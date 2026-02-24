import { eq, desc, and, or, ilike, inArray, sql, gte, gt } from "drizzle-orm";
import { db } from "./db";
import {
  tenants, channels, users, userInvites, emailTokens, customers, customerNotes, customerMemory, conversations, messages,
  products, knowledgeDocs, aiSuggestions, humanActions, aiTrainingSamples, aiTrainingPolicies, learningQueue, escalationEvents,
  responseTemplates, decisionSettings, humanDelaySettings, onboardingState, readinessReports, ragDocuments, ragChunks, csatRatings, conversions, lostDeals,
  updateHistory,
  vehicleLookupCache, vehicleLookupCases,
  priceSnapshots, internalPrices,
  telegramSessions,
  messageTemplates, paymentMethods,
  tenantAgentSettings,
  transmissionIdentityCache,
} from "@shared/schema";
import {
  type Tenant, type InsertTenant,
  type Channel, type InsertChannel,
  type User, type InsertUser,
  type UserInvite, type InsertUserInvite,
  type EmailToken, type InsertEmailToken,
  type Customer, type InsertCustomer, type UpdateCustomer,
  type CustomerNote, type InsertCustomerNote,
  type CustomerMemory, type InsertCustomerMemory,
  type Conversation, type InsertConversation,
  type Message, type InsertMessage,
  type Product, type InsertProduct,
  type KnowledgeDoc, type InsertKnowledgeDoc,
  type RagDocument, type InsertRagDocument,
  type RagChunk, type InsertRagChunk,
  type AiSuggestion, type InsertAiSuggestion,
  type HumanAction, type InsertHumanAction,
  type AiTrainingSample, type InsertAiTrainingSample,
  type AiTrainingPolicy, type InsertAiTrainingPolicy,
  type LearningQueueItem, type InsertLearningQueueItem,
  type EscalationEvent, type InsertEscalationEvent,
  type ResponseTemplate, type InsertResponseTemplate,
  type DecisionSettings, type InsertDecisionSettings,
  type HumanDelaySettings, type InsertHumanDelaySettings,
  type OnboardingState, type InsertOnboardingState,
  type ReadinessReport, type InsertReadinessReport,
  type CsatRating, type InsertCsatRating,
  type Conversion, type InsertConversion,
  type LostDeal, type InsertLostDeal,
  type UpdateHistory, type InsertUpdateHistory, type UpdateStatus,
  type ConversationWithCustomer,
  type ConversationDetail,
  type DashboardMetrics,
  DEFAULT_DELAY_PROFILES,
  type VehicleLookupCache, type InsertVehicleLookupCache,
  type VehicleLookupCase, type InsertVehicleLookupCase,
  type PriceSnapshot, type InsertPriceSnapshot,
  type InternalPrice, type InsertInternalPrice,
  type TelegramSession, type InsertTelegramSession,
  type MessageTemplate, type InsertMessageTemplate,
  type PaymentMethod, type InsertPaymentMethod,
  type TenantAgentSettings, type InsertTenantAgentSettings,
  type TransmissionIdentityCache, type InsertTransmissionIdentityCache,
} from "@shared/schema";
import type { IStorage } from "./storage";
import { encryptSessionString, decryptSessionString } from "./services/telegram-session-crypto";

export class DatabaseStorage implements IStorage {
  private defaultTenantId: string | null = null;

