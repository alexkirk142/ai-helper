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
  type VehicleLookupCache, type InsertVehicleLookupCache,
  type VehicleLookupCase, type InsertVehicleLookupCase,
  type VehicleLookupCaseStatus, type VehicleLookupVerificationStatus,
  type PriceSnapshot, type InsertPriceSnapshot,
  type InternalPrice, type InsertInternalPrice,
  type TelegramSession, type InsertTelegramSession,
  type MessageTemplate, type InsertMessageTemplate,
  type PaymentMethod, type InsertPaymentMethod,
  type TenantAgentSettings, type InsertTenantAgentSettings,
  type TransmissionIdentityCache, type InsertTransmissionIdentityCache,
} from "@shared/schema";

export interface IStorage {
  // Tenants
  getTenant(id: string): Promise<Tenant | undefined>;
  getDefaultTenant(): Promise<Tenant | undefined>;
  getTenantTemplates(tenantId: string): Promise<{ gearboxLookupFound: string; gearboxLookupModelOnly: string; gearboxTagRequest: string; gearboxLookupFallback: string; gearboxNoVin: string }>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  updateTenant(id: string, data: Partial<InsertTenant>): Promise<Tenant | undefined>;

  // Channels
  getChannel(id: string): Promise<Channel | undefined>;
  getChannelsByTenant(tenantId: string): Promise<Channel[]>;
  getChannelsByType(channelType: string): Promise<Channel[]>;
  createChannel(channel: InsertChannel): Promise<Channel>;
  updateChannel(id: string, data: Partial<InsertChannel>): Promise<Channel | undefined>;

  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByOidcId(oidcId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserLoginAttempts(userId: string, attempts: number, lockedUntil: Date | null): Promise<void>;
  updateUserLoginSuccess(userId: string): Promise<void>;

  // User Invites
  getUserInviteByTokenHash(tokenHash: string): Promise<UserInvite | undefined>;
  getPendingInviteForEmail(tenantId: string, email: string): Promise<UserInvite | undefined>;
  createUserInvite(invite: InsertUserInvite): Promise<UserInvite>;
  markUserInviteUsed(inviteId: string): Promise<void>;

  // Email Tokens (verification & password reset)
  createEmailToken(token: InsertEmailToken): Promise<EmailToken>;
  getEmailTokenByHash(tokenHash: string): Promise<EmailToken | undefined>;
  markEmailTokenUsed(tokenId: string): Promise<void>;
  invalidateUserTokens(userId: string, type: string): Promise<void>;
  updateUserEmailVerified(userId: string): Promise<void>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;

  // Account Linking (OIDC + Password)
  linkOidcToUser(userId: string, oidcId: string): Promise<void>;

  // Customers
  getCustomer(id: string): Promise<Customer | undefined>;
  getCustomersByTenant(tenantId: string): Promise<Customer[]>;
  searchCustomers(tenantId: string, query: string): Promise<Customer[]>;
  getCustomerByExternalId(tenantId: string, channel: string, externalId: string): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: string, data: UpdateCustomer): Promise<Customer | undefined>;

  // Customer Notes
  getCustomerNote(id: string): Promise<CustomerNote | undefined>;
  getCustomerNotes(customerId: string): Promise<CustomerNote[]>;
  createCustomerNote(note: InsertCustomerNote): Promise<CustomerNote>;
  deleteCustomerNote(id: string): Promise<boolean>;

  // Customer Memory
  getCustomerMemory(tenantId: string, customerId: string): Promise<CustomerMemory | undefined>;
  upsertCustomerMemory(data: InsertCustomerMemory): Promise<CustomerMemory>;
  incrementFrequentTopic(tenantId: string, customerId: string, intent: string): Promise<CustomerMemory>;
  updateCustomerPreferences(tenantId: string, customerId: string, preferences: Record<string, unknown>): Promise<CustomerMemory>;

  // Conversations
  getConversation(id: string): Promise<Conversation | undefined>;
  getConversationWithCustomer(id: string): Promise<ConversationWithCustomer | undefined>;
  getConversationDetail(id: string): Promise<ConversationDetail | undefined>;
  getConversationsByTenant(tenantId: string): Promise<ConversationWithCustomer[]>;
  getActiveConversations(tenantId: string): Promise<ConversationWithCustomer[]>;
  getConversationChannelCounts(tenantId: string): Promise<{ all: number; telegram?: number; max?: number; whatsapp?: number }>;
  createConversation(conversation: InsertConversation & { lastMessageAt?: Date; createdAt?: Date }): Promise<Conversation>;
  updateConversation(id: string, data: Partial<InsertConversation>): Promise<Conversation | undefined>;
  deleteConversation(id: string): Promise<boolean>;

