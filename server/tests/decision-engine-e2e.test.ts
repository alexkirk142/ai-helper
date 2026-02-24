/**
 * End-to-end tests for Decision Engine
 * Phase 1.1: Tests generateWithDecisionEngine with mocked OpenAI
 * Verifies triple-lock autosend eligibility in full decision flow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock OpenAI BEFORE importing the decision engine
vi.mock("openai", () => {
  const MockOpenAI = function() {
    return {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  reply_text: "Test response from AI",
                  intent: "price",
                  intent_probability: 0.95,
                  questions_to_ask: []
                })
              }
            }]
          })
        }
      }
    };
  };
  return { default: MockOpenAI };
});

// Import decision engine AFTER mocking OpenAI
import { generateWithDecisionEngine, DEFAULT_SETTINGS, type GenerationContext } from "../services/decision-engine";
import { storage } from "../storage";
import { featureFlagService } from "../services/feature-flags";
import type { Tenant, Product, KnowledgeDoc } from "../../shared/schema";

// Test fixtures
const testTenant: Tenant = {
  id: "test-tenant-id",
  name: "Test Store",
  domain: "test.com",
  language: "ru",
  tone: "friendly",
  addressStyle: "ty",
  welcomeMessage: "Welcome",
  businessHours: null,
  escalationEmail: null,
  escalationPhone: null,
  escalationRules: null,
  allowDiscounts: false,
  maxDiscountPercent: 0,
  operationMode: "learning",
};

const testProducts: Product[] = [{
  id: "product-1",
  tenantId: "test-tenant-id",
  name: "Test Product",
  description: "A test product",
  sku: "TEST-001",
  price: 100,
  currency: "RUB",
  inStock: true,
  category: "test",
  imageUrl: null,
}];

const testDocs: KnowledgeDoc[] = [{
  id: "doc-1",
  tenantId: "test-tenant-id",
  title: "Return Policy",
  content: "14 day return policy for all products",
  category: "policies",
}];

const createContext = (overrides?: Partial<GenerationContext>): GenerationContext => ({
  conversationId: "conv-1",
  tenantId: "test-tenant-id",
  tenant: testTenant,
  customerMessage: "What is the price of Test Product?",
  conversationHistory: [
    { role: "user", content: "What is the price of Test Product?" }
  ],
  products: testProducts,
  docs: testDocs,
  ...overrides,
});

// Settings that guarantee AUTO_SEND decision (low threshold + sources)
const autoSendSettings = {
  ...DEFAULT_SETTINGS,
  tenantId: "test-tenant-id",
  tAuto: 0.30,  // Very low threshold to ensure AUTO_SEND
  tEscalate: 0.10,
  autosendAllowed: true,
  intentsAutosendAllowed: ["price", "availability"],
  intentsForceHandoff: [],  // Remove force handoff to prevent ESCALATE
};

describe("Decision Engine E2E - Triple Lock Autosend (Mocked OpenAI)", () => {
  let originalGetDecisionSettings: typeof storage.getDecisionSettings;
  let originalIsEnabled: typeof featureFlagService.isEnabled;

  beforeEach(() => {
    // Save originals
    originalGetDecisionSettings = storage.getDecisionSettings;
    originalIsEnabled = featureFlagService.isEnabled;
  });

  afterEach(() => {
    // Restore originals
    storage.getDecisionSettings = originalGetDecisionSettings;
    featureFlagService.isEnabled = originalIsEnabled;
    vi.clearAllMocks();
  });

  it("returns decision=AUTO_SEND and autosendEligible=true when all three locks pass", async () => {
    // Mock storage to return settings with autosend enabled
    storage.getDecisionSettings = vi.fn().mockResolvedValue(autoSendSettings);

    // Mock both feature flags as enabled
    featureFlagService.isEnabled = vi.fn().mockImplementation((flag) => {
      if (flag === "DECISION_ENGINE_ENABLED") return Promise.resolve(true);
      if (flag === "AI_AUTOSEND_ENABLED") return Promise.resolve(true);
      return Promise.resolve(false);
    });

    const result = await generateWithDecisionEngine(createContext());

    // Assert decision is AUTO_SEND - no conditional
    expect(result.decision).toBe("AUTO_SEND");
    expect(result.autosendEligible).toBe(true);
    expect(result.autosendBlockReason).toBeUndefined();
  });

  it("returns decision=AUTO_SEND with autosendBlockReason=FLAG_OFF when AI_AUTOSEND_ENABLED is false", async () => {
    // Mock storage with autosend allowed
    storage.getDecisionSettings = vi.fn().mockResolvedValue(autoSendSettings);

    // Mock feature flag - decision engine enabled, autosend disabled
    featureFlagService.isEnabled = vi.fn().mockImplementation((flag) => {
      if (flag === "DECISION_ENGINE_ENABLED") return Promise.resolve(true);
      if (flag === "AI_AUTOSEND_ENABLED") return Promise.resolve(false); // Lock 1 fails
      return Promise.resolve(false);
    });

    const result = await generateWithDecisionEngine(createContext());

    // Assert decision is AUTO_SEND but blocked by flag
    expect(result.decision).toBe("AUTO_SEND");
    expect(result.autosendEligible).toBe(false);
    expect(result.autosendBlockReason).toBe("FLAG_OFF");
  });

  it("returns decision=AUTO_SEND with autosendBlockReason=SETTING_OFF when autosendAllowed is false", async () => {
    // Mock storage with autosend NOT allowed
    const settingsWithAutosendOff = {
      ...autoSendSettings,
      autosendAllowed: false, // Lock 2 fails
    };
    storage.getDecisionSettings = vi.fn().mockResolvedValue(settingsWithAutosendOff);

    // Mock both feature flags enabled
    featureFlagService.isEnabled = vi.fn().mockImplementation((flag) => {
      if (flag === "DECISION_ENGINE_ENABLED") return Promise.resolve(true);
      if (flag === "AI_AUTOSEND_ENABLED") return Promise.resolve(true);
      return Promise.resolve(false);
    });

    const result = await generateWithDecisionEngine(createContext());

    // Assert decision is AUTO_SEND but blocked by setting
    expect(result.decision).toBe("AUTO_SEND");
    expect(result.autosendEligible).toBe(false);
    expect(result.autosendBlockReason).toBe("SETTING_OFF");
  });

  it("returns decision=AUTO_SEND with autosendBlockReason=INTENT_NOT_ALLOWED when intent not in allowed list", async () => {
    // Mock storage - autosend allowed but intent "price" not in list
    const settingsWithIntentNotAllowed = {
      ...autoSendSettings,
      intentsAutosendAllowed: ["availability", "shipping"], // "price" not included - Lock 3 fails
    };
    storage.getDecisionSettings = vi.fn().mockResolvedValue(settingsWithIntentNotAllowed);

    // Mock both feature flags enabled
    featureFlagService.isEnabled = vi.fn().mockImplementation((flag) => {
      if (flag === "DECISION_ENGINE_ENABLED") return Promise.resolve(true);
      if (flag === "AI_AUTOSEND_ENABLED") return Promise.resolve(true);
      return Promise.resolve(false);
    });

    const result = await generateWithDecisionEngine(createContext());

    // Assert decision is AUTO_SEND but blocked by intent
    expect(result.decision).toBe("AUTO_SEND");
    expect(result.intent).toBe("price"); // Verify intent is price (mocked)
    expect(result.autosendEligible).toBe(false);
    expect(result.autosendBlockReason).toBe("INTENT_NOT_ALLOWED");
  });

  it("returns decision=NEED_APPROVAL when DECISION_ENGINE_ENABLED is false (kill switch)", async () => {
    // Mock decision engine kill switch
    featureFlagService.isEnabled = vi.fn().mockImplementation((flag) => {
      if (flag === "DECISION_ENGINE_ENABLED") return Promise.resolve(false); // Kill switch
      if (flag === "AI_AUTOSEND_ENABLED") return Promise.resolve(true);
      return Promise.resolve(false);
    });

    storage.getDecisionSettings = vi.fn().mockResolvedValue(autoSendSettings);

    const result = await generateWithDecisionEngine(createContext());

    // Kill switch should force NEED_APPROVAL
    expect(result.decision).toBe("NEED_APPROVAL");
    expect(result.autosendEligible).toBe(false);
    expect(result.autosendBlockReason).toBeUndefined();
  });

  it("returns autosendEligible=false when decision is NEED_APPROVAL due to low confidence", async () => {
    // Mock settings with high threshold so we get NEED_APPROVAL
    const highThresholdSettings = {
      ...autoSendSettings,
      tAuto: 0.99, // Very high threshold - will cause NEED_APPROVAL
      tEscalate: 0.10,
    };
    storage.getDecisionSettings = vi.fn().mockResolvedValue(highThresholdSettings);

    // Mock both flags enabled
    featureFlagService.isEnabled = vi.fn().mockImplementation((flag) => {
      if (flag === "DECISION_ENGINE_ENABLED") return Promise.resolve(true);
      if (flag === "AI_AUTOSEND_ENABLED") return Promise.resolve(true);
      return Promise.resolve(false);
    });

    const result = await generateWithDecisionEngine(createContext());

    // With high threshold, should get NEED_APPROVAL
    expect(result.decision).toBe("NEED_APPROVAL");
    expect(result.autosendEligible).toBe(false);
    // No block reason when decision isn't AUTO_SEND
    expect(result.autosendBlockReason).toBeUndefined();
  });

  it("returns correct Phase 1.1 fields in result", async () => {
    storage.getDecisionSettings = vi.fn().mockResolvedValue(autoSendSettings);
    featureFlagService.isEnabled = vi.fn().mockResolvedValue(true);

    const result = await generateWithDecisionEngine(createContext());

    // Verify Phase 1.1 fields exist
    expect(result).toHaveProperty("autosendEligible");
    expect(result).toHaveProperty("selfCheckNeedHandoff");
    expect(result).toHaveProperty("selfCheckReasons");
    expect(typeof result.autosendEligible).toBe("boolean");
    expect(typeof result.selfCheckNeedHandoff).toBe("boolean");
    expect(Array.isArray(result.selfCheckReasons)).toBe(true);
  });

  it("returns correct Phase 1 fields in result", async () => {
    storage.getDecisionSettings = vi.fn().mockResolvedValue(autoSendSettings);
    featureFlagService.isEnabled = vi.fn().mockResolvedValue(true);

    const result = await generateWithDecisionEngine(createContext());

    // Verify Phase 1 fields exist
    expect(result).toHaveProperty("replyText");
    expect(result).toHaveProperty("intent");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("decision");
    expect(result).toHaveProperty("explanations");
    expect(result).toHaveProperty("penalties");
    expect(result).toHaveProperty("missingFields");
    expect(result).toHaveProperty("usedSources");
    expect(result).toHaveProperty("needsApproval");
    expect(result).toHaveProperty("needsHandoff");
  });
});
