# Промпты для исправления UX — страница Настроек

> Файл: `client/src/pages/settings.tsx` (~4478 строк)
> Каждый промпт независим и решает одну конкретную задачу.
> Применять последовательно: сначала 🔴, потом 🟡, потом 🔵.

---

## 🔴 FIX-01 — Замена технической терминологии на понятные пользователю слова

```
В файле client/src/pages/settings.tsx выполни замену терминологии во всех текстах,
которые видит пользователь (CardTitle, CardDescription, Label, p, Badge-текст).
Не трогай переменные, пропсы, data-testid и комментарии.

Список замен:
- "Decision Engine"           → "Автоматические решения"
- "Human-like Delay"          → "Задержка перед ответом"
- "Phase 1"                   → убрать Badge полностью
- "Phase 2"                   → убрать Badge полностью
- "tAuto"                     → "порог авто-отправки"
- "tEscalate"                 → "порог передачи оператору"
- "AUTO_SEND"                 → "Авто-отправка"
- "NEED_APPROVAL"             → "Требует проверки"
- "ESCALATE" / "эскалировать" → "Передать оператору"
- "Интент" / "Интенты"        → "Тип запроса" / "Типы запросов"
- "few-shot"                  → убрать из UI совсем
- "Обучающий датасет"         → "База примеров для AI"

В компоненте DecisionEngineSettings:
- Заголовок карточки: "Автоматические решения"
- CardDescription: "Настройте, как AI принимает решения по каждому типу запроса"
- Label слайдера tAuto: "Уверенность для авто-отправки: {X}%"
- Label слайдера tEscalate: "Уверенность для передачи оператору: {X}%"
- "Интенты для автоотправки" → "Типы запросов для авто-отправки"
- "Интенты → всегда эскалировать (ESCALATE)" → "Типы запросов → всегда передавать оператору"

В компоненте HumanDelaySettings:
- Заголовок: "Задержка перед ответом"
- CardDescription: "AI будет отвечать с небольшой задержкой, как живой оператор"
- "Включить задержку ответов" оставить как есть
- "Поведение в нерабочее время" → "Что делать вне рабочих часов"
- "Множитель ночной задержки: x{N}" → "Задержка вне рабочих часов: в {N} раза дольше"

В компоненте TrainingPoliciesSettings:
- Заголовок карточки: "Правила обучения AI"
- CardDescription: "Контролируйте, на каких примерах учится ваш AI"
- "Интенты → требовать одобрения (NEED_APPROVAL)" → "Типы запросов → только с проверкой оператора"
- Удали из описания фразу "NOT эскалация, просто требует одобрения оператора" — 
  замени на "Ответы на эти запросы AI не отправит сам, даже при высокой уверенности"
- "Интенты исключённые из обучения" → "Типы запросов, которые AI не запоминает"
- "Ответы с этими интентами не будут использоваться в few-shot примерах для AI" →
  "Ответы на эти запросы AI не будет использовать как образцы для обучения"
- "Запрещённые темы" → "Темы, которые не сохраняются в базу примеров"
- "Разговоры содержащие эти слова не будут сохраняться в обучающий датасет" →
  "Диалоги с этими словами AI не будет использовать как учебные примеры"
```

---

## 🔴 FIX-02 — Добавить рабочие дни недели в настройки рабочих часов

