# AI Per-Tenant Learning — План доработки

> **Документ для агента-исполнителя.**
> Реализуй последовательно через суб-агентов. Каждый этап — отдельный суб-агент.
> После каждого этапа фиксируй результат в секции «Статус» ниже.

---

## Контекст: текущая архитектура AI

### Модели
- Генерация ответа: `gpt-4o-mini`
- Self-check: `gpt-4o-mini` (второй вызов)
- Эмбеддинги: `text-embedding-3-large`, 3072 измерений

### Ключевые файлы (трогать строго по этапам)

```
server/services/decision-engine.ts          ← главный AI-движок
server/services/embedding-service.ts        ← createEmbedding / createEmbeddings
server/services/rag-indexer.ts              ← indexProduct / indexDocument
server/services/rag-retrieval.ts            ← retrieveContext (cosine similarity)
server/services/few-shot-builder.ts         ← selectFewShotExamples (per-tenant)
server/services/training-sample-service.ts  ← recordTrainingSample
server/services/customer-summary-service.ts ← generateCustomerSummary
server/services/inbound-message-handler.ts  ← triggerAiSuggestion (точка входа)
server/services/learning-score-service.ts   ← addToLearningQueue
server/routes/suggestion.routes.ts          ← approve / edit / reject
shared/schema.ts                            ← все типы и таблицы
server/database-storage.ts                  ← реализация storage методов
```

### Таблицы БД (всегда per-tenant — tenantId везде)

```
ai_training_samples    userMessage, aiSuggestion, finalAnswer, intent, decision, outcome, tenantId
ai_training_policies   alwaysEscalateIntents, forbiddenTopics, disabledLearningIntents
learning_queue         learningScore, reasons, status, tenantId
rag_documents          type (PRODUCT|DOC), sourceId, content, tenantId
rag_chunks             ragDocumentId, chunkText, embedding, tenantId
customer_memory        lastSummaryText, frequentTopics, preferences, tenantId
ai_suggestions         decision, confidence, intent, penalties, tenantId
conversations          status (active|pending|resolved|escalated), tenantId
messages               role (customer|assistant), conversationId, content
```

### Как сейчас работает обучение (кратко)

```
Входящее сообщение
  → processIncomingMessageFull (inbound-message-handler.ts)
  → triggerAiSuggestion
  → generateWithDecisionEngine:
      1. RAG retrieval (cosine по rag_chunks)
      2. Few-shot из ai_training_samples тенанта (max 8, EDITED > APPROVED)
      3. gpt-4o-mini → JSON {reply_text, intent, intent_probability}
      4. Self-check (второй gpt-4o-mini)
      5. Scoring: similarity(45%) + intent(25%) + selfCheck(30%) − penalties
      6. Decision: AUTO_SEND / NEED_APPROVAL / ESCALATE
  → createAiSuggestion → UI оператора
  → Оператор approve/edit/reject
  → recordTrainingSample → ai_training_samples
  → addToLearningQueue → learning_queue
```

### Главные пробелы

| Пробел | Последствие |
|--------|-------------|
| Embeddings хранятся как TEXT, cosine similarity в Node.js | Все чанки грузятся в RAM на каждый запрос; >500 чанков = тормоза |
| Операторские ответы без AI suggestion не сохраняются | Богатейший обучающий материал теряется |
| learning_queue не обрабатывается воркером | Очередь копится, никого не обучает |
| Закрытые диалоги не индексируются в RAG | Похожие кейсы не используются как контекст |
| outcome="OPERATOR_MANUAL" не существует | Few-shot не видит "золотые" примеры оператора |

---

## Этап 0 — Миграция RAG на pgvector ⚡ (выполнить ПЕРВЫМ)

### Суб-агент: `database-specialist`

### Почему этот этап нулевой
Сейчас `rag-retrieval.ts` делает так:
```typescript
const allChunks = await storage.getAllRagChunksWithEmbedding(filter.tenantId);
// ... затем cosine similarity в JavaScript для КАЖДОГО чанка
```
При 500+ чанках — это сотни МБ RAM и сотни мс на каждый входящий запрос.
Этап 3 (индексация диалогов) создаст ещё больше чанков, что сделает проблему критической.
Решение — перенести similarity search в PostgreSQL через pgvector.

**Зафиксировано в:** `docs/AUDIT_2026_05.md` (PERF-01), `docs/AI_ENGINE.md` (⚠️ Архитектурное ограничение)

### Точные файлы для изменения

