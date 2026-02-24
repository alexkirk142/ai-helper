import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { requireActiveSubscription, SUBSCRIPTION_REQUIRED_ERROR } from "../middleware/subscription";

vi.mock("../storage", () => ({
  storage: {
    getUserByOidcId: vi.fn(),
    getUser: vi.fn(),
  },
}));

vi.mock("../services/billing-service", () => ({
  getBillingStatus: vi.fn(),
}));

import { storage } from "../storage";
import { getBillingStatus } from "../services/billing-service";

const mockStorage = storage as any;
const mockGetBillingStatus = getBillingStatus as any;

describe("requireActiveSubscription middleware", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    
    app.post("/test-channel", 
      (req, res, next) => {
        req.userId = req.headers["x-user-id"] as string || undefined;
        next();
      },
      requireActiveSubscription, 
      (req, res) => {
        res.json({ success: true });
      }
    );
  });

  it("returns 403 when no userId", async () => {
    const res = await request(app)
      .post("/test-channel")
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("User authentication required");
  });

  it("returns 403 when user has no tenantId", async () => {
    mockStorage.getUserByOidcId.mockResolvedValue({ id: "user1", tenantId: null });
    mockStorage.getUser.mockResolvedValue(null);

    const res = await request(app)
      .post("/test-channel")
      .set("x-user-id", "user1")
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("User not associated with a tenant");
  });

  it("returns 402 SUBSCRIPTION_REQUIRED when canAccess is false", async () => {
    mockStorage.getUserByOidcId.mockResolvedValue({ id: "user1", tenantId: "tenant1" });
    mockGetBillingStatus.mockResolvedValue({
      hasSubscription: false,
      status: null,
      plan: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canAccess: false,
    });

    const res = await request(app)
      .post("/test-channel")
      .set("x-user-id", "user1")
      .send({});

    expect(res.status).toBe(402);
    expect(res.body).toEqual(SUBSCRIPTION_REQUIRED_ERROR);
    expect(res.body.code).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("allows access when subscription is active (canAccess: true)", async () => {
    mockStorage.getUserByOidcId.mockResolvedValue({ id: "user1", tenantId: "tenant1" });
    mockGetBillingStatus.mockResolvedValue({
      hasSubscription: true,
      status: "active",
      plan: { id: "plan1", name: "Pro" },
      currentPeriodEnd: new Date(Date.now() + 86400000),
      cancelAtPeriodEnd: false,
      canAccess: true,
    });

    const res = await request(app)
      .post("/test-channel")
      .set("x-user-id", "user1")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("allows access for trialing status", async () => {
    mockStorage.getUserByOidcId.mockResolvedValue({ id: "user1", tenantId: "tenant1" });
    mockGetBillingStatus.mockResolvedValue({
      hasSubscription: true,
      status: "trialing",
      plan: { id: "plan1", name: "Pro" },
      currentPeriodEnd: new Date(Date.now() + 86400000),
      cancelAtPeriodEnd: false,
      canAccess: true,
    });

    const res = await request(app)
      .post("/test-channel")
      .set("x-user-id", "user1")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("blocks access for unpaid status", async () => {
    mockStorage.getUserByOidcId.mockResolvedValue({ id: "user1", tenantId: "tenant1" });
    mockGetBillingStatus.mockResolvedValue({
      hasSubscription: true,
      status: "unpaid",
      plan: { id: "plan1", name: "Pro" },
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canAccess: false,
    });

    const res = await request(app)
      .post("/test-channel")
      .set("x-user-id", "user1")
      .send({});

    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("allows access for canceled but not expired subscription", async () => {
    mockStorage.getUserByOidcId.mockResolvedValue({ id: "user1", tenantId: "tenant1" });
    mockGetBillingStatus.mockResolvedValue({
      hasSubscription: true,
      status: "canceled",
      plan: { id: "plan1", name: "Pro" },
      currentPeriodEnd: new Date(Date.now() + 86400000),
      cancelAtPeriodEnd: true,
      canAccess: true,
    });

    const res = await request(app)
      .post("/test-channel")
      .set("x-user-id", "user1")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
