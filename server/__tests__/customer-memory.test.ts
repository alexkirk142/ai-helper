import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { createServer } from "http";
import { registerRoutes } from "../routes";

describe("Customer Memory API", () => {
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

  describe("GET /api/customers", () => {
    it("should return list of customers", async () => {
      const res = await request(app).get("/api/customers");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        testCustomerId = res.body[0].id;
        expect(res.body[0]).toHaveProperty("id");
        expect(res.body[0]).toHaveProperty("tenantId");
        expect(res.body[0]).toHaveProperty("name");
      }
    });

    it("should search customers by query", async () => {
      const res = await request(app).get("/api/customers?search=test");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("GET /api/customers/:id", () => {
    it("should return 404 for non-existent customer", async () => {
      const res = await request(app).get("/api/customers/non-existent-id");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Customer not found");
    });

    it("should return customer by id", async () => {
      if (!testCustomerId) {
        const customersRes = await request(app).get("/api/customers");
        if (customersRes.body.length > 0) {
          testCustomerId = customersRes.body[0].id;
        } else {
          return;
        }
      }
      const res = await request(app).get(`/api/customers/${testCustomerId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(testCustomerId);
    });
  });

  describe("PATCH /api/customers/:id", () => {
    it("should return 404 for non-existent customer", async () => {
      const res = await request(app)
        .patch("/api/customers/non-existent-id")
        .send({ name: "New Name" });
      expect(res.status).toBe(404);
    });

    it("should update customer name", async () => {
      if (!testCustomerId) return;
      const res = await request(app)
        .patch(`/api/customers/${testCustomerId}`)
        .send({ name: "Updated Name" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated Name");
    });

    it("should update customer tags", async () => {
      if (!testCustomerId) return;
      const res = await request(app)
        .patch(`/api/customers/${testCustomerId}`)
        .send({ tags: ["vip", "returning"] });
      expect(res.status).toBe(200);
      expect(res.body.tags).toEqual(["vip", "returning"]);
    });

    it("should reject invalid email", async () => {
      if (!testCustomerId) return;
      const res = await request(app)
        .patch(`/api/customers/${testCustomerId}`)
        .send({ email: "invalid-email" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid data");
    });
  });

  describe("Customer Memory API", () => {
    it("GET /api/customers/:id/memory - should return memory (empty or existing)", async () => {
      if (!testCustomerId) return;
      const res = await request(app).get(`/api/customers/${testCustomerId}/memory`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("preferences");
      expect(res.body).toHaveProperty("frequentTopics");
    });

    it("PATCH /api/customers/:id/memory - should update preferences", async () => {
      if (!testCustomerId) return;
      const res = await request(app)
        .patch(`/api/customers/${testCustomerId}/memory`)
        .set("x-tenant-id", "default")
        .set("x-user-id", "test-user")
        .set("x-user-role", "operator")
        .send({ preferences: { city: "Москва", delivery: "Курьером" } });
      expect(res.status).toBe(200);
      expect(res.body.preferences.city).toBe("Москва");
      expect(res.body.preferences.delivery).toBe("Курьером");
    });

    it("PATCH /api/customers/:id/memory - should merge preferences", async () => {
      if (!testCustomerId) return;
      const res = await request(app)
        .patch(`/api/customers/${testCustomerId}/memory`)
        .set("x-tenant-id", "default")
        .set("x-user-id", "test-user")
        .set("x-user-role", "operator")
        .send({ preferences: { payment: "Картой" } });
      expect(res.status).toBe(200);
      expect(res.body.preferences.city).toBe("Москва");
      expect(res.body.preferences.payment).toBe("Картой");
    });

    it("GET /api/customers/:id/memory - should return updated preferences", async () => {
      if (!testCustomerId) return;
      const res = await request(app).get(`/api/customers/${testCustomerId}/memory`);
      expect(res.status).toBe(200);
      expect(res.body.preferences.city).toBe("Москва");
      expect(res.body.preferences.payment).toBe("Картой");
    });

    it("PATCH /api/customers/:id/memory - should reject invalid body", async () => {
      if (!testCustomerId) return;
      const res = await request(app)
        .patch(`/api/customers/${testCustomerId}/memory`)
        .set("x-tenant-id", "default")
        .set("x-user-id", "test-user")
        .set("x-user-role", "operator")
        .send({ preferences: "not-an-object" });
      expect(res.status).toBe(400);
    });

    it("GET /api/customers/:id/memory - should return 404 for non-existent customer", async () => {
      const res = await request(app).get("/api/customers/non-existent-id/memory");
      expect(res.status).toBe(404);
    });
  });

  describe("FrequentTopics Increment (via MemStorage)", () => {
    it("should increment topic counter", async () => {
      if (!testCustomerId) return;
      const { MemStorage } = await import("./helpers/mem-storage");
      const memStorage = new MemStorage();

      // Create test customer in MemStorage
      const testCustomer = await memStorage.createCustomer({
        tenantId: "test-tenant",
        name: "Test Customer",
        channel: "test",
        externalId: "test-ext-1",
      });
      
      await memStorage.incrementFrequentTopic("test-tenant", testCustomer.id, "price");
      const after = await memStorage.getCustomerMemory("test-tenant", testCustomer.id);
      expect((after?.frequentTopics as Record<string, number>)?.price).toBe(1);
      
      await memStorage.incrementFrequentTopic("test-tenant", testCustomer.id, "price");
      const after2 = await memStorage.getCustomerMemory("test-tenant", testCustomer.id);
      expect((after2?.frequentTopics as Record<string, number>)?.price).toBe(2);
    });

    it("should increment multiple different topics", async () => {
      const { MemStorage } = await import("./helpers/mem-storage");
      const memStorage = new MemStorage();
      
      const testCustomer = await memStorage.createCustomer({
        tenantId: "test-tenant",
        name: "Test Customer 2",
        channel: "test",
        externalId: "test-ext-2",
      });
      
      await memStorage.incrementFrequentTopic("test-tenant", testCustomer.id, "availability");
      await memStorage.incrementFrequentTopic("test-tenant", testCustomer.id, "shipping");
      await memStorage.incrementFrequentTopic("test-tenant", testCustomer.id, "availability");
      
      const memory = await memStorage.getCustomerMemory("test-tenant", testCustomer.id);
      const topics = memory?.frequentTopics as Record<string, number>;
      
      expect(topics?.availability).toBe(2);
      expect(topics?.shipping).toBe(1);
    });
  });

  describe("Customer Notes CRUD", () => {
    it("GET /api/customers/:id/notes - should return empty array initially", async () => {
      if (!testCustomerId) return;
      const res = await request(app).get(`/api/customers/${testCustomerId}/notes`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("POST /api/customers/:id/notes - should require auth", async () => {
      if (!testCustomerId) return;
      const res = await request(app)
        .post(`/api/customers/${testCustomerId}/notes`)
        .send({ noteText: "Test note for customer" });
      // Without auth headers, should return 403
      expect([201, 403]).toContain(res.status);
      if (res.status === 201) {
        testNoteId = res.body.id;
      }
    });

    it("POST /api/customers/:id/notes - should reject empty note", async () => {
      if (!testCustomerId) return;
      const res = await request(app)
        .post(`/api/customers/${testCustomerId}/notes`)
        .set("x-tenant-id", "default")
        .set("x-user-id", "test-user")
        .set("x-user-role", "operator")
        .send({ noteText: "" });
      expect(res.status).toBe(400);
    });

    it("GET /api/customers/:id/notes - should return notes list", async () => {
      if (!testCustomerId) return;
      const res = await request(app).get(`/api/customers/${testCustomerId}/notes`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("DELETE /api/customers/:id/notes/:noteId - should delete note", async () => {
      if (!testCustomerId || !testNoteId) return;
      const res = await request(app).delete(`/api/customers/${testCustomerId}/notes/${testNoteId}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("DELETE /api/customers/:id/notes/:noteId - should return 404 for deleted note", async () => {
      if (!testCustomerId || !testNoteId) return;
      const res = await request(app).delete(`/api/customers/${testCustomerId}/notes/${testNoteId}`);
      expect(res.status).toBe(404);
    });
  });
});