1. **`migrations/XXXX_pgvector.sql`** — НОВЫЙ ФАЙЛ (миграция)
   ```sql
   -- Включить расширение
   CREATE EXTENSION IF NOT EXISTS vector;

   -- Добавить векторный столбец (3072 = text-embedding-3-large)
   ALTER TABLE rag_chunks ADD COLUMN IF NOT EXISTS embedding_vector vector(3072);

   -- Заполнить из существующего TEXT-поля
   UPDATE rag_chunks
   SET embedding_vector = embedding::vector
   WHERE embedding IS NOT NULL AND embedding_vector IS NULL;

   -- Индекс для приближённого поиска (HNSW быстрее IVFFlat при < 1M строк)
   CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding_vector
     ON rag_chunks USING hnsw (embedding_vector vector_cosine_ops)
     WITH (m = 16, ef_construction = 64);
   ```
   > **Примечание по `m` и `ef_construction`**: дефолтные значения хорошо подходят до ~500k строк.
   > Старый TEXT-столбец `embedding` не удалять — оставить как fallback до полной проверки.

2. **`shared/schema.ts`** — добавить поле `embeddingVector` в таблицу `ragChunks`
   ```typescript
   // Найти pgTable("rag_chunks", { ... })
   // Добавить новое поле используя drizzle-orm/pg-core:
   // embeddingVector: customType или text с именем "embedding_vector"
   // Drizzle пока не имеет встроенного vector-типа, поэтому:
   import { customType } from "drizzle-orm/pg-core";
   const vector = customType<{ data: number[]; driverData: string }>({
     dataType(config) { return `vector(${config?.dimensions ?? 3072})`; },
     toDriver(value) { return JSON.stringify(value); },
     fromDriver(value) { return JSON.parse(value as string); },
   });
   // embeddingVector: vector("embedding_vector", { dimensions: 3072 })
   ```

3. **`server/database-storage.ts`** — добавить метод `searchRagChunksBySimilarity`
   ```typescript
   async searchRagChunksBySimilarity(
     tenantId: string,
     queryEmbedding: number[],
     topK: number,
     minSimilarity: number
   ): Promise<RagChunkWithSimilarity[]> {
     // SQL: SELECT *, 1 - (embedding_vector <=> $1::vector) as similarity
     //      FROM rag_chunks
     //      WHERE tenant_id = $2
     //        AND 1 - (embedding_vector <=> $1::vector) >= $3
     //      ORDER BY embedding_vector <=> $1::vector
     //      LIMIT $4
     // Использовать db.execute(sql`...`) если Drizzle не поддерживает <=> оператор напрямую
   }
   ```

4. **`server/services/rag-retrieval.ts`** — заменить in-memory поиск на DB-запрос
   - Функция `retrieveContext`:
     - Убрать: `await storage.getAllRagChunksWithEmbedding(filter.tenantId)`
     - Убрать: цикл с `cosineSimilarity(queryEmbedding, embedding)`
     - Добавить: `await storage.searchRagChunksBySimilarity(tenantId, queryEmbedding, topK, minSimilarity)`
   - Функцию `cosineSimilarity` оставить (используется в тестах), но убрать из основного пути

5. **`server/database-storage.ts`** — метод `getAllRagChunksWithEmbedding`
   - **Не удалять** — используется в тестах
   - Пометить как `@deprecated` в JSDoc

### ⚠️ Важно при миграции
- pgvector должен быть установлен на сервере PostgreSQL: `CREATE EXTENSION vector` требует superuser или права на расширение
- Если PostgreSQL управляется через Supabase/Neon/Railway — расширение там уже доступно
- Если self-hosted — установить: `apt install postgresql-16-pgvector` (или нужную версию)
- Проверить до запуска миграции: `SELECT * FROM pg_available_extensions WHERE name = 'vector';`

### Параметры топ-K (после миграции)
```typescript
// rag-retrieval.ts DEFAULT_CONFIG — оставить без изменений:
productTopK: 5,
docTopK: 3,
// Новый параметр для CONVERSATION чанков (Этап 3):
conversationTopK: 3,
```

### Критерии готовности
- [ ] `CREATE EXTENSION vector` выполнен без ошибок
- [ ] Столбец `embedding_vector vector(3072)` существует в таблице `rag_chunks`
- [ ] Индекс HNSW создан
- [ ] Данные из `embedding` (TEXT) скопированы в `embedding_vector`
- [ ] `searchRagChunksBySimilarity` работает и возвращает правильные результаты
- [ ] `rag-retrieval.ts` больше не загружает все чанки в память
- [ ] Существующие тесты `rag-retrieval.test.ts` и `rag-integration.test.ts` не сломаны
- [ ] `npm run build` без ошибок

