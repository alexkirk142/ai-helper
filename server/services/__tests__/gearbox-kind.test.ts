/**
 * Unit tests for server/services/gearbox/gearbox-kind.ts
 *
 * Pure-function tests only — no DB, no queue, no network I/O.
 * These converters form the bridge between:
 *   A) VehicleContext.gearboxType ("AT"|"MT"|"CVT")
 *   B) price-search GearboxType   ("акпп"|"мкпп"|"вариатор"|"dsg"|"ркпп"|"unknown")
 */

import { describe, it, expect } from "vitest";
import {
  fromVehicleContextGearboxType,
  fromPriceSearchGearboxType,
  toPriceSearchGearboxType,
  toHumanRu,
  type GearboxKind,
} from "../gearbox/gearbox-kind";
import type { GearboxType } from "../price-sources/types";

// ─────────────────────────────────────────────────────────────────────────────
// fromVehicleContextGearboxType
// ─────────────────────────────────────────────────────────────────────────────

describe("fromVehicleContextGearboxType", () => {
  it('maps "AT" → "AT"', () => {
    expect(fromVehicleContextGearboxType("AT")).toBe("AT");
  });

  it('maps "MT" → "MT"', () => {
    expect(fromVehicleContextGearboxType("MT")).toBe("MT");
  });

  it('maps "CVT" → "CVT"', () => {
    expect(fromVehicleContextGearboxType("CVT")).toBe("CVT");
  });

  it("is case-insensitive (lowercase input)", () => {
    expect(fromVehicleContextGearboxType("at")).toBe("AT");
    expect(fromVehicleContextGearboxType("mt")).toBe("MT");
    expect(fromVehicleContextGearboxType("cvt")).toBe("CVT");
  });

  it('maps null → "UNKNOWN"', () => {
    expect(fromVehicleContextGearboxType(null)).toBe("UNKNOWN");
  });

  it('maps undefined → "UNKNOWN"', () => {
    expect(fromVehicleContextGearboxType(undefined)).toBe("UNKNOWN");
  });

  it('maps empty string → "UNKNOWN"', () => {
    expect(fromVehicleContextGearboxType("")).toBe("UNKNOWN");
  });

  it('maps unknown string → "UNKNOWN"', () => {
    expect(fromVehicleContextGearboxType("DSG")).toBe("UNKNOWN");
    expect(fromVehicleContextGearboxType("АКПП")).toBe("UNKNOWN");
    expect(fromVehicleContextGearboxType("акпп")).toBe("UNKNOWN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fromPriceSearchGearboxType
// ─────────────────────────────────────────────────────────────────────────────

describe("fromPriceSearchGearboxType", () => {
  const cases: [GearboxType, GearboxKind][] = [
    ["акпп",    "AT"],
    ["мкпп",    "MT"],
    ["вариатор","CVT"],
    ["dsg",     "DCT"],
    ["ркпп",    "AMT"],
    ["unknown", "UNKNOWN"],
  ];

  for (const [input, expected] of cases) {
    it(`maps "${input}" → "${expected}"`, () => {
      expect(fromPriceSearchGearboxType(input)).toBe(expected);
    });
  }

  it('maps null → "UNKNOWN"', () => {
    expect(fromPriceSearchGearboxType(null)).toBe("UNKNOWN");
  });

  it('maps undefined → "UNKNOWN"', () => {
    expect(fromPriceSearchGearboxType(undefined)).toBe("UNKNOWN");
  });

  it('maps arbitrary string → "UNKNOWN"', () => {
    expect(fromPriceSearchGearboxType("АТ")).toBe("UNKNOWN");
    expect(fromPriceSearchGearboxType("AT")).toBe("UNKNOWN");
    expect(fromPriceSearchGearboxType("robotic")).toBe("UNKNOWN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toPriceSearchGearboxType
// ─────────────────────────────────────────────────────────────────────────────

describe("toPriceSearchGearboxType", () => {
  const cases: [GearboxKind, GearboxType][] = [
    ["AT",      "акпп"],
    ["MT",      "мкпп"],
    ["CVT",     "вариатор"],
    ["DCT",     "dsg"],
    ["AMT",     "ркпп"],
    ["UNKNOWN", "unknown"],
  ];

  for (const [input, expected] of cases) {
    it(`maps "${input}" → "${expected}"`, () => {
      expect(toPriceSearchGearboxType(input)).toBe(expected);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// toHumanRu
// ─────────────────────────────────────────────────────────────────────────────

describe("toHumanRu", () => {
  const cases: [GearboxKind, string][] = [
    ["AT",      "АКПП"],
    ["MT",      "МКПП"],
    ["CVT",     "вариатор"],
    ["DCT",     "DSG"],
    ["AMT",     "РКПП"],
    ["UNKNOWN", "КПП"],
  ];

  for (const [input, expected] of cases) {
    it(`maps "${input}" → "${expected}"`, () => {
      expect(toHumanRu(input)).toBe(expected);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip tests (VehicleContext → GearboxKind → GearboxType → GearboxKind)
// ─────────────────────────────────────────────────────────────────────────────

describe("round-trip: VehicleContext → GearboxKind → price-search GearboxType", () => {
  const vcTypes = ["AT", "MT", "CVT"] as const;

  for (const vc of vcTypes) {
    it(`${vc}: fromVehicleContextGearboxType → toPriceSearchGearboxType → fromPriceSearchGearboxType is stable`, () => {
      const kind = fromVehicleContextGearboxType(vc);
      const priceType = toPriceSearchGearboxType(kind);
      const kindBack = fromPriceSearchGearboxType(priceType);
      expect(kindBack).toBe(kind);
    });
  }

  it("UNKNOWN is stable across round-trip", () => {
    const kind = fromVehicleContextGearboxType(null);
    expect(kind).toBe("UNKNOWN");
    const priceType = toPriceSearchGearboxType(kind);
    expect(priceType).toBe("unknown");
    expect(fromPriceSearchGearboxType(priceType)).toBe("UNKNOWN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration boundary: VehicleContext.gearboxType → SearchFallback.gearboxType
// (mirrors the conversion used in vehicle-lookup.worker.ts MODEL_ONLY path)
// ─────────────────────────────────────────────────────────────────────────────

describe("SearchFallback conversion boundary", () => {
  function vehicleContextToSearchFallbackGearboxType(
    vcGearboxType: string | null | undefined
  ): GearboxType {
    return toPriceSearchGearboxType(fromVehicleContextGearboxType(vcGearboxType));
  }

  it('converts "AT" to "акпп" for SearchFallback', () => {
    expect(vehicleContextToSearchFallbackGearboxType("AT")).toBe("акпп");
  });

  it('converts "MT" to "мкпп" for SearchFallback', () => {
    expect(vehicleContextToSearchFallbackGearboxType("MT")).toBe("мкпп");
  });

  it('converts "CVT" to "вариатор" for SearchFallback', () => {
    expect(vehicleContextToSearchFallbackGearboxType("CVT")).toBe("вариатор");
  });

  it('converts null to "unknown" for SearchFallback (safe fallback)', () => {
    expect(vehicleContextToSearchFallbackGearboxType(null)).toBe("unknown");
  });
});
