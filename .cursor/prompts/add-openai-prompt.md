# Add / Modify OpenAI Prompt

## Before making changes

1. Read all existing AI-related files (listed below)
2. Understand current prompt structure — all prompts use JSON response format
3. Check token usage — `gpt-4o-mini` has 128K context, `text-embedding-3-large` for embeddings
4. Understand context assembly — RAG chunks + products + docs + customer memory + few-shot examples

## Steps

1. **Define the prompt template** — system prompt with clear rules and JSON output format
2. **Add necessary context variables** — tenant settings, conversation history, RAG results
3. **Specify JSON response format** — use `response_format: { type: "json_object" }`
4. **Handle response parsing** — always wrap `JSON.parse()` in try/catch with fallback
5. **Add error handling** for API failures (rate limits, timeout, invalid response)
6. **Consider token limits** — `max_completion_tokens: 1024` for replies, estimate input tokens
7. **Test with various inputs** — empty context, long conversations, edge cases

## OpenAI client initialization

```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "sk-placeholder",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
});
```

## Models used in the project

| Purpose | Model | File |
|---------|-------|------|
| Decision engine (replies) | `gpt-4o-mini` | `server/services/decision-engine.ts` |
| Self-check validation | `gpt-4o-mini` | `server/services/decision-engine.ts` |
| Customer summaries | `gpt-4o-mini` | `server/services/customer-summary-service.ts` |
| Onboarding templates | `gpt-4o` | `server/services/onboarding-templates.ts` |
| Embeddings (RAG) | `text-embedding-3-large` (3072 dims) | `server/services/embedding-service.ts` |

## Prompt template pattern

```typescript
const systemPrompt = `You are a [role] for "${context.tenant.name}".

RULES:
1. [Rule 1]
2. [Rule 2]
3. NEVER make up information not in the provided context.

${contextBlock ? "CONTEXT:\n" + contextBlock : "No context available."}

Respond ONLY with a JSON object in this exact format:
{
  "field_1": "string value",
  "field_2": 0.0-1.0,
  "field_3": ["optional", "array"]
}`;
```

## API call pattern

```typescript
const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: systemPrompt },
    ...conversationHistory,  // { role: "user" | "assistant", content: string }[]
  ],
  response_format: { type: "json_object" },
  max_completion_tokens: 1024,
});
```

## Response parsing pattern (ALWAYS use this)

```typescript
const responseContent = response.choices[0]?.message?.content || "{}";
let parsed;
try {
  parsed = JSON.parse(responseContent);
} catch {
  parsed = {
    // Sensible defaults — never crash on parse failure
    reply_text: "Could not generate a response. Please try again.",
    intent: "other",
    confidence: 0.5,
  };
}

// Validate and clamp numeric fields
const score = Math.max(0, Math.min(1, parsed.score || 0.5));

// Validate enum fields against known values
const intent = VALID_INTENTS.includes(parsed.intent) ? parsed.intent : "other";

// Validate arrays
const items = Array.isArray(parsed.items) ? parsed.items : [];
```

## Context assembly helpers

### RAG retrieval
```typescript
import { retrieveContext, formatContextForPrompt } from "./rag-retrieval";

const ragResult = await retrieveContext(tenantId, customerMessage, { topK: 5 });
const contextBlock = formatContextForPrompt(ragResult);
```

### Few-shot examples
```typescript
import { selectFewShotExamples, buildFewShotPromptBlock } from "./few-shot-builder";

const examples = await selectFewShotExamples(tenantId, customerMessage, { maxExamples: 5 });
const { promptBlock, totalTokens } = buildFewShotPromptBlock(examples, maxTokens);
```

### Customer context
```typescript
import { buildCustomerContextBlock } from "./decision-engine";

const customerBlock = buildCustomerContextBlock(customerMemory);
// Returns: "CUSTOMER CONTEXT:\n- Preferences: ...\n- Frequent topics: ..."
```

### Token estimation
```typescript
const TOKENS_PER_CHAR = 0.25;
function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}
```

## Environment variables

```bash
# Primary (preferred)
AI_INTEGRATIONS_OPENAI_API_KEY=sk-...
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1

# Fallback
OPENAI_API_KEY=sk-...
```

## Files to check

### Core AI files
- `server/services/decision-engine.ts` — main decision engine, reply generation, confidence scoring, self-check
- `server/services/embedding-service.ts` — OpenAI embeddings for RAG (`text-embedding-3-large`, 3072 dims)
- `server/services/customer-summary-service.ts` — customer summary generation from conversation history
- `server/services/onboarding-templates.ts` — AI-generated policy/FAQ/greeting templates

### RAG pipeline
- `server/services/rag-retrieval.ts` — retrieves relevant chunks by embedding similarity
- `server/services/rag-indexer.ts` — indexes products and knowledge docs into RAG chunks
- `server/services/document-chunking-service.ts` — splits documents into chunks for embedding

### Learning
- `server/services/few-shot-builder.ts` — builds few-shot examples from approved human actions
- `server/services/training-sample-service.ts` — manages training samples for fine-tuning
- `server/services/learning-score-service.ts` — learning quality scoring

### Message handling
- `server/services/inbound-message-handler.ts` — triggers AI suggestion generation on new messages

### Types
- `shared/schema.ts` — `DecisionSettings`, `IntentType`, `Penalty`, `ConfidenceBreakdown`, `SuggestionResponse`, `INTENT_TYPES`, `PENALTY_CODES`