---

## Этап 1 — Auto-Harvest операторских ответов

### Суб-агент: `backend-developer`

### Цель
Когда оператор пишет сообщение сам (без AI suggestion), это самый ценный обучающий сигнал.
Сейчас он полностью теряется. Нужно его перехватывать и сохранять.

### Точные файлы для изменения

1. **`shared/schema.ts`** — добавить `"OPERATOR_MANUAL"` в union type `TrainingOutcome`
   - Найти: `export type TrainingOutcome` или `outcome` в `aiTrainingSamples`
   - Добавить новое значение в массив/enum

2. **`server/services/training-sample-service.ts`** — принять новый outcome
   - Функция `recordTrainingSample` — убедиться что `"OPERATOR_MANUAL"` не фильтруется

3. **`server/services/few-shot-builder.ts`** — поднять приоритет "OPERATOR_MANUAL"
   - Функция `scoreExample`: добавить кейс `if (sample.outcome === "OPERATOR_MANUAL") score += 0.7`
   - Функция `isHighConfidence`: добавить `if (sample.outcome === "OPERATOR_MANUAL") return true`

4. **`server/routes/suggestion.routes.ts`** или новый middleware — перехват операторских сообщений
   - Найти роут `POST /api/conversations/:id/messages` (может быть в другом файле)
   - При создании сообщения с `role === "assistant"` от оператора:
     ```typescript
     // Найти последнее сообщение клиента в диалоге
     // Проверить нет ли уже training sample для этой пары (дедупликация по conversationId)
     // Создать фиктивный suggestion-объект с suggestedReply = текст оператора
     // Вызвать recordTrainingSample({ outcome: "OPERATOR_MANUAL", ... })
     ```
   - Защита: не дублировать если уже есть sample с этим conversationId + userMessage

5. **`server/database-storage.ts`** — проверить метод `getAiTrainingSamplesByTenant`
   - Убедиться что не фильтрует по outcome (должен возвращать все включая OPERATOR_MANUAL)

### Feature flag
Оборачивать в `featureFlagService.isEnabled("AUTO_LEARNING_ENABLED", tenantId)`

### Критерии готовности
- [ ] `"OPERATOR_MANUAL"` добавлен в scheme без breaking changes
- [ ] При ручном ответе оператора в DB появляется запись в ai_training_samples
- [ ] Дубликаты не создаются
- [ ] Few-shot scorer даёт OPERATOR_MANUAL score > EDITED > APPROVED
- [ ] Существующие тесты `few-shot-builder.test.ts` не сломаны

---

## Этап 2 — Learning Queue Worker

### Суб-агент: `backend-developer`

### Цель
Создать BullMQ-воркер, который автоматически обрабатывает очередь обучения.
Сейчас `learning_queue` наполняется но никогда не обрабатывается.

### Точные файлы для изменения

1. **`server/workers/learning-queue.worker.ts`** — НОВЫЙ ФАЙЛ
   - По образцу `server/workers/no-reply-check.worker.ts` (там есть паттерн BullMQ Worker)
   - Логика обработки одной записи:
     ```
     1. Получить learning_queue item (tenantId, conversationId)
     2. Проверить ai_training_policies тенанта (forbiddenTopics, disabledLearningIntents)
     3. Загрузить messages диалога из БД
     4. Найти пары: последнее customer-сообщение → следующий assistant-ответ
     5. Для каждой пары без существующего training sample:
        - Создать training sample с outcome = "OPERATOR_MANUAL" если оператор отвечал
        - Или outcome = "APPROVED" если был одобренный AI suggestion
     6. Пометить learning_queue запись как "reviewed"
     ```

2. **`server/services/learning-queue-processor.ts`** — НОВЫЙ ФАЙЛ (бизнес-логика отдельно от воркера)
   - Функции: `processLearningQueueItem(item)`, `extractTrainingPairsFromConversation(messages)`
   - Это позволяет тестировать логику без BullMQ

3. **`server/index.ts`** — зарегистрировать новый воркер при старте
   - По аналогии с другими воркерами в файле

4. **`server/batch/index.ts`** — добавить периодический job (каждые 24 часа)
   - Добавлять в очередь все pending learning_queue записи

