import { db } from "../db";
import { 
  customers, 
  customerMemory, 
  customerNotes, 
  conversations, 
  messages,
  aiSuggestions,
  humanActions,
  aiTrainingSamples,
  csatRatings,
  conversions,
  lostDeals
} from "@shared/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { auditLog } from "./audit-log";

export interface DeletionResult {
  success: boolean;
  customerId: string;
  tenantId: string;
  deletedEntities: {
    customers: number;
    customerMemory: number;
    customerNotes: number;
    conversations: number;
    messages: number;
    aiSuggestions: number;
    humanActions: number;
    aiTrainingSamples: number;
    csatRatings: number;
    conversions: number;
    lostDeals: number;
  };
  deletedAt: string;
}

async function tableExists(tx: any, tableName: string): Promise<boolean> {
  try {
    const result = await tx.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = ${tableName}
      )
    `);
    return (result.rows[0] as any)?.exists === true;
  } catch {
    return false;
  }
}

export async function deleteCustomerData(
  customerId: string,
  tenantId: string,
  requestedBy: string
): Promise<DeletionResult> {
  const deletedEntities = {
    customers: 0,
    customerMemory: 0,
    customerNotes: 0,
    conversations: 0,
    messages: 0,
    aiSuggestions: 0,
    humanActions: 0,
    aiTrainingSamples: 0,
    csatRatings: 0,
    conversions: 0,
    lostDeals: 0,
  };

  await db.transaction(async (tx) => {
    const customerRecord = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);

    if (customerRecord.length === 0) {
      return;
    }

    const customerTenantCheck = await tx
      .select({ tenantId: customers.tenantId })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);

    if (customerTenantCheck.length > 0 && customerTenantCheck[0].tenantId !== tenantId) {
      throw new Error("TENANT_MISMATCH");
    }

    const customerConversations = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.customerId, customerId));

    const conversationIds = customerConversations.map(c => c.id);

    if (conversationIds.length > 0) {
      const suggestionRecords = await tx
        .select({ id: aiSuggestions.id })
        .from(aiSuggestions)
        .where(inArray(aiSuggestions.conversationId, conversationIds));

      const suggestionIds = suggestionRecords.map(s => s.id);

      if (suggestionIds.length > 0) {
        const humanActionsResult = await tx
          .delete(humanActions)
          .where(inArray(humanActions.suggestionId, suggestionIds));
        deletedEntities.humanActions = humanActionsResult.rowCount ?? 0;
      }

      const suggestionsResult = await tx
        .delete(aiSuggestions)
        .where(inArray(aiSuggestions.conversationId, conversationIds));
      deletedEntities.aiSuggestions = suggestionsResult.rowCount ?? 0;

      const messagesResult = await tx
        .delete(messages)
        .where(inArray(messages.conversationId, conversationIds));
      deletedEntities.messages = messagesResult.rowCount ?? 0;

      if (await tableExists(tx, "ai_training_samples")) {
        const trainingSamplesResult = await tx
          .delete(aiTrainingSamples)
          .where(inArray(aiTrainingSamples.conversationId, conversationIds));
        deletedEntities.aiTrainingSamples = trainingSamplesResult.rowCount ?? 0;
      }

      if (await tableExists(tx, "csat_ratings")) {
        const csatResult = await tx
          .delete(csatRatings)
          .where(inArray(csatRatings.conversationId, conversationIds));
        deletedEntities.csatRatings = csatResult.rowCount ?? 0;
      }

      if (await tableExists(tx, "conversions")) {
        const conversionsResult = await tx
          .delete(conversions)
          .where(inArray(conversions.conversationId, conversationIds));
        deletedEntities.conversions = conversionsResult.rowCount ?? 0;
      }

      if (await tableExists(tx, "lost_deals")) {
        const lostDealsResult = await tx
          .delete(lostDeals)
          .where(inArray(lostDeals.conversationId, conversationIds));
        deletedEntities.lostDeals = lostDealsResult.rowCount ?? 0;
      }

      const conversationsResult = await tx
        .delete(conversations)
        .where(eq(conversations.customerId, customerId));
      deletedEntities.conversations = conversationsResult.rowCount ?? 0;
    }

    const memoryResult = await tx
      .delete(customerMemory)
      .where(eq(customerMemory.customerId, customerId));
    deletedEntities.customerMemory = memoryResult.rowCount ?? 0;

    const notesResult = await tx
      .delete(customerNotes)
      .where(eq(customerNotes.customerId, customerId));
    deletedEntities.customerNotes = notesResult.rowCount ?? 0;

    const customersResult = await tx
      .delete(customers)
      .where(eq(customers.id, customerId));
    deletedEntities.customers = customersResult.rowCount ?? 0;
  });

  const deletedAt = new Date().toISOString();

  await auditLog.log(
    "customer_data_deleted",
    "customer",
    customerId,
    requestedBy,
    "user",
    {
      tenantId,
      deletedEntities,
      deletedAt,
    }
  );

  return {
    success: true,
    customerId,
    tenantId,
    deletedEntities,
    deletedAt,
  };
}
