import type { PriceSource, PriceResult, GearboxType } from "./types";

export class MockSource implements PriceSource {
  name = "mock";

  async fetchPrices(searchQuery: string, _gearboxType?: GearboxType): Promise<PriceResult> {
    console.log(`[MockSource] Using mock prices for query ${searchQuery}`);
    return {
      minPrice: 1000,
      maxPrice: 1500,
      avgPrice: 1200,
      currency: "RUB",
      listings: [],
      source: "mock",
    };
  }
}
