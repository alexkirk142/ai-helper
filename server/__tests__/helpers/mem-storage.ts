/**
 * In-memory IStorage implementation for unit and integration tests.
 * Moved here from server/storage.ts (DEBT-03) so it no longer pollutes
 * the production module graph.  Import this file only from test code.
 */
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
  type VehicleLookupCaseStatus, type VehicleLookupVerificationStatus,
  type PriceSnapshot, type InsertPriceSnapshot,
  type InternalPrice, type InsertInternalPrice,
  type TelegramSession, type InsertTelegramSession,
  type MessageTemplate, type InsertMessageTemplate,
  type PaymentMethod, type InsertPaymentMethod,
} from "@shared/schema";
import { randomUUID } from "crypto";
import type { IStorage } from "../../storage";

export class MemStorage implements IStorage {
  private tenants: Map<string, Tenant> = new Map();
  private channels: Map<string, Channel> = new Map();
  private users: Map<string, User> = new Map();
  private customers: Map<string, Customer> = new Map();
  private customerNotes: Map<string, CustomerNote> = new Map();
  private customerMemories: Map<string, CustomerMemory> = new Map(); // key: tenantId:customerId
  private conversations: Map<string, Conversation> = new Map();
  private messages: Map<string, Message> = new Map();
  private products: Map<string, Product> = new Map();
  private knowledgeDocs: Map<string, KnowledgeDoc> = new Map();
  private aiSuggestions: Map<string, AiSuggestion> = new Map();
  private humanActions: Map<string, HumanAction> = new Map();
  private aiTrainingSamples: Map<string, AiTrainingSample> = new Map();
  private aiTrainingPolicies: Map<string, AiTrainingPolicy> = new Map();
  private learningQueue: Map<string, LearningQueueItem> = new Map();
  private escalationEvents: Map<string, EscalationEvent> = new Map();
  private responseTemplates: Map<string, ResponseTemplate> = new Map();
  private decisionSettings: Map<string, DecisionSettings> = new Map();
  private humanDelaySettings: Map<string, HumanDelaySettings> = new Map();
  private onboardingStates: Map<string, OnboardingState> = new Map();
  private readinessReports: Map<string, ReadinessReport> = new Map();
  private ragDocuments: Map<string, RagDocument> = new Map();
  private ragChunks: Map<string, RagChunk> = new Map();
  private csatRatings: Map<string, CsatRating> = new Map();
  private conversions: Map<string, Conversion> = new Map();
  private lostDeals: Map<string, LostDeal> = new Map();
  private updateHistory: Map<string, UpdateHistory> = new Map();

  private defaultTenantId: string | null = null;

  constructor() {
    this.seedDemoData();
  }

