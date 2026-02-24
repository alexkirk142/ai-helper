import type { Request, Response, NextFunction } from "express";
import { z, ZodSchema } from "zod";

// ============ PAYLOAD SIZE LIMITS ============

export const PAYLOAD_LIMITS = {
  // General limits
  MAX_BODY_SIZE: 2 * 1024 * 1024, // 2MB
  
  // Message limits
  MAX_MESSAGE_LENGTH: 4000, // 4000 characters
  MAX_ATTACHMENT_METADATA_SIZE: 10 * 1024, // 10KB per attachment
  MAX_ATTACHMENTS_COUNT: 10,
  
  // Product/knowledge limits
  MAX_PRODUCT_DESCRIPTION: 10000,
  MAX_KNOWLEDGE_DOC_CONTENT: 50000,
  
  // Escalation limits
  MAX_ESCALATION_SUMMARY: 2000,
  MAX_ESCALATION_REASON: 500,
};

// ============ VALIDATION SCHEMAS ============

// Message validation
export const messageBodySchema = z.object({
  content: z.string()
    .min(1, "Message content is required")
    .max(PAYLOAD_LIMITS.MAX_MESSAGE_LENGTH, `Message cannot exceed ${PAYLOAD_LIMITS.MAX_MESSAGE_LENGTH} characters`),
  role: z.enum(["customer", "assistant", "owner"]).optional().default("owner"),
  attachments: z.array(z.object({
    type: z.string().max(50),
    url: z.string().url().max(2048),
    metadata: z.record(z.unknown()).optional(),
  })).max(PAYLOAD_LIMITS.MAX_ATTACHMENTS_COUNT).optional(),
});

// AI suggestion edit validation
export const editSuggestionSchema = z.object({
  editedText: z.string()
    .min(1, "Edited text is required")
    .max(PAYLOAD_LIMITS.MAX_MESSAGE_LENGTH, `Edited text cannot exceed ${PAYLOAD_LIMITS.MAX_MESSAGE_LENGTH} characters`),
});

// AI suggestion reject validation
export const rejectSuggestionSchema = z.object({
  reason: z.string()
    .max(500, "Reason cannot exceed 500 characters")
    .optional(),
});

// Escalation update validation
export const updateEscalationSchema = z.object({
  status: z.enum(["pending", "handled", "dismissed"]),
  handledBy: z.string().max(100).optional(),
});

// Feature flag toggle validation
export const toggleFeatureFlagSchema = z.object({
  enabled: z.boolean(),
  tenantId: z.string().uuid().optional(),
});

// Product validation
export const productBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(PAYLOAD_LIMITS.MAX_PRODUCT_DESCRIPTION).optional(),
  sku: z.string().max(50).optional(),
  price: z.number().min(0).optional(),
  currency: z.string().length(3).default("RUB"),
  inStock: z.boolean().default(true),
  category: z.string().max(100).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Tenant settings update — only user-editable fields, no security-sensitive fields
// Explicitly excludes: id, status (fraud prevention), createdAt
export const patchTenantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  language: z.string().max(10).optional(),
  tone: z.enum(["formal", "friendly"]).optional(),
  addressStyle: z.enum(["vy", "ty"]).optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().max(50).optional(),
  workingHoursStart: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format").optional(),
  workingHoursEnd: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format").optional(),
  workingDays: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).optional(),
  autoReplyOutsideHours: z.boolean().optional(),
  escalationEmail: z.string().email().max(254).nullable().optional(),
  escalationTelegram: z.string().max(100).nullable().optional(),
  allowDiscounts: z.boolean().optional(),
  maxDiscountPercent: z.number().int().min(0).max(100).optional(),
  templates: z.record(z.string()).optional(),
});

// Knowledge doc validation
export const knowledgeDocBodySchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string()
    .min(1)
    .max(PAYLOAD_LIMITS.MAX_KNOWLEDGE_DOC_CONTENT, `Content cannot exceed ${PAYLOAD_LIMITS.MAX_KNOWLEDGE_DOC_CONTENT} characters`),
  category: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

// ============ VALIDATION MIDDLEWARE ============

/**
 * Create validation middleware for a Zod schema.
 * Returns 400 with detailed error if validation fails.
 */
export function validateBody<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    
    if (!result.success) {
      res.status(400).json({
        error: "Validation error",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
        requestId: req.requestId,
      });
      return;
    }
    
    // Replace body with validated data (with defaults applied)
    req.body = result.data;
    next();
  };
}

/**
 * Middleware to check body size before parsing.
 * Use with express.json({ limit }) for enforcement.
 */
export function checkBodySize(maxSize: number = PAYLOAD_LIMITS.MAX_BODY_SIZE) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    
    if (contentLength > maxSize) {
      res.status(413).json({
        error: "Payload too large",
        message: `Request body exceeds maximum size of ${Math.round(maxSize / 1024)}KB`,
        maxSize,
        actualSize: contentLength,
        requestId: req.requestId,
      });
      return;
    }
    
    next();
  };
}

/**
 * Validate query parameters.
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    
    if (!result.success) {
      res.status(400).json({
        error: "Invalid query parameters",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
        requestId: req.requestId,
      });
      return;
    }
    
    req.query = result.data;
    next();
  };
}

/**
 * Validate path parameters.
 */
export function validateParams<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    
    if (!result.success) {
      res.status(400).json({
        error: "Invalid path parameters",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
        requestId: req.requestId,
      });
      return;
    }
    
    next();
  };
}