  async getTenant(id: string): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    return tenant;
  }

  async getTenantTemplates(tenantId: string): Promise<{ gearboxLookupFound: string; gearboxLookupModelOnly: string; gearboxTagRequest: string; gearboxLookupFallback: string; gearboxNoVin: string }> {
    const { getMergedGearboxTemplates } = await import("./services/gearbox-templates");
    const tenant = await this.getTenant(tenantId);
    return getMergedGearboxTemplates(tenant ?? undefined);
  }

  async getDefaultTenant(): Promise<Tenant | undefined> {
    if (this.defaultTenantId) {
      return this.getTenant(this.defaultTenantId);
    }
    const [tenant] = await db.select().from(tenants).limit(1);
    if (tenant) {
      this.defaultTenantId = tenant.id;
    }
    return tenant;
  }

  async createTenant(data: InsertTenant): Promise<Tenant> {
    const [tenant] = await db.insert(tenants).values(data).returning();
    if (!this.defaultTenantId) {
      this.defaultTenantId = tenant.id;
    }
    return tenant;
  }

  async updateTenant(id: string, data: Partial<InsertTenant>): Promise<Tenant | undefined> {
    const [tenant] = await db.update(tenants).set(data).where(eq(tenants.id, id)).returning();
    return tenant;
  }

  async getChannel(id: string): Promise<Channel | undefined> {
    const [channel] = await db.select().from(channels).where(eq(channels.id, id));
    return channel;
  }

  async getChannelsByTenant(tenantId: string): Promise<Channel[]> {
    return db.select().from(channels).where(eq(channels.tenantId, tenantId));
  }

  async getChannelsByType(channelType: string): Promise<Channel[]> {
    return db.select().from(channels).where(eq(channels.type, channelType as any));
  }

  async updateChannel(id: string, data: Partial<InsertChannel>): Promise<Channel | undefined> {
    const [channel] = await db.update(channels).set(data).where(eq(channels.id, id)).returning();
    return channel;
  }

  async createChannel(data: InsertChannel): Promise<Channel> {
    const [channel] = await db.insert(channels).values(data).returning();
    return channel;
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByOidcId(oidcId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.oidcId, oidcId));
    return user;
  }

  async createUser(data: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user;
  }

  async updateUserLoginAttempts(userId: string, attempts: number, lockedUntil: Date | null): Promise<void> {
    await db.update(users)
      .set({ failedLoginAttempts: attempts, lockedUntil })
      .where(eq(users.id, userId));
  }

  async updateUserLoginSuccess(userId: string): Promise<void> {
    await db.update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, userId));
  }

  // User Invites
  async getUserInviteByTokenHash(tokenHash: string): Promise<UserInvite | undefined> {
    const [invite] = await db.select().from(userInvites).where(eq(userInvites.tokenHash, tokenHash));
    return invite;
  }

  async getPendingInviteForEmail(tenantId: string, email: string): Promise<UserInvite | undefined> {
    const [invite] = await db.select().from(userInvites)
      .where(and(
        eq(userInvites.tenantId, tenantId),
        eq(userInvites.email, email.toLowerCase()),
        sql`${userInvites.usedAt} IS NULL`
      ));
    return invite;
  }

  async createUserInvite(data: InsertUserInvite): Promise<UserInvite> {
    const [invite] = await db.insert(userInvites).values(data).returning();
    return invite;
  }

  async markUserInviteUsed(inviteId: string): Promise<void> {
    await db.update(userInvites)
      .set({ usedAt: new Date() })
      .where(eq(userInvites.id, inviteId));
  }

  // Email Token methods
  async createEmailToken(data: InsertEmailToken): Promise<EmailToken> {
    const [token] = await db.insert(emailTokens).values(data).returning();
    return token;
  }

  async getEmailTokenByHash(tokenHash: string): Promise<EmailToken | undefined> {
    const [token] = await db.select().from(emailTokens).where(eq(emailTokens.tokenHash, tokenHash));
    return token;
  }

  async markEmailTokenUsed(tokenId: string): Promise<void> {
    await db.update(emailTokens)
      .set({ usedAt: new Date() })
      .where(eq(emailTokens.id, tokenId));
  }

  async invalidateUserTokens(userId: string, type: string): Promise<void> {
    await db.update(emailTokens)
      .set({ usedAt: new Date() })
      .where(and(
        eq(emailTokens.userId, userId),
        eq(emailTokens.type, type),
        sql`${emailTokens.usedAt} IS NULL`
      ));
  }

  async updateUserEmailVerified(userId: string): Promise<void> {
    await db.update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await db.update(users)
      .set({ password: passwordHash, passwordUpdatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async linkOidcToUser(userId: string, oidcId: string): Promise<void> {
    await db.update(users)
      .set({ oidcId, authProvider: "mixed" })
      .where(eq(users.id, userId));
  }

  async getCustomer(id: string): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    return customer;
  }

  async getCustomersByTenant(tenantId: string): Promise<Customer[]> {
    return db.select().from(customers).where(eq(customers.tenantId, tenantId));
  }

  async createCustomer(data: InsertCustomer): Promise<Customer> {
    const [customer] = await db.insert(customers).values(data).returning();
    return customer;
  }

  async searchCustomers(tenantId: string, query: string): Promise<Customer[]> {
    return db.select().from(customers).where(
      and(
        eq(customers.tenantId, tenantId),
        or(
          ilike(customers.name, `%${query}%`),
          ilike(customers.phone, `%${query}%`),
          ilike(customers.email, `%${query}%`),
          ilike(customers.externalId, `%${query}%`)
        )
      )
    );
  }

  async getCustomerByExternalId(tenantId: string, channel: string, externalId: string): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(
      and(
        eq(customers.tenantId, tenantId),
        eq(customers.channel, channel),
        eq(customers.externalId, externalId)
      )
    );
    return customer;
  }

  async updateCustomer(id: string, data: UpdateCustomer): Promise<Customer | undefined> {
    const [customer] = await db.update(customers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    return customer;
  }

  // Customer Notes
  async getCustomerNote(id: string): Promise<CustomerNote | undefined> {
    const [note] = await db.select().from(customerNotes).where(eq(customerNotes.id, id));
    return note;
  }

  async getCustomerNotes(customerId: string): Promise<CustomerNote[]> {
    return db.select().from(customerNotes)
      .where(eq(customerNotes.customerId, customerId))
      .orderBy(desc(customerNotes.createdAt));
  }

  async createCustomerNote(note: InsertCustomerNote): Promise<CustomerNote> {
    const [created] = await db.insert(customerNotes).values(note).returning();
    return created;
  }

  async deleteCustomerNote(id: string): Promise<boolean> {
    const result = await db.delete(customerNotes).where(eq(customerNotes.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Customer Memory
  async getCustomerMemory(tenantId: string, customerId: string): Promise<CustomerMemory | undefined> {
    const [memory] = await db.select().from(customerMemory)
      .where(and(
        eq(customerMemory.tenantId, tenantId),
        eq(customerMemory.customerId, customerId)
      ));
    return memory;
  }

  async upsertCustomerMemory(data: InsertCustomerMemory): Promise<CustomerMemory> {
    const existing = await this.getCustomerMemory(data.tenantId, data.customerId);
    
    if (existing) {
      const [updated] = await db.update(customerMemory)
        .set({
          preferences: data.preferences ?? existing.preferences,
          frequentTopics: data.frequentTopics ?? existing.frequentTopics,
          lastSummaryText: data.lastSummaryText ?? existing.lastSummaryText,
          updatedAt: new Date(),
        })
        .where(eq(customerMemory.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(customerMemory).values({
      ...data,
      preferences: data.preferences ?? {},
      frequentTopics: data.frequentTopics ?? {},
    }).returning();
    return created;
  }

  async incrementFrequentTopic(tenantId: string, customerId: string, intent: string): Promise<CustomerMemory> {
    const existing = await this.getCustomerMemory(tenantId, customerId);
    
    const currentTopics = (existing?.frequentTopics as Record<string, number>) ?? {};
    const newTopics = { ...currentTopics, [intent]: (currentTopics[intent] || 0) + 1 };
    
    if (existing) {
      const [updated] = await db.update(customerMemory)
        .set({ frequentTopics: newTopics, updatedAt: new Date() })
        .where(eq(customerMemory.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(customerMemory).values({
      tenantId,
      customerId,
      preferences: {},
      frequentTopics: newTopics,
    }).returning();
    return created;
  }

  async updateCustomerPreferences(tenantId: string, customerId: string, preferences: Record<string, unknown>): Promise<CustomerMemory> {
    const existing = await this.getCustomerMemory(tenantId, customerId);
    
    if (existing) {
      const merged = { ...(existing.preferences as Record<string, unknown>), ...preferences };
      const [updated] = await db.update(customerMemory)
        .set({ preferences: merged, updatedAt: new Date() })
        .where(eq(customerMemory.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(customerMemory).values({
      tenantId,
      customerId,
      preferences,
      frequentTopics: {},
    }).returning();
    return created;
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conv;
  }

  async getConversationWithCustomer(id: string): Promise<ConversationWithCustomer | undefined> {
    const conv = await this.getConversation(id);
    if (!conv) return undefined;

    const customer = await this.getCustomer(conv.customerId);
    if (!customer) return undefined;

    const msgs = await this.getMessagesByConversation(id);
    const lastMessage = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;

    return { ...conv, customer, lastMessage };
  }

  async getConversationDetail(id: string): Promise<ConversationDetail | undefined> {
    const conv = await this.getConversation(id);
    if (!conv) return undefined;

    const customer = await this.getCustomer(conv.customerId);
    if (!customer) return undefined;

    const msgs = await this.getMessagesByConversation(id);
    const suggestion = await this.getPendingSuggestionByConversation(id);

    return { ...conv, customer, messages: msgs, currentSuggestion: suggestion };
  }

  async getConversationsByTenant(tenantId: string): Promise<ConversationWithCustomer[]> {
    const rows = await db
      .select({ conv: conversations, customer: customers, channel: channels })
      .from(conversations)
      .innerJoin(customers, eq(conversations.customerId, customers.id))
      .leftJoin(channels, eq(conversations.channelId, channels.id))
      .where(eq(conversations.tenantId, tenantId))
      .orderBy(desc(conversations.lastMessageAt));

    if (rows.length === 0) return [];

    const convIds = rows.map(r => r.conv.id);
    const allMessages = await db
      .select()
      .from(messages)
      .where(inArray(messages.conversationId, convIds))
      .orderBy(desc(messages.createdAt));

    // Keep the first occurrence per conversationId (newest, since ordered DESC)
    const lastMsgMap = new Map<string, Message>();
    for (const msg of allMessages) {
      if (!lastMsgMap.has(msg.conversationId)) {
        lastMsgMap.set(msg.conversationId, msg);
      }
    }

    return rows.map(({ conv, customer, channel }) => ({
      ...conv,
      customer,
      lastMessage: lastMsgMap.get(conv.id),
      channel: channel ?? undefined,
    }));
  }

  async getActiveConversations(tenantId: string): Promise<ConversationWithCustomer[]> {
    const rows = await db
      .select({ conv: conversations, customer: customers, channel: channels })
      .from(conversations)
      .innerJoin(customers, eq(conversations.customerId, customers.id))
      .leftJoin(channels, eq(conversations.channelId, channels.id))
      .where(and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.status, "active")
      ))
      .orderBy(desc(conversations.lastMessageAt));

    if (rows.length === 0) return [];

    const convIds = rows.map(r => r.conv.id);
    const allMessages = await db
      .select()
      .from(messages)
      .where(inArray(messages.conversationId, convIds))
      .orderBy(desc(messages.createdAt));

    const lastMsgMap = new Map<string, Message>();
    for (const msg of allMessages) {
      if (!lastMsgMap.has(msg.conversationId)) {
        lastMsgMap.set(msg.conversationId, msg);
      }
    }

    return rows.map(({ conv, customer, channel }) => ({
      ...conv,
      customer,
      lastMessage: lastMsgMap.get(conv.id),
      channel: channel ?? undefined,
    }));
  }

  async getConversationChannelCounts(tenantId: string): Promise<{ all: number; telegram?: number; max?: number; whatsapp?: number }> {
    const tenantChannels = await db
      .select({ type: channels.type })
      .from(channels)
      .where(eq(channels.tenantId, tenantId));

    const connectedTypes = new Set(tenantChannels.map(c => c.type));

    const hasTelegram = connectedTypes.has("telegram") || connectedTypes.has("telegram_personal");
    const hasMax = connectedTypes.has("max") || connectedTypes.has("max_personal");
    const hasWhatsApp = connectedTypes.has("whatsapp") || connectedTypes.has("whatsapp_personal");

    const rows = await db
      .select({ channelType: channels.type, unread: conversations.unreadCount })
      .from(conversations)
      .leftJoin(channels, eq(conversations.channelId, channels.id))
      .where(eq(conversations.tenantId, tenantId));

    let all = 0;
    let telegram = 0;
    let max = 0;
    let whatsapp = 0;

    for (const row of rows) {
      const unread = row.unread ?? 0;
      all += unread;
      const t = row.channelType ?? "";
      if (t === "telegram" || t === "telegram_personal") telegram += unread;
      else if (t === "max" || t === "max_personal") max += unread;
      else if (t === "whatsapp" || t === "whatsapp_personal") whatsapp += unread;
    }

    return {
      all,
      ...(hasTelegram ? { telegram } : {}),
      ...(hasMax ? { max } : {}),
      ...(hasWhatsApp ? { whatsapp } : {}),
    };
  }

  async createConversation(data: InsertConversation & { lastMessageAt?: Date; createdAt?: Date }): Promise<Conversation> {
    const [conv] = await db.insert(conversations).values({
      ...data,
      lastMessageAt: data.lastMessageAt || new Date(),
      createdAt: data.createdAt || new Date(),
    }).returning();
    return conv;
  }

  async updateConversation(id: string, data: Partial<InsertConversation>): Promise<Conversation | undefined> {
    const [conv] = await db.update(conversations).set(data).where(eq(conversations.id, id)).returning();
    return conv;
  }

  async deleteConversation(id: string): Promise<boolean> {
    // Get ai_suggestion IDs first to delete human_actions
    const suggestions = await db.select({ id: aiSuggestions.id })
      .from(aiSuggestions)
      .where(eq(aiSuggestions.conversationId, id));
    const suggestionIds = suggestions.map(s => s.id);

    if (suggestionIds.length > 0) {
      await db.delete(humanActions).where(inArray(humanActions.suggestionId, suggestionIds));
    }
    await db.delete(aiTrainingSamples).where(eq(aiTrainingSamples.conversationId, id));
    await db.delete(learningQueue).where(eq(learningQueue.conversationId, id));
    await db.delete(csatRatings).where(eq(csatRatings.conversationId, id));
    await db.delete(conversions).where(eq(conversions.conversationId, id));
    await db.delete(lostDeals).where(eq(lostDeals.conversationId, id));
    await db.delete(vehicleLookupCases).where(eq(vehicleLookupCases.conversationId, id));
    await db.delete(escalationEvents).where(eq(escalationEvents.conversationId, id));
    await db.delete(aiSuggestions).where(eq(aiSuggestions.conversationId, id));
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
    return true;
  }

  async getMessage(id: string): Promise<Message | undefined> {
    const [msg] = await db.select().from(messages).where(eq(messages.id, id));
    return msg;
  }

  async getMessagesByConversation(conversationId: string): Promise<Message[]> {
    return db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }

  async getMessagesByConversationPaginated(
    conversationId: string,
    cursor?: string,
    limit = 50,
  ): Promise<{ messages: Message[]; nextCursor: string | null }> {
    const safeLimit = Math.min(Math.max(1, limit), 200);

    let whereClause;
    if (cursor) {
      const [cursorMsg] = await db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.id, cursor));

      if (cursorMsg) {
        whereClause = and(
          eq(messages.conversationId, conversationId),
          gt(messages.createdAt, cursorMsg.createdAt),
        );
      } else {
        whereClause = eq(messages.conversationId, conversationId);
      }
    } else {
      whereClause = eq(messages.conversationId, conversationId);
    }

    const rows = await db
      .select()
      .from(messages)
      .where(whereClause)
      .orderBy(messages.createdAt, messages.id)
      .limit(safeLimit + 1);

    const hasMore = rows.length > safeLimit;
    const page = hasMore ? rows.slice(0, safeLimit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return { messages: page, nextCursor };
  }

  async createMessage(data: InsertMessage & { createdAt?: Date }): Promise<Message> {
    const messageTime = data.createdAt || new Date();
    const [msg] = await db.insert(messages).values({
      ...data,
      createdAt: messageTime,
    }).returning();
    
    // Update conversation's lastMessageAt
    await db.update(conversations)
      .set({ lastMessageAt: messageTime })
      .where(eq(conversations.id, data.conversationId));
    
    return msg;
  }

  async updateMessage(id: string, data: Partial<InsertMessage>): Promise<Message | undefined> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [msg] = await db.update(messages).set(data as any).where(eq(messages.id, id)).returning();
    return msg;
  }

  async getMessagesBySuggestionId(suggestionId: string): Promise<Message[]> {
    const suggestion = await this.getAiSuggestion(suggestionId);
    if (!suggestion) return [];
    return this.getMessagesByConversation(suggestion.conversationId);
  }

  async getProduct(id: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }

  async getProductsByTenant(tenantId: string): Promise<Product[]> {
    return db.select().from(products).where(eq(products.tenantId, tenantId));
  }

  async createProduct(data: InsertProduct): Promise<Product> {
    const [product] = await db.insert(products).values(data).returning();
    return product;
  }

  async updateProduct(id: string, data: Partial<InsertProduct>): Promise<Product | undefined> {
    const [product] = await db.update(products).set(data).where(eq(products.id, id)).returning();
    return product;
  }

  async deleteProduct(id: string): Promise<boolean> {
    const result = await db.delete(products).where(eq(products.id, id));
    return true;
  }

  async searchProducts(tenantId: string, query: string): Promise<Product[]> {
    const lowerQuery = `%${query.toLowerCase()}%`;
    return db.select().from(products).where(
      and(
        eq(products.tenantId, tenantId),
        or(
          ilike(products.name, lowerQuery),
          ilike(products.description, lowerQuery),
          ilike(products.category, lowerQuery)
        )
      )
    );
  }

  async getKnowledgeDoc(id: string): Promise<KnowledgeDoc | undefined> {
    const [doc] = await db.select().from(knowledgeDocs).where(eq(knowledgeDocs.id, id));
    return doc;
  }

  async getKnowledgeDocsByTenant(tenantId: string): Promise<KnowledgeDoc[]> {
    return db.select().from(knowledgeDocs).where(eq(knowledgeDocs.tenantId, tenantId));
  }

  async createKnowledgeDoc(data: InsertKnowledgeDoc): Promise<KnowledgeDoc> {
    const [doc] = await db.insert(knowledgeDocs).values(data).returning();
    return doc;
  }

  async updateKnowledgeDoc(id: string, data: Partial<InsertKnowledgeDoc>): Promise<KnowledgeDoc | undefined> {
    const [doc] = await db.update(knowledgeDocs).set(data).where(eq(knowledgeDocs.id, id)).returning();
    return doc;
  }

  async deleteKnowledgeDoc(id: string): Promise<boolean> {
    await db.delete(knowledgeDocs).where(eq(knowledgeDocs.id, id));
    return true;
  }

  async searchKnowledgeDocs(tenantId: string, query: string): Promise<KnowledgeDoc[]> {
    const lowerQuery = `%${query.toLowerCase()}%`;
    return db.select().from(knowledgeDocs).where(
      and(
        eq(knowledgeDocs.tenantId, tenantId),
        eq(knowledgeDocs.isActive, true),
        or(
          ilike(knowledgeDocs.title, lowerQuery),
          ilike(knowledgeDocs.content, lowerQuery)
        )
      )
    );
  }

  async getAiSuggestion(id: string): Promise<AiSuggestion | undefined> {
    const [suggestion] = await db.select().from(aiSuggestions).where(eq(aiSuggestions.id, id));
    return suggestion;
  }

  async getPendingSuggestionByConversation(conversationId: string): Promise<AiSuggestion | undefined> {
    const [suggestion] = await db.select().from(aiSuggestions).where(
      and(
        eq(aiSuggestions.conversationId, conversationId),
        eq(aiSuggestions.status, "pending")
      )
    ).orderBy(desc(aiSuggestions.createdAt)).limit(1);
    return suggestion;
  }

  async getSuggestionsByConversation(conversationId: string): Promise<AiSuggestion[]> {
    return db.select().from(aiSuggestions)
      .where(eq(aiSuggestions.conversationId, conversationId))
      .orderBy(desc(aiSuggestions.createdAt));
  }

  async getSuggestionsByTenant(tenantId: string): Promise<AiSuggestion[]> {
    return db.select({
      id: aiSuggestions.id,
      conversationId: aiSuggestions.conversationId,
      messageId: aiSuggestions.messageId,
      suggestedReply: aiSuggestions.suggestedReply,
      intent: aiSuggestions.intent,
      confidence: aiSuggestions.confidence,
      needsApproval: aiSuggestions.needsApproval,
      needsHandoff: aiSuggestions.needsHandoff,
      questionsToAsk: aiSuggestions.questionsToAsk,
      usedSources: aiSuggestions.usedSources,
      status: aiSuggestions.status,
      createdAt: aiSuggestions.createdAt,
      similarityScore: aiSuggestions.similarityScore,
      intentScore: aiSuggestions.intentScore,
      selfCheckScore: aiSuggestions.selfCheckScore,
      decision: aiSuggestions.decision,
      explanations: aiSuggestions.explanations,
      penalties: aiSuggestions.penalties,
      sourceConflicts: aiSuggestions.sourceConflicts,
      missingFields: aiSuggestions.missingFields,
      autosendEligible: aiSuggestions.autosendEligible,
      autosendBlockReason: aiSuggestions.autosendBlockReason,
      selfCheckNeedHandoff: aiSuggestions.selfCheckNeedHandoff,
      selfCheckReasons: aiSuggestions.selfCheckReasons,
      escalationData: aiSuggestions.escalationData,
    }).from(aiSuggestions)
      .innerJoin(conversations, eq(aiSuggestions.conversationId, conversations.id))
      .where(eq(conversations.tenantId, tenantId))
      .orderBy(desc(aiSuggestions.createdAt));
  }

  async createAiSuggestion(data: InsertAiSuggestion): Promise<AiSuggestion> {
    const [suggestion] = await db.insert(aiSuggestions).values(data).returning();
    return suggestion;
  }

  async updateAiSuggestion(id: string, data: Partial<InsertAiSuggestion>): Promise<AiSuggestion | undefined> {
    const [suggestion] = await db.update(aiSuggestions).set(data).where(eq(aiSuggestions.id, id)).returning();
    return suggestion;
  }

  async createHumanAction(data: InsertHumanAction): Promise<HumanAction> {
    const [action] = await db.insert(humanActions).values(data).returning();
    return action;
  }

  async createAiTrainingSample(data: InsertAiTrainingSample): Promise<AiTrainingSample> {
    const [sample] = await db.insert(aiTrainingSamples).values(data).returning();
    return sample;
  }

  async getAiTrainingSamplesByTenant(tenantId: string, outcome?: string): Promise<AiTrainingSample[]> {
    if (outcome) {
      return db.select().from(aiTrainingSamples)
        .where(and(
          eq(aiTrainingSamples.tenantId, tenantId),
          eq(aiTrainingSamples.outcome, outcome)
        ))
        .orderBy(desc(aiTrainingSamples.createdAt))
        .limit(200);
    }
    return db.select().from(aiTrainingSamples)
      .where(eq(aiTrainingSamples.tenantId, tenantId))
      .orderBy(desc(aiTrainingSamples.createdAt))
      .limit(200);
  }

  async getAiTrainingSamplesCount(tenantId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(aiTrainingSamples)
      .where(eq(aiTrainingSamples.tenantId, tenantId));
    return Number(result[0]?.count || 0);
  }

  async getAiTrainingPolicy(tenantId: string): Promise<AiTrainingPolicy | undefined> {
    const [policy] = await db.select().from(aiTrainingPolicies).where(eq(aiTrainingPolicies.tenantId, tenantId));
    return policy;
  }

  async upsertAiTrainingPolicy(data: InsertAiTrainingPolicy): Promise<AiTrainingPolicy> {
    const [policy] = await db.insert(aiTrainingPolicies)
      .values({
        ...data,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: aiTrainingPolicies.tenantId,
        set: {
          alwaysEscalateIntents: data.alwaysEscalateIntents,
          forbiddenTopics: data.forbiddenTopics,
          disabledLearningIntents: data.disabledLearningIntents,
          updatedAt: new Date(),
        },
      })
      .returning();
    return policy;
  }

  async createLearningQueueItem(data: InsertLearningQueueItem): Promise<LearningQueueItem> {
    const [item] = await db.insert(learningQueue).values(data).returning();
    return item;
  }

  async getLearningQueueByTenant(tenantId: string, minScore?: number): Promise<LearningQueueItem[]> {
    if (minScore !== undefined) {
      return db.select().from(learningQueue)
        .where(and(
          eq(learningQueue.tenantId, tenantId),
          eq(learningQueue.status, "pending"),
          sql`${learningQueue.learningScore} >= ${minScore}`
        ))
        .orderBy(desc(learningQueue.learningScore));
    }
    return db.select().from(learningQueue)
      .where(and(
        eq(learningQueue.tenantId, tenantId),
        eq(learningQueue.status, "pending")
      ))
      .orderBy(desc(learningQueue.learningScore));
  }

  async getLearningQueueItem(conversationId: string): Promise<LearningQueueItem | undefined> {
    const [item] = await db.select().from(learningQueue)
      .where(eq(learningQueue.conversationId, conversationId));
    return item;
  }

  async updateLearningQueueItem(id: string, data: Partial<InsertLearningQueueItem>): Promise<LearningQueueItem | undefined> {
    const updateData: Record<string, unknown> = { ...data };
    if (data.status === "reviewed") {
      updateData.reviewedAt = new Date();
    }
    const [item] = await db.update(learningQueue).set(updateData).where(eq(learningQueue.id, id)).returning();
    return item;
  }

  async upsertLearningQueueItem(data: InsertLearningQueueItem): Promise<LearningQueueItem> {
    const existing = await this.getLearningQueueItem(data.conversationId);
    if (existing) {
      const newScore = Math.max(existing.learningScore, data.learningScore ?? 0);
      const newReasons = [...new Set([...(existing.reasons ?? []), ...(data.reasons ?? [])])];
      const updated = await this.updateLearningQueueItem(existing.id, {
        learningScore: newScore,
        reasons: newReasons,
      });
      return updated!;
    }
    return this.createLearningQueueItem(data);
  }

  async getEscalationEvent(id: string): Promise<EscalationEvent | undefined> {
    const [event] = await db.select().from(escalationEvents).where(eq(escalationEvents.id, id));
    return event;
  }

  async getEscalationsByTenant(tenantId: string): Promise<EscalationEvent[]> {
    return db
      .select()
      .from(escalationEvents)
      .where(
        inArray(
          escalationEvents.conversationId,
          db.select({ id: conversations.id })
            .from(conversations)
            .where(eq(conversations.tenantId, tenantId))
        )
      )
      .orderBy(desc(escalationEvents.createdAt));
  }

  async getRecentEscalations(tenantId: string, limit: number): Promise<EscalationEvent[]> {
    const all = await this.getEscalationsByTenant(tenantId);
    return all.slice(0, limit);
  }

  async createEscalationEvent(data: InsertEscalationEvent): Promise<EscalationEvent> {
    const [event] = await db.insert(escalationEvents).values(data).returning();
    return event;
  }

  async updateEscalationEvent(id: string, data: Partial<InsertEscalationEvent>): Promise<EscalationEvent | undefined> {
    const [event] = await db.update(escalationEvents).set(data).where(eq(escalationEvents.id, id)).returning();
    return event;
  }

  async getTemplatesByTenant(tenantId: string): Promise<ResponseTemplate[]> {
    return db.select().from(responseTemplates).where(eq(responseTemplates.tenantId, tenantId));
  }

  async createTemplate(data: InsertResponseTemplate): Promise<ResponseTemplate> {
    const [template] = await db.insert(responseTemplates).values(data).returning();
    return template;
  }

  async getDashboardMetrics(tenantId: string): Promise<DashboardMetrics> {
    const [convCounts, pendingResult, productsResult, docsResult] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${conversations.status} = 'active')::int`,
          escalated: sql<number>`count(*) filter (where ${conversations.status} = 'escalated')::int`,
        })
        .from(conversations)
        .where(eq(conversations.tenantId, tenantId)),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(aiSuggestions)
        .innerJoin(conversations, eq(aiSuggestions.conversationId, conversations.id))
        .where(and(
          eq(conversations.tenantId, tenantId),
          eq(aiSuggestions.status, "pending")
        )),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(eq(products.tenantId, tenantId)),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(knowledgeDocs)
        .where(eq(knowledgeDocs.tenantId, tenantId)),
    ]);

    const conv = convCounts[0];
    return {
      totalConversations: conv?.total ?? 0,
      activeConversations: conv?.active ?? 0,
      escalatedConversations: conv?.escalated ?? 0,
      resolvedToday: 0,
      avgResponseTime: 12,
      aiAccuracy: 0,
      pendingSuggestions: pendingResult[0]?.count ?? 0,
      productsCount: productsResult[0]?.count ?? 0,
      knowledgeDocsCount: docsResult[0]?.count ?? 0,
    };
  }

  async getDecisionSettings(tenantId: string): Promise<DecisionSettings | undefined> {
    const [settings] = await db.select().from(decisionSettings).where(eq(decisionSettings.tenantId, tenantId));
    return settings;
  }

  async upsertDecisionSettings(data: InsertDecisionSettings): Promise<DecisionSettings> {
    const existing = await this.getDecisionSettings(data.tenantId);
    if (existing) {
      const [updated] = await db.update(decisionSettings)
        .set(data)
        .where(eq(decisionSettings.tenantId, data.tenantId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(decisionSettings).values(data).returning();
      return created;
    }
  }

  async getHumanDelaySettings(tenantId: string): Promise<HumanDelaySettings | undefined> {
    const [settings] = await db.select().from(humanDelaySettings).where(eq(humanDelaySettings.tenantId, tenantId));
    if (settings) return settings;
    
    return {
      tenantId,
      enabled: false,
      delayProfiles: DEFAULT_DELAY_PROFILES,
      nightMode: "DELAY",
      nightDelayMultiplier: 3.0,
      nightAutoReplyText: "Спасибо за сообщение! Мы ответим в рабочее время.",
      minDelayMs: 3000,
      maxDelayMs: 120000,
      typingIndicatorEnabled: true,
      updatedAt: new Date(),
    };
  }

  async upsertHumanDelaySettings(data: InsertHumanDelaySettings): Promise<HumanDelaySettings> {
    const existing = await db.select().from(humanDelaySettings).where(eq(humanDelaySettings.tenantId, data.tenantId));
    if (existing.length > 0) {
      const [updated] = await db.update(humanDelaySettings)
        .set(data)
        .where(eq(humanDelaySettings.tenantId, data.tenantId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(humanDelaySettings).values(data).returning();
      return created;
    }
  }

  async getOnboardingState(tenantId: string): Promise<OnboardingState | undefined> {
    const [state] = await db.select().from(onboardingState).where(eq(onboardingState.tenantId, tenantId));
    return state;
  }

  async upsertOnboardingState(data: InsertOnboardingState): Promise<OnboardingState> {
    const existing = await this.getOnboardingState(data.tenantId);
    if (existing) {
      const [updated] = await db.update(onboardingState)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(onboardingState.tenantId, data.tenantId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(onboardingState).values(data).returning();
      return created;
    }
  }

  async createReadinessReport(data: InsertReadinessReport): Promise<ReadinessReport> {
    const [report] = await db.insert(readinessReports).values(data).returning();
    return report;
  }

  async getLatestReadinessReport(tenantId: string): Promise<ReadinessReport | undefined> {
    const [report] = await db.select()
      .from(readinessReports)
      .where(eq(readinessReports.tenantId, tenantId))
      .orderBy(desc(readinessReports.createdAt))
      .limit(1);
    return report;
  }

  // Phase 8: CSAT Ratings
  async createCsatRating(data: InsertCsatRating): Promise<CsatRating> {
    const [rating] = await db.insert(csatRatings).values(data).returning();
    return rating;
  }

  async getCsatRatingByConversation(conversationId: string): Promise<CsatRating | undefined> {
    const [rating] = await db.select()
      .from(csatRatings)
      .where(eq(csatRatings.conversationId, conversationId));
    return rating;
  }

  async getCsatRatingsByTenant(tenantId: string): Promise<CsatRating[]> {
    return db.select()
      .from(csatRatings)
      .where(eq(csatRatings.tenantId, tenantId))
      .orderBy(desc(csatRatings.createdAt));
  }

  // Conversion methods
  async createConversion(data: InsertConversion): Promise<Conversion> {
    const [conversion] = await db.insert(conversions).values({
      ...data,
      currency: data.currency ?? "RUB",
    }).returning();
    return conversion;
  }

  async getConversionByConversation(conversationId: string): Promise<Conversion | undefined> {
    const [conversion] = await db.select()
      .from(conversions)
      .where(eq(conversions.conversationId, conversationId));
    return conversion;
  }

  async getConversionsByTenant(tenantId: string): Promise<Conversion[]> {
    return db.select()
      .from(conversions)
      .where(eq(conversions.tenantId, tenantId))
      .orderBy(desc(conversions.createdAt));
  }

  // Lost Deals methods
  async createLostDeal(data: InsertLostDeal): Promise<LostDeal> {
    const [lostDeal] = await db.insert(lostDeals).values(data).returning();
    return lostDeal;
  }

  async getLostDealByConversation(conversationId: string): Promise<LostDeal | undefined> {
    const [lostDeal] = await db.select()
      .from(lostDeals)
      .where(eq(lostDeals.conversationId, conversationId));
    return lostDeal;
  }

  async getLostDealsByTenant(tenantId: string): Promise<LostDeal[]> {
    return db.select()
      .from(lostDeals)
      .where(eq(lostDeals.tenantId, tenantId))
      .orderBy(desc(lostDeals.createdAt));
  }

  async ensureDefaultTenant(): Promise<Tenant> {
    let tenant = await this.getDefaultTenant();
    if (!tenant) {
      tenant = await this.createTenant({
        name: "Demo Store",
        language: "ru",
        tone: "formal",
        addressStyle: "vy",
        currency: "RUB",
        timezone: "Europe/Moscow",
        workingHoursStart: "09:00",
        workingHoursEnd: "18:00",
        workingDays: ["mon", "tue", "wed", "thu", "fri"],
        autoReplyOutsideHours: true,
        escalationEmail: "owner@example.com",
        allowDiscounts: true,
        maxDiscountPercent: 10,
      });
    }
    return tenant;
  }

  // Metrics methods
  async getCustomersCount(tenantId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(customers)
      .where(eq(customers.tenantId, tenantId));
    return result[0]?.count ?? 0;
  }

  async getCustomerNotesCount(tenantId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(customerNotes)
      .innerJoin(customers, eq(customerNotes.customerId, customers.id))
      .where(eq(customers.tenantId, tenantId));
    return result[0]?.count ?? 0;
  }

  async getCustomerMemoryCount(tenantId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(customerMemory)
      .where(eq(customerMemory.tenantId, tenantId));
    return result[0]?.count ?? 0;
  }

  async createRagDocument(doc: InsertRagDocument): Promise<RagDocument> {
    const [created] = await db.insert(ragDocuments).values(doc).returning();
    return created;
  }

  async createRagChunk(chunk: InsertRagChunk): Promise<RagChunk> {
    const [created] = await db.insert(ragChunks).values(chunk).returning();
    return created;
  }

  async deleteRagBySource(tenantId: string, sourceType: "PRODUCT" | "DOC", sourceId: string): Promise<{ deletedDocs: number }> {
    const deleted = await db.delete(ragDocuments)
      .where(and(
        eq(ragDocuments.tenantId, tenantId),
        eq(ragDocuments.type, sourceType),
        eq(ragDocuments.sourceId, sourceId)
      ))
      .returning({ id: ragDocuments.id });
    return { deletedDocs: deleted.length };
  }

  async updateRagChunkEmbedding(chunkId: string, embedding: number[]): Promise<boolean> {
    const embeddingJson = JSON.stringify(embedding);
    const result = await db.update(ragChunks)
      .set({ embedding: embeddingJson, updatedAt: new Date() })
      .where(eq(ragChunks.id, chunkId))
      .returning({ id: ragChunks.id });
    return result.length > 0;
  }

  async getRagChunksBySource(tenantId: string, sourceType: "PRODUCT" | "DOC", sourceId: string): Promise<{ id: string; chunkText: string; embedding: number[] | null }[]> {
    const docs = await db.select({ id: ragDocuments.id })
      .from(ragDocuments)
      .where(and(
        eq(ragDocuments.tenantId, tenantId),
        eq(ragDocuments.type, sourceType),
        eq(ragDocuments.sourceId, sourceId)
      ));
    
    if (docs.length === 0) return [];
    
    const docIds = docs.map(d => d.id);
    const rows = await db.select({
      id: ragChunks.id,
      chunkText: ragChunks.chunkText,
      embedding: ragChunks.embedding,
    })
      .from(ragChunks)
      .where(inArray(ragChunks.ragDocumentId, docIds));
    
    return rows.map(row => ({
      id: row.id,
      chunkText: row.chunkText,
      embedding: row.embedding ? JSON.parse(row.embedding) as number[] : null,
    }));
  }

  async getRagChunksWithoutEmbedding(tenantId: string, limit = 100): Promise<{ id: string; chunkText: string }[]> {
    const docs = await db.select({ id: ragDocuments.id })
      .from(ragDocuments)
      .where(eq(ragDocuments.tenantId, tenantId));
    
    if (docs.length === 0) return [];
    
    const docIds = docs.map(d => d.id);
    const chunks = await db.select({
      id: ragChunks.id,
      chunkText: ragChunks.chunkText,
    })
      .from(ragChunks)
      .where(and(
        inArray(ragChunks.ragDocumentId, docIds),
        sql`${ragChunks.embedding} IS NULL`
      ))
      .limit(limit);
    
    return chunks;
  }

  async getRagChunksWithStaleHash(tenantId: string, limit = 100): Promise<{ id: string; chunkText: string; storedHash: string | null; currentHash: string }[]> {
    const { computeContentHash } = await import("./services/rag-indexer");
    
    const docs = await db.select({ id: ragDocuments.id })
      .from(ragDocuments)
      .where(eq(ragDocuments.tenantId, tenantId));
    
    if (docs.length === 0) return [];
    
    const docIds = docs.map(d => d.id);
    const chunks = await db.select({
      id: ragChunks.id,
      chunkText: ragChunks.chunkText,
      metadata: ragChunks.metadata,
      embedding: ragChunks.embedding,
    })
      .from(ragChunks)
      .where(and(
        inArray(ragChunks.ragDocumentId, docIds),
        sql`${ragChunks.embedding} IS NOT NULL`
      ))
      .limit(limit * 10);
    
    const staleChunks: { id: string; chunkText: string; storedHash: string | null; currentHash: string }[] = [];
    
    for (const chunk of chunks) {
      const storedHash = (chunk.metadata as Record<string, unknown>)?.contentHash as string | null;
      const currentHash = computeContentHash(chunk.chunkText);
      
      if (storedHash !== currentHash) {
        staleChunks.push({
          id: chunk.id,
          chunkText: chunk.chunkText,
          storedHash,
          currentHash,
        });
        if (staleChunks.length >= limit) break;
      }
    }
    
    return staleChunks;
  }

  async invalidateStaleEmbeddings(tenantId: string): Promise<{ invalidated: number }> {
    const staleChunks = await this.getRagChunksWithStaleHash(tenantId, 1000);
    
    if (staleChunks.length === 0) return { invalidated: 0 };
    
    const staleIds = staleChunks.map(c => c.id);
    await db.update(ragChunks)
      .set({ embedding: null, updatedAt: new Date() })
      .where(inArray(ragChunks.id, staleIds));
    
    return { invalidated: staleChunks.length };
  }

  async getAllRagChunksWithEmbedding(tenantId: string): Promise<{ id: string; chunkText: string; chunkIndex: number; embedding: string | null; metadata: unknown }[]> {
    const docs = await db.select({ id: ragDocuments.id })
      .from(ragDocuments)
      .where(eq(ragDocuments.tenantId, tenantId));
    
    if (docs.length === 0) return [];
    
    const docIds = docs.map(d => d.id);
    const chunks = await db.select({
      id: ragChunks.id,
      chunkText: ragChunks.chunkText,
      chunkIndex: ragChunks.chunkIndex,
      embedding: ragChunks.embedding,
      metadata: ragChunks.metadata,
    })
      .from(ragChunks)
      .where(and(
        inArray(ragChunks.ragDocumentId, docIds),
        sql`${ragChunks.embedding} IS NOT NULL`
      ));
    
    return chunks;
  }

  // Update History methods
  async getUpdateHistory(): Promise<UpdateHistory[]> {
    return db.select().from(updateHistory).orderBy(desc(updateHistory.createdAt));
  }

  async getUpdateById(id: string): Promise<UpdateHistory | undefined> {
    const [update] = await db.select().from(updateHistory).where(eq(updateHistory.id, id));
    return update;
  }

  async createUpdate(update: InsertUpdateHistory): Promise<UpdateHistory> {
    const [created] = await db.insert(updateHistory).values(update).returning();
    return created;
  }

  async updateUpdateStatus(id: string, status: UpdateStatus, errorMessage?: string): Promise<UpdateHistory | undefined> {
    const updateData: Partial<UpdateHistory> = { status };
    if (status === "applied") {
      updateData.appliedAt = new Date();
    }
    if (errorMessage) {
      updateData.errorMessage = errorMessage;
    }
    const [updated] = await db.update(updateHistory)
      .set(updateData)
      .where(eq(updateHistory.id, id))
      .returning();
    return updated;
  }

  async setUpdateBackupPath(id: string, backupPath: string): Promise<UpdateHistory | undefined> {
    const [updated] = await db.update(updateHistory)
      .set({ backupPath })
      .where(eq(updateHistory.id, id))
      .returning();
    return updated;
  }

  async getCurrentVersion(): Promise<string> {
    const [lastApplied] = await db.select()
      .from(updateHistory)
      .where(eq(updateHistory.status, "applied"))
      .orderBy(desc(updateHistory.appliedAt))
      .limit(1);
    return lastApplied?.version || "1.0.0";
  }

  // Vehicle Lookup Cache
  async getVehicleLookupCacheByKey(lookupKey: string): Promise<VehicleLookupCache | undefined> {
    const [row] = await db.select().from(vehicleLookupCache).where(eq(vehicleLookupCache.lookupKey, lookupKey));
    return row;
  }

  async upsertVehicleLookupCache(data: InsertVehicleLookupCache): Promise<VehicleLookupCache> {
    const [row] = await db.insert(vehicleLookupCache)
      .values(data)
      .onConflictDoUpdate({
        target: vehicleLookupCache.lookupKey,
        set: {
          idType: data.idType,
          rawValue: data.rawValue,
          normalizedValue: data.normalizedValue,
          result: data.result,
          source: data.source,
          updatedAt: new Date(),
          expiresAt: data.expiresAt ?? null,
        },
      })
      .returning();
    return row;
  }

  async linkCaseToCache(caseId: string, cacheId: string): Promise<void> {
    await db.update(vehicleLookupCases)
      .set({ cacheId, updatedAt: new Date() })
      .where(eq(vehicleLookupCases.id, caseId));
  }

  // Vehicle Lookup Cases
  async createVehicleLookupCase(data: InsertVehicleLookupCase): Promise<VehicleLookupCase> {
    const [row] = await db.insert(vehicleLookupCases).values(data).returning();
    return row;
  }

  async getVehicleLookupCaseById(caseId: string): Promise<VehicleLookupCase | undefined> {
    const [row] = await db.select().from(vehicleLookupCases).where(eq(vehicleLookupCases.id, caseId));
    return row;
  }

  async getLatestVehicleLookupCaseByConversation(tenantId: string, conversationId: string): Promise<VehicleLookupCase | undefined> {
    const [row] = await db.select()
      .from(vehicleLookupCases)
      .where(and(
        eq(vehicleLookupCases.tenantId, tenantId),
        eq(vehicleLookupCases.conversationId, conversationId)
      ))
      .orderBy(desc(vehicleLookupCases.createdAt))
      .limit(1);
    return row;
  }

  async findActiveVehicleLookupCase(tenantId: string, conversationId: string, normalizedValue: string): Promise<VehicleLookupCase | undefined> {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
    const [row] = await db.select()
      .from(vehicleLookupCases)
      .where(and(
        eq(vehicleLookupCases.tenantId, tenantId),
        eq(vehicleLookupCases.conversationId, conversationId),
        eq(vehicleLookupCases.normalizedValue, normalizedValue),
        inArray(vehicleLookupCases.status, ["PENDING", "RUNNING"]),
        gte(vehicleLookupCases.createdAt, cutoff)
      ))
      .orderBy(desc(vehicleLookupCases.createdAt))
      .limit(1);
    return row;
  }

  async updateVehicleLookupCaseStatus(
    caseId: string,
    patch: { status?: VehicleLookupCase["status"]; verificationStatus?: VehicleLookupCase["verificationStatus"]; error?: string | null; cacheId?: string | null }
  ): Promise<VehicleLookupCase | undefined> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.verificationStatus !== undefined) set.verificationStatus = patch.verificationStatus;
    if (patch.error !== undefined) set.error = patch.error;
    if (patch.cacheId !== undefined) set.cacheId = patch.cacheId;
    const [row] = await db.update(vehicleLookupCases)
      .set(set as Partial<VehicleLookupCase>)
      .where(eq(vehicleLookupCases.id, caseId))
      .returning();
    return row;
  }

  // Price Snapshots

  async createPriceSnapshot(data: InsertPriceSnapshot): Promise<PriceSnapshot> {
    const values = {
      ...data,
      searchKey: data.searchKey ?? data.oem,
    };
    const [row] = await db.insert(priceSnapshots).values(values).returning();
    return row;
  }

  async getGlobalPriceSnapshot(cacheKey: string): Promise<PriceSnapshot | null> {
    const now = new Date();
    const validityFilter = or(
      sql`(${priceSnapshots.expiresAt} IS NOT NULL AND ${priceSnapshots.expiresAt} > ${now})`,
      and(
        sql`${priceSnapshots.expiresAt} IS NULL`,
        gte(priceSnapshots.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      )
    );

    // First: exact match by search_key (new composite key format oem::make::model)
    const [bySearchKey] = await db.select()
      .from(priceSnapshots)
      .where(and(eq(priceSnapshots.searchKey, cacheKey), validityFilter!))
      .orderBy(desc(priceSnapshots.createdAt))
      .limit(1);
    if (bySearchKey) return bySearchKey;

    // Fallback: match by oem column for entries saved before composite keys were introduced
    const oemPart = cacheKey.split("::")[0].toUpperCase();
    const [byOem] = await db.select()
      .from(priceSnapshots)
      .where(and(eq(priceSnapshots.oem, oemPart), validityFilter!))
      .orderBy(desc(priceSnapshots.createdAt))
      .limit(1);
    return byOem ?? null;
  }

  async getLatestPriceSnapshot(oem: string, maxAgeDays = 7): Promise<PriceSnapshot | undefined> {
    const now = new Date();
    // Prefer snapshots that have expiresAt set and not yet expired
    // Fall back to createdAt-based cutoff for legacy rows
    const [row] = await db.select()
      .from(priceSnapshots)
      .where(and(
        eq(priceSnapshots.oem, oem),
        or(
          // New-style: has expiresAt and it's in the future
          sql`(${priceSnapshots.expiresAt} IS NOT NULL AND ${priceSnapshots.expiresAt} > ${now})`,
          // Legacy-style: no expiresAt, use createdAt-based cutoff
          and(
            sql`${priceSnapshots.expiresAt} IS NULL`,
            gte(priceSnapshots.createdAt, new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000))
          )
        )
      ))
      .orderBy(desc(priceSnapshots.createdAt))
      .limit(1);
    return row;
  }

  async getPriceSnapshotsByOem(tenantId: string, oem: string, limit = 50): Promise<PriceSnapshot[]> {
    return db.select()
      .from(priceSnapshots)
      .where(and(
        eq(priceSnapshots.tenantId, tenantId),
        eq(priceSnapshots.oem, oem)
      ))
      .orderBy(desc(priceSnapshots.createdAt))
      .limit(limit);
  }

  // Internal Prices

  async upsertInternalPrice(data: InsertInternalPrice): Promise<InternalPrice> {
    const [row] = await db.insert(internalPrices)
      .values(data)
      .onConflictDoUpdate({
        target: [internalPrices.tenantId, internalPrices.oem, internalPrices.condition, internalPrices.supplier],
        set: { price: data.price, currency: data.currency ?? "RUB", updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async getInternalPricesByOem(tenantId: string, oem: string): Promise<InternalPrice[]> {
    return db.select()
      .from(internalPrices)
      .where(and(
        eq(internalPrices.tenantId, tenantId),
        eq(internalPrices.oem, oem)
      ));
  }

  // Telegram Accounts (multi-account sessions)

  private decryptTelegramSessionRow<T extends { sessionString: string | null }>(row: T): T {
    const plain = decryptSessionString(row.sessionString ?? null);
    return { ...row, sessionString: plain };
  }

  async getTelegramAccountsByTenant(tenantId: string): Promise<TelegramSession[]> {
    const rows = await db.select().from(telegramSessions)
      .where(eq(telegramSessions.tenantId, tenantId))
      .orderBy(desc(telegramSessions.createdAt));
    return rows.map((row) => this.decryptTelegramSessionRow(row));
  }

  async getTelegramAccountById(id: string): Promise<TelegramSession | undefined> {
    const [row] = await db.select().from(telegramSessions).where(eq(telegramSessions.id, id));
    return row ? this.decryptTelegramSessionRow(row) : undefined;
  }

  async getActiveTelegramAccounts(): Promise<TelegramSession[]> {
    const rows = await db.select().from(telegramSessions)
      .where(and(
        eq(telegramSessions.status, "active"),
        eq(telegramSessions.isEnabled, true),
      ));
    return rows.map((row) => this.decryptTelegramSessionRow(row));
  }

  async createTelegramAccount(data: InsertTelegramSession): Promise<TelegramSession> {
    const payload = { ...data };
    if (payload.sessionString != null && payload.sessionString !== "") {
      payload.sessionString = encryptSessionString(payload.sessionString);
    }
    const [row] = await db.insert(telegramSessions).values(payload).returning();
    return row ? this.decryptTelegramSessionRow(row) : (row as TelegramSession);
  }

  async updateTelegramAccount(id: string, data: Partial<InsertTelegramSession>): Promise<TelegramSession | undefined> {
    const payload = { ...data };
    if (payload.sessionString !== undefined) {
      payload.sessionString = payload.sessionString == null || payload.sessionString === ""
        ? payload.sessionString
        : encryptSessionString(payload.sessionString);
    }
    const [row] = await db.update(telegramSessions)
      .set({ ...payload, updatedAt: new Date() })
      .where(eq(telegramSessions.id, id))
      .returning();
    return row ? this.decryptTelegramSessionRow(row) : undefined;
  }

  async deleteTelegramAccount(id: string): Promise<boolean> {
    const result = await db.delete(telegramSessions).where(eq(telegramSessions.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // ─── Message Templates ───────────────────────────────────────────────────

  async getMessageTemplatesByTenant(tenantId: string): Promise<MessageTemplate[]> {
    return db.select()
      .from(messageTemplates)
      .where(eq(messageTemplates.tenantId, tenantId))
      .orderBy(messageTemplates.order, messageTemplates.createdAt);
  }

  async getActiveMessageTemplateByType(tenantId: string, type: string): Promise<MessageTemplate | undefined> {
    const [row] = await db.select()
      .from(messageTemplates)
      .where(and(
        eq(messageTemplates.tenantId, tenantId),
        eq(messageTemplates.type, type),
        eq(messageTemplates.isActive, true),
      ))
      .orderBy(messageTemplates.order)
      .limit(1);
    return row;
  }

  async getMessageTemplate(id: string): Promise<MessageTemplate | undefined> {
    const [row] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, id));
    return row;
  }

  async createMessageTemplate(data: InsertMessageTemplate): Promise<MessageTemplate> {
    const [row] = await db.insert(messageTemplates).values(data).returning();
    return row;
  }

  async updateMessageTemplate(id: string, data: Partial<InsertMessageTemplate>): Promise<MessageTemplate | undefined> {
    const [row] = await db.update(messageTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(messageTemplates.id, id))
      .returning();
    return row;
  }

  async deleteMessageTemplate(id: string): Promise<boolean> {
    const result = await db.delete(messageTemplates).where(eq(messageTemplates.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async seedDefaultTemplates(tenantId: string): Promise<void> {
    const { DEFAULT_TEMPLATES } = await import("./services/template-renderer");
    for (const tpl of DEFAULT_TEMPLATES) {
      await db.insert(messageTemplates)
        .values({ tenantId, ...tpl })
        .onConflictDoNothing();
    }
  }

  // ─── Payment Methods ─────────────────────────────────────────────────────

  async getPaymentMethodsByTenant(tenantId: string): Promise<PaymentMethod[]> {
    return db.select()
      .from(paymentMethods)
      .where(eq(paymentMethods.tenantId, tenantId))
      .orderBy(paymentMethods.order, paymentMethods.createdAt);
  }

  async getActivePaymentMethods(tenantId: string): Promise<PaymentMethod[]> {
    return db.select()
      .from(paymentMethods)
      .where(and(
        eq(paymentMethods.tenantId, tenantId),
        eq(paymentMethods.isActive, true),
      ))
      .orderBy(paymentMethods.order, paymentMethods.createdAt);
  }

  async getPaymentMethod(id: string): Promise<PaymentMethod | undefined> {
    const [row] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, id));
    return row;
  }

  async createPaymentMethod(data: InsertPaymentMethod): Promise<PaymentMethod> {
    const [row] = await db.insert(paymentMethods).values(data).returning();
    return row;
  }

  async updatePaymentMethod(id: string, data: Partial<InsertPaymentMethod>): Promise<PaymentMethod | undefined> {
    const [row] = await db.update(paymentMethods)
      .set(data)
      .where(eq(paymentMethods.id, id))
      .returning();
    return row;
  }

  async deletePaymentMethod(id: string): Promise<boolean> {
    const result = await db.delete(paymentMethods).where(eq(paymentMethods.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async reorderPaymentMethods(tenantId: string, updates: Array<{ id: string; order: number }>): Promise<void> {
    for (const { id, order } of updates) {
      await db.update(paymentMethods)
        .set({ order })
        .where(and(
          eq(paymentMethods.id, id),
          eq(paymentMethods.tenantId, tenantId),
        ));
    }
  }

  // ─── Tenant Agent Settings ────────────────────────────────────────────────

  async getTenantAgentSettings(tenantId: string): Promise<TenantAgentSettings | null> {
    const [row] = await db.select()
      .from(tenantAgentSettings)
      .where(eq(tenantAgentSettings.tenantId, tenantId));
    return row ?? null;
  }

  async upsertTenantAgentSettings(tenantId: string, data: Partial<InsertTenantAgentSettings>): Promise<TenantAgentSettings> {
    const [row] = await db.insert(tenantAgentSettings)
      .values({
        ...data,
        tenantId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tenantAgentSettings.tenantId,
        set: {
          companyName: data.companyName,
          specialization: data.specialization,
          warehouseCity: data.warehouseCity,
          warrantyMonths: data.warrantyMonths,
          warrantyKm: data.warrantyKm,
          installDays: data.installDays,
          qrDiscountPercent: data.qrDiscountPercent,
          systemPrompt: data.systemPrompt,
          objectionPayment: data.objectionPayment,
          objectionOnline: data.objectionOnline,
          closingScript: data.closingScript,
          customFacts: data.customFacts,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  // ─── Transmission Identity Cache ─────────────────────────────────────────────

  async getTransmissionIdentity(normalizedOem: string): Promise<TransmissionIdentityCache | undefined> {
    const [row] = await db
      .select()
      .from(transmissionIdentityCache)
      .where(eq(transmissionIdentityCache.normalizedOem, normalizedOem))
      .limit(1);
    return row;
  }

  async saveTransmissionIdentity(data: InsertTransmissionIdentityCache): Promise<TransmissionIdentityCache> {
    const [row] = await db
      .insert(transmissionIdentityCache)
      .values(data)
      .onConflictDoUpdate({
        target: transmissionIdentityCache.normalizedOem,
        set: {
          modelName: data.modelName,
          manufacturer: data.manufacturer,
          origin: data.origin,
          confidence: data.confidence,
          hitCount: sql`${transmissionIdentityCache.hitCount} + 1`,
          lastSeenAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning();
    return row;
  }

  async incrementTransmissionIdentityHit(normalizedOem: string): Promise<void> {
    await db
      .update(transmissionIdentityCache)
      .set({
        hitCount: sql`${transmissionIdentityCache.hitCount} + 1`,
        lastSeenAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(transmissionIdentityCache.normalizedOem, normalizedOem));
  }

  // ─── Price snapshot helpers for decision engine context injection ─────────────

  async getLatestVehicleLookupCase(conversationId: string): Promise<VehicleLookupCase | undefined> {
    const [row] = await db.select()
      .from(vehicleLookupCases)
      .where(eq(vehicleLookupCases.conversationId, conversationId))
      .orderBy(desc(vehicleLookupCases.createdAt))
      .limit(1);
    return row;
  }

  async getLatestPriceSnapshotForConversation(
    tenantId: string,
    conversationId: string
  ): Promise<PriceSnapshot | undefined> {
    try {
      // Step 1: get the latest COMPLETED case for this conversation
      const [completedCase] = await db.select()
        .from(vehicleLookupCases)
        .where(and(
          eq(vehicleLookupCases.conversationId, conversationId),
          eq(vehicleLookupCases.status, "COMPLETED")
        ))
        .orderBy(desc(vehicleLookupCases.createdAt))
        .limit(1);

      if (!completedCase?.normalizedValue) return undefined;

      const normalizedValue = completedCase.normalizedValue;

      // Step 2: find a price snapshot matching the OEM from the case
      const [snapshot] = await db.select()
        .from(priceSnapshots)
        .where(and(
          or(
            eq(priceSnapshots.oem, normalizedValue),
            sql`${priceSnapshots.searchKey} LIKE ${normalizedValue + "%"}`
          ),
          or(
            eq(priceSnapshots.tenantId, tenantId),
            sql`${priceSnapshots.tenantId} IS NULL`
          )
        ))
        .orderBy(desc(priceSnapshots.createdAt))
        .limit(1);

      return snapshot;
    } catch {
      return undefined;
    }
  }
}
