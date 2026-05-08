# AI Engine — Decision Engine, RAG, Few-Shot

> Файлы: `server/services/decision-engine.ts`, `rag-retrieval.ts`, `few-shot-builder.ts`, `embedding-service.ts`
> Актуально на май 2026.

---

## Обзор

AI-движок генерирует ответы на сообщения клиентов через OpenAI GPT-4o-mini. Основные компоненты:

1. **RAG Retrieval** — поиск релевантного контекста по базе знаний и товарам
2. **Few-Shot Builder** — подбор примеров из одобренных операторами ответов
3. **Decision Engine** — генерация ответа + классификация + self-check + autosend decision
4. **Human Delay Engine** — имитация человеческой задержки перед отправкой

---

## Decision Engine — основной поток

**Файл:** `server/services/decision-engine.ts`
**Функция:** `generateWithDecisionEngine(context: GenerationContext)`

```
1. Загрузить tenant_agent_settings из БД
   └─ company_facts, company_scripts, custom_system_prompt

2. RAG Retrieval (rag-retrieval.ts):
   a) Создать query embedding через OpenAI text-embedding-3-small
   b) Загрузить ВСЕ rag_chunks тенанта из PostgreSQL
   c) Cosine similarity для каждого чанка
   d) Отфильтровать < minSimilarity (default 0.5)
   e) Top-K products (default 5) + Top-K docs (default 3)
   f) Если product similarity < retrievalConfidenceThreshold (0.7) → fallback на docs

3. Few-Shot Builder (few-shot-builder.ts):
   a) SELECT ai_training_samples WHERE outcome IN ('APPROVED', 'EDITED')
      AND intent = текущий интент
      ORDER BY created_at DESC LIMIT N
   b) Если примеров мало → BUILTIN_FEW_SHOT_EXAMPLES (захардкожены в коде)
   c) Сформировать блок: "User: ... Assistant: ..."

4. Сформировать System Prompt:
   - Роль: "Ты AI-помощник по продажам..."
   - Язык и тональность из настроек тенанта
   - Факты о компании (company_facts)
   - Скрипты продаж (company_scripts)
   - Кастомный system prompt (если задан)
   - Контекст клиента (customer memory: предпочтения, частые темы)
   - RAG-контекст: отформатированные чанки
   - Few-shot примеры

5. Вызов OpenAI GPT-4o-mini:
   - model: "gpt-4o-mini"
   - response_format: { type: "json_object" }
   - Ответ: { reply_text, intent, intent_probability, questions_to_ask }

6. Self-Check (отдельный GPT-вызов):
   - Оценить черновик ответа: score 0-1, need_handoff, reasons, missing_fields
   - model: "gpt-4o-mini", max_completion_tokens: 256

7. Расчёт Confidence:
   - base = similarity * 0.4 + intentScore * 0.3 + selfCheckScore * 0.3
   - Применить Penalty codes (штрафы за отсутствие источников, конфликты и т.д.)
   - Итоговый confidence = clamp(base + sum(penalties), 0, 1)

8. Тройная блокировка Autosend:
   Lock 1: feature_flag AI_AUTOSEND_ENABLED = true
   Lock 2: tenant_agent_settings.autosendAllowed = true
   Lock 3: intent ∈ intentsAutosendAllowed AND intent ∉ intentsForceHandoff

9. Принять Decision:
   - confidence >= t_auto AND autosendEligible → AUTO_SEND
   - confidence < t_escalate → ESCALATE
   - иначе → NEED_APPROVAL

10. Вернуть SuggestionResponse
```

---

## RAG Retrieval

**Файл:** `server/services/rag-retrieval.ts`

### Конфигурация по умолчанию

```typescript
DEFAULT_CONFIG = {
  productTopK: 5,           // Топ-5 продуктов
  docTopK: 3,               // Топ-3 документа
  retrievalConfidenceThreshold: 0.7,  // Порог переключения на docs
  minSimilarity: 0.5,       // Минимальный порог similarity
}
```

### Алгоритм

```
1. Создать embedding запроса через OpenAI text-embedding-3-small
2. Загрузить ВСЕ rag_chunks тенанта из PostgreSQL (embedding IS NOT NULL)
3. Для каждого чанка: cosine_similarity(queryEmbedding, chunkEmbedding)
4. Отфильтровать < minSimilarity
5. Разделить на productChunks и docChunks
6. Сортировать по similarity DESC, взять Top-K
7. Если topProductSimilarity < threshold → usedDocFallback = true
```

### ⚠️ Архитектурное ограничение

Эмбеддинги хранятся как `TEXT` (JSON) в PostgreSQL, а не как `vector`. Cosine similarity считается в Node.js на **всех** чанках тенанта. При больших объёмах (>1000 чанков) это становится медленным. **Решение:** мигрировать на pgvector.

---

## Embedding Service

**Файл:** `server/services/embedding-service.ts`

