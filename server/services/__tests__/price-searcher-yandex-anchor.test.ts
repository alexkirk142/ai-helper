/**
 * Unit tests for the Yandex anchor-selection refactor (Step 7 / YANDEX_PREFER_MODELNAME).
 *
 * Covers:
 *   - isValidMarketModelName()  — market model validity guard
 *   - selectYandexAnchor()      — anchor-selection policy
 *   - buildYandexQueries()      — full query generation, flag ON and OFF
 *
 * No network, no DB, no GPT — pure function tests only.
 *
 * Run: npx vitest run server/services/__tests__/price-searcher-yandex-anchor.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  isValidMarketModelName,
  selectYandexAnchor,
  buildYandexQueries,
} from "../price-searcher";

// ─────────────────────────────────────────────────────────────────────────────
// isValidMarketModelName
// ─────────────────────────────────────────────────────────────────────────────

describe("isValidMarketModelName", () => {
  // Valid market model codes
  it("accepts JF011E", () => expect(isValidMarketModelName("JF011E")).toBe(true));
  it("accepts JF016E", () => expect(isValidMarketModelName("JF016E")).toBe(true));
  it("accepts W5MBB", () => expect(isValidMarketModelName("W5MBB")).toBe(true));
  it("accepts RE0F11A", () => expect(isValidMarketModelName("RE0F11A")).toBe(true));
  it("accepts AW55-51SN (hyphen)", () => expect(isValidMarketModelName("AW55-51SN")).toBe(true));
  it("accepts FAU(5A) (parens)", () => expect(isValidMarketModelName("FAU(5A)")).toBe(true));
  it("accepts 6HP19", () => expect(isValidMarketModelName("6HP19")).toBe(true));

  // Catalog / OEM codes — must be rejected (4+ consecutive digits)
  it("rejects 2500A230 (4 trailing digits)", () =>
    expect(isValidMarketModelName("2500A230")).toBe(false));
  it("rejects 31020-3VX2D (part number-like; no 4+ digit run, but pattern fails)", () => {
    // 31020 contains 5 consecutive digits → rejected
    expect(isValidMarketModelName("31020-3VX2D")).toBe(false);
  });
  it("rejects M3MHD987579 (6 consecutive digits)", () =>
    expect(isValidMarketModelName("M3MHD987579")).toBe(false));

  // Generic type labels — must be rejected
  it("rejects 'AT'", () => expect(isValidMarketModelName("AT")).toBe(false));
  it("rejects 'CVT'", () => expect(isValidMarketModelName("CVT")).toBe(false));
  it("rejects 'АКПП'", () => expect(isValidMarketModelName("АКПП")).toBe(false));
  it("rejects 'AUTOMATIC'", () => expect(isValidMarketModelName("AUTOMATIC")).toBe(false));

  // Edge cases
  it("rejects null", () => expect(isValidMarketModelName(null)).toBe(false));
  it("rejects undefined", () => expect(isValidMarketModelName(undefined)).toBe(false));
  it("rejects empty string", () => expect(isValidMarketModelName("")).toBe(false));
  it("rejects a 13-char string (too long)", () =>
    expect(isValidMarketModelName("ABCDEFGHIJKLM")).toBe(false));
  it("accepts a 12-char string", () =>
    expect(isValidMarketModelName("ABCDEFGHIJKL")).toBe(true));
});

// ─────────────────────────────────────────────────────────────────────────────
// selectYandexAnchor — policy function
// ─────────────────────────────────────────────────────────────────────────────

describe("selectYandexAnchor — PN input", () => {
  it("prefers modelName when PN input and modelName is valid", () => {
    expect(selectYandexAnchor("31020-3VX2D", "JF011E", "oemPartNumber")).toBe("JF011E");
  });

  it("falls back to oem when modelName is null", () => {
    expect(selectYandexAnchor("31020-3VX2D", null, "oemPartNumber")).toBe("31020-3VX2D");
  });

  it("falls back to oem when modelName has 4+ digits (catalog code)", () => {
    expect(selectYandexAnchor("31020-3VX2D", "2500A230", "oemPartNumber")).toBe("31020-3VX2D");
  });

  it("falls back to oem when modelName is a type label (AT)", () => {
    expect(selectYandexAnchor("31020-3VX2D", "AT", "oemPartNumber")).toBe("31020-3VX2D");
  });
});

describe("selectYandexAnchor — TC input", () => {
  it("prefers modelName when TC input and modelName differs from oem", () => {
    // TC input resolves to same market code — but modelName is different
    expect(selectYandexAnchor("JF011E", "JF016E", "transmissionCode")).toBe("JF016E");
  });

  it("returns oem when modelName equals oem (no-op)", () => {
    expect(selectYandexAnchor("JF011E", "JF011E", "transmissionCode")).toBe("JF011E");
  });

  it("falls back to oem when modelName is invalid", () => {
    expect(selectYandexAnchor("JF011E", "2500A230", "transmissionCode")).toBe("JF011E");
  });
});

describe("selectYandexAnchor — legacy input", () => {
  it("prefers modelName when legacy + valid modelName that differs", () => {
    expect(selectYandexAnchor("OLDCODE", "JF011E", "legacy")).toBe("JF011E");
  });

  it("returns oem when modelName equals oem", () => {
    expect(selectYandexAnchor("JF011E", "JF011E", "legacy")).toBe("JF011E");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildYandexQueries — flag OFF (snapshot / backward-compat)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildYandexQueries — flag OFF (exact backward compat)", () => {
  it("Q1 uses raw oem, not modelName", () => {
    const qs = buildYandexQueries("31020-3VX2D", "JF011E", "NISSAN", "QASHQAI", "CVT");
    expect(qs[0]).toBe("вариатор 31020-3VX2D купить");
  });

  it("Q2 uses raw oem", () => {
    const qs = buildYandexQueries("31020-3VX2D", "JF011E", "NISSAN", "QASHQAI", "CVT");
    expect(qs[1]).toBe("вариатор NISSAN QASHQAI 31020-3VX2D контрактная");
  });

  it("Q3 uses modelName (valid, != oem)", () => {
    const qs = buildYandexQueries("31020-3VX2D", "JF011E", "NISSAN", "QASHQAI", "CVT");
    expect(qs[2]).toBe("вариатор JF011E NISSAN купить");
  });

  it("Q4 is modelName цена", () => {
    const qs = buildYandexQueries("31020-3VX2D", "JF011E", "NISSAN", "QASHQAI", "CVT");
    expect(qs[3]).toBe("вариатор JF011E цена");
  });

  it("produces exactly 4 queries when make+model+modelName all present", () => {
    const qs = buildYandexQueries("31020-3VX2D", "JF011E", "NISSAN", "QASHQAI", "CVT");
    expect(qs).toHaveLength(4);
  });

  it("omits Q3/Q4 when modelName has 4+ digits", () => {
    const qs = buildYandexQueries("2500A230", "2500A230", "NISSAN", "X-TRAIL", "AT");
    // modelName === oem, so Q3/Q4 condition (modelName !== oem) is false
    expect(qs).toHaveLength(2);
  });

  it("omits Q2 when make is absent", () => {
    const qs = buildYandexQueries("JF011E", null, null, null, "CVT");
    expect(qs).toHaveLength(1);
    expect(qs[0]).toBe("вариатор JF011E купить");
  });

  it("produces Q2 with make only (no model)", () => {
    const qs = buildYandexQueries("JF011E", null, "NISSAN", null, "AT");
    expect(qs[1]).toBe("АКПП NISSAN JF011E контрактная");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildYandexQueries — flag ON, PN input, valid modelName
// ─────────────────────────────────────────────────────────────────────────────

describe("buildYandexQueries — flag ON, PN + valid modelName", () => {
  const flagOpts = { flagEnabled: true, inputKind: "oemPartNumber" as const };

  it("Q1 uses modelName as anchor", () => {
    const qs = buildYandexQueries("31020-3VX2D", "JF011E", "NISSAN", "QASHQAI", "CVT", flagOpts);
    expect(qs[0]).toBe("вариатор JF011E купить");
  });

  it("Q2 includes modelName and appends raw PN as secondary token", () => {
    const qs = buildYandexQueries("31020-3VX2D", "JF011E", "NISSAN", "QASHQAI", "CVT", flagOpts);
    expect(qs[1]).toBe("вариатор NISSAN QASHQAI JF011E 31020-3VX2D контрактная");
  });

  it("PN (oem) appears in at least one query", () => {
    const qs = buildYandexQueries("31020-3VX2D", "JF011E", "NISSAN", "QASHQAI", "CVT", flagOpts);
    const hasPN = qs.some((q) => q.includes("31020-3VX2D"));
    expect(hasPN).toBe(true);
  });

  it("does not emit Q3 identical to Q1 when make is falsy", () => {
    // Without make: Q3 candidate = "вариатор JF011E undefined купить"
    // Q1 = "вариатор JF011E купить" — different (contains "undefined"), not a dup
    // But more importantly, no actual duplicate
    const qs = buildYandexQueries("31020-3VX2D", "JF011E", null, null, "CVT", flagOpts);
    const unique = new Set(qs);
    expect(unique.size).toBe(qs.length);
  });

  it("does not exceed 4 queries", () => {
    const qs = buildYandexQueries("31020-3VX2D", "JF011E", "NISSAN", "QASHQAI", "CVT", flagOpts);
    expect(qs.length).toBeLessThanOrEqual(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildYandexQueries — flag ON, TC input
// ─────────────────────────────────────────────────────────────────────────────

describe("buildYandexQueries — flag ON, TC input", () => {
  const flagOpts = { flagEnabled: true, inputKind: "transmissionCode" as const };

  it("Q1 uses oem when modelName === oem (TC resolved same code)", () => {
    const qs = buildYandexQueries("JF011E", "JF011E", "NISSAN", "QASHQAI", "CVT", flagOpts);
    expect(qs[0]).toBe("вариатор JF011E купить");
    // No secondary PN suffix since anchorTerm === oem
    expect(qs[1]).toBe("вариатор NISSAN QASHQAI JF011E контрактная");
  });

  it("Q1 uses modelName when TC resolves to a DIFFERENT valid code", () => {
    const qs = buildYandexQueries("JF011E", "JF016E", "NISSAN", "X-TRAIL", "CVT", flagOpts);
    expect(qs[0]).toBe("вариатор JF016E купить");
  });

  it("Q1 stays as oem when modelName invalid (has 4+ digits)", () => {
    const qs = buildYandexQueries("JF011E", "2500A230", "NISSAN", "X-TRAIL", "CVT", flagOpts);
    expect(qs[0]).toBe("вариатор JF011E купить");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildYandexQueries — flag ON, invalid modelName → falls back to oem
// ─────────────────────────────────────────────────────────────────────────────

describe("buildYandexQueries — flag ON, invalid/null modelName", () => {
  it("null modelName → Q1 uses oem", () => {
    const qs = buildYandexQueries(
      "31020-3VX2D", null, "NISSAN", "QASHQAI", "CVT",
      { flagEnabled: true, inputKind: "oemPartNumber" }
    );
    expect(qs[0]).toBe("вариатор 31020-3VX2D купить");
  });

  it("catalog code modelName → Q1 uses oem", () => {
    const qs = buildYandexQueries(
      "31020-3VX2D", "2500A230", "NISSAN", "QASHQAI", "CVT",
      { flagEnabled: true, inputKind: "oemPartNumber" }
    );
    expect(qs[0]).toBe("вариатор 31020-3VX2D купить");
  });

  it("type label modelName → Q1 uses oem", () => {
    const qs = buildYandexQueries(
      "31020-3VX2D", "CVT", "NISSAN", "QASHQAI", "CVT",
      { flagEnabled: true, inputKind: "oemPartNumber" }
    );
    expect(qs[0]).toBe("вариатор 31020-3VX2D купить");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildYandexQueries — no queries are emitted twice (dedup invariant)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildYandexQueries — no duplicate queries", () => {
  const cases: Array<[string, string | null, string | null, string | null, string | null, object | undefined]> = [
    ["JF011E", "JF011E", "NISSAN", "QASHQAI", "CVT", undefined],
    ["31020-3VX2D", "JF011E", "NISSAN", "QASHQAI", "CVT", undefined],
    ["31020-3VX2D", "JF011E", "NISSAN", "QASHQAI", "CVT", { flagEnabled: true, inputKind: "oemPartNumber" }],
    ["JF011E", null, null, null, null, undefined],
    ["JF011E", "JF016E", "TOYOTA", "CAMRY", "AT", { flagEnabled: true, inputKind: "transmissionCode" }],
  ];

  for (const [oem, model, make, vModel, gearbox, opts] of cases) {
    it(`no duplicates: oem=${oem} modelName=${model} flag=${(opts as any)?.flagEnabled ?? false}`, () => {
      const qs = buildYandexQueries(oem, model, make, vModel, gearbox, opts as any);
      expect(new Set(qs).size).toBe(qs.length);
    });
  }
});
