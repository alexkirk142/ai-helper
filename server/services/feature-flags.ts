import type { FeatureFlag, InsertFeatureFlag, FeatureFlagName } from "@shared/schema";
import { featureFlags } from "@shared/schema";
import { db } from "../db";
import { sql, eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";

const DEFAULT_FLAGS: Record<FeatureFlagName, { description: string; enabled: boolean }> = {
  AI_SUGGESTIONS_ENABLED: {
    description: "Enable AI-powered response suggestions",
    enabled: true,
  },
  DECISION_ENGINE_ENABLED: {
    description: "Enable advanced decision engine for auto-responses",
    enabled: false,
  },
  AI_AUTOSEND_ENABLED: {
    description: "Enable automatic sending of AI responses without approval",
    enabled: false,
  },
  HUMAN_DELAY_ENABLED: {
    description: "Enable human-like delay before sending responses",
    enabled: false,
  },
  RAG_ENABLED: {
    description: "Enable RAG (Retrieval-Augmented Generation) for context",
    enabled: true,
  },
  FEW_SHOT_LEARNING: {
    description: "Enable few-shot learning with examples from approved responses",
    enabled: true,
  },
  TELEGRAM_CHANNEL_ENABLED: {
    description: "Enable Telegram messenger channel",
    enabled: false,
  },
  WHATSAPP_CHANNEL_ENABLED: {
    description: "Enable WhatsApp messenger channel",
    enabled: false,
  },
  MAX_CHANNEL_ENABLED: {
    description: "Enable Max (VK Teams) messenger channel",
    enabled: false,
  },
  TELEGRAM_PERSONAL_CHANNEL_ENABLED: {
    description: "Enable Telegram Personal (MTProto) channel",
    enabled: false,
  },
  WHATSAPP_PERSONAL_CHANNEL_ENABLED: {
    description: "Enable WhatsApp Personal (Baileys) channel",
    enabled: false,
  },
  AUTO_PARTS_ENABLED: {
    description: "Enable auto parts dealer functionality (VIN lookup, gearbox ID, price search, Agent tab, price templates)",
    enabled: false,
  },
  MAX_PERSONAL_CHANNEL_ENABLED: {
    description: "Enable Max (VK Teams) Personal channel",
    enabled: false,
  },
  AI_PRICE_ESTIMATE_ENABLED: {
    description: "Enable AI-based price estimate fallback when web search returns no results",
    enabled: true,
  },
  PRICE_ESCALATION_ENABLED: {
    description: "Enable structured escalation to operator when Yandex price search is insufficient",
    enabled: true,
  },
  GPT_WEB_SEARCH_ENABLED: {
    description: "Enable GPT web_search as fallback when Yandex price search is insufficient",
    enabled: true,
  },
};

class FeatureFlagService {
  /** In-memory write-through cache: key = getKey(name, tenantId) */
  private flags: Map<string, FeatureFlag> = new Map();

  constructor() {
    this.seedDefaults();
  }

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------

  /** Seed hard-coded defaults into the in-memory map (synchronous). */
  private seedDefaults(): void {
    for (const [name, config] of Object.entries(DEFAULT_FLAGS)) {
      const flag: FeatureFlag = {
        id: randomUUID(),
        name,
        description: config.description,
        enabled: config.enabled,
        tenantId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.flags.set(this.getKey(name, null), flag);
    }
  }

  /**
   * Ensure the partial unique indexes required by persistToDb() exist.
   * Idempotent (IF NOT EXISTS) — safe to run on every startup.
   * This self-heals deployments where db:migrate was not run manually.
   */
  private async ensureSchema(): Promise<void> {
    // Drop the old column-level UNIQUE(name) constraint if it still exists
    // (present in DBs created before migration 0013 was applied).
    await db.execute(sql`
      ALTER TABLE feature_flags DROP CONSTRAINT IF EXISTS feature_flags_name_unique
    `);

    // Partial index for global flags (tenant_id IS NULL): unique on name
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_global_unique
        ON feature_flags (name)
        WHERE tenant_id IS NULL
    `);

    // Partial index for per-tenant overrides (tenant_id IS NOT NULL): unique on (name, tenant_id)
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_tenant_unique
        ON feature_flags (name, tenant_id)
        WHERE tenant_id IS NOT NULL
    `);
  }

  /**
   * Load persisted flags from the DB and merge them into the in-memory cache,
   * overwriting defaults with stored values.  Should be awaited at server
   * startup before requests are served.
   *
   * Also seeds global defaults into the DB so tenant-specific overrides have a
   * baseline row and the table is never empty after first boot.
   */
  async initFromDb(): Promise<void> {
    try {
      await this.ensureSchema();

      // Seed global defaults to DB (upsert — do not overwrite existing values)
      for (const flag of this.flags.values()) {
        if (flag.tenantId === null) {
          await db.execute(sql`
            INSERT INTO feature_flags (id, name, description, enabled, tenant_id, created_at, updated_at)
            VALUES (${flag.id}, ${flag.name}, ${flag.description}, ${flag.enabled}, NULL, NOW(), NOW())
            ON CONFLICT (name) WHERE tenant_id IS NULL
            DO NOTHING
          `);
        }
      }

      // Load all rows (global + tenant overrides) into memory
      const rows = await db.select().from(featureFlags);
      for (const row of rows) {
        this.flags.set(this.getKey(row.name, row.tenantId), {
          ...row,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        });
      }
      console.log(`[FeatureFlags] Loaded ${rows.length} flag(s) from DB`);
    } catch (err) {
      console.error("[FeatureFlags] DB load failed — using in-memory defaults:", err);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private getKey(name: string, tenantId: string | null): string {
    return tenantId ? `${tenantId}:${name}` : `global:${name}`;
  }

  /**
   * Upsert a flag row to the DB.
   * Uses two separate partial unique indexes (migration 0013) to handle the
   * nullable tenantId: global rows conflict on (name) WHERE tenant_id IS NULL,
   * per-tenant rows conflict on (name, tenant_id) WHERE tenant_id IS NOT NULL.
   */
  private async persistToDb(flag: FeatureFlag): Promise<void> {
    try {
      if (flag.tenantId === null) {
        await db.execute(sql`
          INSERT INTO feature_flags (id, name, description, enabled, tenant_id, created_at, updated_at)
          VALUES (${flag.id}, ${flag.name}, ${flag.description}, ${flag.enabled}, NULL, NOW(), NOW())
          ON CONFLICT (name) WHERE tenant_id IS NULL
          DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
        `);
      } else {
        await db.execute(sql`
          INSERT INTO feature_flags (id, name, description, enabled, tenant_id, created_at, updated_at)
          VALUES (${flag.id}, ${flag.name}, ${flag.description}, ${flag.enabled}, ${flag.tenantId}, NOW(), NOW())
          ON CONFLICT (name, tenant_id) WHERE tenant_id IS NOT NULL
          DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
        `);
      }
    } catch (err) {
      console.error("[FeatureFlags] DB persist failed:", err);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Check whether a flag is enabled.  For tenant-specific calls the DB is
   * queried directly so that overrides set on another process/pod are always
   * visible without a restart.  The in-memory cache is used only for the
   * global (non-tenant) fallback.
   */
  async isEnabled(name: FeatureFlagName, tenantId?: string): Promise<boolean> {
    if (tenantId) {
      try {
        const [override] = await db
          .select()
          .from(featureFlags)
          .where(and(eq(featureFlags.name, name), eq(featureFlags.tenantId, tenantId)))
          .limit(1);
        if (override) return override.enabled;
      } catch (err) {
        console.error("[FeatureFlags] DB query failed, falling back to cache:", err);
      }
    }
    // Fall back to in-memory global default (seeded at startup)
    return this.flags.get(this.getKey(name, null))?.enabled ?? false;
  }

  isEnabledSync(name: string, tenantId?: string): boolean {
    if (tenantId) {
      const tenantFlag = this.flags.get(this.getKey(name, tenantId));
      if (tenantFlag) return tenantFlag.enabled;
    }
    const globalFlag = this.flags.get(this.getKey(name, null));
    return globalFlag?.enabled ?? false;
  }

  async getFlag(name: string, tenantId?: string | null): Promise<FeatureFlag | undefined> {
    if (tenantId) {
      try {
        const [override] = await db
          .select()
          .from(featureFlags)
          .where(and(eq(featureFlags.name, name), eq(featureFlags.tenantId, tenantId)))
          .limit(1);
        if (override) return { ...override, createdAt: new Date(override.createdAt), updatedAt: new Date(override.updatedAt) };
      } catch (err) {
        console.error("[FeatureFlags] DB query failed, falling back to cache:", err);
      }
    }
    // Fall back to global in-memory entry
    return this.flags.get(this.getKey(name, null));
  }

  async getAllFlags(tenantId?: string): Promise<FeatureFlag[]> {
    try {
      // Load all global flags plus tenant-specific overrides from DB
      const globalRows = await db
        .select()
        .from(featureFlags)
        .where(isNull(featureFlags.tenantId));

      const seenNames = new Set<string>();
      const result: FeatureFlag[] = [];

      if (tenantId) {
        const tenantRows = await db
          .select()
          .from(featureFlags)
          .where(and(eq(featureFlags.tenantId, tenantId)));

        for (const row of tenantRows) {
          result.push({ ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) });
          seenNames.add(row.name);
        }
      }

      for (const row of globalRows) {
        if (!seenNames.has(row.name)) {
          result.push({ ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) });
        }
      }

      return result;
    } catch (err) {
      console.error("[FeatureFlags] DB query failed, falling back to cache:", err);
      // Fallback: serve from in-memory cache
      const result: FeatureFlag[] = [];
      const seenNames = new Set<string>();
      if (tenantId) {
        for (const flag of this.flags.values()) {
          if (flag.tenantId === tenantId) { result.push(flag); seenNames.add(flag.name); }
        }
      }
      for (const flag of this.flags.values()) {
        if (flag.tenantId === null && !seenNames.has(flag.name)) result.push(flag);
      }
      return result;
    }
  }

  async setFlag(name: string, enabled: boolean, tenantId?: string | null): Promise<FeatureFlag> {
    const key = this.getKey(name, tenantId ?? null);
    const existing = this.flags.get(key);

    const flag: FeatureFlag = existing
      ? { ...existing, enabled, updatedAt: new Date() }
      : {
          id: randomUUID(),
          name,
          description: DEFAULT_FLAGS[name as FeatureFlagName]?.description ?? null,
          enabled,
          tenantId: tenantId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

    this.flags.set(key, flag);
    await this.persistToDb(flag);
    return flag;
  }

  async createFlag(data: InsertFeatureFlag): Promise<FeatureFlag> {
    const flag: FeatureFlag = {
      id: randomUUID(),
      name: data.name,
      description: data.description ?? null,
      enabled: data.enabled ?? false,
      tenantId: data.tenantId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.flags.set(this.getKey(flag.name, flag.tenantId), flag);
    await this.persistToDb(flag);
    return flag;
  }

  async deleteFlag(id: string): Promise<boolean> {
    for (const [key, flag] of this.flags.entries()) {
      if (flag.id === id) {
        this.flags.delete(key);
        return true;
      }
    }
    return false;
  }
}

export const featureFlagService = new FeatureFlagService();

export function isFeatureEnabled(name: string, tenantId?: string): boolean {
  return featureFlagService.isEnabledSync(name, tenantId);
}