- **Модель:** `text-embedding-3-small` (1536 dimensions)
- **API:** OpenAI Embeddings API
- **Batching:** поддерживается для массовой индексации
- **Доступность:** проверяется через `embeddingService.isAvailable()` (нужен OPENAI_API_KEY)

### RAG Indexer

**Файл:** `server/services/rag-indexer.ts`

- При создании/обновлении Product → автоматически создать/обновить rag_document + rag_chunks
- При создании/обновлении KnowledgeDoc → то же самое
- Чанкинг через `document-chunking-service.ts`

---

## Few-Shot Builder

**Файл:** `server/services/few-shot-builder.ts`

Формирует примеры для in-context learning:

```typescript
interface FewShotConfig {
  tenantId: string;
  intent: string;
  maxExamples: number;      // default 5
  maxTokensPerExample: number;
}
```

**Приоритет источников:**
1. `ai_training_samples` с outcome = APPROVED или EDITED (из БД тенанта)
2. `BUILTIN_FEW_SHOT_EXAMPLES` (захардкожены в decision-engine.ts)

---

## Self-Check

Отдельный GPT-вызов для проверки качества ответа.

**Промпт содержит:**
- Вопрос клиента
- Черновик ответа
- Топ-3 источника из RAG

**Возвращает:**
```json
{
  "self_check_score": 0.0-1.0,
  "need_handoff": true|false,
  "reasons": ["reason1"],
  "missing_fields": ["price", "availability"]
}
```

**Правила:**
- Низкий score если ответ придумывает данные не из источников
- Низкий score если отсутствует критичная информация (цена, наличие)
- `need_handoff = true` при скидках, жалобах, нестандартных запросах

---

## Human Delay Engine

**Файл:** `server/services/human-delay-engine.ts`

Имитирует человеческую задержку перед отправкой autosend-ответов.

**Профили задержки:**

| Профиль | baseMin | baseMax | typingSpeed | jitter |
|---------|---------|---------|-------------|--------|
| SHORT | 2000ms | 4000ms | 40 chars/s | 500ms |
| MEDIUM | 4000ms | 8000ms | 35 chars/s | 1000ms |
| LONG | 8000ms | 15000ms | 30 chars/s | 2000ms |

**Расчёт задержки:**
```
typingDelay = textLength / typingSpeed * 1000
baseDelay = random(baseMin, baseMax)
finalDelay = clamp(baseDelay + typingDelay + jitter, minDelayMs, maxDelayMs)
```

**Ночной режим** (вне рабочих часов):
- `AUTO_REPLY` — отправить авто-текст, не ждать
- `DELAY` — применить nightDelayMultiplier (default 3x)
- `DISABLE` — не отправлять

---

## AI Intents (классификация намерений)

| Интент | Описание |
|--------|----------|
| `price` | Вопрос о цене |
| `availability` | Вопрос о наличии |
| `shipping` | Вопрос о доставке |
| `return` | Вопрос о возврате |
| `discount` | Запрос скидки (force_handoff по умолчанию) |
| `complaint` | Жалоба (force_handoff по умолчанию) |
| `other` | Прочее |
| `photo_request` | Запрос фото |
| `price_objection` | Возражение по цене |
| `ready_to_buy` | Готов купить |
| `needs_manual_quote` | Нужен ручной расчёт |
| `invalid_vin` | Неверный VIN |
| `marking_provided` | Предоставлена маркировка КПП |
| `payment_blocked` | Проблема с оплатой |
| `warranty_question` | Вопрос о гарантии |
| `want_visit` | Хочет приехать |
| `what_included` | Что входит в комплект |
| `mileage_preference` | Предпочтение по пробегу |

**Vehicle lookup intents** (не для AI, для flow управления):
`vehicle_id_request`, `gearbox_tag_request`, `gearbox_tag_retry`

---

## Onboarding Templates

**Файл:** `server/services/onboarding-templates.ts`

На шаге KB онбординга GPT генерирует черновики базы знаний:

```
POST /api/onboarding/generate-templates
Body: { answers: { BUSINESS: {...}, POLICIES: {...} } }
→ GPT-4o-mini → [{ title, content, docType }]

POST /api/onboarding/apply-templates
→ Создать knowledge_docs + запустить RAG indexing
```

---

## Vehicle Data Extractor (GPT-based)

**Файл:** `server/services/vehicle-data-extractor.ts`

GPT-4o-mini извлекает `driveType` и `gearboxType` из rawData PartsAPI когда regex-парсинг не дал результата:

- Стоимость: ~50 токенов на вызов
- Вызывается только когда хотя бы одно значение null
- Кэшируется в `transmission_identity_cache`

---

## Observability

**Файл:** `server/services/observability/metrics.ts`

In-memory счётчики через `incr(metricName, labels)`:

- `price_search.yandex.query_count` — запросы к Yandex
- `price_search.confidence_level` — уровни confidence
- И другие метрики ценового поиска

⚠️ Метрики не экспортируются в Prometheus — хранятся только в памяти.
