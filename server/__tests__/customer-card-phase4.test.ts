import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { createServer } from "http";
import { registerRoutes } from "../routes";
import { handleIncomingMessage } from "../services/inbound-message-handler";
import { storage } from "../storage";

describe("Phase 4.0 Customer Card", () => {
  let app: express.Express;
  let httpServer: ReturnType<typeof createServer>;
  let testCustomerId: string;
  let testNoteId: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    httpServer = createServer(app);
    await registerRoutes(httpServer, app);
  });

  afterAll(() => {
    httpServer.close();
  });

  describe("Inbound message creates customer and conversation with customerId", () => {
    it("should create customer with channel field on first inbound message", async () => {
      const tenant = await storage.getDefaultTenant();
      expect(tenant).toBeDefined();

      const uniqueId = `test_user_${Date.now()}`;
      const result = await handleIncomingMessage(tenant!.id, {
        channel: "telegram",
        externalUserId: uniqueId,
        externalConversationId: `conv_${uniqueId}`,
        externalMessageId: `msg_${uniqueId}_1`,
        text: "Hello from test",
        timestamp: Date.now(),
        metadata: { pushName: "Test User" },
      });

      expect(result.conversationId).toBeDefined();
      expect(result.messageId).toBeDefined();
      expect(result.isNew).toBe(true);

      const conversation = await storage.getConversation(result.conversationId);
      expect(conversation).toBeDefined();
      expect(conversation!.customerId).toBeDefined();
      testCustomerId = conversation!.customerId;

      const customer = await storage.getCustomer(testCustomerId);
      expect(customer).toBeDefined();
      expect(customer!.channel).toBe("telegram");
      expect(customer!.externalId).toBe(uniqueId);
    });

    it("should reuse same customer for repeated inbound with same externalUserId", async () => {
      const tenant = await storage.getDefaultTenant();
      const uniqueId = `reuse_test_${Date.now()}`;

      // First message - creates customer
      const result1 = await handleIncomingMessage(tenant!.id, {
        channel: "telegram",
        externalUserId: uniqueId,
        externalConversationId: `conv_${uniqueId}`,
        externalMessageId: `msg_${uniqueId}_1`,
        text: "First message",
        timestamp: Date.now(),
        metadata: { pushName: "Reuse Test" },
      });

      const conv1 = await storage.getConversation(result1.conversationId);
      const firstCustomerId = conv1!.customerId;

      // Second message - should reuse same customer
      const result2 = await handleIncomingMessage(tenant!.id, {
        channel: "telegram",
        externalUserId: uniqueId,
        externalConversationId: `conv_${uniqueId}`,
        externalMessageId: `msg_${uniqueId}_2`,
        text: "Second message",
        timestamp: Date.now(),
        metadata: { pushName: "Reuse Test" },
      });

      const conv2 = await storage.getConversation(result2.conversationId);
      expect(conv2!.customerId).toBe(firstCustomerId);
    });

    it("should create different customer for different channel with same externalUserId", async () => {
      const tenant = await storage.getDefaultTenant();
      const uniqueId = `multi_channel_${Date.now()}`;

      // Create customer on telegram
      const result1 = await handleIncomingMessage(tenant!.id, {
        channel: "telegram",
        externalUserId: uniqueId,
        externalConversationId: `tg_conv_${uniqueId}`,
        externalMessageId: `tg_msg_${uniqueId}`,
        text: "Hello from Telegram",
        timestamp: Date.now(),
        metadata: { pushName: "Multi Channel User" },
      });

      const conv1 = await storage.getConversation(result1.conversationId);
      const tgCustomerId = conv1!.customerId;

      // Create customer on whatsapp with same externalUserId
      const result2 = await handleIncomingMessage(tenant!.id, {
        channel: "whatsapp_personal",
        externalUserId: uniqueId,
        externalConversationId: `wa_conv_${uniqueId}`,
        externalMessageId: `wa_msg_${uniqueId}`,
        text: "Hello from WhatsApp",
        timestamp: Date.now(),
        metadata: { pushName: "Multi Channel User WA" },
      });

      const conv2 = await storage.getConversation(result2.conversationId);
      expect(conv2!.customerId).not.toBe(tgCustomerId);

      const customer = await storage.getCustomer(conv2!.customerId);
      expect(customer!.channel).toBe("whatsapp_personal");
    });
  });

  describe("RBAC for customer endpoints", () => {
    it("PATCH /api/customers/:id - should work for operator", async () => {
      const customersRes = await request(app).get("/api/customers");
      if (customersRes.body.length === 0) return;
      const customerId = customersRes.body[0].id;

      const res = await request(app)
        .patch(`/api/customers/${customerId}`)
        .set("X-Debug-Role", "operator")
        .send({ name: "Updated by Operator" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated by Operator");
    });

    it("PATCH /api/customers/:id - should fail for guest", async () => {
      const customersRes = await request(app).get("/api/customers");
      if (customersRes.body.length === 0) return;
      const customerId = customersRes.body[0].id;

      const res = await request(app)
        .patch(`/api/customers/${customerId}`)
        .set("X-Debug-Role", "guest")
        .send({ name: "Should Fail" });

      expect(res.status).toBe(403);
    });
  });

  describe("RBAC for customer notes", () => {
    let noteCustomerId: string;
    let testUserId: string;
    let testUser2Id: string;
    let testAdminId: string;

    beforeAll(async () => {
      const tenant = await storage.getDefaultTenant();
      const ts = Date.now();
      
      // Create test users in DB for proper authorization testing
      const user1 = await storage.createUser({
        tenantId: tenant!.id,
        username: `test_operator_${ts}`,
        password: "test_password_hash",
        email: `operator_${ts}@test.com`,
        role: "operator",
      });
      testUserId = user1.id;

      const user2 = await storage.createUser({
        tenantId: tenant!.id,
        username: `test_operator2_${ts}`,
        password: "test_password_hash",
        email: `operator2_${ts}@test.com`,
        role: "operator",
      });
      testUser2Id = user2.id;

      const admin = await storage.createUser({
        tenantId: tenant!.id,
        username: `test_admin_${ts}`,
        password: "test_password_hash",
        email: `admin_${ts}@test.com`,
        role: "admin",
      });
      testAdminId = admin.id;

      const customersRes = await request(app).get("/api/customers");
      if (customersRes.body.length > 0) {
        noteCustomerId = customersRes.body[0].id;
      }
    });

    it("POST /api/customers/:id/notes - operator can create note with valid user", async () => {
      if (!noteCustomerId) return;

      const res = await request(app)
        .post(`/api/customers/${noteCustomerId}/notes`)
        .set("X-Debug-Role", "operator")
        .set("X-Debug-User-Id", testUserId)
        .send({ noteText: "Note by operator" });

      expect(res.status).toBe(201);
      expect(res.body.noteText).toBe("Note by operator");
      expect(res.body.authorUserId).toBe(testUserId);
      testNoteId = res.body.id;
    });

    it("POST /api/customers/:id/notes - fails if user not found in DB", async () => {
      if (!noteCustomerId) return;

      const res = await request(app)
        .post(`/api/customers/${noteCustomerId}/notes`)
        .set("X-Debug-Role", "operator")
        .set("X-Debug-User-Id", "nonexistent_user_id")
        .send({ noteText: "Note by unknown user" });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("User not found");
    });

    it("POST /api/customers/:id/notes - guest cannot create note", async () => {
      if (!noteCustomerId) return;

      const res = await request(app)
        .post(`/api/customers/${noteCustomerId}/notes`)
        .set("X-Debug-Role", "guest")
        .send({ noteText: "Note by guest" });

      expect(res.status).toBe(403);
    });

    it("DELETE note - non-author operator cannot delete", async () => {
      if (!noteCustomerId || !testNoteId) return;

      // Different user trying to delete note created by testUserId
      const res = await request(app)
        .delete(`/api/customers/${noteCustomerId}/notes/${testNoteId}`)
        .set("X-Debug-Role", "operator")
        .set("X-Debug-User-Id", testUser2Id);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Only note author or admin");
    });

    it("DELETE note - author can delete own note", async () => {
      if (!noteCustomerId) return;

      // Create note by testUser2Id
      const createRes = await request(app)
        .post(`/api/customers/${noteCustomerId}/notes`)
        .set("X-Debug-Role", "operator")
        .set("X-Debug-User-Id", testUser2Id)
        .send({ noteText: "Note to be deleted by author" });

      expect(createRes.status).toBe(201);
      const noteId = createRes.body.id;

      // Same author deletes
      const deleteRes = await request(app)
        .delete(`/api/customers/${noteCustomerId}/notes/${noteId}`)
        .set("X-Debug-Role", "operator")
        .set("X-Debug-User-Id", testUser2Id);

      expect(deleteRes.status).toBe(200);
    });

    it("DELETE note - admin can delete any note", async () => {
      if (!noteCustomerId || !testNoteId) return;

      const res = await request(app)
        .delete(`/api/customers/${noteCustomerId}/notes/${testNoteId}`)
        .set("X-Debug-Role", "admin")
        .set("X-Debug-User-Id", testAdminId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("DELETE note - owner can delete any note", async () => {
      if (!noteCustomerId) return;

      // Create a new note first
      const createRes = await request(app)
        .post(`/api/customers/${noteCustomerId}/notes`)
        .set("X-Debug-Role", "operator")
        .set("X-Debug-User-Id", testUserId)
        .send({ noteText: "Note to delete by owner" });

      expect(createRes.status).toBe(201);
      const noteId = createRes.body.id;

      // Owner should be able to delete
      const deleteRes = await request(app)
        .delete(`/api/customers/${noteCustomerId}/notes/${noteId}`)
        .set("X-Debug-Role", "owner");

      expect(deleteRes.status).toBe(200);
    });
  });

  describe("Customer uniqueness", () => {
    it("getCustomerByExternalId finds customer by tenantId + channel + externalId", async () => {
      const tenant = await storage.getDefaultTenant();
      expect(tenant).toBeDefined();

      const customer = await storage.getCustomerByExternalId(
        tenant!.id,
        "telegram",
        "tg_test_user_123"
      );
      expect(customer).toBeDefined();
      expect(customer!.channel).toBe("telegram");
      expect(customer!.externalId).toBe("tg_test_user_123");
    });

    it("getCustomerByExternalId returns undefined for different channel", async () => {
      const tenant = await storage.getDefaultTenant();

      const customer = await storage.getCustomerByExternalId(
        tenant!.id,
        "max",
        "tg_test_user_123"
      );
      expect(customer).toBeUndefined();
    });
  });
});
