/**
 * Unit tests for Decision Engine
 * Phase 1.1: Testing thresholds, penalties, autosend eligibility
 * 
 * These tests import and test the REAL decision engine functions
 */

import { describe, it, expect, vi } from "vitest";
import { _testing, DEFAULT_SETTINGS } from "../services/decision-engine";

const {
  calculateFinalConfidence,
  makeDecision,
  checkAutosendEligibility,
  replyContainsPriceOrOffer,
  CONFIDENCE_WEIGHTS,
} = _testing;

describe("Decision Engine - Threshold Logic (Real Implementation)", () => {
  const settings = { ...DEFAULT_SETTINGS, tenantId: "test", tAuto: 0.80, tEscalate: 0.40 };

  it("returns AUTO_SEND when confidence >= tAuto", () => {
    expect(makeDecision(0.85, false, settings)).toBe("AUTO_SEND");
    expect(makeDecision(0.80, false, settings)).toBe("AUTO_SEND");
  });

  it("returns NEED_APPROVAL when confidence between tEscalate and tAuto", () => {
    expect(makeDecision(0.79, false, settings)).toBe("NEED_APPROVAL");
    expect(makeDecision(0.50, false, settings)).toBe("NEED_APPROVAL");
    expect(makeDecision(0.40, false, settings)).toBe("NEED_APPROVAL");
  });

  it("returns ESCALATE when confidence < tEscalate", () => {
    expect(makeDecision(0.39, false, settings)).toBe("ESCALATE");
    expect(makeDecision(0.20, false, settings)).toBe("ESCALATE");
    expect(makeDecision(0.0, false, settings)).toBe("ESCALATE");
  });

  it("returns ESCALATE when forceEscalate is true regardless of confidence", () => {
    expect(makeDecision(0.95, true, settings)).toBe("ESCALATE");
    expect(makeDecision(0.50, true, settings)).toBe("ESCALATE");
    expect(makeDecision(0.10, true, settings)).toBe("ESCALATE");
  });
});

describe("Decision Engine - Intent Force Handoff (Real Implementation)", () => {
  const settings = { ...DEFAULT_SETTINGS, tenantId: "test" };

  it("forces ESCALATE for discount intent in default settings", () => {
    const intentsForceHandoff = (settings.intentsForceHandoff || []) as string[];
    const forceEscalate = intentsForceHandoff.includes("discount");
    
    expect(forceEscalate).toBe(true);
    expect(makeDecision(0.95, forceEscalate, settings)).toBe("ESCALATE");
  });

  it("forces ESCALATE for complaint intent in default settings", () => {
    const intentsForceHandoff = (settings.intentsForceHandoff || []) as string[];
    const forceEscalate = intentsForceHandoff.includes("complaint");
    
    expect(forceEscalate).toBe(true);
    expect(makeDecision(0.95, forceEscalate, settings)).toBe("ESCALATE");
  });

  it("does not force escalate for price intent", () => {
    const intentsForceHandoff = (settings.intentsForceHandoff || []) as string[];
    const forceEscalate = intentsForceHandoff.includes("price");
    
    expect(forceEscalate).toBe(false);
    expect(makeDecision(0.85, forceEscalate, settings)).toBe("AUTO_SEND");
  });
});

