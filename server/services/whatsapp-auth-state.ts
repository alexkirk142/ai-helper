/**
 * usePostgresAuthState — Baileys AuthenticationState backed by PostgreSQL.
 *
 * Replaces useMultiFileAuthState: no files are written to disk.
 * All creds and Signal-Protocol keys are stored in whatsapp_auth_sessions
 * as a single JSON blob per (tenantId, accountId) row.
 *
 * authData JSON schema (new format):
 *   { creds: AuthenticationCreds, keys: { [type]: { [id]: value } } }
 *
 * Backward-compat migrations (handled automatically on first call):
 *   1. Old DB format  { files: { [filename]: base64 } }  → converted to new format
 *   2. Old disk files ./whatsapp_sessions/{tenantId}/    → read, stored to DB, disk removed
 */

import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { whatsappAuthSessions } from "@shared/schema";
import * as fs from "fs";
import * as path from "path";

// Key types Baileys uses (order matters: longer prefixes must come first)
const SIGNAL_KEY_TYPES = [
  "app-state-sync-key",
  "app-state-sync-version",
  "sender-key-memory",
  "sender-key",
  "pre-key",
  "session",
] as const;

interface AuthData {
  creds?: Record<string, unknown>;
  keys: Record<string, Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Migrate legacy { files: { [filename]: base64 } } DB format → AuthData
// ---------------------------------------------------------------------------
function migrateFilesBlob(files: Record<string, string>): AuthData {
  const result: AuthData = { keys: {} };
  for (const [filename, b64] of Object.entries(files)) {
    if (!filename.endsWith(".json")) continue;
    let content: string;
    try {
      content = Buffer.from(b64, "base64").toString("utf-8");
    } catch {
      continue;
    }
    if (filename === "creds.json") {
      try { result.creds = JSON.parse(content); } catch { /* ignore */ }
    } else {
      const name = filename.slice(0, -5);
      for (const kt of SIGNAL_KEY_TYPES) {
        if (name.startsWith(kt + "-")) {
          const id = name.slice(kt.length + 1);
          if (!result.keys[kt]) result.keys[kt] = {};
          try { result.keys[kt][id] = JSON.parse(content); } catch { /* ignore */ }
          break;
        }
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Read legacy disk session ./whatsapp_sessions/{tenantId}/ → AuthData
// Does NOT delete disk files — caller must delete AFTER successful DB write.
// ---------------------------------------------------------------------------
function readFromDisk(tenantId: string): { data: AuthData; sessionDir: string } | null {
  const sessionDir = path.join("./whatsapp_sessions", tenantId);
  if (!fs.existsSync(sessionDir)) return null;

  const result: AuthData = { keys: {} };
  let found = false;
  try {
    for (const filename of fs.readdirSync(sessionDir)) {
      if (!filename.endsWith(".json")) continue;
      const fullPath = path.join(sessionDir, filename);
      if (!fs.statSync(fullPath).isFile()) continue;
      let content: string;
      try { content = fs.readFileSync(fullPath, "utf-8"); } catch { continue; }

      if (filename === "creds.json") {
        try { result.creds = JSON.parse(content); found = true; } catch { /* ignore */ }
      } else {
        const name = filename.slice(0, -5);
        for (const kt of SIGNAL_KEY_TYPES) {
          if (name.startsWith(kt + "-")) {
            const id = name.slice(kt.length + 1);
            if (!result.keys[kt]) result.keys[kt] = {};
            try { result.keys[kt][id] = JSON.parse(content); found = true; } catch { /* ignore */ }
            break;
          }
        }
      }
    }
  } catch (err: any) {
    console.warn(`[WA-AuthState] Disk read failed for ${tenantId}:`, err.message);
  }

  return found ? { data: result, sessionDir } : null;
}

// ---------------------------------------------------------------------------
// Upsert authData JSON into DB
// ---------------------------------------------------------------------------
async function upsertAuthData(tenantId: string, accountId: string, authData: AuthData): Promise<void> {
  const serialized = JSON.stringify(authData);
  await db
    .insert(whatsappAuthSessions)
    .values({ tenantId, accountId, authData: serialized, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [whatsappAuthSessions.tenantId, whatsappAuthSessions.accountId],
      set: { authData: serialized, updatedAt: new Date() },
    });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function usePostgresAuthState(
  tenantId: string,
  accountId: string = "default",
): Promise<{ state: any; saveCreds: () => Promise<void> }> {
  const { BufferJSON, initAuthCreds } = await import("@whiskeysockets/baileys");

  // 1. Load from DB
  const [row] = await db
    .select()
    .from(whatsappAuthSessions)
    .where(
      and(
        eq(whatsappAuthSessions.tenantId, tenantId),
        eq(whatsappAuthSessions.accountId, accountId),
      ),
    );

  let authData: AuthData = { keys: {} };

  if (row?.authData) {
    try {
      const raw = JSON.parse(row.authData) as AuthData & { files?: Record<string, string> };
      if (raw.files) {
        // Legacy format: { files: { [filename]: base64 } }
        authData = migrateFilesBlob(raw.files);
        console.log(`[WA-AuthState] Migrated legacy files-blob in DB for tenant=${tenantId} account=${accountId}`);
        await upsertAuthData(tenantId, accountId, authData);
      } else {
        authData = raw;
      }
    } catch (err: any) {
      console.warn(`[WA-AuthState] Failed to parse authData for ${tenantId}/${accountId}:`, err.message);
    }
  } else {
    // 2. No DB row — try disk migration (backward compat with old file-based sessions).
    // Delete disk files ONLY after the DB write succeeds to avoid data loss on DB failure.
    const disk = readFromDisk(tenantId);
    if (disk?.data.creds) {
      authData = disk.data;
      await upsertAuthData(tenantId, accountId, authData);
      // DB write succeeded — safe to remove disk dir
      try {
        fs.rmSync(disk.sessionDir, { recursive: true, force: true });
        console.log(`[WA-AuthState] Migrated disk session to DB and removed ${disk.sessionDir}`);
      } catch (err: any) {
        console.warn(`[WA-AuthState] Could not remove disk session dir ${disk.sessionDir}:`, err.message);
      }
    }
  }

  // Deserialize creds (BufferJSON restores Buffer objects from their JSON representation)
  const creds: Record<string, unknown> = authData.creds
    ? JSON.parse(JSON.stringify(authData.creds), BufferJSON.reviver)
    : (initAuthCreds() as unknown as Record<string, unknown>);

  // In-memory key store: { [type]: { [id]: serialized-value } }
  const keyData: Record<string, Record<string, unknown>> = authData.keys ?? {};

  // Write-through: persist to DB immediately after every change
  async function persist(): Promise<void> {
    const snapshot: AuthData = {
      creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
      keys: keyData,
    };
    await upsertAuthData(tenantId, accountId, snapshot);
  }

  const state = {
    creds,
    keys: {
      get: async (type: string, ids: string[]) => {
        const result: Record<string, unknown> = {};
        const typeStore = keyData[type] ?? {};
        for (const id of ids) {
          const raw = typeStore[id];
          if (raw !== undefined && raw !== null) {
            result[id] = JSON.parse(JSON.stringify(raw), BufferJSON.reviver);
          }
        }
        return result;
      },
      set: async (data: Record<string, Record<string, unknown | null>>) => {
        for (const [type, entries] of Object.entries(data)) {
          if (!keyData[type]) keyData[type] = {};
          for (const [id, value] of Object.entries(entries)) {
            if (value === null || value === undefined) {
              delete keyData[type][id];
            } else {
              keyData[type][id] = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
            }
          }
        }
        await persist();
      },
    },
  };

  const saveCreds = async (): Promise<void> => {
    await persist();
  };

  return { state, saveCreds };
}
