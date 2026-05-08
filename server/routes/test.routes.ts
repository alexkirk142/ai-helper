import { Router, type Request, type Response } from "express";
import { requireAuth, requireTenant } from "../middleware/rbac";
import { requirePlatformAdmin } from "../middleware/platform-admin";
import { storage } from "../storage";

const testRouter = Router();

/**
 * POST /api/test/simulate-message
 *
 * Non-production only. Injects a synthetic inbound message through the full
 * inbound-message-handler pipeline so developers/QA can trigger AI responses
 * without a real channel integration.
 */
testRouter.post(
  "/api/test/simulate-message",
  requireAuth,
  requirePlatformAdmin(),
  requireTenant,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      const {
        customerName,
        customerPhone,
        message,
        imageBase64,
        imageMimeType,
        conversationId,
      } = req.body as {
        customerName?: string;
        customerPhone?: string;
        message?: string;
        imageBase64?: string;
        imageMimeType?: string;
        conversationId?: string;
      };

      let resolvedName: string;
      let resolvedPhone: string;

      if (conversationId) {
        const existingConv = await storage.getConversationWithCustomer(
          conversationId,
          req.tenantId!
        );
        if (!existingConv || existingConv.tenantId !== req.tenantId!) {
          return res.status(404).json({ error: "Conversation not found" });
        }
        if (!existingConv.customer?.phone) {
          return res
            .status(400)
            .json({ error: "Customer phone not found for this conversation" });
        }
        if (!message && !imageBase64) {
          return res
            .status(400)
            .json({ error: "Missing required field: message or image" });
        }
        resolvedName = existingConv.customer.name || "Test Customer";
        resolvedPhone = existingConv.customer.phone;
      } else {
        if (!customerName || !customerPhone || (!message && !imageBase64)) {
          return res.status(400).json({
            error:
              "Missing required fields: customerName, customerPhone, and message or image",
          });
        }
        resolvedName = customerName;
        resolvedPhone = customerPhone;
      }

      const externalUserId =
        resolvedPhone.replace(/\D/g, "") || `test_${Date.now()}`;

      const { processIncomingMessageFull } = await import(
        "../services/inbound-message-handler"
      );

      const parsed = {
        externalMessageId: `test_${Date.now()}_${Math.random()
          .toString(36)
          .substring(7)}`,
        externalConversationId: externalUserId,
        externalUserId,
        text: message || "",
        timestamp: new Date(),
        channel: "mock" as const,
        metadata: {
          firstName: resolvedName,
          phone: resolvedPhone,
        },
        attachments: imageBase64
          ? [
              {
                type: "image" as const,
                url: `data:${imageMimeType || "image/jpeg"};base64,${imageBase64}`,
                mimeType: imageMimeType || "image/jpeg",
              },
            ]
          : undefined,
      };

      await processIncomingMessageFull(req.tenantId!, parsed);

      const customer = await storage.getCustomerByExternalId(
        req.tenantId!,
        "mock",
        externalUserId
      );
      if (!customer) {
        return res.status(500).json({ error: "Customer was not created" });
      }

      const allConversations = await storage.getConversationsByTenant(
        user.tenantId
      );
      const conv = allConversations.find(
        (c) =>
          c.customerId === customer.id &&
          (c.status === "active" || c.status === "pending")
      );

      const conversation = conv
        ? await storage.getConversationWithCustomer(conv.id, user.tenantId)
        : null;

      console.log(
        `[TestEndpoint] Simulated message for tenant ${user.tenantId}, customer ${customer.id}`
      );
      res.json({ success: true, conversation, customer });
    } catch (error: any) {
      console.error("[TestEndpoint] simulate-message error:", error);
      res.status(500).json({ error: error.message || "Failed to simulate message" });
    }
  }
);

export default testRouter;
