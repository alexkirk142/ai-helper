import { db } from "../db";
import { tenants, users, adminActions, type AdminActionType } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface AdminActionResult {
  success: boolean;
  alreadyInState?: boolean;
  error?: string;
  actionId?: string;
}

export class AdminActionService {
  async restrictTenant(
    tenantId: string,
    adminId: string,
    reason: string
  ): Promise<AdminActionResult> {
    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant[0]) {
      return { success: false, error: "Tenant not found" };
    }

    if (tenant[0].status === "restricted") {
      const [action] = await db
        .insert(adminActions)
        .values({
          actionType: "tenant_restrict",
          targetType: "tenant",
          targetId: tenantId,
          adminId,
          reason,
          previousState: null,
          metadata: { idempotent: true, noOp: true, alreadyState: "restricted" },
        })
        .returning();
      return { success: true, alreadyInState: true, actionId: action.id };
    }

    const previousState = { status: tenant[0].status };

    await db
      .update(tenants)
      .set({ status: "restricted" })
      .where(eq(tenants.id, tenantId));

    const [action] = await db
      .insert(adminActions)
      .values({
        actionType: "tenant_restrict",
        targetType: "tenant",
        targetId: tenantId,
        adminId,
        reason,
        previousState,
      })
      .returning();

    return { success: true, actionId: action.id };
  }

  async unrestrictTenant(
    tenantId: string,
    adminId: string,
    reason: string
  ): Promise<AdminActionResult> {
    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant[0]) {
      return { success: false, error: "Tenant not found" };
    }

    if (tenant[0].status === "active") {
      const [action] = await db
        .insert(adminActions)
        .values({
          actionType: "tenant_unrestrict",
          targetType: "tenant",
          targetId: tenantId,
          adminId,
          reason,
          previousState: null,
          metadata: { idempotent: true, noOp: true, alreadyState: "active" },
        })
        .returning();
      return { success: true, alreadyInState: true, actionId: action.id };
    }

    const previousState = { status: tenant[0].status };

    await db
      .update(tenants)
      .set({ status: "active" })
      .where(eq(tenants.id, tenantId));

    const [action] = await db
      .insert(adminActions)
      .values({
        actionType: "tenant_unrestrict",
        targetType: "tenant",
        targetId: tenantId,
        adminId,
        reason,
        previousState,
      })
      .returning();

    return { success: true, actionId: action.id };
  }

  async disableUser(
    userId: string,
    adminId: string,
    reason: string
  ): Promise<AdminActionResult> {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user[0]) {
      return { success: false, error: "User not found" };
    }

    if (user[0].isDisabled) {
      const [action] = await db
        .insert(adminActions)
        .values({
          actionType: "user_disable",
          targetType: "user",
          targetId: userId,
          adminId,
          reason,
          previousState: null,
          metadata: { idempotent: true, noOp: true, alreadyState: "disabled" },
        })
        .returning();
      return { success: true, alreadyInState: true, actionId: action.id };
    }

    if (user[0].isPlatformOwner) {
      return { success: false, error: "Cannot disable platform owner" };
    }

    if (user[0].isPlatformAdmin) {
      return { success: false, error: "Cannot disable platform admin" };
    }

    const previousState = {
      isDisabled: user[0].isDisabled,
      disabledAt: user[0].disabledAt,
      disabledReason: user[0].disabledReason,
    };

    await db
      .update(users)
      .set({
        isDisabled: true,
        disabledAt: new Date(),
        disabledReason: reason,
      })
      .where(eq(users.id, userId));

    const [action] = await db
      .insert(adminActions)
      .values({
        actionType: "user_disable",
        targetType: "user",
        targetId: userId,
        adminId,
        reason,
        previousState,
      })
      .returning();

    return { success: true, actionId: action.id };
  }

  async enableUser(
    userId: string,
    adminId: string,
    reason: string
  ): Promise<AdminActionResult> {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user[0]) {
      return { success: false, error: "User not found" };
    }

    if (!user[0].isDisabled) {
      const [action] = await db
        .insert(adminActions)
        .values({
          actionType: "user_enable",
          targetType: "user",
          targetId: userId,
          adminId,
          reason,
          previousState: null,
          metadata: { idempotent: true, noOp: true, alreadyState: "enabled" },
        })
        .returning();
      return { success: true, alreadyInState: true, actionId: action.id };
    }

    const previousState = {
      isDisabled: user[0].isDisabled,
      disabledAt: user[0].disabledAt,
      disabledReason: user[0].disabledReason,
    };

    await db
      .update(users)
      .set({
        isDisabled: false,
        disabledAt: null,
        disabledReason: null,
      })
      .where(eq(users.id, userId));

    const [action] = await db
      .insert(adminActions)
      .values({
        actionType: "user_enable",
        targetType: "user",
        targetId: userId,
        adminId,
        reason,
        previousState,
      })
      .returning();

    return { success: true, actionId: action.id };
  }

  async getActionsForTarget(
    targetType: "tenant" | "user",
    targetId: string,
    limit = 20
  ) {
    return db
      .select()
      .from(adminActions)
      .where(eq(adminActions.targetId, targetId))
      .orderBy(adminActions.createdAt)
      .limit(limit);
  }

  async promoteToAdmin(
    userId: string,
    ownerId: string,
    reason: string
  ): Promise<AdminActionResult> {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user[0]) {
      return { success: false, error: "User not found" };
    }

    if (user[0].isPlatformOwner) {
      return { success: false, error: "Cannot modify platform owner privileges" };
    }

    if (user[0].isPlatformAdmin) {
      const [action] = await db
        .insert(adminActions)
        .values({
          actionType: "admin_promote",
          targetType: "user",
          targetId: userId,
          adminId: ownerId,
          reason,
          previousState: null,
          metadata: { idempotent: true, noOp: true, alreadyState: "admin" },
        })
        .returning();
      return { success: true, alreadyInState: true, actionId: action.id };
    }

    const previousState = { isPlatformAdmin: user[0].isPlatformAdmin };

    await db
      .update(users)
      .set({ isPlatformAdmin: true })
      .where(eq(users.id, userId));

    const [action] = await db
      .insert(adminActions)
      .values({
        actionType: "admin_promote",
        targetType: "user",
        targetId: userId,
        adminId: ownerId,
        reason,
        previousState,
      })
      .returning();

    return { success: true, actionId: action.id };
  }

  async demoteFromAdmin(
    userId: string,
    ownerId: string,
    reason: string
  ): Promise<AdminActionResult> {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user[0]) {
      return { success: false, error: "User not found" };
    }

    if (user[0].isPlatformOwner) {
      return { success: false, error: "Cannot modify platform owner privileges" };
    }

    if (!user[0].isPlatformAdmin) {
      const [action] = await db
        .insert(adminActions)
        .values({
          actionType: "admin_demote",
          targetType: "user",
          targetId: userId,
          adminId: ownerId,
          reason,
          previousState: null,
          metadata: { idempotent: true, noOp: true, alreadyState: "not_admin" },
        })
        .returning();
      return { success: true, alreadyInState: true, actionId: action.id };
    }

    const previousState = { isPlatformAdmin: user[0].isPlatformAdmin };

    await db
      .update(users)
      .set({ isPlatformAdmin: false })
      .where(eq(users.id, userId));

    const [action] = await db
      .insert(adminActions)
      .values({
        actionType: "admin_demote",
        targetType: "user",
        targetId: userId,
        adminId: ownerId,
        reason,
        previousState,
      })
      .returning();

    return { success: true, actionId: action.id };
  }
}

export const adminActionService = new AdminActionService();
