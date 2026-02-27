const YANDEX_SEARCH_URL = "https://searchapi.api.cloud.yandex.net/v2/web/search";

export const DOMAIN_PRIORITY_SCORES: Record<string, number> = {
  // Tier 1 — Playwright works reliably, high listing density
  "baza.drom.ru": 10,
  "farpost.ru": 10,
  "japancar.ru": 9,
  "dvsavto.ru": 9,
  "qx9.ru": 8,
  "kor-motor.ru": 8,
  "avtgr.ru": 8,
  // Tier 2 — good source but Playwright has occasional issues
  "exist.ru": 7,
  "emex.ru": 7,
  "abcp.ru": 7,
  "bibika.ru": 6,
  // Avito: strong anti-bot, Playwright always returns 0 — GPT web_search handles it instead
  "avito.ru": 1,
};

const EXCLUDED_DOMAINS = [
  "youtube.com",
  "wikipedia.org",
  "auto.ru/catalog",
  "drive2.ru",
  "zr.ru",
  "autodata.ru",
];

export interface YandexSearchResult {
  url: string;
  title: string;
  snippet: string;
  domain: string;
  priorityScore: number;
}

export async function searchYandex(
  query: string,
  maxResults = 5
): Promise<YandexSearchResult[]> {
  const apiKey = process.env.YANDEX_SEARCH_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID;

  if (!apiKey || !folderId) {
    console.log("[YandexSource] YANDEX_SEARCH_API_KEY or YANDEX_FOLDER_ID not set, skipping");
    return [];
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(YANDEX_SEARCH_URL, {
      method: "POST",
      headers: {
        "Authorization": `Api-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: {
          searchType: "SEARCH_TYPE_RU",
          queryText: query,
          familyMode: "FAMILY_MODE_NONE",
          page: 0,
        },
        sortSpec: {
          sortMode: "SORT_MODE_BY_RELEVANCE",
        },
        groupSpec: {
          groupMode: "GROUP_MODE_FLAT",
          groupsOnPage: maxResults,
          docsInGroup: 1,
        },
        maxPassages: 2,
        folderId,
        region: "225",
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    console.log("[YandexSource] Response status:", res.status);

    if (res.status === 429) {
      console.warn("[YandexSource] Rate limit hit (429), returning []");
      return [];
    }
    if (res.status === 401) {
      console.warn("[YandexSource] Invalid API key (401), returning []");
      return [];
    }
    if (!res.ok) {
      console.warn(`[YandexSource] HTTP ${res.status} for query: ${query}`);
      return [];
    }

    const rawText = await res.text();
    const data = JSON.parse(rawText) as any;

    const xmlString = Buffer.from(data.rawData, "base64").toString("utf-8");

    const urlMatches = [...xmlString.matchAll(/<url>([^<]+)<\/url>/g)].map(m => m[1]);
    const titleMatches = [...xmlString.matchAll(/<title>([^<]+)<\/title>/g)].map(m => m[1]);
    const snippetMatches = [...xmlString.matchAll(/<(?:passage|headline)>([^<]+)<\/(?:passage|headline)>/g)].map(m => m[1]);
    const domainMatches = [...xmlString.matchAll(/<domain>([^<]+)<\/domain>/g)].map(m => m[1]);

    return urlMatches
      .map((url, i) => ({
        url,
        title: titleMatches[i] ?? "",
        snippet: snippetMatches[i] ?? "",
        domain: domainMatches[i] ?? extractDomain(url),
        priorityScore: getDomainScore(domainMatches[i] ?? extractDomain(url)),
      }))
      .filter(r => !isExcludedDomain(r.url))
      .sort((a, b) => b.priorityScore - a.priorityScore);

  } catch (err: any) {
    if (err?.name === "AbortError") {
      console.warn("[YandexSource] Request timed out for query:", query);
    } else {
      console.warn("[YandexSource] Error:", err?.message);
    }
    return [];
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

function getDomainScore(domain: string): number {
  for (const [key, score] of Object.entries(DOMAIN_PRIORITY_SCORES)) {
    if (domain.includes(key)) return score;
  }
  return 2; // any other .ru domain
}

function isExcludedDomain(url: string): boolean {
  return EXCLUDED_DOMAINS.some((d) => url.includes(d));
}
