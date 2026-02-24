import type { PriceSource, PriceResult, ListingItem, GearboxType } from "./types";
import { detectGearboxType } from "./types";

const WEB_TIMEOUT_MS = 20_000;

const PRICE_REGEX = /(\d[\d\s,.]*)\s*(?:₽|руб|р\.|RUB)/gi;

const GEARBOX_WEB_QUERY: Record<GearboxType, (oem: string) => string> = {
  акпп: (oem) => `АКПП автомат ${oem} контрактная купить цена`,
  мкпп: (oem) => `МКПП механика ${oem} контрактная купить цена`,
  вариатор: (oem) => `вариатор CVT ${oem} контрактный купить цена`,
  dsg: (oem) => `DSG ${oem} контрактная купить цена`,
  ркпп: (oem) => `РКПП робот AMT ${oem} контрактная купить цена`,
  unknown: (oem) => `КПП OEM ${oem} контрактная купить цена`,
};

function extractPrices(text: string): number[] {
  const prices: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = PRICE_REGEX.exec(text)) !== null) {
    const cleaned = match[1].replace(/[\s,.]/g, "");
    const num = parseInt(cleaned, 10);
    if (Number.isFinite(num) && num >= 1000 && num <= 10_000_000) {
      prices.push(num);
    }
  }
  return prices;
}

export class WebSource implements PriceSource {
  name = "web";

  async fetchPrices(searchQuery: string, explicitGearboxType?: GearboxType): Promise<PriceResult | null> {
    const serpApiKey = process.env.SERP_API_KEY;
    if (!serpApiKey) {
      console.log("[WebSource] SERP_API_KEY not set, skipping");
      return null;
    }

    const gearboxType = explicitGearboxType ?? detectGearboxType(searchQuery);
    const rawQuery = GEARBOX_WEB_QUERY[gearboxType](searchQuery);
    const query = encodeURIComponent(rawQuery);
    const url = `https://serpapi.com/search.json?q=${query}&hl=ru&gl=ru&num=10&api_key=${serpApiKey}`;

    console.log(`[WebSource] Searching: ${searchQuery}, gearbox: ${gearboxType}, query: ${rawQuery}`);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEB_TIMEOUT_MS);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok) {
        console.warn(`[WebSource] SerpAPI HTTP ${response.status} for query ${searchQuery}`);
        return null;
      }

      const data = await response.json() as {
        organic_results?: Array<{ title?: string; snippet?: string; link?: string }>;
      };

      const results = data.organic_results ?? [];
      const listings: ListingItem[] = [];

      for (const item of results) {
        const snippet = item.snippet ?? "";
        const title = item.title ?? "";
        const prices = extractPrices(`${title} ${snippet}`);

        for (const price of prices) {
          listings.push({
            title: title.slice(0, 200),
            price,
            condition: "contract",
            seller: `web:${new URL(item.link ?? "https://unknown").hostname}`,
            url: item.link ?? "",
          });
        }
      }

      if (listings.length === 0) {
        console.log(`[WebSource] No prices found in search results for query ${searchQuery}`);
        return null;
      }

      const prices = listings.map((l) => l.price);
      const result: PriceResult = {
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        avgPrice: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
        currency: "RUB",
        listings,
        source: "web",
      };

      console.log(`[WebSource] Found ${listings.length} price mentions for query ${searchQuery}: ${result.minPrice}–${result.maxPrice}`);
      return result;
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.warn(`[WebSource] Timeout for query ${searchQuery}`);
      } else {
        console.warn(`[WebSource] Error for query ${searchQuery}:`, error.message);
      }
      return null;
    }
  }
}