```
В файле client/src/pages/settings.tsx найди компонент Settings, вкладку "automation"
и блок "Рабочие часы" (CardTitle="Рабочие часы").

1. В форму добавь поле workingDays (уже существует в типе Tenant как string[]).
   Значения: "mon", "tue", "wed", "thu", "fri", "sat", "sun"
   
2. В settingsFormSchema добавь:
   workingDays: z.array(z.string()).optional().default(["mon","tue","wed","thu","fri"])

3. В defaultValues формы добавь:
   workingDays: ["mon","tue","wed","thu","fri"]

4. В values (заполнение из tenant) добавь:
   workingDays: tenant.workingDays ?? ["mon","tue","wed","thu","fri"]

5. Внутри CardContent, ПОСЛЕ блока с workingHoursStart/workingHoursEnd, 
   но ДО кнопки сохранения добавь FormField:

   <FormField
     control={form.control}
     name="workingDays"
     render={({ field }) => (
       <FormItem>
         <FormLabel>Рабочие дни</FormLabel>
         <div className="flex flex-wrap gap-2 mt-2">
           {[
             { value: "mon", label: "Пн" },
             { value: "tue", label: "Вт" },
             { value: "wed", label: "Ср" },
             { value: "thu", label: "Чт" },
             { value: "fri", label: "Пт" },
             { value: "sat", label: "Сб" },
             { value: "sun", label: "Вс" },
           ].map(({ value, label }) => {
             const checked = field.value?.includes(value);
             return (
               <button
                 key={value}
                 type="button"
                 onClick={() => {
                   const next = checked
                     ? field.value.filter((d: string) => d !== value)
                     : [...(field.value ?? []), value];
                   field.onChange(next);
                 }}
                 className={cn(
                   "w-10 h-10 rounded-md border text-sm font-medium transition-colors",
                   checked
                     ? "bg-primary text-primary-foreground border-primary"
                     : "bg-background text-muted-foreground hover:bg-muted"
                 )}
               >
                 {label}
               </button>
             );
           })}
         </div>
         <FormMessage />
       </FormItem>
     )}
   />

6. В handleSubmit передай workingDays в cleaned объект.
```

---

## 🔴 FIX-03 — Убрать внутренние заметки разработчика из UI

```
В файле client/src/pages/settings.tsx найди и замени следующие строки:

1. В компоненте TrainingPoliciesSettings, Label с текстом 
   "Интенты → требовать одобрения (NEED_APPROVAL)" и параграф ниже:
   
   БЫЛО:
   <p className="text-xs text-muted-foreground mb-2">
     Понижает AUTO_SEND до ручной проверки — NOT эскалация, просто требует одобрения оператора
   </p>
   
   ЗАМЕНИТЬ НА:
   <p className="text-xs text-muted-foreground mb-2">
     Для этих типов запросов AI всегда будет ждать одобрения оператора перед отправкой
   </p>

2. Найди все остальные тексты содержащие технические аббревиатуры в скобках
   рядом с пользовательскими лейблами: (NEED_APPROVAL), (AUTO_SEND), (ESCALATE)
   — удали скобки с кодом, оставь только понятный текст.
```

---

## 🟡 FIX-04 — Визуальная схема под слайдерами Decision Engine

```
В файле client/src/pages/settings.tsx найди компонент DecisionEngineSettings.
После блока с двумя слайдерами (tAuto и tEscalate), но ДО <Separator />,
добавь визуальную подсказку:

<div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
  <p className="font-medium text-foreground text-sm">Как это работает:</p>
  <div className="flex items-center gap-1 flex-wrap">
    <span className="inline-flex items-center gap-1 rounded bg-red-500/10 text-red-600 px-2 py-0.5">
      0% – {Math.round(tEscalate * 100)}%
    </span>
    <span>→ передать оператору</span>
    <span className="mx-2 text-muted-foreground/40">│</span>
    <span className="inline-flex items-center gap-1 rounded bg-yellow-500/10 text-yellow-600 px-2 py-0.5">
      {Math.round(tEscalate * 100)}% – {Math.round(tAuto * 100)}%
    </span>
    <span>→ ждать проверки</span>
    <span className="mx-2 text-muted-foreground/40">│</span>
    <span className="inline-flex items-center gap-1 rounded bg-green-500/10 text-green-600 px-2 py-0.5">
      {Math.round(tAuto * 100)}% – 100%
    </span>
    <span>→ отправить сразу</span>
  </div>
  <p className="text-muted-foreground/70 mt-1">
    Уверенность рассчитывается автоматически на основе релевантности базы знаний и истории ответов
  </p>
</div>

Значения {Math.round(tAuto * 100)} и {Math.round(tEscalate * 100)} должны реактивно
обновляться при движении слайдеров (они уже есть в состоянии компонента).
```

---

## 🟡 FIX-05 — Заменить key-value «Дополнительные факты» на textarea

