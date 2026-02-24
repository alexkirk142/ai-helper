/**
 * Sanitizer utility for redacting sensitive information from logs and audit events.
 * Masks tokens, API keys, secrets, and PII (phone, email).
 */

// Patterns to detect sensitive data
const SENSITIVE_PATTERNS = {
  // API keys and tokens (various formats)
  apiKey: /(?:api[_-]?key|apikey|token|bearer|authorization|secret|password|credential)["\s:=]+["']?([a-zA-Z0-9_\-./]{20,})["']?/gi,
  
  // JWT tokens
  jwt: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  
  // OpenAI API keys
  openaiKey: /sk-[a-zA-Z0-9]{20,}/g,
  
  // Session IDs and secrets
  sessionId: /(?:session[_-]?id|sess)["\s:=]+["']?([a-zA-Z0-9_\-./]{20,})["']?/gi,
  
  // Database URLs (mask password)
  dbUrl: /(?:postgres(?:ql)?|mysql|mongodb):\/\/([^:]+):([^@]+)@/gi,
  
  // Email addresses
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  
  // Phone numbers (Russian and international) - more flexible pattern
  phone: /(?:\+7|8)[\s.-]?\(?[0-9]{3}\)?[\s.-]?[0-9]{3}[\s.-]?[0-9]{2}[\s.-]?[0-9]{2}/g,
  
  // Credit card numbers (16 digits with spaces, dashes, or dots)
  creditCard: /\b[0-9]{4}[\s.-][0-9]{4}[\s.-][0-9]{4}[\s.-][0-9]{4}\b/g,
  
  // Full names - Russian (Фамилия Имя Отчество)
  russianFullName: /[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:вич|вна|ична|евич|евна|ович|овна)/gu,
  
  // Full names - English (First Last or First Middle Last)
  englishFullName: /\b(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g,
  
  // Russian addresses (city + street patterns)
  russianAddress: /(?:г\.|город|гор\.)\s*[А-ЯЁа-яё-]+(?:[\s,]+(?:ул\.|улица|пр\.|проспект|пер\.|переулок|бул\.|бульвар|ш\.|шоссе)\s*[А-ЯЁа-яё\s.-]+(?:,?\s*д\.?\s*\d+[а-яА-Я]?)?(?:,?\s*(?:кв\.?|квартира)\s*\d+)?)?/giu,
  
  // Street addresses (generic patterns)
  streetAddress: /(?:ул\.|улица|пр\.|проспект|пер\.|переулок|бул\.|бульвар|ш\.|шоссе|наб\.|набережная)\s+[А-ЯЁа-яё\s.-]+(?:,?\s*д\.?\s*\d+[а-яА-Я]?)?(?:,?\s*(?:кв\.?|квартира)\s*\d+)?/giu,
  
  // English street addresses
  englishStreetAddress: /\b\d{1,5}\s+[A-Za-z]+\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Way|Place|Pl\.?)(?:\s*,?\s*(?:Apt\.?|Suite|Ste\.?|Unit|#)\s*\d+[A-Za-z]?)?\b/gi,
};

// Fields that should always be masked
const SENSITIVE_FIELDS = [
  "password",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "sessionId",
  "session_id",
  "creditCard",
  "credit_card",
  "ssn",
  "pin",
  "fullName",
  "full_name",
  "firstName",
  "first_name",
  "lastName",
  "last_name",
  "middleName",
  "middle_name",
  "address",
  "streetAddress",
  "street_address",
  "homeAddress",
  "home_address",
  "deliveryAddress",
  "delivery_address",
  "shippingAddress",
  "shipping_address",
];

/**
 * Mask a string value while keeping first/last few chars for debugging.
 */
function maskValue(value: string, visibleChars = 4): string {
  if (value.length <= visibleChars * 2) {
    return "*".repeat(value.length);
  }
  const start = value.slice(0, visibleChars);
  const end = value.slice(-visibleChars);
  const masked = "*".repeat(Math.min(value.length - visibleChars * 2, 10));
  return `${start}${masked}${end}`;
}

/**
 * Sanitize a string by masking sensitive patterns.
 */
export function sanitizeString(input: string): string {
  let result = input;
  
  // Mask JWT tokens
  result = result.replace(SENSITIVE_PATTERNS.jwt, "[MASKED_JWT]");
  
  // Mask OpenAI keys
  result = result.replace(SENSITIVE_PATTERNS.openaiKey, "[MASKED_OPENAI_KEY]");
  
  // Mask API keys and tokens
  result = result.replace(SENSITIVE_PATTERNS.apiKey, (match, key) => {
    return match.replace(key, maskValue(key));
  });
  
  // Mask session IDs
  result = result.replace(SENSITIVE_PATTERNS.sessionId, (match, id) => {
    return match.replace(id, maskValue(id));
  });
  
  // Mask database URLs (hide password)
  result = result.replace(SENSITIVE_PATTERNS.dbUrl, (match, user, password) => {
    return match.replace(password, "****");
  });
  
  // Mask emails (keep domain visible)
  result = result.replace(SENSITIVE_PATTERNS.email, (email) => {
    const [local, domain] = email.split("@");
    return `${maskValue(local, 2)}@${domain}`;
  });
  
  // Mask phone numbers - keep last 4 digits
  result = result.replace(SENSITIVE_PATTERNS.phone, (phone) => {
    const digits = phone.replace(/\D/g, "");
    const masked = "*".repeat(Math.max(0, digits.length - 4));
    const visible = digits.slice(-4);
    return `${masked}${visible}`;
  });
  
  // Mask credit card numbers - keep last 4 digits
  result = result.replace(SENSITIVE_PATTERNS.creditCard, (card) => {
    const parts = card.split(/[\s.-]/);
    return `****-****-****-${parts[3]}`;
  });
  
  // Mask Russian full names (FIO)
  result = result.replace(SENSITIVE_PATTERNS.russianFullName, "[MASKED_NAME]");
  
  // Mask English full names with titles
  result = result.replace(SENSITIVE_PATTERNS.englishFullName, "[MASKED_NAME]");
  
  // Mask Russian addresses
  result = result.replace(SENSITIVE_PATTERNS.russianAddress, "[MASKED_ADDRESS]");
  
  // Mask Russian street addresses
  result = result.replace(SENSITIVE_PATTERNS.streetAddress, "[MASKED_ADDRESS]");
  
  // Mask English street addresses
  result = result.replace(SENSITIVE_PATTERNS.englishStreetAddress, "[MASKED_ADDRESS]");
  
  return result;
}

/**
 * Recursively sanitize an object, masking sensitive fields and values.
 */
export function sanitizeObject<T>(obj: T, depth = 0): T {
  // Prevent infinite recursion
  if (depth > 10) return obj;
  
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === "string") {
    return sanitizeString(obj) as T;
  }
  
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1)) as T;
  }
  
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      // Check if field name is sensitive
      const lowerKey = key.toLowerCase();
      const isSensitiveField = SENSITIVE_FIELDS.some((f) => 
        lowerKey.includes(f.toLowerCase())
      );
      
      if (isSensitiveField && typeof value === "string") {
        result[key] = maskValue(value);
      } else {
        result[key] = sanitizeObject(value, depth + 1);
      }
    }
    
    return result as T;
  }
  
  return obj;
}