  private seedDemoData() {
    // Create default tenant
    const tenant: Tenant = {
      id: randomUUID(),
      name: "Demo Store",
      status: "active",
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
      escalationTelegram: null,
      allowDiscounts: true,
      maxDiscountPercent: 10,
      templates: null,
      createdAt: new Date(),
    };
    this.tenants.set(tenant.id, tenant);
    this.defaultTenantId = tenant.id;

    // Create demo customers
    const now = new Date();
    const customer1: Customer = {
      id: randomUUID(),
      tenantId: tenant.id,
      channelId: null,
      channel: "telegram",
      externalId: "tg_12345",
      name: "Ivan Petrov",
      phone: "+7 999 123-45-67",
      email: null,
      tags: [],
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    this.customers.set(customer1.id, customer1);

    const customer2: Customer = {
      id: randomUUID(),
      tenantId: tenant.id,
      channelId: null,
      channel: "telegram",
      externalId: "tg_67890",
      name: "Anna Sidorova",
      phone: "+7 999 987-65-43",
      email: null,
      tags: [],
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    this.customers.set(customer2.id, customer2);

    // Create demo conversations
    const conv1: Conversation = {
      id: randomUUID(),
      tenantId: tenant.id,
      customerId: customer1.id,
      channelId: null,
      status: "active",
      mode: "learning",
      lastMessageAt: new Date(),
      unreadCount: 2,
      createdAt: new Date(Date.now() - 3600000),
    };
    this.conversations.set(conv1.id, conv1);

    const conv2: Conversation = {
      id: randomUUID(),
      tenantId: tenant.id,
      customerId: customer2.id,
      channelId: null,
      status: "escalated",
      mode: "semi-auto",
      lastMessageAt: new Date(Date.now() - 1800000),
      unreadCount: 1,
      createdAt: new Date(Date.now() - 7200000),
    };
    this.conversations.set(conv2.id, conv2);

    // Demo messages for conv1
    const msg1: Message = {
      id: randomUUID(),
      conversationId: conv1.id,
      role: "customer",
      content: "Zdravstvuyte! Skol'ko stoit iPhone 15 Pro?",
      attachments: [],
      metadata: {},
      createdAt: new Date(Date.now() - 300000),
    };
    this.messages.set(msg1.id, msg1);

    const msg2: Message = {
      id: randomUUID(),
      conversationId: conv1.id,
      role: "assistant",
      content: "Zdravstvuyte! iPhone 15 Pro stoit 129 990 rublej. V nalichii est' vse cveta. Chto-nibud' eshche?",
      attachments: [],
      metadata: {},
      createdAt: new Date(Date.now() - 240000),
    };
    this.messages.set(msg2.id, msg2);

    const msg3: Message = {
      id: randomUUID(),
      conversationId: conv1.id,
      role: "customer",
      content: "A skidku mozhno?",
      attachments: [],
      metadata: {},
      createdAt: new Date(Date.now() - 60000),
    };
    this.messages.set(msg3.id, msg3);

    // Demo suggestion for conv1 - discount intent forces escalation per Decision Engine rules
    const suggestion: AiSuggestion = {
      id: randomUUID(),
      conversationId: conv1.id,
      messageId: msg3.id,
      suggestedReply: "Da, pri zakaze segodnya ya mogu predlozhit' skidku 5%. Itogovaya cena sostavit 123 490 rublej. Oformlyaem?",
      intent: "discount",
      confidence: 0.65, // Lower due to force-handoff penalty
      needsApproval: true,
      needsHandoff: true, // Force handoff for discount intent
      questionsToAsk: [],
      usedSources: [{ type: "product", id: "iphone-15-pro", quote: "iPhone 15 Pro - 129 990 RUB", similarity: 0.92 }],
      status: "pending",
      createdAt: new Date(),
      // Phase 1: Decision Engine fields
      similarityScore: 0.92,
      intentScore: 0.88,
      selfCheckScore: 0.75,
      decision: "ESCALATE", // Forced escalation for discount intent
      explanations: ["Интент 'скидка' требует передачи оператору", "Запрос на скидку автоматически эскалируется"],
      penalties: [{ code: "INTENT_FORCE_HANDOFF", message: "Интент требует оператора", value: 0 }],
      sourceConflicts: false,
      missingFields: [],
      // Phase 1.1: Triple lock autosend fields
      autosendEligible: false,
      autosendBlockReason: null,
      // Phase 1.1: Self-check handoff info
      selfCheckNeedHandoff: false,
      selfCheckReasons: [],
      escalationData: null,
    };
    this.aiSuggestions.set(suggestion.id, suggestion);

    // Demo products
    const products = [
      { name: "iPhone 15 Pro", sku: "IPH15PRO", description: "Latest Apple flagship smartphone", price: 129990, category: "Smartphones", inStock: true, stockQuantity: 15 },
      { name: "Samsung Galaxy S24", sku: "SGS24", description: "Samsung flagship with AI features", price: 89990, category: "Smartphones", inStock: true, stockQuantity: 20 },
      { name: "MacBook Pro 14", sku: "MBP14", description: "M3 Pro chip, 18GB RAM", price: 199990, category: "Laptops", inStock: true, stockQuantity: 8 },
      { name: "AirPods Pro 2", sku: "APP2", description: "Wireless earbuds with ANC", price: 24990, category: "Accessories", inStock: true, stockQuantity: 50 },
      { name: "Apple Watch Series 9", sku: "AWS9", description: "Latest smartwatch from Apple", price: 44990, category: "Wearables", inStock: false, stockQuantity: 0 },
    ];
    products.forEach((p) => {
      const product: Product = {
        id: randomUUID(),
        tenantId: tenant.id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        price: p.price,
        currency: "RUB",
        category: p.category,
        inStock: p.inStock,
        stockQuantity: p.stockQuantity,
        variants: [],
        images: [],
        deliveryInfo: "Dostavka 1-3 dnya",
        createdAt: new Date(),
      };
      this.products.set(product.id, product);
    });

    // Demo knowledge docs
    const docs = [
      { title: "Politika vozvrata", category: "returns", content: "Vy mozhete vernut' tovar v techenie 14 dnej s momenta pokupki. Tovar dolzhen byt' v originalnoj upakovke i bez sledov ispol'zovaniya." },
      { title: "Usloviya dostavki", category: "shipping", content: "Besplatnaya dostavka pri zakaze ot 5000 rublej. Standarnaya dostavka 3-5 dnej, ekspress 1-2 dnya." },
      { title: "Garantiya", category: "policy", content: "Na vsyu elektroniku predostavlyaetsya garantiya 1 god. Rasshirennaya garantiya dostupna za dopolnitel'nuyu platu." },
      { title: "Sposoby oplaty", category: "faq", content: "Prinimaem oplatu kartoj, nalichnymi pri poluchenii, beznalichnyj raschet dlya yurlits." },
    ];
    docs.forEach((d) => {
      const doc: KnowledgeDoc = {
        id: randomUUID(),
        tenantId: tenant.id,
        title: d.title,
        content: d.content,
        category: d.category,
        docType: null,
        tags: [],
        isActive: true,
        createdAt: new Date(),
      };
      this.knowledgeDocs.set(doc.id, doc);
    });

    // Demo escalation
    const escalation: EscalationEvent = {
      id: randomUUID(),
      conversationId: conv2.id,
      reason: "complaint",
      summary: "Klient zhaluetsya na zaderzhku dostavki",
      suggestedResponse: "Prinosim izvineniya za zaderzhku. Pozhalujsta, ukashite nomer zakaza, i my razberemsia.",
      clarificationNeeded: "Nuzhen nomer zakaza",
      status: "pending",
      handledBy: null,
      handledAt: null,
      createdAt: new Date(Date.now() - 1800000),
    };
    this.escalationEvents.set(escalation.id, escalation);
  }

  // Tenant methods
  async getTenant(id: string): Promise<Tenant | undefined> {
    return this.tenants.get(id);
  }

  async getTenantTemplates(tenantId: string): Promise<{ gearboxLookupFound: string; gearboxLookupModelOnly: string; gearboxTagRequest: string; gearboxLookupFallback: string; gearboxNoVin: string }> {
    const { getMergedGearboxTemplates } = await import("../../services/gearbox-templates");
    const tenant = await this.getTenant(tenantId);
    return getMergedGearboxTemplates(tenant ?? undefined);
  }

  async getDefaultTenant(): Promise<Tenant | undefined> {
    if (this.defaultTenantId) {
      return this.tenants.get(this.defaultTenantId);
    }
    return Array.from(this.tenants.values())[0];
  }

  async createTenant(tenant: InsertTenant): Promise<Tenant> {
    const id = randomUUID();
    const newTenant: Tenant = {
      ...tenant,
      id,
      workingDays: tenant.workingDays || ["mon", "tue", "wed", "thu", "fri"],
      createdAt: new Date(),
    } as Tenant;
    this.tenants.set(id, newTenant);
    if (!this.defaultTenantId) {
      this.defaultTenantId = id;
    }
    return newTenant;
  }

  async updateTenant(id: string, data: Partial<InsertTenant>): Promise<Tenant | undefined> {
    const tenant = this.tenants.get(id);
    if (!tenant) return undefined;
    const updated = { ...tenant, ...data } as Tenant;
    this.tenants.set(id, updated);
    return updated;
  }

  // Channel methods
  async getChannel(id: string): Promise<Channel | undefined> {
    return this.channels.get(id);
  }

  async getChannelsByTenant(tenantId: string): Promise<Channel[]> {
    return Array.from(this.channels.values()).filter((c) => c.tenantId === tenantId);
  }

  async getChannelsByType(channelType: string): Promise<Channel[]> {
    return Array.from(this.channels.values()).filter((c) => c.type === channelType);
  }

  async createChannel(channel: InsertChannel): Promise<Channel> {
    const id = randomUUID();
    const newChannel: Channel = { ...channel, id, createdAt: new Date() } as Channel;
    this.channels.set(id, newChannel);
    return newChannel;
  }

  async updateChannel(id: string, data: Partial<InsertChannel>): Promise<Channel | undefined> {
    const existing = this.channels.get(id);
    if (!existing) return undefined;
    const updated: Channel = { ...existing, ...data } as Channel;
    this.channels.set(id, updated);
    return updated;
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((u) => u.username === username);
  }

  async getUserByOidcId(oidcId: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((u) => u.oidcId === oidcId);
  }

  async createUser(user: InsertUser): Promise<User> {
    const id = randomUUID();
    const newUser: User = { ...user, id, createdAt: new Date() } as User;
    this.users.set(id, newUser);
    return newUser;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((u) => u.email?.toLowerCase() === email.toLowerCase());
  }

  async updateUserLoginAttempts(userId: string, attempts: number, lockedUntil: Date | null): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.failedLoginAttempts = attempts;
      user.lockedUntil = lockedUntil;
      this.users.set(userId, user);
    }
  }