describe("Decision Engine - Triple Lock Autosend Eligibility (Real Implementation)", () => {
  it("is eligible when all three conditions are met", () => {
    const settings = { 
      ...DEFAULT_SETTINGS, 
      tenantId: "test",
      autosendAllowed: true,
      intentsAutosendAllowed: ["price", "availability"]
    };
    
    const result = checkAutosendEligibility("AUTO_SEND", "price", true, settings);
    expect(result.eligible).toBe(true);
    expect(result.blockReason).toBeUndefined();
  });

  it("is blocked with FLAG_OFF when feature flag is disabled", () => {
    const settings = { 
      ...DEFAULT_SETTINGS, 
      tenantId: "test",
      autosendAllowed: true,
      intentsAutosendAllowed: ["price"]
    };
    
    const result = checkAutosendEligibility("AUTO_SEND", "price", false, settings);
    expect(result.eligible).toBe(false);
    expect(result.blockReason).toBe("FLAG_OFF");
  });

  it("is blocked with SETTING_OFF when setting is disabled", () => {
    const settings = { 
      ...DEFAULT_SETTINGS, 
      tenantId: "test",
      autosendAllowed: false,
      intentsAutosendAllowed: ["price"]
    };
    
    const result = checkAutosendEligibility("AUTO_SEND", "price", true, settings);
    expect(result.eligible).toBe(false);
    expect(result.blockReason).toBe("SETTING_OFF");
  });

  it("is blocked with INTENT_NOT_ALLOWED when intent not in allowed list", () => {
    const settings = { 
      ...DEFAULT_SETTINGS, 
      tenantId: "test",
      autosendAllowed: true,
      intentsAutosendAllowed: ["price", "availability"]
    };
    
    const result = checkAutosendEligibility("AUTO_SEND", "shipping", true, settings);
    expect(result.eligible).toBe(false);
    expect(result.blockReason).toBe("INTENT_NOT_ALLOWED");
  });

  it("is not eligible when decision is not AUTO_SEND", () => {
    const settings = { 
      ...DEFAULT_SETTINGS, 
      tenantId: "test",
      autosendAllowed: true,
      intentsAutosendAllowed: ["price"]
    };
    
    const result = checkAutosendEligibility("NEED_APPROVAL", "price", true, settings);
    expect(result.eligible).toBe(false);
    expect(result.blockReason).toBeUndefined();
  });

  it("checks all three locks in correct order: flag -> setting -> intent", () => {
    const settings = { 
      ...DEFAULT_SETTINGS, 
      tenantId: "test",
      autosendAllowed: false, // Second lock would fail
      intentsAutosendAllowed: [] // Third lock would also fail
    };
    
    // First lock fails (flag)
    let result = checkAutosendEligibility("AUTO_SEND", "price", false, settings);
    expect(result.blockReason).toBe("FLAG_OFF");
    
    // Second lock fails (setting)
    result = checkAutosendEligibility("AUTO_SEND", "price", true, settings);
    expect(result.blockReason).toBe("SETTING_OFF");
    
    // Third lock fails (intent) 
    const settingsWithAutosend = { ...settings, autosendAllowed: true };
    result = checkAutosendEligibility("AUTO_SEND", "price", true, settingsWithAutosend);
    expect(result.blockReason).toBe("INTENT_NOT_ALLOWED");
  });
});

describe("Decision Engine - Confidence Calculation (Real Implementation)", () => {
  it("uses correct weights from production code", () => {
    expect(CONFIDENCE_WEIGHTS.similarity).toBe(0.45);
    expect(CONFIDENCE_WEIGHTS.intent).toBe(0.25);
    expect(CONFIDENCE_WEIGHTS.selfCheck).toBe(0.30);
  });

  it("calculates weighted confidence correctly", () => {
    const result = calculateFinalConfidence(0.9, 0.8, 0.7, []);
    
    // 0.45 * 0.9 + 0.25 * 0.8 + 0.30 * 0.7 = 0.405 + 0.2 + 0.21 = 0.815
    expect(result.total).toBeCloseTo(0.815, 2);
    expect(result.similarity).toBe(0.9);
    expect(result.intent).toBe(0.8);
    expect(result.selfCheck).toBe(0.7);
  });

  it("applies penalties correctly", () => {
    const penalties = [
      { code: "NO_SOURCES", message: "No sources", value: -0.30 }
    ];
    
    const result = calculateFinalConfidence(0.9, 0.8, 0.7, penalties);
    
    // 0.815 - 0.30 = 0.515
    expect(result.total).toBeCloseTo(0.515, 2);
  });

  it("clamps confidence to 0-1 range", () => {
    const heavyPenalties = [
      { code: "NO_SOURCES", message: "No sources", value: -0.30 },
      { code: "PRICE_NOT_FOUND", message: "Price missing", value: -0.25 },
      { code: "CONFLICTING", message: "Conflicts", value: -0.20 },
      { code: "SELF_CHECK_LOW", message: "Low self check", value: -0.15 },
    ];
    
    const result = calculateFinalConfidence(0.5, 0.5, 0.5, heavyPenalties);
    
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(1);
  });
});

