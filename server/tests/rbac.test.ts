import { describe, it, expect } from "vitest";
import { 
  hasPermission, 
  getPermissionsForRole,
  type UserRole,
  type Permission 
} from "../middleware/rbac";

describe("RBAC Permission Matrix", () => {
  describe("hasPermission", () => {
    it("owner has all permissions", () => {
      const ownerPermissions: Permission[] = [
        "VIEW_CONVERSATIONS",
        "MANAGE_CONVERSATIONS",
        "VIEW_CUSTOMERS",
        "MANAGE_CUSTOMERS",
        "DELETE_CUSTOMER_DATA",
        "VIEW_ANALYTICS",
        "MANAGE_PRODUCTS",
        "MANAGE_KNOWLEDGE_BASE",
        "MANAGE_AUTOSEND",
        "MANAGE_POLICIES",
        "MANAGE_TRAINING",
        "EXPORT_TRAINING_DATA",
        "MANAGE_CHANNELS",
        "MANAGE_TENANT_SETTINGS",
        "MANAGE_USERS",
        "VIEW_AUDIT_LOGS",
      ];

      ownerPermissions.forEach(permission => {
        expect(hasPermission("owner", permission)).toBe(true);
      });
    });

    it("admin has all permissions except MANAGE_USERS", () => {
      expect(hasPermission("admin", "VIEW_CONVERSATIONS")).toBe(true);
      expect(hasPermission("admin", "MANAGE_AUTOSEND")).toBe(true);
      expect(hasPermission("admin", "DELETE_CUSTOMER_DATA")).toBe(true);
      expect(hasPermission("admin", "MANAGE_USERS")).toBe(false);
    });

    it("operator can view and manage conversations/customers", () => {
      expect(hasPermission("operator", "VIEW_CONVERSATIONS")).toBe(true);
      expect(hasPermission("operator", "MANAGE_CONVERSATIONS")).toBe(true);
      expect(hasPermission("operator", "VIEW_CUSTOMERS")).toBe(true);
      expect(hasPermission("operator", "MANAGE_CUSTOMERS")).toBe(true);
      expect(hasPermission("operator", "VIEW_ANALYTICS")).toBe(true);
    });

    it("operator cannot manage autosend, policies, or training", () => {
      expect(hasPermission("operator", "MANAGE_AUTOSEND")).toBe(false);
      expect(hasPermission("operator", "MANAGE_POLICIES")).toBe(false);
      expect(hasPermission("operator", "MANAGE_TRAINING")).toBe(false);
      expect(hasPermission("operator", "EXPORT_TRAINING_DATA")).toBe(false);
    });

    it("operator cannot delete customer data", () => {
      expect(hasPermission("operator", "DELETE_CUSTOMER_DATA")).toBe(false);
    });

    it("viewer can only view, not manage", () => {
      expect(hasPermission("viewer", "VIEW_CONVERSATIONS")).toBe(true);
      expect(hasPermission("viewer", "VIEW_CUSTOMERS")).toBe(true);
      expect(hasPermission("viewer", "MANAGE_CONVERSATIONS")).toBe(false);
      expect(hasPermission("viewer", "MANAGE_CUSTOMERS")).toBe(false);
      expect(hasPermission("viewer", "VIEW_ANALYTICS")).toBe(false);
    });

    it("guest has no permissions", () => {
      expect(hasPermission("guest", "VIEW_CONVERSATIONS")).toBe(false);
      expect(hasPermission("guest", "VIEW_CUSTOMERS")).toBe(false);
      expect(hasPermission("guest", "MANAGE_AUTOSEND")).toBe(false);
    });
  });

  describe("getPermissionsForRole", () => {
    it("returns all permissions for owner", () => {
      const permissions = getPermissionsForRole("owner");
      expect(permissions.length).toBe(16);
      expect(permissions).toContain("MANAGE_USERS");
    });

    it("returns correct permissions for admin", () => {
      const permissions = getPermissionsForRole("admin");
      expect(permissions).toContain("MANAGE_AUTOSEND");
      expect(permissions).toContain("DELETE_CUSTOMER_DATA");
      expect(permissions).not.toContain("MANAGE_USERS");
    });

    it("returns correct permissions for operator", () => {
      const permissions = getPermissionsForRole("operator");
      expect(permissions).toContain("VIEW_CONVERSATIONS");
      expect(permissions).toContain("MANAGE_CONVERSATIONS");
      expect(permissions).toContain("VIEW_ANALYTICS");
      expect(permissions).not.toContain("MANAGE_AUTOSEND");
      expect(permissions).not.toContain("DELETE_CUSTOMER_DATA");
    });

    it("returns limited permissions for viewer", () => {
      const permissions = getPermissionsForRole("viewer");
      expect(permissions).toContain("VIEW_CONVERSATIONS");
      expect(permissions).toContain("VIEW_CUSTOMERS");
      expect(permissions.length).toBe(2);
    });

    it("returns no permissions for guest", () => {
      const permissions = getPermissionsForRole("guest");
      expect(permissions.length).toBe(0);
    });
  });

  describe("role hierarchy for sensitive actions", () => {
    it("autosend requires admin or higher", () => {
      expect(hasPermission("owner", "MANAGE_AUTOSEND")).toBe(true);
      expect(hasPermission("admin", "MANAGE_AUTOSEND")).toBe(true);
      expect(hasPermission("operator", "MANAGE_AUTOSEND")).toBe(false);
      expect(hasPermission("viewer", "MANAGE_AUTOSEND")).toBe(false);
    });

    it("policies require admin or higher", () => {
      expect(hasPermission("owner", "MANAGE_POLICIES")).toBe(true);
      expect(hasPermission("admin", "MANAGE_POLICIES")).toBe(true);
      expect(hasPermission("operator", "MANAGE_POLICIES")).toBe(false);
      expect(hasPermission("viewer", "MANAGE_POLICIES")).toBe(false);
    });

    it("training requires admin or higher", () => {
      expect(hasPermission("owner", "MANAGE_TRAINING")).toBe(true);
      expect(hasPermission("admin", "MANAGE_TRAINING")).toBe(true);
      expect(hasPermission("operator", "MANAGE_TRAINING")).toBe(false);
      expect(hasPermission("viewer", "MANAGE_TRAINING")).toBe(false);
    });

    it("analytics require operator or higher", () => {
      expect(hasPermission("owner", "VIEW_ANALYTICS")).toBe(true);
      expect(hasPermission("admin", "VIEW_ANALYTICS")).toBe(true);
      expect(hasPermission("operator", "VIEW_ANALYTICS")).toBe(true);
      expect(hasPermission("viewer", "VIEW_ANALYTICS")).toBe(false);
    });

    it("customer data deletion requires admin or higher", () => {
      expect(hasPermission("owner", "DELETE_CUSTOMER_DATA")).toBe(true);
      expect(hasPermission("admin", "DELETE_CUSTOMER_DATA")).toBe(true);
      expect(hasPermission("operator", "DELETE_CUSTOMER_DATA")).toBe(false);
      expect(hasPermission("viewer", "DELETE_CUSTOMER_DATA")).toBe(false);
    });
  });
});