### Параметры BullMQ
```typescript
// Очередь — уже существует (создаётся в learning-score-service.ts)
// Воркер — новый файл, читает из той же очереди "learning_queue"
const BATCH_SIZE = 50; // обрабатывать по 50 записей за раз
const MIN_LEARNING_SCORE = 1; // threshold из learning_queue.learningScore
```

### Критерии готовности
- [ ] Воркер стартует без ошибок вместе с сервером
- [ ] Pending записи из learning_queue обрабатываются и переходят в "reviewed"
- [ ] Политики тенанта (forbiddenTopics) соблюдаются
- [ ] Не создаются дубликаты training samples
- [ ] Логи работы воркера в консоли

---

## Этап 3 — Conversation-to-RAG Indexer

### Суб-агент: `backend-developer`

### Цель
Успешно завершённые диалоги должны становиться знаниями в RAG.
Когда похожий вопрос придёт снова — RAG найдёт готовый пример ответа.

### Точные файлы для изменения

1. **`shared/schema.ts`** — добавить тип `"CONVERSATION"` в `RAG_DOC_TYPES`
   - Найти: `export const RAG_DOC_TYPES`
   - Добавить `"CONVERSATION"` в массив

2. **`server/services/conversation-rag-indexer.ts`** — НОВЫЙ ФАЙЛ
   ```typescript
   // Функция indexConversation(conversationId, tenantId):
   // 1. Загрузить все messages диалога
   // 2. Отфильтровать: минимум 3 пары customer/assistant
   // 3. Проверить: есть ли уже rag_document с type="CONVERSATION" и sourceId=conversationId
   // 4. Если нет — сформировать текст диалога в формате:
   //    "Клиент: {message}\nОператор: {reply}\n\n..."
   // 5. Создать RagDocument type="CONVERSATION" + chunks через rag-indexer.ts логику
   // 6. Для каждого чанка создать embedding через embedding-service.ts
   // 7. Сохранить в rag_documents + rag_chunks
   ```

3. **`server/routes/suggestion.routes.ts`** — триггер при resolve разговора
   - Найти место где conversation.status → "resolved"
   - Добавить: `indexConversation(conversationId, tenantId)` (fire-and-forget, в catch логировать)

4. **`server/database-storage.ts`** — проверить метод `getAllRagChunksWithEmbedding`
   - Убедиться что type="CONVERSATION" чанки возвращаются в результатах

5. **`server/services/rag-retrieval.ts`** — обновить `formatContextForPrompt`
   - Добавить секцию `=== ПОХОЖИЕ ДИАЛОГИ ===` для sourceType="CONVERSATION"

### Условия индексации разговора
```
conversation.status === "resolved"
AND messages.filter(m => m.role === "customer").length >= 2
AND messages.filter(m => m.role === "assistant").length >= 2
AND (есть хотя бы один APPROVED/EDITED training sample ИЛИ оператор писал сам)
```

### Критерии готовности
- [ ] Тип "CONVERSATION" добавлен без breaking changes
- [ ] При resolve диалога создаётся rag_document + rag_chunks
- [ ] Эмбеддинги создаются для каждого чанка
- [ ] Дубликаты не создаются (проверка по sourceId+type)
- [ ] Чанки из CONVERSATION-диалогов появляются в RAG retrieval
- [ ] В formatContextForPrompt отображается новая секция

---

## Этап 4 — Training Stats API

### Суб-агент: `backend-developer`

### Цель
Дать оператору и платформе видимость того, как идёт обучение тенанта.

### Точные файлы для изменения

1. **`server/database-storage.ts`** — добавить метод `getAiTrainingStats(tenantId)`
   ```typescript
   // Возвращает:
   {
     samplesByOutcome: { APPROVED: n, EDITED: n, REJECTED: n, OPERATOR_MANUAL: n },
     conversationRagCount: number,      // rag_documents WHERE type="CONVERSATION"
     avgConfidenceLast50: number | null, // среднее ai_suggestions.confidence за последние 50
     topIntents: { intent: string, count: number }[], // топ-5 из ai_training_samples
     totalSamples: number,
     learningQueuePending: number,       // learning_queue WHERE status="pending"
   }
   ```

2. **`server/storage.types.ts`** или `server/storage.ts`** — добавить сигнатуру метода

3. **`server/routes/settings.routes.ts`** — добавить эндпоинт
   ```
   GET /api/ai/training-stats
   requireAuth + requirePermission("VIEW_CONVERSATIONS")
   Возвращает getAiTrainingStats(user.tenantId)
   ```

4. **`client/src/pages/`** — (опционально) добавить виджет на страницу настроек AI
   - Простая карточка с числами, без отдельной страницы
   - Файл: найти компонент настроек AI агента в клиенте