  async updateUserLoginSuccess(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      user.lastLoginAt = new Date();
      this.users.set(userId, user);
    }
  }

  // User Invite methods
  private userInvites: Map<string, UserInvite> = new Map();

  async getUserInviteByTokenHash(tokenHash: string): Promise<UserInvite | undefined> {
    return Array.from(this.userInvites.values()).find((i) => i.tokenHash === tokenHash);
  }

  async getPendingInviteForEmail(tenantId: string, email: string): Promise<UserInvite | undefined> {
    return Array.from(this.userInvites.values()).find(
      (i) => i.tenantId === tenantId && i.email.toLowerCase() === email.toLowerCase() && !i.usedAt
    );
  }

  async createUserInvite(invite: InsertUserInvite): Promise<UserInvite> {
    const id = randomUUID();
    const newInvite: UserInvite = { ...invite, id, createdAt: new Date(), usedAt: null } as UserInvite;
    this.userInvites.set(id, newInvite);
    return newInvite;
  }

  async markUserInviteUsed(inviteId: string): Promise<void> {
    const invite = this.userInvites.get(inviteId);
    if (invite) {
      invite.usedAt = new Date();
      this.userInvites.set(inviteId, invite);
    }
  }

  // Email Token methods
  private emailTokens: Map<string, EmailToken> = new Map();

  async createEmailToken(token: InsertEmailToken): Promise<EmailToken> {
    const id = randomUUID();
    const newToken: EmailToken = { ...token, id, createdAt: new Date(), usedAt: null } as EmailToken;
    this.emailTokens.set(id, newToken);
    return newToken;
  }

  async getEmailTokenByHash(tokenHash: string): Promise<EmailToken | undefined> {
    return Array.from(this.emailTokens.values()).find((t) => t.tokenHash === tokenHash);
  }

  async markEmailTokenUsed(tokenId: string): Promise<void> {
    const token = this.emailTokens.get(tokenId);
    if (token) {
      token.usedAt = new Date();
      this.emailTokens.set(tokenId, token);
    }
  }

  async invalidateUserTokens(userId: string, type: string): Promise<void> {
    const entries = Array.from(this.emailTokens.entries());
    for (const [id, token] of entries) {
      if (token.userId === userId && token.type === type && !token.usedAt) {
        token.usedAt = new Date();
        this.emailTokens.set(id, token);
      }
    }
  }

  async updateUserEmailVerified(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      (user as any).emailVerifiedAt = new Date();
      this.users.set(userId, user);
    }
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      (user as any).password = passwordHash;
      (user as any).passwordUpdatedAt = new Date();
      this.users.set(userId, user);
    }
  }

  async linkOidcToUser(userId: string, oidcId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      (user as any).oidcId = oidcId;
      (user as any).authProvider = "mixed";
      this.users.set(userId, user);
    }
  }

  // Customer methods
  async getCustomer(id: string): Promise<Customer | undefined> {
    return this.customers.get(id);
  }

  async getCustomersByTenant(tenantId: string): Promise<Customer[]> {
    return Array.from(this.customers.values()).filter((c) => c.tenantId === tenantId);
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    const id = randomUUID();
    const now = new Date();
    const newCustomer: Customer = { ...customer, id, createdAt: now, updatedAt: now } as Customer;
    this.customers.set(id, newCustomer);
    return newCustomer;
  }

  async searchCustomers(tenantId: string, query: string): Promise<Customer[]> {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.customers.values()).filter(c =>
      c.tenantId === tenantId && (
        c.name?.toLowerCase().includes(lowerQuery) ||
        c.phone?.toLowerCase().includes(lowerQuery) ||
        c.email?.toLowerCase().includes(lowerQuery) ||
        c.externalId?.toLowerCase().includes(lowerQuery)
      )
    );
  }

  async getCustomerByExternalId(tenantId: string, channel: string, externalId: string): Promise<Customer | undefined> {
    return Array.from(this.customers.values()).find(c =>
      c.tenantId === tenantId && c.channel === channel && c.externalId === externalId
    );
  }

  async updateCustomer(id: string, data: UpdateCustomer): Promise<Customer | undefined> {
    const customer = this.customers.get(id);
    if (!customer) return undefined;
    const updated: Customer = { ...customer, ...data, updatedAt: new Date() };
    this.customers.set(id, updated);
    return updated;
  }

  // Customer Notes
  async getCustomerNote(id: string): Promise<CustomerNote | undefined> {
    return this.customerNotes.get(id);
  }

  async getCustomerNotes(customerId: string): Promise<CustomerNote[]> {
    return Array.from(this.customerNotes.values())
      .filter(n => n.customerId === customerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createCustomerNote(note: InsertCustomerNote): Promise<CustomerNote> {
    const id = randomUUID();
    const newNote: CustomerNote = { ...note, id, createdAt: new Date() } as CustomerNote;
    this.customerNotes.set(id, newNote);
    return newNote;
  }

  async deleteCustomerNote(id: string): Promise<boolean> {
    return this.customerNotes.delete(id);
  }

  // Customer Memory
  private getMemoryKey(tenantId: string, customerId: string): string {
    return `${tenantId}:${customerId}`;
  }

  async getCustomerMemory(tenantId: string, customerId: string): Promise<CustomerMemory | undefined> {
    return this.customerMemories.get(this.getMemoryKey(tenantId, customerId));
  }

  async upsertCustomerMemory(data: InsertCustomerMemory): Promise<CustomerMemory> {
    const key = this.getMemoryKey(data.tenantId, data.customerId);
    const existing = this.customerMemories.get(key);

    if (existing) {
      const updated: CustomerMemory = {
        ...existing,
        preferences: data.preferences ?? existing.preferences,
        frequentTopics: data.frequentTopics ?? existing.frequentTopics,
        lastSummaryText: data.lastSummaryText ?? existing.lastSummaryText,
        updatedAt: new Date(),
      };
      this.customerMemories.set(key, updated);
      return updated;
    }

    const newMemory: CustomerMemory = {
      id: randomUUID(),
      tenantId: data.tenantId,
      customerId: data.customerId,
      preferences: data.preferences ?? {},
      frequentTopics: data.frequentTopics ?? {},
      lastSummaryText: data.lastSummaryText ?? null,
      updatedAt: new Date(),
    };
    this.customerMemories.set(key, newMemory);
    return newMemory;
  }

  async incrementFrequentTopic(tenantId: string, customerId: string, intent: string): Promise<CustomerMemory> {
    const key = this.getMemoryKey(tenantId, customerId);
    const existing = this.customerMemories.get(key);

    const currentTopics = (existing?.frequentTopics as Record<string, number>) ?? {};
    const newTopics = { ...currentTopics, [intent]: (currentTopics[intent] || 0) + 1 };

    if (existing) {
      const updated: CustomerMemory = { ...existing, frequentTopics: newTopics, updatedAt: new Date() };
      this.customerMemories.set(key, updated);
      return updated;
    }

    const newMemory: CustomerMemory = {
      id: randomUUID(),
      tenantId,
      customerId,
      preferences: {},
      frequentTopics: newTopics,
      lastSummaryText: null,
      updatedAt: new Date(),
    };
    this.customerMemories.set(key, newMemory);
    return newMemory;
  }

  async updateCustomerPreferences(tenantId: string, customerId: string, preferences: Record<string, unknown>): Promise<CustomerMemory> {
    const key = this.getMemoryKey(tenantId, customerId);
    const existing = this.customerMemories.get(key);

    if (existing) {
      const merged = { ...(existing.preferences as Record<string, unknown>), ...preferences };
      const updated: CustomerMemory = { ...existing, preferences: merged, updatedAt: new Date() };
      this.customerMemories.set(key, updated);
      return updated;
    }

    const newMemory: CustomerMemory = {
      id: randomUUID(),
      tenantId,
      customerId,
      preferences,
      frequentTopics: {},
      lastSummaryText: null,
      updatedAt: new Date(),
    };
    this.customerMemories.set(key, newMemory);
    return newMemory;
  }

  // Conversation methods
  async getConversation(id: string): Promise<Conversation | undefined> {
    return this.conversations.get(id);
  }

  async getConversationWithCustomer(id: string): Promise<ConversationWithCustomer | undefined> {
    const conversation = this.conversations.get(id);
    if (!conversation) return undefined;
    const customer = await this.getCustomer(conversation.customerId);
    if (!customer) return undefined;
    const messages = await this.getMessagesByConversation(id);
    const lastMessage = messages[messages.length - 1];
    return { ...conversation, customer, lastMessage };
  }

  async getConversationDetail(id: string): Promise<ConversationDetail | undefined> {
    const conversation = this.conversations.get(id);
    if (!conversation) return undefined;
    const customer = await this.getCustomer(conversation.customerId);
    if (!customer) return undefined;
    const messages = await this.getMessagesByConversation(id);
    const currentSuggestion = await this.getPendingSuggestionByConversation(id);
    return { ...conversation, customer, messages, currentSuggestion };
  }

  async getConversationsByTenant(tenantId: string): Promise<ConversationWithCustomer[]> {
    const convs = Array.from(this.conversations.values())
      .filter((c) => c.tenantId === tenantId)
      .sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime());

    const result: ConversationWithCustomer[] = [];
    for (const conv of convs) {
      const customer = await this.getCustomer(conv.customerId);
      if (customer) {
        const messages = await this.getMessagesByConversation(conv.id);
        const channel = conv.channelId ? await this.getChannel(conv.channelId) : undefined;
        result.push({ ...conv, customer, lastMessage: messages[messages.length - 1], channel });
      }
    }
    return result;
  }

  async getActiveConversations(tenantId: string): Promise<ConversationWithCustomer[]> {
    const all = await this.getConversationsByTenant(tenantId);
    return all.filter((c) => c.status === "active" || c.status === "waiting");
  }

  async createConversation(conversation: InsertConversation & { lastMessageAt?: Date; createdAt?: Date }): Promise<Conversation> {
    const id = randomUUID();
    const now = new Date();
    const newConv: Conversation = {
      ...conversation,
      id,
      status: conversation.status || "active",
      mode: conversation.mode || "learning",
      unreadCount: conversation.unreadCount || 0,
      lastMessageAt: conversation.lastMessageAt || now,
      createdAt: conversation.createdAt || now,
    } as Conversation;
    this.conversations.set(id, newConv);
    return newConv;
  }

  async updateConversation(id: string, data: Partial<InsertConversation>): Promise<Conversation | undefined> {
    const conv = this.conversations.get(id);
    if (!conv) return undefined;
    const updated = { ...conv, ...data };
    this.conversations.set(id, updated);
    return updated;
  }

  // Message methods
  async getMessage(id: string): Promise<Message | undefined> {
    return this.messages.get(id);
  }

  async getMessagesByConversation(conversationId: string): Promise<Message[]> {
    return Array.from(this.messages.values())
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async getMessagesByConversationPaginated(
    conversationId: string,
    cursor?: string,
    limit = 50,
  ): Promise<{ messages: Message[]; nextCursor: string | null }> {
    const safeLimit = Math.min(Math.max(1, limit), 200);
    const all = await this.getMessagesByConversation(conversationId);

    let startIdx = 0;
    if (cursor) {
      const cursorIdx = all.findIndex((m) => m.id === cursor);
      if (cursorIdx !== -1) startIdx = cursorIdx + 1;
    }

    const slice = all.slice(startIdx, startIdx + safeLimit + 1);
    const hasMore = slice.length > safeLimit;
    const page = hasMore ? slice.slice(0, safeLimit) : slice;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return { messages: page, nextCursor };
  }

  async createMessage(message: InsertMessage & { createdAt?: Date }): Promise<Message> {
    const id = randomUUID();
    const messageTime = message.createdAt || new Date();
    const newMessage: Message = { ...message, id, createdAt: messageTime } as Message;
    this.messages.set(id, newMessage);

    // Update conversation's lastMessageAt
    const conv = this.conversations.get(message.conversationId);
    if (conv) {
      // Only update if this message is newer than current lastMessageAt
      const currentLast = conv.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : 0;
      if (messageTime.getTime() > currentLast) {
        conv.lastMessageAt = messageTime;
      }
      if (message.role === "customer") {
        conv.unreadCount = (conv.unreadCount || 0) + 1;
      }
      this.conversations.set(conv.id, conv);
    }

    return newMessage;
  }

  async updateMessage(id: string, data: Partial<InsertMessage>): Promise<Message | undefined> {
    const msg = this.messages.get(id);
    if (!msg) return undefined;
    const updated: Message = { ...msg, ...(data as Partial<Message>) };
    this.messages.set(id, updated);
    return updated;
  }

  async getMessagesBySuggestionId(suggestionId: string): Promise<Message[]> {
    return Array.from(this.messages.values())
      .filter((m) => {
        const metadata = m.metadata as Record<string, unknown> | null;
        return metadata?.suggestionId === suggestionId;
      });
  }

  // Product methods
  async getProduct(id: string): Promise<Product | undefined> {
    return this.products.get(id);
  }

  async getProductsByTenant(tenantId: string): Promise<Product[]> {
    return Array.from(this.products.values()).filter((p) => p.tenantId === tenantId);
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const id = randomUUID();
    const newProduct: Product = { ...product, id, createdAt: new Date() } as Product;
    this.products.set(id, newProduct);
    return newProduct;
  }

  async updateProduct(id: string, data: Partial<InsertProduct>): Promise<Product | undefined> {
    const product = this.products.get(id);
    if (!product) return undefined;
    const updated = { ...product, ...data };
    this.products.set(id, updated);
    return updated;
  }

  async deleteProduct(id: string): Promise<boolean> {
    return this.products.delete(id);
  }

  async searchProducts(tenantId: string, query: string): Promise<Product[]> {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.products.values())
      .filter((p) => p.tenantId === tenantId)
      .filter((p) =>
        p.name.toLowerCase().includes(lowerQuery) ||
        p.description?.toLowerCase().includes(lowerQuery) ||
        p.sku?.toLowerCase().includes(lowerQuery)
      );
  }

  // Knowledge Doc methods
  async getKnowledgeDoc(id: string): Promise<KnowledgeDoc | undefined> {
    return this.knowledgeDocs.get(id);
  }

  async getKnowledgeDocsByTenant(tenantId: string): Promise<KnowledgeDoc[]> {
    return Array.from(this.knowledgeDocs.values()).filter((d) => d.tenantId === tenantId);
  }

  async createKnowledgeDoc(doc: InsertKnowledgeDoc): Promise<KnowledgeDoc> {
    const id = randomUUID();
    const newDoc: KnowledgeDoc = { ...doc, id, createdAt: new Date() } as KnowledgeDoc;
    this.knowledgeDocs.set(id, newDoc);
    return newDoc;
  }

  async updateKnowledgeDoc(id: string, data: Partial<InsertKnowledgeDoc>): Promise<KnowledgeDoc | undefined> {
    const doc = this.knowledgeDocs.get(id);
    if (!doc) return undefined;
    const updated = { ...doc, ...data };
    this.knowledgeDocs.set(id, updated);
    return updated;
  }

  async deleteKnowledgeDoc(id: string): Promise<boolean> {
    return this.knowledgeDocs.delete(id);
  }

  async searchKnowledgeDocs(tenantId: string, query: string): Promise<KnowledgeDoc[]> {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.knowledgeDocs.values())
      .filter((d) => d.tenantId === tenantId && d.isActive)
      .filter((d) =>
        d.title.toLowerCase().includes(lowerQuery) ||
        d.content.toLowerCase().includes(lowerQuery)
      );
  }

  // AI Suggestion methods
  async getAiSuggestion(id: string): Promise<AiSuggestion | undefined> {
    return this.aiSuggestions.get(id);
  }

  async getPendingSuggestionByConversation(conversationId: string): Promise<AiSuggestion | undefined> {
    return Array.from(this.aiSuggestions.values()).find(
      (s) => s.conversationId === conversationId && s.status === "pending"
    );
  }

  async getSuggestionsByConversation(conversationId: string): Promise<AiSuggestion[]> {
    return Array.from(this.aiSuggestions.values()).filter(
      (s) => s.conversationId === conversationId
    );
  }

  async getSuggestionsByTenant(tenantId: string): Promise<AiSuggestion[]> {
    const tenantConversationIds = new Set(
      Array.from(this.conversations.values())
        .filter((c) => c.tenantId === tenantId)
        .map((c) => c.id)
    );
    return Array.from(this.aiSuggestions.values()).filter(
      (s) => tenantConversationIds.has(s.conversationId)
    );
  }

  async createAiSuggestion(suggestion: InsertAiSuggestion): Promise<AiSuggestion> {
    const id = randomUUID();
    const newSuggestion: AiSuggestion = { ...suggestion, id, createdAt: new Date() } as AiSuggestion;
    this.aiSuggestions.set(id, newSuggestion);
    return newSuggestion;
  }

  async updateAiSuggestion(id: string, data: Partial<InsertAiSuggestion>): Promise<AiSuggestion | undefined> {
    const suggestion = this.aiSuggestions.get(id);
    if (!suggestion) return undefined;
    const updated = { ...suggestion, ...data };
    this.aiSuggestions.set(id, updated);
    return updated;
  }

  // Human Action methods
  async createHumanAction(action: InsertHumanAction): Promise<HumanAction> {
    const id = randomUUID();
    const newAction: HumanAction = { ...action, id, createdAt: new Date() } as HumanAction;
    this.humanActions.set(id, newAction);
    return newAction;
  }

  // AI Training Samples methods
  async createAiTrainingSample(sample: InsertAiTrainingSample): Promise<AiTrainingSample> {
    const id = randomUUID();
    const newSample: AiTrainingSample = { ...sample, id, createdAt: new Date() } as AiTrainingSample;
    this.aiTrainingSamples.set(id, newSample);
    return newSample;
  }

  async getAiTrainingSamplesByTenant(tenantId: string, outcome?: string): Promise<AiTrainingSample[]> {
    const samples = Array.from(this.aiTrainingSamples.values())
      .filter(s => s.tenantId === tenantId);
    if (outcome) {
      return samples.filter(s => s.outcome === outcome);
    }
    return samples;
  }

  async getAiTrainingSamplesCount(tenantId: string): Promise<number> {
    return Array.from(this.aiTrainingSamples.values())
      .filter(s => s.tenantId === tenantId).length;
  }

  // AI Training Policies methods
  async getAiTrainingPolicy(tenantId: string): Promise<AiTrainingPolicy | undefined> {
    return this.aiTrainingPolicies.get(tenantId);
  }

  async upsertAiTrainingPolicy(policy: InsertAiTrainingPolicy): Promise<AiTrainingPolicy> {
    const existing = this.aiTrainingPolicies.get(policy.tenantId);
    const now = new Date();
    const updated: AiTrainingPolicy = {
      tenantId: policy.tenantId,
      alwaysEscalateIntents: policy.alwaysEscalateIntents ?? existing?.alwaysEscalateIntents ?? [],
      forbiddenTopics: policy.forbiddenTopics ?? existing?.forbiddenTopics ?? [],
      disabledLearningIntents: policy.disabledLearningIntents ?? existing?.disabledLearningIntents ?? [],
      updatedAt: now,
    };
    this.aiTrainingPolicies.set(policy.tenantId, updated);
    return updated;
  }

  // Learning Queue methods
  async createLearningQueueItem(item: InsertLearningQueueItem): Promise<LearningQueueItem> {
    const id = randomUUID();
    const newItem: LearningQueueItem = {
      ...item,
      id,
      status: item.status ?? "pending",
      reasons: item.reasons ?? [],
      learningScore: item.learningScore ?? 0,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date(),
    };
    this.learningQueue.set(id, newItem);
    return newItem;
  }

  async getLearningQueueByTenant(tenantId: string, minScore?: number): Promise<LearningQueueItem[]> {
    let items = Array.from(this.learningQueue.values())
      .filter(i => i.tenantId === tenantId && i.status === "pending");

    if (minScore !== undefined) {
      items = items.filter(i => i.learningScore >= minScore);
    }

    return items.sort((a, b) => b.learningScore - a.learningScore);
  }

  async getLearningQueueItem(conversationId: string): Promise<LearningQueueItem | undefined> {
    return Array.from(this.learningQueue.values())
      .find(i => i.conversationId === conversationId);
  }

  async updateLearningQueueItem(id: string, data: Partial<InsertLearningQueueItem>): Promise<LearningQueueItem | undefined> {
    const item = this.learningQueue.get(id);
    if (!item) return undefined;
    const updated = { ...item, ...data };
    this.learningQueue.set(id, updated);
    return updated;
  }

  async upsertLearningQueueItem(item: InsertLearningQueueItem): Promise<LearningQueueItem> {
    const existing = await this.getLearningQueueItem(item.conversationId);
    if (existing) {
      const newScore = Math.max(existing.learningScore, item.learningScore ?? 0);
      const newReasons = Array.from(new Set([...(existing.reasons ?? []), ...(item.reasons ?? [])]));
      const updated = await this.updateLearningQueueItem(existing.id, {
        learningScore: newScore,
        reasons: newReasons,
      });
      return updated!;
    }
    return this.createLearningQueueItem(item);
  }

  // Escalation Event methods
  async getEscalationEvent(id: string): Promise<EscalationEvent | undefined> {
    return this.escalationEvents.get(id);
  }

  async getEscalationsByTenant(tenantId: string): Promise<EscalationEvent[]> {
    const convIds = new Set(
      Array.from(this.conversations.values())
        .filter((c) => c.tenantId === tenantId)
        .map((c) => c.id)
    );
    return Array.from(this.escalationEvents.values())
      .filter((e) => convIds.has(e.conversationId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getRecentEscalations(tenantId: string, limit: number): Promise<EscalationEvent[]> {
    const all = await this.getEscalationsByTenant(tenantId);
    return all.slice(0, limit);
  }

  async createEscalationEvent(event: InsertEscalationEvent): Promise<EscalationEvent> {
    const id = randomUUID();
    const newEvent: EscalationEvent = { ...event, id, createdAt: new Date() } as EscalationEvent;
    this.escalationEvents.set(id, newEvent);
    return newEvent;
  }

  async updateEscalationEvent(id: string, data: Partial<InsertEscalationEvent>): Promise<EscalationEvent | undefined> {
    const event = this.escalationEvents.get(id);
    if (!event) return undefined;
    const updated = { ...event, ...data };
    this.escalationEvents.set(id, updated);
    return updated;
  }

  // Response Template methods
  async getTemplatesByTenant(tenantId: string): Promise<ResponseTemplate[]> {
    return Array.from(this.responseTemplates.values()).filter((t) => t.tenantId === tenantId);
  }

  async createTemplate(template: InsertResponseTemplate): Promise<ResponseTemplate> {
    const id = randomUUID();
    const newTemplate: ResponseTemplate = { ...template, id, createdAt: new Date() } as ResponseTemplate;
    this.responseTemplates.set(id, newTemplate);
    return newTemplate;
  }

  // Dashboard metrics
  async getDashboardMetrics(tenantId: string): Promise<DashboardMetrics> {
    const convs = Array.from(this.conversations.values()).filter((c) => c.tenantId === tenantId);
    const products = Array.from(this.products.values()).filter((p) => p.tenantId === tenantId);
    const docs = Array.from(this.knowledgeDocs.values()).filter((d) => d.tenantId === tenantId);
    const suggestions = Array.from(this.aiSuggestions.values());

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const resolvedToday = convs.filter(
      (c) => c.status === "resolved" && new Date(c.lastMessageAt || 0) >= today
    ).length;

    const approvedSuggestions = suggestions.filter((s) => s.status === "approved").length;
    const totalSuggestions = suggestions.length;
    const aiAccuracy = totalSuggestions > 0 ? approvedSuggestions / totalSuggestions : 0;

    const pendingSuggestions = suggestions.filter((s) => s.status === "pending").length;

    return {
      totalConversations: convs.length,
      activeConversations: convs.filter((c) => c.status === "active" || c.status === "waiting").length,
      escalatedConversations: convs.filter((c) => c.status === "escalated").length,
      resolvedToday,
      avgResponseTime: 12, // Mock value
      aiAccuracy,
      pendingSuggestions,
      productsCount: products.length,
      knowledgeDocsCount: docs.length,
    };
  }

  // Phase 1: Decision Settings methods
  async getDecisionSettings(tenantId: string): Promise<DecisionSettings | undefined> {
    return this.decisionSettings.get(tenantId);
  }

  async upsertDecisionSettings(settings: InsertDecisionSettings): Promise<DecisionSettings> {
    const existing = this.decisionSettings.get(settings.tenantId);
    const updated: DecisionSettings = {
      tenantId: settings.tenantId,
      tAuto: settings.tAuto ?? existing?.tAuto ?? 0.80,
      tEscalate: settings.tEscalate ?? existing?.tEscalate ?? 0.40,
      autosendAllowed: settings.autosendAllowed ?? existing?.autosendAllowed ?? false,
      intentsAutosendAllowed: settings.intentsAutosendAllowed ?? existing?.intentsAutosendAllowed ?? ["price", "availability", "shipping", "other"],
      intentsForceHandoff: settings.intentsForceHandoff ?? existing?.intentsForceHandoff ?? ["discount", "complaint"],
      updatedAt: new Date(),
    };
    this.decisionSettings.set(settings.tenantId, updated);
    return updated;
  }

  // Phase 2: Human Delay Settings methods
  async getHumanDelaySettings(tenantId: string): Promise<HumanDelaySettings | undefined> {
    return this.humanDelaySettings.get(tenantId);
  }

  async upsertHumanDelaySettings(settings: InsertHumanDelaySettings): Promise<HumanDelaySettings> {
    const existing = this.humanDelaySettings.get(settings.tenantId);
    const updated: HumanDelaySettings = {
      tenantId: settings.tenantId,
      enabled: settings.enabled ?? existing?.enabled ?? false,
      delayProfiles: settings.delayProfiles ?? existing?.delayProfiles ?? DEFAULT_DELAY_PROFILES,
      nightMode: settings.nightMode ?? existing?.nightMode ?? "DELAY",
      nightDelayMultiplier: settings.nightDelayMultiplier ?? existing?.nightDelayMultiplier ?? 3.0,
      nightAutoReplyText: settings.nightAutoReplyText ?? existing?.nightAutoReplyText ?? "Спасибо за сообщение! Мы ответим в рабочее время.",
      minDelayMs: settings.minDelayMs ?? existing?.minDelayMs ?? 3000,
      maxDelayMs: settings.maxDelayMs ?? existing?.maxDelayMs ?? 120000,
      typingIndicatorEnabled: settings.typingIndicatorEnabled ?? existing?.typingIndicatorEnabled ?? true,
      updatedAt: new Date(),
    };
    this.humanDelaySettings.set(settings.tenantId, updated);
    return updated;
  }

  // Phase 7: Onboarding State methods
  async getOnboardingState(tenantId: string): Promise<OnboardingState | undefined> {
    return this.onboardingStates.get(tenantId);
  }

  async upsertOnboardingState(state: InsertOnboardingState): Promise<OnboardingState> {
    const existing = this.onboardingStates.get(state.tenantId);
    const updated: OnboardingState = {
      tenantId: state.tenantId,
      status: state.status ?? existing?.status ?? "NOT_STARTED",
      currentStep: state.currentStep ?? existing?.currentStep ?? "BUSINESS",
      completedSteps: state.completedSteps ?? existing?.completedSteps ?? [],
      answers: state.answers ?? existing?.answers ?? {},
      updatedAt: new Date(),
    };
    this.onboardingStates.set(state.tenantId, updated);
    return updated;
  }

  async createReadinessReport(report: InsertReadinessReport): Promise<ReadinessReport> {
    const id = randomUUID();
    const newReport: ReadinessReport = {
      id,
      tenantId: report.tenantId,
      score: report.score ?? 0,
      checks: report.checks ?? [],
      recommendations: report.recommendations ?? [],
      createdAt: new Date(),
    };
    this.readinessReports.set(id, newReport);
    return newReport;
  }

  async getLatestReadinessReport(tenantId: string): Promise<ReadinessReport | undefined> {
    const reports = Array.from(this.readinessReports.values())
      .filter(r => r.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return reports[0];
  }

  // Phase 8: CSAT Ratings
  async createCsatRating(rating: InsertCsatRating): Promise<CsatRating> {
    const id = randomUUID();
    const newRating: CsatRating = {
      id,
      tenantId: rating.tenantId,
      conversationId: rating.conversationId,
      rating: rating.rating,
      comment: rating.comment ?? null,
      intent: rating.intent ?? null,
      decision: rating.decision ?? null,
      createdAt: new Date(),
    };
    this.csatRatings.set(id, newRating);
    return newRating;
  }

  async getCsatRatingByConversation(conversationId: string): Promise<CsatRating | undefined> {
    return Array.from(this.csatRatings.values()).find(r => r.conversationId === conversationId);
  }

  async getCsatRatingsByTenant(tenantId: string): Promise<CsatRating[]> {
    return Array.from(this.csatRatings.values()).filter(r => r.tenantId === tenantId);
  }

  // Conversion methods
  async createConversion(data: InsertConversion): Promise<Conversion> {
    const id = randomUUID();
    const conversion: Conversion = {
      id,
      tenantId: data.tenantId,
      conversationId: data.conversationId,
      amount: data.amount,
      currency: data.currency ?? "RUB",
      intent: data.intent ?? null,
      decision: data.decision ?? null,
      createdAt: new Date(),
    };
    this.conversions.set(id, conversion);
    return conversion;
  }

  async getConversionByConversation(conversationId: string): Promise<Conversion | undefined> {
    return Array.from(this.conversions.values()).find(c => c.conversationId === conversationId);
  }

  async getConversionsByTenant(tenantId: string): Promise<Conversion[]> {
    return Array.from(this.conversions.values()).filter(c => c.tenantId === tenantId);
  }

  // Lost Deals methods
  async createLostDeal(data: InsertLostDeal): Promise<LostDeal> {
    const id = randomUUID();
    const lostDeal: LostDeal = {
      id,
      tenantId: data.tenantId,
      conversationId: data.conversationId,
      reason: data.reason,
      detectedAutomatically: data.detectedAutomatically ?? true,
      notes: data.notes ?? null,
      createdAt: new Date(),
    };
    this.lostDeals.set(id, lostDeal);
    return lostDeal;
  }

  async getLostDealByConversation(conversationId: string): Promise<LostDeal | undefined> {
    return Array.from(this.lostDeals.values()).find(ld => ld.conversationId === conversationId);
  }

  async getLostDealsByTenant(tenantId: string): Promise<LostDeal[]> {
    return Array.from(this.lostDeals.values()).filter(ld => ld.tenantId === tenantId);
  }

  // Metrics methods
  async getCustomersCount(tenantId: string): Promise<number> {
    return Array.from(this.customers.values()).filter(c => c.tenantId === tenantId).length;
  }

  async getCustomerNotesCount(tenantId: string): Promise<number> {
    const customerIds = new Set(
      Array.from(this.customers.values())
        .filter(c => c.tenantId === tenantId)
        .map(c => c.id)
    );
    return Array.from(this.customerNotes.values()).filter(n => customerIds.has(n.customerId)).length;
  }

  async getCustomerMemoryCount(tenantId: string): Promise<number> {
    return Array.from(this.customerMemories.values()).filter(m => m.tenantId === tenantId).length;
  }

  async createRagDocument(doc: InsertRagDocument): Promise<RagDocument> {
    const id = randomUUID();
    const now = new Date();
    const newDoc: RagDocument = {
      ...doc,
      id,
      metadata: doc.metadata || {},
      createdAt: now,
      updatedAt: now,
    };
    this.ragDocuments.set(id, newDoc);
    return newDoc;
  }

  async createRagChunk(chunk: InsertRagChunk): Promise<RagChunk> {
    const id = randomUUID();
    const now = new Date();
    const newChunk: RagChunk = {
      ...chunk,
      id,
      embedding: chunk.embedding || null,
      metadata: chunk.metadata || {},
      createdAt: now,
      updatedAt: now,
    };
    this.ragChunks.set(id, newChunk);
    return newChunk;
  }

  async deleteRagBySource(tenantId: string, sourceType: "PRODUCT" | "DOC", sourceId: string): Promise<{ deletedDocs: number }> {
    let count = 0;
    const docsToDelete = Array.from(this.ragDocuments.entries())
      .filter(([_, doc]) => doc.tenantId === tenantId && doc.type === sourceType && doc.sourceId === sourceId);

    for (const [id, _doc] of docsToDelete) {
      const chunksToDelete = Array.from(this.ragChunks.entries())
        .filter(([_, chunk]) => chunk.ragDocumentId === id);
      for (const [chunkId] of chunksToDelete) {
        this.ragChunks.delete(chunkId);
      }
      this.ragDocuments.delete(id);
      count++;
    }
    return { deletedDocs: count };
  }

  async updateRagChunkEmbedding(_chunkId: string, _embedding: number[]): Promise<boolean> {
    return false;
  }

  async getRagChunksBySource(_tenantId: string, _sourceType: "PRODUCT" | "DOC", _sourceId: string): Promise<{ id: string; chunkText: string; embedding: number[] | null }[]> {
    return [];
  }

  async getRagChunksWithoutEmbedding(_tenantId: string, _limit?: number): Promise<{ id: string; chunkText: string }[]> {
    return [];
  }

  async getRagChunksWithStaleHash(_tenantId: string, _limit?: number): Promise<{ id: string; chunkText: string; storedHash: string | null; currentHash: string }[]> {
    return [];
  }

  async invalidateStaleEmbeddings(_tenantId: string): Promise<{ invalidated: number }> {
    return { invalidated: 0 };
  }

  async getAllRagChunksWithEmbedding(_tenantId: string): Promise<{ id: string; chunkText: string; chunkIndex: number; embedding: string | null; metadata: unknown }[]> {
    return [];
  }

  // Update History methods
  async getUpdateHistory(): Promise<UpdateHistory[]> {
    return Array.from(this.updateHistory.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getUpdateById(id: string): Promise<UpdateHistory | undefined> {
    return this.updateHistory.get(id);
  }

  async createUpdate(update: InsertUpdateHistory): Promise<UpdateHistory> {
    const id = randomUUID();
    const newUpdate: UpdateHistory = {
      ...update,
      id,
      createdAt: new Date(),
      appliedAt: null,
      appliedById: null,
      errorMessage: null,
      backupPath: null,
    } as UpdateHistory;
    this.updateHistory.set(id, newUpdate);
    return newUpdate;
  }

  async updateUpdateStatus(id: string, status: UpdateStatus, errorMessage?: string): Promise<UpdateHistory | undefined> {
    const update = this.updateHistory.get(id);
    if (!update) return undefined;
    const updated: UpdateHistory = {
      ...update,
      status,
      errorMessage: errorMessage || null,
      appliedAt: status === "applied" ? new Date() : update.appliedAt,
    };
    this.updateHistory.set(id, updated);
    return updated;
  }

  async setUpdateBackupPath(id: string, backupPath: string): Promise<UpdateHistory | undefined> {
    const update = this.updateHistory.get(id);
    if (!update) return undefined;
    const updated: UpdateHistory = { ...update, backupPath };
    this.updateHistory.set(id, updated);
    return updated;
  }

  async getCurrentVersion(): Promise<string> {
    const updates = await this.getUpdateHistory();
    const lastApplied = updates.find(u => u.status === "applied");
    return lastApplied?.version || "1.0.0";
  }

  // Vehicle Lookup Cache (stubs)
  async getVehicleLookupCacheByKey(_lookupKey: string): Promise<VehicleLookupCache | undefined> {
    return undefined;
  }

  async upsertVehicleLookupCache(data: InsertVehicleLookupCache): Promise<VehicleLookupCache> {
    const id = randomUUID();
    const now = new Date();
    return { ...data, id, createdAt: now, updatedAt: now, expiresAt: data.expiresAt ?? null } as VehicleLookupCache;
  }

  async linkCaseToCache(_caseId: string, _cacheId: string): Promise<void> {}

  // Vehicle Lookup Cases (stubs)
  async createVehicleLookupCase(data: InsertVehicleLookupCase): Promise<VehicleLookupCase> {
    const id = randomUUID();
    const now = new Date();
    return { ...data, id, createdAt: now, updatedAt: now } as VehicleLookupCase;
  }

  async getVehicleLookupCaseById(_caseId: string): Promise<VehicleLookupCase | undefined> {
    return undefined;
  }

  async getLatestVehicleLookupCaseByConversation(_tenantId: string, _conversationId: string): Promise<VehicleLookupCase | undefined> {
    return undefined;
  }

  async findActiveVehicleLookupCase(_tenantId: string, _conversationId: string, _normalizedValue: string): Promise<VehicleLookupCase | undefined> {
    return undefined;
  }

  async updateVehicleLookupCaseStatus(
    _caseId: string,
    _patch: { status?: VehicleLookupCaseStatus; verificationStatus?: VehicleLookupVerificationStatus; error?: string | null; cacheId?: string | null }
  ): Promise<VehicleLookupCase | undefined> {
    return undefined;
  }

  async createPriceSnapshot(data: InsertPriceSnapshot): Promise<PriceSnapshot> {
    const id = randomUUID();
    return { ...data, id, createdAt: new Date() } as PriceSnapshot;
  }

  async getGlobalPriceSnapshot(_oem: string): Promise<PriceSnapshot | null> {
    return null;
  }

  async getLatestPriceSnapshot(_oem: string, _maxAgeDays?: number): Promise<PriceSnapshot | undefined> {
    return undefined;
  }

  async getPriceSnapshotsByOem(_tenantId: string, _oem: string, _limit?: number): Promise<PriceSnapshot[]> {
    return [];
  }

  async upsertInternalPrice(data: InsertInternalPrice): Promise<InternalPrice> {
    const id = randomUUID();
    return { ...data, id, updatedAt: new Date() } as InternalPrice;
  }

  async getInternalPricesByOem(_tenantId: string, _oem: string): Promise<InternalPrice[]> {
    return [];
  }

  // Telegram Accounts (stubs)
  private telegramAccountsMap: Map<string, TelegramSession> = new Map();

  async getTelegramAccountsByTenant(tenantId: string): Promise<TelegramSession[]> {
    return Array.from(this.telegramAccountsMap.values()).filter(a => a.tenantId === tenantId);
  }

  async getTelegramAccountById(id: string): Promise<TelegramSession | undefined> {
    return this.telegramAccountsMap.get(id);
  }

  async getActiveTelegramAccounts(): Promise<TelegramSession[]> {
    return Array.from(this.telegramAccountsMap.values()).filter(a => a.status === "active" && a.isEnabled);
  }

  async createTelegramAccount(data: InsertTelegramSession): Promise<TelegramSession> {
    const id = randomUUID();
    const now = new Date();
    const account: TelegramSession = {
      ...data,
      id,
      phoneNumber: data.phoneNumber ?? null,
      sessionString: data.sessionString ?? null,
      phoneCodeHash: data.phoneCodeHash ?? null,
      status: data.status ?? "pending",
      lastError: data.lastError ?? null,
      userId: data.userId ?? null,
      username: data.username ?? null,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      channelId: data.channelId ?? null,
      authMethod: data.authMethod ?? null,
      isEnabled: data.isEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.telegramAccountsMap.set(id, account);
    return account;
  }

  async updateTelegramAccount(id: string, data: Partial<InsertTelegramSession>): Promise<TelegramSession | undefined> {
    const existing = this.telegramAccountsMap.get(id);
    if (!existing) return undefined;
    const updated: TelegramSession = { ...existing, ...data, updatedAt: new Date() } as TelegramSession;
    this.telegramAccountsMap.set(id, updated);
    return updated;
  }

  async deleteTelegramAccount(id: string): Promise<boolean> {
    return this.telegramAccountsMap.delete(id);
  }

  // ─── Message Templates (stubs) ───────────────────────────────────────────

  private messageTemplatesMap: Map<string, MessageTemplate> = new Map();

  async getMessageTemplatesByTenant(tenantId: string): Promise<MessageTemplate[]> {
    return Array.from(this.messageTemplatesMap.values()).filter(t => t.tenantId === tenantId);
  }

  async getActiveMessageTemplateByType(tenantId: string, type: string): Promise<MessageTemplate | undefined> {
    return Array.from(this.messageTemplatesMap.values())
      .find(t => t.tenantId === tenantId && t.type === type && t.isActive);
  }

  async getMessageTemplate(id: string): Promise<MessageTemplate | undefined> {
    return this.messageTemplatesMap.get(id);
  }

  async createMessageTemplate(data: InsertMessageTemplate): Promise<MessageTemplate> {
    const id = randomUUID();
    const now = new Date();
    const tpl: MessageTemplate = {
      id,
      tenantId: data.tenantId,
      type: data.type,
      name: data.name,
      content: data.content,
      isActive: data.isActive ?? true,
      order: data.order ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    this.messageTemplatesMap.set(id, tpl);
    return tpl;
  }

  async updateMessageTemplate(id: string, data: Partial<InsertMessageTemplate>): Promise<MessageTemplate | undefined> {
    const existing = this.messageTemplatesMap.get(id);
    if (!existing) return undefined;
    const updated: MessageTemplate = { ...existing, ...data, updatedAt: new Date() };
    this.messageTemplatesMap.set(id, updated);
    return updated;
  }

  async deleteMessageTemplate(id: string): Promise<boolean> {
    return this.messageTemplatesMap.delete(id);
  }

  async seedDefaultTemplates(_tenantId: string): Promise<void> {
    // no-op in tests
  }

  // ─── Payment Methods (stubs) ─────────────────────────────────────────────

  private paymentMethodsMap: Map<string, PaymentMethod> = new Map();

  async getPaymentMethodsByTenant(tenantId: string): Promise<PaymentMethod[]> {
    return Array.from(this.paymentMethodsMap.values()).filter(m => m.tenantId === tenantId);
  }

  async getActivePaymentMethods(tenantId: string): Promise<PaymentMethod[]> {
    return Array.from(this.paymentMethodsMap.values())
      .filter(m => m.tenantId === tenantId && m.isActive);
  }

  async getPaymentMethod(id: string): Promise<PaymentMethod | undefined> {
    return this.paymentMethodsMap.get(id);
  }

  async createPaymentMethod(data: InsertPaymentMethod): Promise<PaymentMethod> {
    const id = randomUUID();
    const method: PaymentMethod = {
      id,
      tenantId: data.tenantId,
      title: data.title,
      description: data.description ?? null,
      isActive: data.isActive ?? true,
      order: data.order ?? 0,
      createdAt: new Date(),
    };
    this.paymentMethodsMap.set(id, method);
    return method;
  }

  async updatePaymentMethod(id: string, data: Partial<InsertPaymentMethod>): Promise<PaymentMethod | undefined> {
    const existing = this.paymentMethodsMap.get(id);
    if (!existing) return undefined;
    const updated: PaymentMethod = { ...existing, ...data } as PaymentMethod;
    this.paymentMethodsMap.set(id, updated);
    return updated;
  }

  async deletePaymentMethod(id: string): Promise<boolean> {
    return this.paymentMethodsMap.delete(id);
  }

  async reorderPaymentMethods(tenantId: string, updates: Array<{ id: string; order: number }>): Promise<void> {
    for (const { id, order } of updates) {
      const m = this.paymentMethodsMap.get(id);
      if (m && m.tenantId === tenantId) {
        this.paymentMethodsMap.set(id, { ...m, order });
      }
    }
  }
}