```
В файле client/src/pages/settings.tsx найди компонент AIAgentSettingsCard.
Найди карточку с CardTitle="Дополнительные факты".

Текущая реализация: массив объектов {key, value} с двумя Input на строку.

Задача: заменить на одно поле Textarea.

1. Удали состояния customFacts, addFact, removeFact, updateFact.

2. Добавь одно состояние:
   const [companyFacts, setCompanyFacts] = useState("");

3. В useEffect где заполняется форма из settings:
   - Если settings.companyFacts — это строка, просто setCompanyFacts(settings.companyFacts ?? "")
   - Если это был массив [{key, value}] — сконвертируй в строку:
     const factsText = (settings.customFacts as any[])
       ?.map((f: any) => `${f.key}: ${f.value}`)
       .join("\n") ?? "";
     setCompanyFacts(factsText);

4. В handleSave передавай companyFacts как строку (поле companyFacts).

5. Замени весь CardContent карточки «Дополнительные факты» на:

   <CardContent className="space-y-3">
     <p className="text-xs text-muted-foreground">
       Любые факты о компании, которые агент будет использовать в ответах.
       Каждый факт с новой строки.
     </p>
     <Textarea
       value={companyFacts}
       onChange={(e) => setCompanyFacts(e.target.value)}
       placeholder={
         "Адрес: г. Москва, ул. Ленина 5\n" +
         "Работаем с 2015 года\n" +
         "Доставка по всей России\n" +
         "Самовывоз возможен по предварительному звонку"
       }
       className="min-h-[120px]"
       data-testid="textarea-company-facts"
     />
   </CardContent>
```

---

## 🟡 FIX-06 — Перенести «Системный промпт» в блок «Дополнительно»

```
В файле client/src/pages/settings.tsx найди компонент AIAgentSettingsCard.
Найди карточку с CardTitle="Системный промпт".

Оберни её в Collapsible (компонент уже импортирован в файле):

Замени карточку на следующее:

<Collapsible>
  <CollapsibleTrigger asChild>
    <Button
      variant="ghost"
      className="flex w-full items-center justify-between rounded-md border px-4 py-3 text-sm font-medium hover:bg-muted"
      type="button"
    >
      <span className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-muted-foreground" />
        Расширенные настройки
      </span>
      <ChevronDown className="h-4 w-4 text-muted-foreground" />
    </Button>
  </CollapsibleTrigger>
  <CollapsibleContent>
    <Card className="mt-2 border-dashed">
      <CardHeader>
        <CardTitle className="text-base">Системный промпт</CardTitle>
        <CardDescription>
          Основной характер и поведение агента. Если оставить пустым — используется стандартный промпт.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
          ⚠️ Изменение полностью заменяет поведение агента по умолчанию.
          Используйте только если точно знаете что делаете.
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowDefaultPrompt(true)}
          data-testid="button-view-default-prompt"
        >
          <FileText className="mr-2 h-4 w-4" />
          Посмотреть стандартный промпт
        </Button>
        <Textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Опишите как должен вести себя ваш агент..."
          className="min-h-[200px] font-mono text-sm"
          data-testid="textarea-system-prompt"
        />
        {systemPrompt && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setSystemPrompt("")}
          >
            Сбросить до стандартного
          </Button>
        )}
      </CardContent>
    </Card>
  </CollapsibleContent>
</Collapsible>

Иконки Lock и ChevronDown уже импортированы в файле.
```

---

## 🟡 FIX-07 — Единая таблица настроек интентов

