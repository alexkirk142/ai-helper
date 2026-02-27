import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Vitest config for server-side unit tests.
 *
 * Usage:
 *   npx vitest run --config vitest.config.server.ts
 *   npx vitest run --config vitest.config.server.ts server/services/detection/__tests__/...
 *
 * Separate from vite.config.ts because that file sets root="client" for the
 * frontend build; server tests must resolve from the workspace root.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["server/**/*.{test,spec}.{ts,mts}"],
    exclude: ["**/node_modules/**", "**/.git/**"],
  },
});
