import * as cheerio from "cheerio";
import type { PriceSource, PriceResult, ListingItem, GearboxType } from "./types";
import { detectGearboxType, GEARBOX_TYPE_SEARCH_TERM, GEARBOX_TYPE_KEYWORDS } from "./types";

const AVITO_TIMEOUT_MS = 15_000;
const AVITO_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const GENERIC_GEARBOX_KEYWORDS = [
  "контракт",
  "кпп",
  "коробка",
];

function matchesGearboxType(text: string, gearboxTypeKeywords: string[]): boolean {
  const lower = text.toLowerCase();
  const hasTypeKeyword = gearboxTypeKeywords.length === 0 || gearboxTypeKeywords.some((kw) => lower.includes(kw));
  const hasGenericKeyword = GENERIC_GEARBOX_KEYWORDS.some((kw) => lower.includes(kw));
  return hasTypeKeyword || hasGenericKeyword;
}

function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d]/g, "");
  const num = parseInt(cleaned, 10);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export class AvitoSource implements PriceSource {
  name = "avito";

  async fetchPrices(searchQuery: string, explicitGearboxType?: GearboxType): Promise<PriceResult | null> {
    if (process.env.AVITO_ENABLED !== "true") {
      console.log("[AvitoSource] Disabled (AVITO_ENABLED !== true), skipping");
      return null;
    }

    const gearboxType = explicitGearboxType ?? detectGearboxType(searchQuery);
    const searchTerm = GEARBOX_TYPE_SEARCH_TERM[gearboxType];
    const filterKeywords = GEARBOX_TYPE_KEYWORDS[gearboxType];

    const query = encodeURIComponent(`${searchQuery} ${searchTerm}`);
    const url = `https://www.avito.ru/rossiya/zapchasti_i_aksessuary?q=${query}`;

    console.log(`[AvitoSource] Searching: ${searchQuery}, gearbox: ${gearboxType}, query: ${searchQuery} ${searchTerm}`);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AVITO_TIMEOUT_MS);

      const response = await fetch(url, {
        headers: {
          "User-Agent": AVITO_USER_AGENT,
          "Accept-Language": "ru-RU,ru;q=0.9",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        console.warn(`[AvitoSource] HTTP ${response.status} for query ${searchQuery}`);
        return null;
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const listings: ListingItem[] = [];

      $("[data-marker='item']").each((_i, el) => {
        const titleEl = $(el).find("[itemprop='name']");
        const priceEl = $(el).find("[itemprop='price']");
        const linkEl = $(el).find("a[itemprop='url']");
        const locationEl = $(el).find("[class*='geo']");

        const title = titleEl.text().trim();
        const priceAttr = priceEl.attr("content") || priceEl.text();
        const price = parsePrice(priceAttr);
        const href = linkEl.attr("href");
        const seller = $(el).find("[data-marker='item-address']").text().trim() || "Авито";
        const location = locationEl.text().trim() || undefined;

        if (!title || !price || !matchesGearboxType(title, filterKeywords)) return;

        listings.push({
          title,
          price,
          condition: "contract",
          seller,
          url: href ? `https://www.avito.ru${href}` : url,
          location,
        });
      });

      if (listings.length === 0) {
        console.log(`[AvitoSource] No relevant listings for query ${searchQuery} (gearbox: ${gearboxType})`);
        return null;
      }

      const prices = listings.map((l) => l.price);
      const result: PriceResult = {
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        avgPrice: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
        currency: "RUB",
        listings,
        source: "avito",
      };

      console.log(`[AvitoSource] Found ${listings.length} listings for query ${searchQuery}: ${result.minPrice}–${result.maxPrice}`);
      return result;
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.warn(`[AvitoSource] Timeout for query ${searchQuery}`);
      } else {
        console.warn(`[AvitoSource] Error for query ${searchQuery}:`, error.message);
      }
      return null;
    }
  }
}