```
В файле client/src/pages/settings.tsx найди компонент DecisionEngineSettings.

Задача: заменить два разрозненных блока badge-пикеров интентов на единую таблицу,
где для каждого типа запроса выбирается одно действие из трёх.

1. Состояние остаётся таким же: intentsAutosendAllowed, intentsForceHandoff.
   Логика: если intent в intentsForceHandoff → "оператор",
           если intent в intentsAutosendAllowed → "авто",
           иначе → "проверка".

2. Добавь функцию:
   function getIntentMode(intent: string): "auto" | "check" | "operator" {
     if (intentsForceHandoff.includes(intent)) return "operator";
     if (intentsAutosendAllowed.includes(intent)) return "auto";
     return "check";
   }

   function setIntentMode(intent: string, mode: "auto" | "check" | "operator") {
     setIntentsAutosendAllowed(prev =>
       mode === "auto" ? [...prev.filter(i => i !== intent), intent] : prev.filter(i => i !== intent)
     );
     setIntentsForceHandoff(prev =>
       mode === "operator" ? [...prev.filter(i => i !== intent), intent] : prev.filter(i => i !== intent)
     );
   }

3. Замени оба блока badge-пикеров (интенты для автоотправки + интенты для эскалации)
   на следующую таблицу:

   <div className="space-y-2">
     <Label>Поведение AI по типам запросов</Label>
     <p className="text-xs text-muted-foreground mb-3">
       Определите, что делать с каждым типом запроса от клиента
     </p>
     <div className="rounded-md border overflow-hidden">
       <table className="w-full text-sm">
         <thead className="bg-muted/50">
           <tr>
             <th className="text-left px-3 py-2 font-medium">Тип запроса</th>
             <th className="text-center px-3 py-2 font-medium text-green-600 w-28">
               <span className="flex items-center justify-center gap-1">
                 <Zap className="h-3 w-3" /> Авто
               </span>
             </th>
             <th className="text-center px-3 py-2 font-medium text-yellow-600 w-28">
               Проверка
             </th>
             <th className="text-center px-3 py-2 font-medium text-red-600 w-28">
               Оператор
             </th>
           </tr>
         </thead>
         <tbody className="divide-y">
           {INTENT_OPTIONS
             .filter(i => autoPartsEnabled || !AUTO_PARTS_INTENTS.has(i.value))
             .map((intent) => {
               const mode = getIntentMode(intent.value);
               return (
                 <tr key={intent.value} className="hover:bg-muted/30">
                   <td className="px-3 py-2">{intent.label}</td>
                   {(["auto", "check", "operator"] as const).map((m) => (
                     <td key={m} className="text-center px-3 py-2">
                       <button
                         type="button"
                         onClick={() => setIntentMode(intent.value, m)}
                         className={cn(
                           "h-5 w-5 rounded-full border-2 mx-auto block transition-colors",
                           mode === m
                             ? m === "auto"
                               ? "bg-green-500 border-green-500"
                               : m === "check"
                               ? "bg-yellow-500 border-yellow-500"
                               : "bg-red-500 border-red-500"
                             : "bg-background border-muted-foreground/30 hover:border-muted-foreground"
                         )}
                         data-testid={`intent-mode-${intent.value}-${m}`}
                       />
                     </td>
                   ))}
                 </tr>
               );
             })}
         </tbody>
       </table>
     </div>
     <div className="flex gap-4 text-xs text-muted-foreground pt-1">
       <span className="flex items-center gap-1">
         <span className="h-2.5 w-2.5 rounded-full bg-green-500 inline-block" />
         Авто — отправить без проверки
       </span>
       <span className="flex items-center gap-1">
         <span className="h-2.5 w-2.5 rounded-full bg-yellow-500 inline-block" />
         Проверка — оператор одобряет
       </span>
       <span className="flex items-center gap-1">
         <span className="h-2.5 w-2.5 rounded-full bg-red-500 inline-block" />
         Оператор — всегда передавать живому
       </span>
     </div>
   </div>
```

---

## 🟡 FIX-08 — Единая кнопка сохранения на каждой вкладке

