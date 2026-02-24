import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../db";
import { 
  customers, 
  customerMemory, 
  customerNotes, 
  conversations, 
  messages,
  aiSuggestions,
  humanActions,
  tenants,
  users
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { deleteCustomerData } from "../services/customer-data-deletion-service";

vi.mock("../services/audit-log", () => ({
  auditLog: {
    log: vi.fn().mockResolvedValue({}),
    setContext: vi.fn(),
    clearContext: vi.fn(),
  },
}));

describe("Customer Data Deletion Service", () => {
  const testTenantId = "test-tenant-deletion-" + Date.now();
  const testUserId = "test-user-deletion-" + Date.now();
  let testCustomerId: string;
  let testConversationId: string;
  let testSuggestionId: string;

  beforeEach(async () => {
    const timestamp = Date.now();
    testCustomerId = "test-customer-" + timestamp;
    testConversationId = "test-conv-" + timestamp;
    testSuggestionId = "test-sugg-" + timestamp;

    await db.insert(tenants).values({
      id: testTenantId,
      name: "Test Tenant for Deletion",
      slug: "test-deletion-" + timestamp,
    }).onConflictDoNothing();

    await db.insert(users).values({
      id: testUserId,
      tenantId: testTenantId,
      username: `test-deletion-${timestamp}`,
      password: "test-password-hash",
      email: `test-deletion-${timestamp}@test.com`,
      role: "admin",
    }).onConflictDoNothing();

    await db.insert(customers).values({
      id: testCustomerId,
      tenantId: testTenantId,
      externalId: "ext-" + timestamp,
      name: "Test Customer for Deletion",
      channel: "mock",
    });

    await db.insert(customerMemory).values({
      id: "mem-" + timestamp,
      tenantId: testTenantId,
      customerId: testCustomerId,
      preferences: { city: "Moscow" },
      frequentTopics: { price: 5 },
    });

    await db.insert(customerNotes).values({
      id: "note-" + timestamp,
      tenantId: testTenantId,
      customerId: testCustomerId,
      authorUserId: testUserId,
      noteText: "Test note for deletion",
    });

    await db.insert(conversations).values({
      id: testConversationId,
      tenantId: testTenantId,
      customerId: testCustomerId,
      status: "active",
      mode: "learning",
    });

    await db.insert(messages).values({
      id: "msg-" + timestamp,
      conversationId: testConversationId,
      role: "customer",
      content: "Test message for deletion",
    });

    await db.insert(aiSuggestions).values({
      id: testSuggestionId,
      conversationId: testConversationId,
      suggestedReply: "Test suggestion",
      confidence: 0.9,
      decision: "NEED_APPROVAL",
    });

    await db.insert(humanActions).values({
      id: "action-" + timestamp,
      suggestionId: testSuggestionId,
      userId: testUserId,
      action: "approve",
    });
  });

  it("deletes all customer data in a single transaction", async () => {
    const customerBefore = await db.select().from(customers).where(eq(customers.id, testCustomerId));
    expect(customerBefore.length).toBe(1);

    const result = await deleteCustomerData(testCustomerId, testTenantId, testUserId);

    expect(result.success).toBe(true);
    expect(result.customerId).toBe(testCustomerId);
    expect(result.tenantId).toBe(testTenantId);
    expect(result.deletedEntities.customers).toBe(1);
    expect(result.deletedEntities.customerMemory).toBe(1);
    expect(result.deletedEntities.customerNotes).toBe(1);
    expect(result.deletedEntities.conversations).toBe(1);
    expect(result.deletedEntities.messages).toBe(1);
    expect(result.deletedEntities.aiSuggestions).toBe(1);
    expect(result.deletedEntities.humanActions).toBe(1);

    const customerAfter = await db.select().from(customers).where(eq(customers.id, testCustomerId));
    expect(customerAfter.length).toBe(0);

    const memoryAfter = await db.select().from(customerMemory).where(eq(customerMemory.customerId, testCustomerId));
    expect(memoryAfter.length).toBe(0);

    const notesAfter = await db.select().from(customerNotes).where(eq(customerNotes.customerId, testCustomerId));
    expect(notesAfter.length).toBe(0);

    const conversationsAfter = await db.select().from(conversations).where(eq(conversations.customerId, testCustomerId));
    expect(conversationsAfter.length).toBe(0);

    const messagesAfter = await db.select().from(messages).where(eq(messages.conversationId, testConversationId));
    expect(messagesAfter.length).toBe(0);

    const suggestionsAfter = await db.select().from(aiSuggestions).where(eq(aiSuggestions.conversationId, testConversationId));
    expect(suggestionsAfter.length).toBe(0);

    const actionsAfter = await db.select().from(humanActions).where(eq(humanActions.suggestionId, testSuggestionId));
    expect(actionsAfter.length).toBe(0);
  });

  it("is idempotent - repeated delete returns 200 OK", async () => {
    const result1 = await deleteCustomerData(testCustomerId, testTenantId, testUserId);
    expect(result1.success).toBe(true);
    expect(result1.deletedEntities.customers).toBe(1);

    const result2 = await deleteCustomerData(testCustomerId, testTenantId, testUserId);
    expect(result2.success).toBe(true);
    expect(result2.deletedEntities.customers).toBe(0);
    expect(result2.deletedEntities.conversations).toBe(0);
    expect(result2.deletedEntities.messages).toBe(0);
  });

  it("prevents deletion of customer from another tenant", async () => {
    const otherTenantId = "other-tenant-" + Date.now();

    await expect(
      deleteCustomerData(testCustomerId, otherTenantId, testUserId)
    ).rejects.toThrow("TENANT_MISMATCH");

    const customerStillExists = await db.select().from(customers).where(eq(customers.id, testCustomerId));
    expect(customerStillExists.length).toBe(1);
  });
});