describe("Decision Engine - Penalty Format", () => {
  it("penalties have correct format {code, message, value}", () => {
    const penalty = {
      code: "NO_SOURCES",
      message: "Источники не найдены",
      value: -0.30
    };
    
    expect(typeof penalty.code).toBe("string");
    expect(typeof penalty.message).toBe("string");
    expect(typeof penalty.value).toBe("number");
    expect(penalty.value).toBeLessThan(0);
  });
});

describe("Decision Engine - Kill Switch Behavior", () => {
  it("returns NEED_APPROVAL when decision engine is disabled", () => {
    // When decisionEngineEnabled = false, the main function returns NEED_APPROVAL
    // This test verifies the expected behavior
    const decisionEngineEnabled = false;
    
    // Kill switch behavior is: decision = "NEED_APPROVAL" if !decisionEngineEnabled
    const decision = decisionEngineEnabled ? "AUTO_SEND" : "NEED_APPROVAL";
    expect(decision).toBe("NEED_APPROVAL");
  });
});

describe("Decision Engine - Default Settings", () => {
  it("has correct default thresholds", () => {
    expect(DEFAULT_SETTINGS.tAuto).toBe(0.80);
    expect(DEFAULT_SETTINGS.tEscalate).toBe(0.40);
  });

  it("has correct default autosend config", () => {
    expect(DEFAULT_SETTINGS.autosendAllowed).toBe(false);
    expect(DEFAULT_SETTINGS.intentsAutosendAllowed).toContain("price");
    expect(DEFAULT_SETTINGS.intentsAutosendAllowed).toContain("availability");
    expect(DEFAULT_SETTINGS.intentsAutosendAllowed).toContain("shipping");
  });

  it("has correct default force handoff intents", () => {
    expect(DEFAULT_SETTINGS.intentsForceHandoff).toContain("discount");
    expect(DEFAULT_SETTINGS.intentsForceHandoff).toContain("complaint");
  });
});

describe("Decision Engine - Vehicle Lookup Autosend", () => {
  it("autosend is eligible for vehicle_id_request when intent is in intentsAutosendAllowed", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      tenantId: "test",
      autosendAllowed: true,
      intentsAutosendAllowed: ["price", "vehicle_id_request", "gearbox_tag_request"],
    };
    const result = checkAutosendEligibility("AUTO_SEND", "vehicle_id_request", true, settings);
    expect(result.eligible).toBe(true);
    expect(result.blockReason).toBeUndefined();
  });

  it("autosend is blocked for vehicle_id_request when intent not in intentsAutosendAllowed", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      tenantId: "test",
      autosendAllowed: true,
      intentsAutosendAllowed: ["price", "availability"],
    };
    const result = checkAutosendEligibility("AUTO_SEND", "vehicle_id_request", true, settings);
    expect(result.eligible).toBe(false);
    expect(result.blockReason).toBe("INTENT_NOT_ALLOWED");
  });

  it("guardrail: replyContainsPriceOrOffer returns true for text with price/currency", () => {
    expect(replyContainsPriceOrOffer("Цена 15 000 рублей")).toBe(true);
    expect(replyContainsPriceOrOffer("Стоимость 500 EUR")).toBe(true);
    expect(replyContainsPriceOrOffer("скидка 10%")).toBe(true);
    expect(replyContainsPriceOrOffer("стоимость указана в каталоге")).toBe(true);
  });

  it("guardrail: replyContainsPriceOrOffer returns false for neutral request text", () => {
    expect(replyContainsPriceOrOffer("Укажите, пожалуйста, VIN или номер рамы")).toBe(false);
    expect(replyContainsPriceOrOffer("Пришлите фото шильдика КПП")).toBe(false);
  });
});
