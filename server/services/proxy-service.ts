import { db } from "../db";
import { proxies, channels } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import type { Proxy } from "@shared/schema";

export interface ProxyConfig {
  host: string;
  port: number;
  protocol: "http" | "https" | "socks4" | "socks5";
  username?: string | null;
  password?: string | null;
}

export const proxyService = {
  async getAvailableProxy(options?: { 
    protocol?: string; 
    country?: string;
  }): Promise<Proxy | null> {
    let query = db
      .select()
      .from(proxies)
      .where(eq(proxies.status, "available"));
    
    const results = await query.limit(10);
    
    let filtered = results;
    if (options?.protocol) {
      filtered = filtered.filter(p => p.protocol === options.protocol);
    }
    if (options?.country) {
      filtered = filtered.filter(p => p.country === options.country);
    }
    
    return filtered.length > 0 ? filtered[0] : null;
  },

  async assignProxyToChannel(channelId: string, tenantId: string): Promise<Proxy | null> {
    const existingProxy = await db
      .select()
      .from(proxies)
      .where(eq(proxies.assignedChannelId, channelId))
      .limit(1);
    
    if (existingProxy.length > 0) {
      return existingProxy[0];
    }

    const available = await this.getAvailableProxy();
    if (!available) {
      console.log("[ProxyService] No available proxies found");
      return null;
    }

    const [updated] = await db
      .update(proxies)
      .set({
        assignedTenantId: tenantId,
        assignedChannelId: channelId,
        status: "assigned",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(proxies.id, available.id),
          eq(proxies.status, "available")
        )
      )
      .returning();

    if (!updated) {
      return this.assignProxyToChannel(channelId, tenantId);
    }

    console.log(`[ProxyService] Assigned proxy ${updated.host}:${updated.port} to channel ${channelId}`);
    return updated;
  },

  async releaseProxyFromChannel(channelId: string): Promise<void> {
    await db
      .update(proxies)
      .set({
        assignedTenantId: null,
        assignedChannelId: null,
        status: "available",
        updatedAt: new Date(),
      })
      .where(eq(proxies.assignedChannelId, channelId));
    
    console.log(`[ProxyService] Released proxy from channel ${channelId}`);
  },

  async getProxyForChannel(channelId: string): Promise<ProxyConfig | null> {
    const [proxy] = await db
      .select()
      .from(proxies)
      .where(eq(proxies.assignedChannelId, channelId))
      .limit(1);
    
    if (!proxy) {
      return null;
    }

    return {
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol as ProxyConfig["protocol"],
      username: proxy.username,
      password: proxy.password,
    };
  },

  async markProxyFailed(proxyId: string, errorMessage: string): Promise<void> {
    await db
      .update(proxies)
      .set({
        status: "failed",
        lastErrorMessage: errorMessage,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(proxies.id, proxyId));
    
    console.log(`[ProxyService] Marked proxy ${proxyId} as failed: ${errorMessage}`);
  },

  async getProxyStats(): Promise<{
    available: number;
    assigned: number;
    disabled: number;
    failed: number;
  }> {
    const stats = await db
      .select({
        status: proxies.status,
        count: db.$count(proxies, eq(proxies.status, proxies.status)),
      })
      .from(proxies)
      .groupBy(proxies.status);

    const result = {
      available: 0,
      assigned: 0,
      disabled: 0,
      failed: 0,
    };

    for (const stat of stats) {
      if (stat.status in result) {
        result[stat.status as keyof typeof result] = Number(stat.count);
      }
    }

    return result;
  },

  buildProxyUrl(proxy: ProxyConfig): string {
    let auth = "";
    if (proxy.username && proxy.password) {
      auth = `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`;
    }
    return `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`;
  },
};