  // Messages
  getMessage(id: string): Promise<Message | undefined>;
  getMessagesByConversation(conversationId: string): Promise<Message[]>;
  getMessagesByConversationPaginated(conversationId: string, cursor?: string, limit?: number): Promise<{ messages: Message[]; nextCursor: string | null }>;
  createMessage(message: InsertMessage & { createdAt?: Date }): Promise<Message>;
  updateMessage(id: string, data: Partial<InsertMessage>): Promise<Message | undefined>;
  getMessagesBySuggestionId(suggestionId: string): Promise<Message[]>;

  // Products
  getProduct(id: string): Promise<Product | undefined>;
  getProductsByTenant(tenantId: string): Promise<Product[]>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: string, data: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: string): Promise<boolean>;
  searchProducts(tenantId: string, query: string): Promise<Product[]>;

  // Knowledge Docs
  getKnowledgeDoc(id: string): Promise<KnowledgeDoc | undefined>;
  getKnowledgeDocsByTenant(tenantId: string): Promise<KnowledgeDoc[]>;
  createKnowledgeDoc(doc: InsertKnowledgeDoc): Promise<KnowledgeDoc>;
  updateKnowledgeDoc(id: string, data: Partial<InsertKnowledgeDoc>): Promise<KnowledgeDoc | undefined>;
  deleteKnowledgeDoc(id: string): Promise<boolean>;
  searchKnowledgeDocs(tenantId: string, query: string): Promise<KnowledgeDoc[]>;

  // AI Suggestions
  getAiSuggestion(id: string): Promise<AiSuggestion | undefined>;
  getPendingSuggestionByConversation(conversationId: string): Promise<AiSuggestion | undefined>;
  getSuggestionsByConversation(conversationId: string): Promise<AiSuggestion[]>;
  getSuggestionsByTenant(tenantId: string): Promise<AiSuggestion[]>;
  createAiSuggestion(suggestion: InsertAiSuggestion): Promise<AiSuggestion>;
  updateAiSuggestion(id: string, data: Partial<InsertAiSuggestion>): Promise<AiSuggestion | undefined>;

  // Human Actions
  createHumanAction(action: InsertHumanAction): Promise<HumanAction>;

  // AI Training Samples
  createAiTrainingSample(sample: InsertAiTrainingSample): Promise<AiTrainingSample>;
  getAiTrainingSamplesByTenant(tenantId: string, outcome?: string): Promise<AiTrainingSample[]>;
  getAiTrainingSamplesCount(tenantId: string): Promise<number>;

  // AI Training Policies
  getAiTrainingPolicy(tenantId: string): Promise<AiTrainingPolicy | undefined>;
  upsertAiTrainingPolicy(policy: InsertAiTrainingPolicy): Promise<AiTrainingPolicy>;

  // Learning Queue
  createLearningQueueItem(item: InsertLearningQueueItem): Promise<LearningQueueItem>;
  getLearningQueueByTenant(tenantId: string, minScore?: number): Promise<LearningQueueItem[]>;
  getLearningQueueItem(conversationId: string): Promise<LearningQueueItem | undefined>;
  updateLearningQueueItem(id: string, data: Partial<InsertLearningQueueItem>): Promise<LearningQueueItem | undefined>;
  upsertLearningQueueItem(item: InsertLearningQueueItem): Promise<LearningQueueItem>;

  // Escalation Events
  getEscalationEvent(id: string): Promise<EscalationEvent | undefined>;
  getEscalationsByTenant(tenantId: string): Promise<EscalationEvent[]>;
  getRecentEscalations(tenantId: string, limit: number): Promise<EscalationEvent[]>;
  createEscalationEvent(event: InsertEscalationEvent): Promise<EscalationEvent>;
  updateEscalationEvent(id: string, data: Partial<InsertEscalationEvent>): Promise<EscalationEvent | undefined>;

  // Response Templates
  getTemplatesByTenant(tenantId: string): Promise<ResponseTemplate[]>;
  createTemplate(template: InsertResponseTemplate): Promise<ResponseTemplate>;

  // Dashboard
  getDashboardMetrics(tenantId: string): Promise<DashboardMetrics>;

  // Phase 1: Decision Settings
  getDecisionSettings(tenantId: string): Promise<DecisionSettings | undefined>;
  upsertDecisionSettings(settings: InsertDecisionSettings): Promise<DecisionSettings>;

  // Phase 2: Human Delay Settings
  getHumanDelaySettings(tenantId: string): Promise<HumanDelaySettings | undefined>;
  upsertHumanDelaySettings(settings: InsertHumanDelaySettings): Promise<HumanDelaySettings>;

  // Phase 7: Onboarding State
  getOnboardingState(tenantId: string): Promise<OnboardingState | undefined>;
  upsertOnboardingState(state: InsertOnboardingState): Promise<OnboardingState>;

  // Phase 7.3: Readiness Reports
  createReadinessReport(report: InsertReadinessReport): Promise<ReadinessReport>;
  getLatestReadinessReport(tenantId: string): Promise<ReadinessReport | undefined>;

  // Phase 8: CSAT Ratings
  createCsatRating(rating: InsertCsatRating): Promise<CsatRating>;
  getCsatRatingByConversation(conversationId: string): Promise<CsatRating | undefined>;
  getCsatRatingsByTenant(tenantId: string): Promise<CsatRating[]>;

  // Phase 8: Conversions
  createConversion(conversion: InsertConversion): Promise<Conversion>;
  getConversionByConversation(conversationId: string): Promise<Conversion | undefined>;
  getConversionsByTenant(tenantId: string): Promise<Conversion[]>;

  // Phase 8.3: Lost Deals
  createLostDeal(lostDeal: InsertLostDeal): Promise<LostDeal>;
  getLostDealByConversation(conversationId: string): Promise<LostDeal | undefined>;
  getLostDealsByTenant(tenantId: string): Promise<LostDeal[]>;

  // Metrics
  getCustomersCount(tenantId: string): Promise<number>;
  getCustomerNotesCount(tenantId: string): Promise<number>;
  getCustomerMemoryCount(tenantId: string): Promise<number>;

  // RAG Documents & Chunks
  createRagDocument(doc: InsertRagDocument): Promise<RagDocument>;
  createRagChunk(chunk: InsertRagChunk): Promise<RagChunk>;

  // RAG Cleanup
  deleteRagBySource(tenantId: string, sourceType: "PRODUCT" | "DOC", sourceId: string): Promise<{ deletedDocs: number }>;

  // RAG Embeddings
  updateRagChunkEmbedding(chunkId: string, embedding: number[]): Promise<boolean>;
  getRagChunksBySource(tenantId: string, sourceType: "PRODUCT" | "DOC", sourceId: string): Promise<{ id: string; chunkText: string; embedding: number[] | null }[]>;
  getRagChunksWithoutEmbedding(tenantId: string, limit?: number): Promise<{ id: string; chunkText: string }[]>;
  getRagChunksWithStaleHash(tenantId: string, limit?: number): Promise<{ id: string; chunkText: string; storedHash: string | null; currentHash: string }[]>;
  invalidateStaleEmbeddings(tenantId: string): Promise<{ invalidated: number }>;
  getAllRagChunksWithEmbedding(tenantId: string): Promise<{ id: string; chunkText: string; chunkIndex: number; embedding: string | null; metadata: unknown }[]>;

  // Update History
  getUpdateHistory(): Promise<UpdateHistory[]>;
  getUpdateById(id: string): Promise<UpdateHistory | undefined>;
  createUpdate(update: InsertUpdateHistory): Promise<UpdateHistory>;
  updateUpdateStatus(id: string, status: UpdateStatus, errorMessage?: string): Promise<UpdateHistory | undefined>;
  setUpdateBackupPath(id: string, backupPath: string): Promise<UpdateHistory | undefined>;
  getCurrentVersion(): Promise<string>;

  // Vehicle Lookup Cache
  getVehicleLookupCacheByKey(lookupKey: string): Promise<VehicleLookupCache | undefined>;
  upsertVehicleLookupCache(data: InsertVehicleLookupCache): Promise<VehicleLookupCache>;
  linkCaseToCache(caseId: string, cacheId: string): Promise<void>;

  // Vehicle Lookup Cases
  createVehicleLookupCase(data: InsertVehicleLookupCase): Promise<VehicleLookupCase>;
  getVehicleLookupCaseById(caseId: string): Promise<VehicleLookupCase | undefined>;
  getLatestVehicleLookupCaseByConversation(tenantId: string, conversationId: string): Promise<VehicleLookupCase | undefined>;
  findActiveVehicleLookupCase(tenantId: string, conversationId: string, normalizedValue: string): Promise<VehicleLookupCase | undefined>;
  updateVehicleLookupCaseStatus(
    caseId: string,
    patch: { status?: VehicleLookupCaseStatus; verificationStatus?: VehicleLookupVerificationStatus; error?: string | null; cacheId?: string | null }
  ): Promise<VehicleLookupCase | undefined>;

  // Price Snapshots
  createPriceSnapshot(data: InsertPriceSnapshot): Promise<PriceSnapshot>;
  // Global cache lookup — searches by OEM only, regardless of tenant.
  // Returns the most recent non-expired snapshot (expiresAt > now) for this OEM.
  getGlobalPriceSnapshot(oem: string): Promise<PriceSnapshot | null>;
  // Configurable-age global lookup used internally by getGlobalPriceSnapshot.
  getLatestPriceSnapshot(oem: string, maxAgeDays?: number): Promise<PriceSnapshot | undefined>;
  getPriceSnapshotsByOem(tenantId: string, oem: string, limit?: number): Promise<PriceSnapshot[]>;

  // Internal Prices
  upsertInternalPrice(data: InsertInternalPrice): Promise<InternalPrice>;
  getInternalPricesByOem(tenantId: string, oem: string): Promise<InternalPrice[]>;

  // Telegram Accounts (multi-account sessions)
  getTelegramAccountsByTenant(tenantId: string): Promise<TelegramSession[]>;
  getTelegramAccountById(id: string): Promise<TelegramSession | undefined>;
  getActiveTelegramAccounts(): Promise<TelegramSession[]>;
  createTelegramAccount(data: InsertTelegramSession): Promise<TelegramSession>;
  updateTelegramAccount(id: string, data: Partial<InsertTelegramSession>): Promise<TelegramSession | undefined>;
  deleteTelegramAccount(id: string): Promise<boolean>;

  // Message Templates
  getMessageTemplatesByTenant(tenantId: string): Promise<MessageTemplate[]>;
  getActiveMessageTemplateByType(tenantId: string, type: string): Promise<MessageTemplate | undefined>;
  getMessageTemplate(id: string): Promise<MessageTemplate | undefined>;
  createMessageTemplate(data: InsertMessageTemplate): Promise<MessageTemplate>;
  updateMessageTemplate(id: string, data: Partial<InsertMessageTemplate>): Promise<MessageTemplate | undefined>;
  deleteMessageTemplate(id: string): Promise<boolean>;
  seedDefaultTemplates(tenantId: string): Promise<void>;

  // Payment Methods
  getPaymentMethodsByTenant(tenantId: string): Promise<PaymentMethod[]>;
  getActivePaymentMethods(tenantId: string): Promise<PaymentMethod[]>;
  getPaymentMethod(id: string): Promise<PaymentMethod | undefined>;
  createPaymentMethod(data: InsertPaymentMethod): Promise<PaymentMethod>;
  updatePaymentMethod(id: string, data: Partial<InsertPaymentMethod>): Promise<PaymentMethod | undefined>;
  deletePaymentMethod(id: string): Promise<boolean>;
  reorderPaymentMethods(tenantId: string, updates: Array<{ id: string; order: number }>): Promise<void>;

  // Tenant Agent Settings
  getTenantAgentSettings(tenantId: string): Promise<TenantAgentSettings | null>;
  upsertTenantAgentSettings(tenantId: string, data: Partial<InsertTenantAgentSettings>): Promise<TenantAgentSettings>;

  // Transmission Identity Cache
  getTransmissionIdentity(normalizedOem: string): Promise<TransmissionIdentityCache | undefined>;
  saveTransmissionIdentity(data: InsertTransmissionIdentityCache): Promise<TransmissionIdentityCache>;
  incrementTransmissionIdentityHit(normalizedOem: string): Promise<void>;

  // Price snapshot helpers for decision engine context injection
  getLatestVehicleLookupCase(conversationId: string): Promise<VehicleLookupCase | undefined>;
  getLatestPriceSnapshotForConversation(tenantId: string, conversationId: string): Promise<PriceSnapshot | undefined>;
}

import { DatabaseStorage } from "./database-storage";

// Use PostgreSQL storage for persistent data
export const storage = new DatabaseStorage();