### Критерии готовности
- [ ] GET /api/ai/training-stats возвращает корректные данные
- [ ] Все поля присутствуют даже если данных нет (null/0 по умолчанию)
- [ ] Endpoint защищён auth + permission

---

## Этап 5 — Интеграционное тестирование

### Суб-агент: `backend-developer`

### Цель
Убедиться что все 4 этапа работают вместе и не сломали существующее.

### Точные файлы для изменения / создания

1. **`server/__tests__/ai-learning-pipeline.test.ts`** — НОВЫЙ ФАЙЛ
   - Тест: оператор пишет вручную → появляется training sample с outcome=OPERATOR_MANUAL
   - Тест: learning queue item обрабатывается воркером → status=reviewed
   - Тест: resolved conversation → rag_document type=CONVERSATION создан
   - Тест: GET /api/ai/training-stats возвращает корректную структуру

2. **Существующие тесты — запустить и убедиться что не сломаны:**
   - `server/__tests__/few-shot-builder.test.ts`
   - `server/__tests__/rag-integration.test.ts`
   - `server/__tests__/rag-retrieval.test.ts`
   - `server/__tests__/training-policies.test.ts`

3. **Миграция БД** — если добавлялись новые поля/типы:
   - Создать файл `migrations/XXXX_ai_learning_upgrade.sql`
   - Добавить ALTER TABLE если нужно (например новый outcome в enum)

### Критерии готовности
- [ ] Все новые тесты проходят
- [ ] Все существующие AI-тесты не сломаны
- [ ] Миграция применена без ошибок
- [ ] `npm run build` без TypeScript ошибок

---

## Инструкция для главного агента

```
Ты — ведущий агент (orchestrator). Твоя задача реализовать систему per-tenant AI обучения
по документу docs/AI_LEARNING_UPGRADE.md.

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:
1. Читай этот документ в начале каждого этапа
2. Каждый этап реализуй через отдельный суб-агент типа "backend-developer"
3. Не начинай следующий этап пока суб-агент не отрапортовал "Критерии готовности ✅"
4. После каждого этапа обновляй секцию "Статус выполнения" в этом документе
5. Если суб-агент столкнулся с проблемой — разберись и либо дай ему уточнение, либо реши сам

ПОРЯДОК РАБОТЫ:
Этап 0 (database-specialist) → Этап 1–4 (backend-developer) → Этап 5 (backend-developer)
Каждый → проверь критерии → обнови статус → следующий

ПРОМТ ДЛЯ КАЖДОГО СУБ-АГЕНТА:
"Прочитай docs/AI_LEARNING_UPGRADE.md. Реализуй Этап N: [название].
Следуй точно разделу 'Точные файлы для изменения'.
Перед изменением каждого файла прочитай его полностью.
После реализации проверь критерии готовности из документа.
Сообщи о каждом изменённом файле и результате."

ВАЖНО ДЛЯ ЭТАПА 0:
Перед запуском миграции выполни проверку:
  SELECT * FROM pg_available_extensions WHERE name = 'vector';
Если расширение недоступно — сообщи об этом, НЕ продолжай.

ВАЖНО: Не изменяй файлы из других этапов до начала того этапа.
```

---

## Статус выполнения

| Этап | Описание | Статус | Дата |
|------|----------|--------|------|
| 0 | Миграция RAG на pgvector (RAM-проблема) | ✅ выполнен | 10.05.2026 |
| 1 | Auto-Harvest операторских ответов | ✅ выполнен | 10.05.2026 |
| 2 | Learning Queue Worker | ✅ выполнен | 10.05.2026 |
| 3 | Conversation-to-RAG Indexer | ✅ выполнен | 10.05.2026 |
| 4 | Training Stats API | ✅ выполнен | 10.05.2026 |
| 5 | Интеграционное тестирование | ✅ выполнен | 10.05.2026 |

---

## Справка: смежные файлы (только читать, не изменять без необходимости)

```
server/services/message-bus.ts           ← события входящих сообщений
server/services/feature-flags.ts         ← featureFlagService.isEnabled(...)
server/services/audit-log.ts             ← логирование действий
server/middleware/rbac.ts                ← requireAuth, requirePermission
server/workers/no-reply-check.worker.ts  ← образец BullMQ Worker
server/batch/index.ts                    ← образец периодических задач
server/batch/utils.ts                    ← утилиты для batch-обработки
```

---

*Создан: 10.05.2026. Версия: 1.0*