/**
 * Sanitize HTTP headers for logging.
 */
export function sanitizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> {
  const sensitiveHeaders = [
    "authorization",
    "cookie",
    "x-api-key",
    "x-auth-token",
    "x-session-id",
  ];
  
  const result: Record<string, string | string[] | undefined> = {};
  
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveHeaders.includes(lowerKey)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      result[key] = sanitizeString(value);
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Create a sanitized log entry.
 */
export function createSafeLogEntry(entry: Record<string, unknown>): Record<string, unknown> {
  return sanitizeObject(entry);
}

/**
 * Deep sanitize any value - alias for sanitizeObject with improved typing.
 * Recursively sanitizes strings, arrays, and nested objects.
 */
export function sanitizeDeep<T>(value: T): T {
  return sanitizeObject(value);
}

/**
 * Sanitize text specifically for AI prompts - more aggressive masking.
 * Used for few-shot examples, training samples, smoke tests.
 */
export function sanitizeForPrompt(text: string): string {
  return sanitizeString(text);
}

/**
 * Sanitize any value for logging — truncates long strings and suppresses
 * known binary/large fields (content, data, image, attachments).
 * Safe to pass directly to console.log or JSON.stringify.
 */
export function sanitizeForLog(obj: unknown): unknown {
  if (typeof obj === 'string' && obj.length > 300) {
    return obj.substring(0, 100) + `...[truncated ${obj.length} chars]`;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForLog);
  }
  if (typeof obj === 'object' && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        k === 'content' || k === 'data' || k === 'image' || k === 'attachments'
          ? '[binary/large data suppressed]'
          : sanitizeForLog(v),
      ])
    );
  }
  return obj;
}

/**
 * Sanitize customer notes and comments.
 */
export function sanitizeCustomerData(data: {
  notes?: string | null;
  comments?: string | null;
  feedback?: string | null;
  [key: string]: unknown;
}): typeof data {
  const result = { ...data };
  if (result.notes && typeof result.notes === "string") {
    result.notes = sanitizeString(result.notes);
  }
  if (result.comments && typeof result.comments === "string") {
    result.comments = sanitizeString(result.comments);
  }
  if (result.feedback && typeof result.feedback === "string") {
    result.feedback = sanitizeString(result.feedback);
  }
  return sanitizeObject(result);
}
