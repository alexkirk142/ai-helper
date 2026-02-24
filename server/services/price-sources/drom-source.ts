import * as cheerio from "cheerio";
import type { PriceSource, PriceResult, ListingItem, GearboxType } from "./types";
import { detectGearboxType } from "./types";

const DROM_TIMEOUT_MS = 15_000;
const DROM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DROM_CATEGORY_PATH: Record<GearboxType, string> = {
  акпп: "/sell/akpp/",
  dsg: "/sell/akpp/",
  мкпп: "/sell/mkpp/",
  вариатор: "/sell/variator/",
  ркпп: "/sell/robot/",
  unknown: "/sell/akpp/",
};

function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d]/g, "");
  const num = parseInt(cleaned, 10);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export class DromSource implements PriceSource {
  name = "drom";

  async fetchPrices(searchQuery: string, explicitGearboxType?: GearboxType): Promise<PriceResult | null> {
    if (process.env.DROM_ENABLED !== "true") {
      console.log("[DromSource] Disabled (DROM_ENABLED !== true), skipping");
      return null;
    }

    const gearboxType = explicitGearboxType ?? detectGearboxType(searchQuery);
    const categoryPath = DROM_CATEGORY_PATH[gearboxType];
    const query = encodeURIComponent(searchQuery);
    const url = `https://baza.drom.ru${categoryPath}?q=${query}`;

    console.log(`[DromSource] Searching: ${searchQuery}, gearbox: ${gearboxType}, url: ${url}`);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DROM_TIMEOUT_MS);

      const response = await fetch(url, {
        headers: {
          "User-Agent": DROM_USER_AGENT,
          "Accept-Language": "ru-RU,ru;q=0.9",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        console.warn(`[DromSource] HTTP ${response.status} for query ${searchQuery}`);
        return null;
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const listings: ListingItem[] = [];

      $("[data-bull-item]").each((_i, el) => {
        const titleEl = $(el).find(".bull-item__title, .bull-item-content__subject-container a");
        const priceEl = $(el).find(".bull-item__price, .price-block__price");
        const linkEl = $(el).find("a.bull-item__link, .bull-item-content__subject-container a");
        const locationEl = $(el).find(".bull-item__annotation-row, .bull-delivery__city");

        const title = titleEl.text().trim();
        const priceText = priceEl.text();
        const price = parsePrice(priceText);
        const href = linkEl.attr("href") || "";
        const location = locationEl.text().trim() || undefined;

        if (!title || !price) return;

        listings.push({
          title,
          price,
          condition: "contract",
          seller: "Дром",
          url: href.startsWith("http") ? href : `https://baza.drom.ru${href}`,
          location,
        });
      });

      if (listings.length === 0) {
        console.log(`[DromSource] No listings for query ${searchQuery} (gearbox: ${gearboxType})`);
        return null;
      }

      const prices = listings.map((l) => l.price);
      const result: PriceResult = {
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        avgPrice: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
        currency: "RUB",
        listings,
        source: "drom",
      };

      console.log(`[DromSource] Found ${listings.length} listings for query ${searchQuery}: ${result.minPrice}–${result.maxPrice}`);
      return result;
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.warn(`[DromSource] Timeout for query ${searchQuery}`);
      } else {
        console.warn(`[DromSource] Error for query ${searchQuery}:`, error.message);
      }
      return null;
    }
  }
}
