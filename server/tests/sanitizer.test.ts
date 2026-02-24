/**
 * Unit tests for sanitizer utility
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeString,
  sanitizeObject,
  sanitizeHeaders,
  createSafeLogEntry,
  sanitizeDeep,
  sanitizeForPrompt,
  sanitizeCustomerData,
} from "../utils/sanitizer";

describe("sanitizeString", () => {
  it("masks JWT tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.Gfx6VO9tcxwk6xqx9yYzSfebfeakZp5JYIgP_edcw_A";
    const result = sanitizeString(jwt);
    expect(result).toBe("[MASKED_JWT]");
  });

  it("masks OpenAI API keys", () => {
    const input = "Using key sk-1234567890abcdef1234567890abcdef";
    const result = sanitizeString(input);
    expect(result).toContain("[MASKED_OPENAI_KEY]");
    expect(result).not.toContain("sk-1234567890");
  });

  it("masks API keys in various formats", () => {
    const input1 = 'api_key="secret123456789012345678901234567890"';
    const result1 = sanitizeString(input1);
    expect(result1).not.toContain("secret12345678901234567890123456789");
    
    const input2 = "apiKey: long_secret_key_that_needs_masking_123";
    const result2 = sanitizeString(input2);
    expect(result2).not.toContain("long_secret_key_that_needs_masking_123");
  });

  it("masks database URLs with passwords", () => {
    const input = "postgresql://user:supersecretpassword@localhost:5432/db";
    const result = sanitizeString(input);
    expect(result).toContain("****");
    expect(result).not.toContain("supersecretpassword");
  });

  it("masks email addresses", () => {
    const input = "Contact john.doe@example.com for help";
    const result = sanitizeString(input);
    expect(result).not.toContain("john.doe@");
    expect(result).toContain("@example.com"); // Domain preserved
  });

  it("masks phone numbers", () => {
    const input = "Call +7 999 123-45-67 or 8(800)555-35-35";
    const result = sanitizeString(input);
    // Last 4 digits should be visible, rest masked
    expect(result).toContain("****");
    // Full number should be masked
    expect(result).not.toContain("+7 999 123-45-67");
  });

  it("masks credit card numbers", () => {
    const input = "Card: 4532 1234 5678 9012";
    const result = sanitizeString(input);
    // First 12 digits should be masked, last 4 visible
    expect(result).toContain("****-****-****-9012");
    expect(result).not.toContain("4532 1234 5678");
  });
});

describe("sanitizeObject", () => {
  it("masks sensitive field values", () => {
    const obj = {
      user: "john",
      password: "secret123",
      apiKey: "key12345678901234567890",
    };
    const result = sanitizeObject(obj);
    
    expect(result.user).toBe("john");
    expect(result.password).not.toBe("secret123");
    expect(result.apiKey).not.toBe("key12345678901234567890");
  });

  it("recursively sanitizes nested objects", () => {
    const obj = {
      level1: {
        level2: {
          password: "nested_secret",
          safeField: "visible",
        },
      },
    };
    const result = sanitizeObject(obj);
    
    expect(result.level1.level2.safeField).toBe("visible");
    expect(result.level1.level2.password).not.toBe("nested_secret");
  });

  it("sanitizes arrays", () => {
    const arr = [
      { password: "secret1" },
      { password: "secret2" },
    ];
    const result = sanitizeObject(arr);
    
    expect(result[0].password).not.toBe("secret1");
    expect(result[1].password).not.toBe("secret2");
  });

  it("handles null and undefined", () => {
    expect(sanitizeObject(null)).toBe(null);
    expect(sanitizeObject(undefined)).toBe(undefined);
  });

  it("sanitizes strings within object values", () => {
    const obj = {
      message: "Email me at test@example.com",
    };
    const result = sanitizeObject(obj);
    
    expect(result.message).toContain("@example.com");
    expect(result.message).not.toContain("test@");
  });
});

describe("sanitizeHeaders", () => {
  it("redacts authorization header", () => {
    const headers = {
      authorization: "Bearer eyJtoken...",
      "content-type": "application/json",
    };
    const result = sanitizeHeaders(headers);
    
    expect(result.authorization).toBe("[REDACTED]");
    expect(result["content-type"]).toBe("application/json");
  });

  it("redacts cookie header", () => {
    const headers = {
      cookie: "session=abc123; other=value",
    };
    const result = sanitizeHeaders(headers);
    
    expect(result.cookie).toBe("[REDACTED]");
  });

  it("redacts x-api-key header", () => {
    const headers = {
      "x-api-key": "my-secret-api-key",
    };
    const result = sanitizeHeaders(headers);
    
    expect(result["x-api-key"]).toBe("[REDACTED]");
  });

  it("sanitizes non-sensitive headers with potential secrets", () => {
    const headers = {
      "x-custom": "Contains sk-1234567890abcdef1234567890abcdef",
    };
    const result = sanitizeHeaders(headers);
    
    expect(result["x-custom"]).not.toContain("sk-1234567890");
  });
});

describe("createSafeLogEntry", () => {
  it("creates sanitized log entry", () => {
    const entry = {
      level: "info",
      message: "User logged in",
      user: {
        email: "user@example.com",
        password: "should_be_masked",
      },
    };
    const result = createSafeLogEntry(entry);
    
    expect(result.level).toBe("info");
    expect(result.message).toBe("User logged in");
    expect((result.user as Record<string, string>).password).not.toBe("should_be_masked");
  });
});

describe("PII - Full Names", () => {
  it("masks Russian full names (FIO with patronymic)", () => {
    const input = "Клиент: Иванов Иван Иванович хочет заказать товар";
    const result = sanitizeString(input);
    expect(result).toContain("[MASKED_NAME]");
    expect(result).not.toContain("Иванов Иван Иванович");
  });

  it("masks Russian female full names", () => {
    const input = "Контакт: Петрова Мария Александровна";
    const result = sanitizeString(input);
    expect(result).toContain("[MASKED_NAME]");
    expect(result).not.toContain("Петрова Мария Александровна");
  });

  it("masks English names with titles", () => {
    const input = "Customer Mr. John Smith requested help";
    const result = sanitizeString(input);
    expect(result).toContain("[MASKED_NAME]");
    expect(result).not.toContain("Mr. John Smith");
  });

  it("masks fullName field in objects", () => {
    const obj = { fullName: "John Smith", city: "Moscow" };
    const result = sanitizeObject(obj);
    expect(result.fullName).not.toBe("John Smith");
    expect(result.city).toBe("Moscow");
  });

  it("masks firstName and lastName fields", () => {
    const obj = { firstName: "Ivan", lastName: "Petrov", age: 30 };
    const result = sanitizeObject(obj);
    expect(result.firstName).not.toBe("Ivan");
    expect(result.lastName).not.toBe("Petrov");
    expect(result.age).toBe(30);
  });
});

describe("PII - Addresses", () => {
  it("masks Russian city and street addresses", () => {
    const input = "Доставка: г. Москва, ул. Тверская, д. 12, кв. 45";
    const result = sanitizeString(input);
    expect(result).toContain("[MASKED_ADDRESS]");
    expect(result).not.toContain("г. Москва");
  });

  it("masks Russian street addresses without city", () => {
    const input = "Адрес: ул. Ленина, д. 5";
    const result = sanitizeString(input);
    expect(result).toContain("[MASKED_ADDRESS]");
    expect(result).not.toContain("ул. Ленина");
  });

  it("masks English street addresses", () => {
    const input = "Ship to: 123 Main Street, Apt. 4B";
    const result = sanitizeString(input);
    expect(result).toContain("[MASKED_ADDRESS]");
    expect(result).not.toContain("123 Main Street");
  });

  it("masks address fields in objects", () => {
    const obj = {
      deliveryAddress: "123 Oak Avenue",
      shippingAddress: "456 Pine Road",
      product: "Widget",
    };
    const result = sanitizeObject(obj);
    expect(result.deliveryAddress).not.toBe("123 Oak Avenue");
    expect(result.shippingAddress).not.toBe("456 Pine Road");
    expect(result.product).toBe("Widget");
  });
});

describe("sanitizeDeep", () => {
  it("deeply sanitizes nested structures", () => {
    const data = {
      customer: {
        email: "test@example.com",
        profile: {
          address: "123 Secret Lane",
        },
      },
      notes: "Contact at +7 999 123-45-67",
    };
    const result = sanitizeDeep(data);
    expect(result.customer.email).not.toContain("test@");
    expect(result.customer.profile.address).not.toBe("123 Secret Lane");
    expect(result.notes).toContain("****");
  });

  it("preserves non-sensitive data", () => {
    const data = {
      productId: "SKU-12345",
      quantity: 5,
      status: "pending",
    };
    const result = sanitizeDeep(data);
    expect(result.productId).toBe("SKU-12345");
    expect(result.quantity).toBe(5);
    expect(result.status).toBe("pending");
  });
});

describe("sanitizeForPrompt", () => {
  it("sanitizes text for AI prompts", () => {
    const prompt = "User said: Call me at +7 999 123-45-67 or email me at user@test.com";
    const result = sanitizeForPrompt(prompt);
    expect(result).not.toContain("+7 999 123-45-67");
    expect(result).not.toContain("user@");
  });
});

describe("sanitizeCustomerData", () => {
  it("sanitizes notes and comments fields", () => {
    const data = {
      notes: "Customer John Doe called from +7 999 123-45-67",
      comments: "VIP client, email: vip@company.com",
      feedback: "Great service for Mr. Smith Johnson!",
      orderId: "ORD-123",
    };
    const result = sanitizeCustomerData(data);
    expect(result.notes).not.toContain("+7 999 123-45-67");
    expect(result.comments).not.toContain("vip@");
    expect(result.orderId).toBe("ORD-123");
  });

  it("handles null values gracefully", () => {
    const data = {
      notes: null,
      comments: null,
      feedback: null,
    };
    const result = sanitizeCustomerData(data);
    expect(result.notes).toBeNull();
    expect(result.comments).toBeNull();
    expect(result.feedback).toBeNull();
  });
});

describe("regression tests", () => {
  it("does not break existing email masking", () => {
    const input = "Email: contact@business.ru";
    const result = sanitizeString(input);
    expect(result).toContain("@business.ru");
    expect(result).not.toContain("contact@");
  });

  it("does not break existing phone masking", () => {
    const input = "Phone: 8 800 555-35-35";
    const result = sanitizeString(input);
    expect(result).toContain("****");
    expect(result).not.toContain("8 800 555");
  });

  it("does not break existing API key masking", () => {
    const input = "sk-proj1234567890abcdefghijklmnop";
    const result = sanitizeString(input);
    expect(result).toBe("[MASKED_OPENAI_KEY]");
  });
});
