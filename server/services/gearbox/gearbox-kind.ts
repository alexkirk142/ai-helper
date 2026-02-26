/**
 * Canonical gearbox kind — the single source of truth for gearbox classification.
 *
 * The codebase has two incompatible gearbox representations:
 *   A) VehicleContext.gearboxType  → "AT" | "MT" | "CVT"          (PartsAPI / GPT extractor)
 *   B) price-search GearboxType   → "акпп" | "мкпп" | "вариатор"  (server/services/price-sources/types.ts)
 *
 * GearboxKind is the canonical bridge. Use the converters below whenever code
 * crosses the boundary between A and B.
 *
 * Backward-compatibility contract:
 *   - GearboxType union in price-sources/types.ts is NOT changed.
 *   - VehicleContext.gearboxType field is NOT renamed.
 *   - Queue payload shapes are NOT changed.
 */

import type { GearboxType } from "../price-sources/types";

// ─── Canonical type ───────────────────────────────────────────────────────────

/**
 * Canonical gearbox kind, independent of both representation systems.
 *
 * Superset of VehicleContext ("AT"|"MT"|"CVT") because the price-search
 * GearboxType also covers DCT and AMT.  Canonical kind carries full type
 * information; callers can project it back to either representation as needed.
 */
export type GearboxKind = "AT" | "MT" | "CVT" | "DCT" | "AMT" | "UNKNOWN";

// ─── Converters ───────────────────────────────────────────────────────────────

/**
 * Convert VehicleContext.gearboxType ("AT" | "MT" | "CVT") → GearboxKind.
 * Any unrecognised or absent value maps to "UNKNOWN".
 */
export function fromVehicleContextGearboxType(
  input: string | null | undefined
): GearboxKind {
  switch (input?.toUpperCase()) {
    case "AT":  return "AT";
    case "MT":  return "MT";
    case "CVT": return "CVT";
    default:    return "UNKNOWN";
  }
}

/**
 * Convert price-search GearboxType ("акпп" | "мкпп" | ...) → GearboxKind.
 * "unknown" and any unrecognised value map to "UNKNOWN".
 */
export function fromPriceSearchGearboxType(
  input: GearboxType | string | null | undefined
): GearboxKind {
  switch (input) {
    case "акпп":    return "AT";
    case "мкпп":    return "MT";
    case "вариатор": return "CVT";
    case "dsg":     return "DCT";
    case "ркпп":    return "AMT";
    case "unknown": return "UNKNOWN";
    default:        return "UNKNOWN";
  }
}

/**
 * Convert GearboxKind → price-search GearboxType.
 * Exhaustive — every GearboxKind value has a defined mapping.
 * DCT → "dsg", AMT → "ркпп" (closest Russian equivalents).
 */
export function toPriceSearchGearboxType(kind: GearboxKind): GearboxType {
  switch (kind) {
    case "AT":      return "акпп";
    case "MT":      return "мкпп";
    case "CVT":     return "вариатор";
    case "DCT":     return "dsg";
    case "AMT":     return "ркпп";
    case "UNKNOWN": return "unknown";
  }
}

/**
 * Human-readable Russian label for customer-facing text and log messages.
 * UNKNOWN → neutral "КПП" to avoid incorrect type assertion.
 */
export function toHumanRu(kind: GearboxKind): string {
  switch (kind) {
    case "AT":      return "АКПП";
    case "MT":      return "МКПП";
    case "CVT":     return "вариатор";
    case "DCT":     return "DSG";
    case "AMT":     return "РКПП";
    case "UNKNOWN": return "КПП";
  }
}