```
В файле client/src/pages/settings.tsx решить проблему множественных кнопок Save.

Для вкладки "automation" (Автоматизация):

1. Убери отдельные кнопки Save из:
   - компонента HumanDelaySettings (кнопку "Сохранить настройки задержки")
   - компонента DecisionEngineSettings (кнопку "Сохранить настройки Decision Engine")

2. Добавь колбэки onSave через пропсы:
   - DecisionEngineSettings получает проп: onSave?: () => void
   - HumanDelaySettings получает проп: onSave?: () => void

3. В handleSave обоих компонентов вместо вызова updateMutation.mutate вызывай
   тот же mutate, но через onSuccess вызывай onSave?.()

4. В TabsContent value="automation" добавь единую кнопку в самом низу:
   <div className="flex justify-end pt-4 border-t mt-6">
     <Button
       onClick={() => {
         decisionEngineRef.current?.save();
         humanDelayRef.current?.save();
         form.handleSubmit(handleSubmit)();
       }}
       data-testid="button-save-automation-tab"
     >
       <Save className="mr-2 h-4 w-4" />
       Сохранить все настройки автоматизации
     </Button>
   </div>

   Используй useRef + forwardRef + useImperativeHandle для вызова save() из дочерних компонентов,
   или вынеси состояние наверх в Settings компонент.

Альтернативный подход (проще): оставить кнопки Save в компонентах, но добавить 
индикатор несохранённых изменений: если локальное состояние отличается от загруженных 
данных — показывать жёлтую полоску вверху карточки "Есть несохранённые изменения".
```

---

## 🔵 FIX-09 — Реструктуризация вкладок (переименование)

```
В файле client/src/pages/settings.tsx найди основной компонент Settings,
блок <TabsList> и все <TabsTrigger>.

Выполни следующие изменения:

1. Переименуй вкладки (только label, data-testid не трогай):
   - value="company"           → label "🏢 Компания"           (без эмодзи если стиль не поддерживает)
   - value="ai-agent"          → label "🤖 Поведение AI"
   - value="automation"        → label "⚡ Автоматизация"        (оставить)
   - value="ai-training"       → label "📚 Обучение"
   - value="templates-payment" → label "💬 Шаблоны"
   - value="channels"          → label "🔗 Каналы"              (оставить)

2. В TabsContent value="company" перемести блок "Рабочие часы" из вкладки
   "automation" СЮДА — рабочие часы логически относятся к информации о компании.

3. В TabsContent value="ai-agent":
   - Перемести компонент CompanyAgentCard СЮДА из вкладки "company"
     (информация о компании нужна именно для настройки поведения AI)
   - Вкладка "Компания" остаётся только для валюты, часового пояса, рабочих часов

4. Переименуй CardTitle в блоке templates-payment:
   - "Шаблоны сообщений" → "Шаблоны автоответов"
   - "Способы оплаты" → "Способы оплаты для клиентов"

Не трогай data-testid атрибуты — они используются в тестах.
```

---

## 🔵 FIX-10 — Индикатор несохранённых изменений

```
В файле client/src/pages/settings.tsx добавь визуальный индикатор 
несохранённых изменений для компонентов DecisionEngineSettings и HumanDelaySettings.

Для каждого из этих компонентов:

1. Добавь состояние isDirty:
   const [isDirty, setIsDirty] = useState(false);

2. В useEffect где заполняются данные из settings:
   setIsDirty(false); // при загрузке данных — чистый

3. Во всех onChange обработчиках (setTAuto, setTEscalate, setAutosendAllowed и т.д.):
   setIsDirty(true);

4. В onSuccess мутации:
   setIsDirty(false);

5. Добавь вверху CardContent (самая первая строка, только если isDirty):
   {isDirty && (
     <div className="flex items-center gap-2 rounded-md bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400 mb-4">
       <AlertCircle className="h-3 w-3 flex-shrink-0" />
       Есть несохранённые изменения — не забудьте нажать «Сохранить»
     </div>
   )}

Иконка AlertCircle уже импортирована в файле.
```

---

## Порядок применения

```
1. FIX-01  (терминология)         — самый безопасный, только текст
2. FIX-03  (убрать заметки)       — только текст
3. FIX-02  (рабочие дни)          — добавление поля формы
4. FIX-04  (визуальная схема)     — добавление JSX
5. FIX-05  (факты → textarea)     — рефакторинг компонента
6. FIX-06  (промпт → collapsible) — оборачивание в Collapsible
7. FIX-07  (таблица интентов)     — замена badge-пикеров
8. FIX-10  (индикатор dirty)      — добавление состояния
9. FIX-08  (единый Save)          — рефакторинг архитектуры
10. FIX-09 (вкладки)              — реструктуризация (самый рискованный)
```
