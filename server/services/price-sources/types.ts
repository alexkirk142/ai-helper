export interface ListingItem {
  title: string;
  price: number;
  condition: "contract" | "used" | "new";
  seller: string;
  url: string;
  location?: string;
  postedAt?: string;
  city?: string | null;
  sourceUrl?: string;
}

export interface PriceResult {
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  currency: string;
  listings: ListingItem[];
  source: string;
}

export interface PriceSource {
  name: string;
  fetchPrices(query: string, gearboxType?: GearboxType): Promise<PriceResult | null>;
}

export type GearboxType = "акпп" | "мкпп" | "вариатор" | "dsg" | "ркпп" | "unknown";

export const GEARBOX_TYPE_KEYWORDS: Record<GearboxType, string[]> = {
  акпп: ["акпп", "автомат", "автоматическая", "at"],
  мкпп: ["мкпп", "механика", "механическая", "mt"],
  вариатор: ["вариатор", "cvt", "бесступенчатая"],
  dsg: ["dsg", "dct"],
  ркпп: ["ркпп", "робот", "роботизированная", "amt", "секвентальная"],
  unknown: [],
};

export const GEARBOX_TYPE_SEARCH_TERM: Record<GearboxType, string> = {
  акпп: "АКПП автомат контрактная",
  мкпп: "МКПП механика контрактная",
  вариатор: "вариатор CVT контрактный",
  dsg: "DSG контрактная",
  ркпп: "РКПП робот контрактная",
  unknown: "КПП контрактная",
};

/**
 * Detect gearbox type from free-form text (customer message or model name).
 * DSG is checked before РКПП to avoid "робот"/"роботизированная" false positive.
 */
export function detectGearboxType(text: string): GearboxType {
  const lower = text.toLowerCase();
  const orderedTypes: GearboxType[] = ["dsg", "акпп", "мкпп", "вариатор", "ркпп"];
  for (const type of orderedTypes) {
    if (GEARBOX_TYPE_KEYWORDS[type].some((kw) => lower.includes(kw))) {
      return type;
    }
  }
  return "unknown";
}
