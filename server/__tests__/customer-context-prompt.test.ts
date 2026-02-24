import { describe, it, expect } from "vitest";
import { buildCustomerContextBlock } from "../services/decision-engine";
import type { CustomerMemory } from "../../shared/schema";

describe("buildCustomerContextBlock", () => {
  it("should return null when memory is null", () => {
    const result = buildCustomerContextBlock(null);
    expect(result).toBeNull();
  });

  it("should return null when memory is undefined", () => {
    const result = buildCustomerContextBlock(undefined);
    expect(result).toBeNull();
  });

  it("should return null when memory has empty preferences and no topics", () => {
    const memory: CustomerMemory = {
      id: "mem-1",
      tenantId: "tenant-1",
      customerId: "cust-1",
      preferences: {},
      frequentTopics: {},
      lastSummaryText: null,
      updatedAt: new Date(),
    };
    const result = buildCustomerContextBlock(memory);
    expect(result).toBeNull();
  });

  it("should include city preference when present", () => {
    const memory: CustomerMemory = {
      id: "mem-1",
      tenantId: "tenant-1",
      customerId: "cust-1",
      preferences: { city: "Москва" },
      frequentTopics: {},
      lastSummaryText: null,
      updatedAt: new Date(),
    };
    const result = buildCustomerContextBlock(memory);
    expect(result).not.toBeNull();
    expect(result).toContain("CUSTOMER CONTEXT");
    expect(result).toContain("Город: Москва");
  });

  it("should include delivery preference when present", () => {
    const memory: CustomerMemory = {
      id: "mem-1",
      tenantId: "tenant-1",
      customerId: "cust-1",
      preferences: { delivery: "Курьером" },
      frequentTopics: {},
      lastSummaryText: null,
      updatedAt: new Date(),
    };
    const result = buildCustomerContextBlock(memory);
    expect(result).not.toBeNull();
    expect(result).toContain("Предпочтительная доставка: Курьером");
  });

  it("should include payment preference when present", () => {
    const memory: CustomerMemory = {
      id: "mem-1",
      tenantId: "tenant-1",
      customerId: "cust-1",
      preferences: { payment: "Картой" },
      frequentTopics: {},
      lastSummaryText: null,
      updatedAt: new Date(),
    };
    const result = buildCustomerContextBlock(memory);
    expect(result).not.toBeNull();
    expect(result).toContain("Предпочтительная оплата: Картой");
  });

  it("should include all preferences when all present", () => {
    const memory: CustomerMemory = {
      id: "mem-1",
      tenantId: "tenant-1",
      customerId: "cust-1",
      preferences: { city: "СПб", delivery: "Самовывоз", payment: "Наличными" },
      frequentTopics: {},
      lastSummaryText: null,
      updatedAt: new Date(),
    };
    const result = buildCustomerContextBlock(memory);
    expect(result).not.toBeNull();
    expect(result).toContain("Город: СПб");
    expect(result).toContain("Предпочтительная доставка: Самовывоз");
    expect(result).toContain("Предпочтительная оплата: Наличными");
  });

  it("should include lastSummaryText when present", () => {
    const memory: CustomerMemory = {
      id: "mem-1",
      tenantId: "tenant-1",
      customerId: "cust-1",
      preferences: {},
      frequentTopics: {},
      lastSummaryText: "Постоянный клиент, покупает электронику",
      updatedAt: new Date(),
    };
    const result = buildCustomerContextBlock(memory);
    expect(result).not.toBeNull();
    expect(result).toContain("Краткое резюме: Постоянный клиент, покупает электронику");
  });

  it("should include frequent topics sorted by count", () => {
    const memory: CustomerMemory = {
      id: "mem-1",
      tenantId: "tenant-1",
      customerId: "cust-1",
      preferences: {},
      frequentTopics: { price: 5, shipping: 2, availability: 3 },
      lastSummaryText: null,
      updatedAt: new Date(),
    };
    const result = buildCustomerContextBlock(memory);
    expect(result).not.toBeNull();
    expect(result).toContain("Частые темы запросов:");
    expect(result).toContain("Цена (5x)");
    expect(result).toContain("Наличие (3x)");
    expect(result).toContain("Доставка (2x)");
  });

  it("should limit frequent topics to top 3", () => {
    const memory: CustomerMemory = {
      id: "mem-1",
      tenantId: "tenant-1",
      customerId: "cust-1",
      preferences: {},
      frequentTopics: { 
        price: 10, 
        shipping: 8, 
        availability: 6, 
        return: 4, 
        discount: 2 
      },
      lastSummaryText: null,
      updatedAt: new Date(),
    };
    const result = buildCustomerContextBlock(memory);
    expect(result).not.toBeNull();
    expect(result).toContain("Цена (10x)");
    expect(result).toContain("Доставка (8x)");
    expect(result).toContain("Наличие (6x)");
    expect(result).not.toContain("Возврат");
    expect(result).not.toContain("Скидки");
  });

  it("should include disclaimer about not overriding KB/Products", () => {
    const memory: CustomerMemory = {
      id: "mem-1",
      tenantId: "tenant-1",
      customerId: "cust-1",
      preferences: { city: "Москва" },
      frequentTopics: {},
      lastSummaryText: null,
      updatedAt: new Date(),
    };
    const result = buildCustomerContextBlock(memory);
    expect(result).not.toBeNull();
    expect(result).toContain("do not override KB/Products facts");
  });

  it("should combine all memory sections when all present", () => {
    const memory: CustomerMemory = {
      id: "mem-1",
      tenantId: "tenant-1",
      customerId: "cust-1",
      preferences: { city: "Казань", delivery: "Почтой" },
      frequentTopics: { price: 3, shipping: 1 },
      lastSummaryText: "VIP клиент",
      updatedAt: new Date(),
    };
    const result = buildCustomerContextBlock(memory);
    expect(result).not.toBeNull();
    expect(result).toContain("CUSTOMER CONTEXT");
    expect(result).toContain("Город: Казань");
    expect(result).toContain("Предпочтительная доставка: Почтой");
    expect(result).toContain("Краткое резюме: VIP клиент");
    expect(result).toContain("Цена (3x)");
    expect(result).toContain("Доставка (1x)");
  });

  it("should sanitize PII in lastSummaryText", () => {
    const memory: CustomerMemory = {
      id: "mem-1",
      tenantId: "tenant-1",
      customerId: "cust-1",
      preferences: {},
      frequentTopics: {},
      lastSummaryText: "Клиент Иван, email: ivan@example.com, телефон +7 999 123 45 67",
      updatedAt: new Date(),
    };
    const result = buildCustomerContextBlock(memory);
    expect(result).not.toBeNull();
    expect(result).not.toContain("ivan@example.com");
    expect(result).not.toContain("+7 999 123 45 67");
    expect(result).toContain("@example.com");
    expect(result).toContain("4567");
  });

  it("should sanitize PII in preferences", () => {
    const memory: CustomerMemory = {
      id: "mem-1",
      tenantId: "tenant-1",
      customerId: "cust-1",
      preferences: { city: "Москва, звонить +7 495 111 22 33" },
      frequentTopics: {},
      lastSummaryText: null,
      updatedAt: new Date(),
    };
    const result = buildCustomerContextBlock(memory);
    expect(result).not.toBeNull();
    expect(result).not.toContain("+7 495 111 22 33");
    expect(result).toContain("2233");
  });
});
