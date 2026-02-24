import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { tenants, users, adminActions } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import { adminActionService } from "../services/admin-action-service";

describe("Admin Action Idempotency", () => {
  let testTenantId: string;
  let testUserId: string;
  let testAdminId: string;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Test Tenant Idempotency" })
      .returning();
    testTenantId = tenant.id;

    const [admin] = await db
      .insert(users)
      .values({
        tenantId: testTenantId,
        username: `admin_idemp_${Date.now()}`,
        password: "hashed",
        isPlatformAdmin: true,
      })
      .returning();
    testAdminId = admin.id;

    const [user] = await db
      .insert(users)
      .values({
        tenantId: testTenantId,
        username: `user_idemp_${Date.now()}`,
        password: "hashed",
        isPlatformAdmin: false,
      })
      .returning();
    testUserId = user.id;
  });

  afterAll(async () => {
    await db.delete(adminActions).where(eq(adminActions.targetId, testTenantId));
    await db.delete(adminActions).where(eq(adminActions.targetId, testUserId));
    await db.delete(users).where(eq(users.id, testAdminId));
    await db.delete(users).where(eq(users.id, testUserId));
    await db.delete(tenants).where(eq(tenants.id, testTenantId));
  });

  it("repeated restrict creates 2 rows, second marked noOp=true", async () => {
    const result1 = await adminActionService.restrictTenant(
      testTenantId,
      testAdminId,
      "First restrict"
    );
    expect(result1.success).toBe(true);
    expect(result1.alreadyInState).toBeUndefined();

    const result2 = await adminActionService.restrictTenant(
      testTenantId,
      testAdminId,
      "Second restrict attempt"
    );
    expect(result2.success).toBe(true);
    expect(result2.alreadyInState).toBe(true);

    const actions = await db
      .select()
      .from(adminActions)
      .where(
        and(
          eq(adminActions.targetId, testTenantId),
          eq(adminActions.actionType, "tenant_restrict")
        )
      )
      .orderBy(adminActions.createdAt);

    expect(actions.length).toBe(2);

    const first = actions[0];
    const second = actions[1];

    expect((first.previousState as any).status).toBe("active");
    expect(first.metadata).toBeNull();

    expect(second.previousState).toBeNull();
    expect((second.metadata as any).idempotent).toBe(true);
    expect((second.metadata as any).noOp).toBe(true);
    expect((second.metadata as any).alreadyState).toBe("restricted");
  });

  it("repeated disable creates 2 rows, second marked noOp=true", async () => {
    const result1 = await adminActionService.disableUser(
      testUserId,
      testAdminId,
      "First disable"
    );
    expect(result1.success).toBe(true);
    expect(result1.alreadyInState).toBeUndefined();

    const result2 = await adminActionService.disableUser(
      testUserId,
      testAdminId,
      "Second disable attempt"
    );
    expect(result2.success).toBe(true);
    expect(result2.alreadyInState).toBe(true);

    const actions = await db
      .select()
      .from(adminActions)
      .where(
        and(
          eq(adminActions.targetId, testUserId),
          eq(adminActions.actionType, "user_disable")
        )
      )
      .orderBy(adminActions.createdAt);

    expect(actions.length).toBe(2);

    const first = actions[0];
    const second = actions[1];

    expect((first.previousState as any).isDisabled).toBe(false);
    expect(first.metadata).toBeNull();

    expect(second.previousState).toBeNull();
    expect((second.metadata as any).idempotent).toBe(true);
    expect((second.metadata as any).noOp).toBe(true);
    expect((second.metadata as any).alreadyState).toBe("disabled");
  });
});
