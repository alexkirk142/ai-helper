# FRONTEND_REFERENCE.md — AI Sales Operator

> Исчерпывающий справочник по клиентской части проекта.  
> Обновлён: 2026-05-22. Основан на SocratiCode-анализе индекса (2692 чанков).

---

## Содержание

1. [Обзор архитектуры](#1-обзор-архитектуры)
2. [Стек технологий](#2-стек-технологий)
3. [Структура директорий](#3-структура-директорий)
4. [App.tsx — корневой компонент](#4-apptsx--корневой-компонент)
5. [Роутинг (wouter)](#5-роутинг-wouter)
6. [Страницы (Pages)](#6-страницы-pages)
7. [Страница Settings (~5384 строк)](#7-страница-settings-5384-строки)
8. [Компоненты](#8-компоненты)
9. [Хуки (Hooks)](#9-хуки-hooks)
10. [Библиотеки (lib/)](#10-библиотеки-lib)
11. [WebSocket клиент](#11-websocket-клиент)
12. [Система стилей](#12-система-стилей)
13. [Брендинг](#13-брендинг)
14. [Code Splitting (Lazy Loading)](#14-code-splitting-lazy-loading)
15. [Паттерны работы с данными](#15-паттерны-работы-с-данными)
16. [Билинг — интеграция UI](#16-билинг--интеграция-ui)
17. [Критические ограничения](#17-критические-ограничения)

---

## 1. Обзор архитектуры

```
main.tsx
  └── AppWrapper
        ├── QueryClientProvider  (TanStack Query)
        ├── ThemeProvider        (light/dark/system)
        ├── TooltipProvider
        ├── App                  (роутинг + auth guard)
        │   ├── LandingPage      (не авторизован, не auth-маршрут)
        │   ├── AuthRouter       (/login, /signup, /verify-email, ...)
        │   ├── OwnerRouter      (/owner/*, без авторизации)
        │   └── AuthenticatedApp (авторизован)
        │       ├── SidebarProvider
        │       ├── AppSidebar
        │       ├── header (ThemeToggle, logout, user email)
        │       └── Router → страницы (все lazy)
        └── Toaster
```

**Принцип:** SPA без SSR. Все данные через TanStack Query (queryKey = URL path).  
**Роутер:** wouter 3.3.5 (НЕ react-router).  
**Состояние:** только React Query + useState/useEffect (нет Redux/Zustand/Jotai).

---

## 2. Стек технологий

| Библиотека | Версия | Назначение |
|-----------|--------|-----------|
| React | 18.3.1 | UI фреймворк |
| Vite | 7.3.0 | Сборщик + HMR |
| TypeScript | 5.6.3 | Strict mode, `noEmit` |
| Tailwind CSS | 3.4.17 | Утилитарные стили |
| shadcn/ui | new-york | Компонентная библиотека (Radix UI) |
| TanStack React Query | 5.60.5 | Server state, `staleTime: Infinity` |
| wouter | 3.3.5 | Роутер (лёгкий, без history API) |
| react-hook-form | 7.55.0 | Формы |
| @hookform/resolvers | 3.10.0 | Zod интеграция для форм |
| Zod | — | Валидация схем форм |
| recharts | 2.15.2 | Графики (только в analytics) |
| framer-motion | 11.13.1 | Анимации |
| lucide-react | 0.453.0 | Иконки |
| cmdk | 1.1.1 | Command palette |
| react-icons | — | SiTelegram и другие брендовые иконки |
| date-fns | — | Форматирование дат |

---

## 3. Структура директорий

```
client/
├── index.html                   # Точка входа Vite
└── src/
    ├── main.tsx                 # React.createRoot → AppWrapper
    ├── App.tsx                  # Корневой компонент (80 connections!)
    ├── index.css                # Tailwind base + CSS переменные (dark/light)
    │
    ├── pages/                   # 23 страницы
    │   ├── dashboard.tsx        # Обзор метрик + последние эскалации
    │   ├── conversations.tsx    # Список диалогов + чат (основной рабочий вид)
    │   ├── customer-profile.tsx # Детальная карточка клиента
    │   ├── knowledge-base.tsx   # База знаний: CRUD документов
    │   ├── products.tsx         # Каталог товаров: CRUD
    │   ├── escalations.tsx      # Управление эскалациями
    │   ├── crm.tsx              # CRM — все заявки (Marquiz/Universal), статусы, фильтры, детали
│   ├── failed-leads.tsx     # Устаревшая страница неудачных заявок (сохранена для compat)
    │   ├── settings.tsx         # Все настройки: 7 вкладок (~5384 строк!)
    │   ├── onboarding.tsx       # 6-шаговый wizard онбординга
    │   ├── analytics.tsx        # CSAT, конверсии, интенты, lost-deals (recharts)
    │   ├── billing.tsx          # Подписка: CryptoBot checkout, 50 USDT/мес
    │   ├── extensions.tsx       # Подписка AI Agent + Coming Soon расширения
    │   ├── auth.tsx             # Login/Signup/VerifyEmail/Forgot/Reset (один файл, 5 компонентов)
    │   ├── not-found.tsx        # 404
    │   ├── security-status.tsx  # Панель безопасности [adminOnly]
    │   ├── admin-billing.tsx    # Platform admin: биллинг, метрики, подписки [adminOnly]
    │   ├── admin-secrets.tsx    # Platform admin: API ключи, интеграции [adminOnly]
    │   ├── admin-users.tsx      # Platform admin: пользователи [adminOnly]
    │   ├── admin-proxies.tsx    # Platform admin: прокси-пул [adminOnly]
    │   ├── admin-max-gateway.tsx # Platform admin: MAX Gateway управление [adminOnly]
    │   ├── admin-tenants.tsx    # Platform admin: поиск тенантов, авто-запчасти [adminOnly]
    │   ├── admin-broadcast.tsx  # Platform admin: рассылки через Telegram-бот [adminOnly]
    │   ├── owner-dashboard.tsx  # Platform owner: сводный дашборд [ownerOnly]
    │   ├── owner-login.tsx      # Platform owner: отдельный логин [public]
    │   └── owner-updates.tsx    # Platform owner: обновления системы [ownerOnly]
    │
    ├── components/
    │   ├── app-sidebar.tsx      # Навигационная панель с бейджами unread/escalation
    │   ├── chat-interface.tsx   # Чат: сообщения, AI-подсказки, ввод текста
    │   ├── conversation-list.tsx # Список диалогов с фильтрами; показывает аватар MAX-пользователя через AvatarImage
    │   ├── customer-card.tsx    # Карточка клиента: теги, иконки канала; показывает аватар MAX-пользователя через AvatarImage
    │   ├── metrics-card.tsx     # Карточка метрики с трендом (dashboard)
    │   ├── csat-dialog.tsx      # Диалог оценки CSAT 1-5 звёзд
    │   ├── subscription-paywall.tsx  # SubscriptionPaywall, ChannelPaywallOverlay,
    │   │                             # SubscriptionBadge, PaymentSuccessDialog,
    │   │                             # usePublicBillingConfig
    │   ├── channel-tabs.tsx     # Вкладки выбора канала
    │   ├── brand-logo.tsx       # BrandLogoIcon SVG + BRAND_NAME + BRAND_TAGLINE
    │   ├── theme-toggle.tsx     # Light/Dark/System переключатель
    │   └── ui/                  # 40+ shadcn/ui примитивов (НЕ редактировать вручную)
    │       ├── button.tsx, input.tsx, textarea.tsx, select.tsx
    │       ├── dialog.tsx, sheet.tsx, alert-dialog.tsx, drawer.tsx
    │       ├── card.tsx, badge.tsx, separator.tsx, skeleton.tsx
    │       ├── tabs.tsx, accordion.tsx, collapsible.tsx
    │       ├── form.tsx, label.tsx, checkbox.tsx, switch.tsx, radio-group.tsx
    │       ├── table.tsx, scroll-area.tsx, pagination.tsx
    │       ├── sidebar.tsx, navigation-menu.tsx, menubar.tsx
    │       ├── dropdown-menu.tsx, context-menu.tsx
    │       ├── popover.tsx, hover-card.tsx, tooltip.tsx
    │       ├── toast.tsx, toaster.tsx
    │       ├── avatar.tsx, aspect-ratio.tsx
    │       ├── calendar.tsx, slider.tsx, progress.tsx
    │       ├── resizable.tsx, carousel.tsx
    │       ├── command.tsx (cmdk)
    │       ├── breadcrumb.tsx, toggle.tsx, toggle-group.tsx
    │       ├── input-otp.tsx, alert.tsx
    │       └── chart.tsx         # recharts обёртка (отдельный чанк!)
    │
    ├── hooks/
    │   ├── use-auth.ts           # Auth state, logout (staleTime 5 мин)
    │   ├── use-billing.ts        # Billing status, checkout, cancel (channels + AI)
    │   ├── use-notifications.ts  # Browser notifications + подписка на WS
    │   ├── use-response-templates.ts  # CRUD response templates
    │   ├── useAutoPartsEnabled.ts     # Feature flag AUTO_PARTS_ENABLED
    │   ├── use-mobile.tsx         # Mobile breakpoint (768px)
    │   └── use-toast.ts           # shadcn toast хук
    │
    └── lib/
        ├── queryClient.ts        # TanStack QueryClient + apiRequest() + getQueryFn()
        ├── websocket.ts          # WebSocketClient singleton (wsClient)
        ├── theme-provider.tsx    # ThemeProvider + useTheme
        ├── auth-utils.ts         # Redirect при unauthorized
        └── utils.ts              # cn() для merging Tailwind классов
```

---

## 4. App.tsx — корневой компонент

> **Самый связанный файл фронтенда: 80 соединений.**  
> **Циклическая зависимость:** App.tsx ↔ settings.tsx (единственная — в клиенте)

### AppWrapper (root)

```typescript
<QueryClientProvider client={queryClient}>
  <ThemeProvider defaultTheme="light" storageKey="ai-sales-operator-theme">
    <TooltipProvider>
      <App />
      <Toaster />
    </TooltipProvider>
  </ThemeProvider>
</QueryClientProvider>
```

### App — логика роутинга

```
App()
  ├── useAuth() → { isLoading, isAuthenticated }
  ├── if isLoading → Loader2 spinner fullscreen
  ├── if /owner/* → OwnerRouter (без auth проверки)
  ├── if /login|/signup|/verify-email|/forgot|/reset → AuthRouter
  ├── if !isAuthenticated → LandingPage
  └── else → AuthenticatedApp
```

### AuthenticatedApp — основной shell

**Логика:**

1. Если `isPlatformAdmin || isPlatformOwner` И нет `tenantId` → **platform staff** (перенаправить на `/owner`)
2. Если platform staff + пытается зайти не на `/owner/*` и не `/admin/*` → redirect `/owner`
3. `useNotifications()` — подписка на browser notifications
4. `wsClient.connect()` при mount (если не platform staff), `disconnect()` при unmount
5. Onboarding redirect: если `onboardingState.status !== "DONE"` И `aiBilling.canAccess === true` → `/onboarding`
6. Payment Success Dialog: показывает `PaymentSuccessDialog` когда подписка стала active (localStorage dedupe per period)

**Layout:**

```
SidebarProvider (--sidebar-width: 16rem, --sidebar-width-icon: 3rem)
  └── flex h-screen w-full
        ├── AppSidebar
        └── flex-1 flex-col overflow-hidden
              ├── header h-14 (SidebarTrigger | user email + ThemeToggle + Logout)
              └── main flex-1 overflow-auto
                    └── Router → страницы
```

### AdminGuard

```typescript
function AdminGuard({ children }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Loader2 />;
  if (!user?.isPlatformAdmin && !user?.isPlatformOwner) {
    navigate("/");
    return null;
  }
  return <>{children}</>;
}
```

Используется для всех `/admin/*` маршрутов.

---

## 5. Роутинг (wouter)

### Router (для авторизованных тенантов)

| Путь | Компонент | Guard |
|------|-----------|-------|
| `/` | Dashboard | — |
| `/conversations` | Conversations | — |
| `/customers/:id` | CustomerProfile | — |
| `/knowledge-base` | KnowledgeBase | — |
| `/products` | Products | — |
| `/escalations` | Escalations | — |
| `/crm` | CrmPage | — | CRM страница всех заявок
| `/failed-leads` | FailedLeads | — | (устаревшее, оставлено для compat)
| `/settings` | Settings | — |
| `/onboarding` | Onboarding | — |
| `/analytics` | Analytics | — |
| `/extensions` | Extensions | — |
| `/billing` | Billing | — |
| `/admin/security` | SecurityStatus | AdminGuard |
| `/admin/billing` | AdminBilling | AdminGuard |
| `/admin/secrets` | AdminSecrets | AdminGuard |
| `/admin/users` | AdminUsers | AdminGuard |
| `/admin/proxies` | AdminProxies | AdminGuard |
| `/admin/max-gateway` | AdminMaxGateway | AdminGuard |
| `/admin/tenants` | AdminTenants | AdminGuard |
| `/admin/broadcast` | AdminBroadcast | AdminGuard |
| `*` | NotFound | — |

### AuthRouter (неавторизованные)

| Путь | Компонент |
|------|-----------|
| `/login` | LoginPage (из auth.tsx) |
| `/signup` | SignupPage |
| `/verify-email` | VerifyEmailPage |
| `/forgot-password` | ForgotPasswordPage |
| `/reset-password` | ResetPasswordPage |
| `*` | LandingPage |

### OwnerRouter (без auth проверки)

| Путь | Компонент |
|------|-----------|
| `/owner/login` | OwnerLoginPage |
| `/owner/updates` | OwnerUpdates |
| `/owner` | OwnerDashboard |
| `*` | NotFound |

---

## 6. Страницы (Pages)

### Dashboard (`pages/dashboard.tsx`)

- Обзор 8 метрик через `GET /api/dashboard/metrics` (`DashboardMetrics`)
- Последние эскалации + активные диалоги (последние 5)
- Все тренды — реальные вычисленные данные, **нет захардкоженных значений**:
  - «Всего разговоров» — недельный тренд `±X%` из `conversationsThisWeek` vs `conversationsLastWeek`
  - «Решено сегодня» — сравнение с `resolvedYesterday` (`±N вчера`)
  - «Среднее время ответа» — форматируется через `formatSeconds()` (`Xм Yс`), пометка «за 30 дней»
  - «Точность AI» — реальный % + цвет тренда: ≥80% up, ≥50% neutral, <50% down
- Вспомогательные функции в файле: `weekTrend(thisWeek, lastWeek)`, `formatSeconds(seconds)`

### Conversations (`pages/conversations.tsx`)

**Основной рабочий вид.** Двухпанельный layout: список слева + чат справа.

- Список диалогов (`ConversationList`) с фильтром по статусу: active, waiting, escalated, resolved
- Чат (`ChatInterface`): история + AI-подсказки + поле ввода
- Операции с подсказками: approve, edit, reject, escalate
- `muteMutation` — отключение AI для конкретного диалога
- `refetchInterval: 30000` для списка диалогов
- WebSocket обновления через `new_message`, `conversation_update`, `new_suggestion`

### CustomerProfile (`pages/customer-profile.tsx`)

- Детали клиента: имя, телефон, канал, теги
- Заметки оператора (notes)
- Долгосрочная память (memory)
- История диалогов
- Аватар MAX-пользователя (80×80) через `AvatarImage` + `getMaxAvatarUrl()`

### KnowledgeBase (`pages/knowledge-base.tsx`)

- CRUD документов (policy/FAQ/delivery/returns)
- Поиск + фильтр по категориям
- Кнопка "Переиндексировать RAG" → `POST /api/rag/index`

### Products (`pages/products.tsx`)

- Каталог товаров: CRUD
- Поиск по названию/описанию

### Escalations (`pages/escalations.tsx`)

- Список эскалированных диалогов
- Разрешение эскалаций с комментарием
- Фильтр по статусу

### CrmPage (`pages/crm.tsx`)

- Полноценная CRM для всех входящих заявок из Marquiz и Universal webhook в премиальном стиле **LimesCRM** (в нашей стилистике)
- Три режима отображения: **Доска (Kanban)**, **Таблица** и **Список** с мягкими скруглениями, тенями и градиентными элементами управления
- Интерактивный **HTML5 Drag & Drop** на Доске: лиды можно перетаскивать между колонками для мгновенной смены статуса (`PATCH /api/crm/leads/:id`)
- Мгновенная клиентская **Фильтрация (по источнику)** и **Сортировка (по дате, сумме сделки)**, работающая синхронно во всех трёх режимах отображения
- Доска с статус-зависимыми цветными бейджами, кнопками быстрого добавления в колонках и плейсхолдерами пустого состояния
- Элегантные карточки лидов с аватарками инициалов, индикатором относительного времени, структурированными полями контактов, бюджетом сделки и футером: вертикальные блоки "Источник" и "Ответственный" (с визуальным AI-робот аватаром)
- Клик по карточке → диалоговое окно `Dialog` с детальной информацией, сменой статуса, заметками оператора и метаданными
- Данные из `GET /api/crm/leads` + `GET /api/crm/stats` с автообновлением каждые 15 секунд

### FailedLeads (`pages/failed-leads.tsx`)

- **Устаревшая страница** — оставлена для обратной совместимости
- Заявки из Marquiz/Universal webhook, которые не удалось доставить ни в один мессенджер
- Данные из `GET /api/failed-leads` (conversations.status = "failed_delivery")

### Settings (`pages/settings.tsx`)

> Подробно в [разделе 7](#7-страница-settings-5384-строки).

### Onboarding (`pages/onboarding.tsx`)

- 6-шаговый wizard: бизнес-данные, каталог, база знаний, каналы, AI-тест, готово
- Прогресс-бар (`Progress`)
- GPT-генерация policy/FAQ на шаге "База знаний"
- Smoke-тест AI на шаге "AI-тест"
- Блокирован за paywall до оплаты AI-подписки

### Analytics (`pages/analytics.tsx`)

- Графики recharts: CSAT, конверсии, интенты, lost-deals
- **Отдельный чанк** (recharts тяжелый — исключён из main bundle)
- Периоды: 7d, 30d, 90d

### Billing (`pages/billing.tsx`)

- Статус подписки channels: активна/триал/неактивна
- CryptoBot checkout через Telegram бота
- Отмена подписки
- `useBillingStatus` (staleTime: 30s, refetchInterval: 60s)

### Extensions (`pages/extensions.tsx`)

- **AI Agent подписка** (отдельно от channels): возможности, цена
- `useAiBillingStatus`, `useCreateAiCheckout`, `useCancelAiSubscription`
- "Coming Soon" расширения: Веб-виджет, Расширенная аналитика

### Auth (`pages/auth.tsx`)

Один файл, 5 именованных экспортов (каждый wrapped в `lazy()` отдельно):
- `LoginPage` — email + пароль, ссылки на signup/forgot
- `SignupPage` — имя компании, email, пароль
- `VerifyEmailPage` — ввод кода из письма
- `ForgotPasswordPage` — запрос письма
- `ResetPasswordPage` — новый пароль по токену

### LandingPage (inline в App.tsx)

- Маркетинговая лендинг-страница для неавторизованных
- 3 feature-карточки: Мультиканальность, ИИ-подсказки, Контроль качества
- CTA кнопки: Войти, Регистрация, Начать работу

### Admin Pages (все за AdminGuard)

| Страница | Файл | Описание |
|---------|------|----------|
| SecurityStatus | `security-status.tsx` | Security readiness: RBAC, PII, webhook, rate-limiting |
| AdminBilling | `admin-billing.tsx` | Метрики биллинга, все подписки, цены (subscriptionPrice, aiAgentPrice, trialHours, **extraAccountPrice**), гранты, trial hours |
| AdminSecrets | `admin-secrets.tsx` | API-ключи интеграций: OpenAI, Telegram, Yandex и др. |
| AdminUsers | `admin-users.tsx` | Пользователи платформы: enable/disable |
| AdminProxies | `admin-proxies.tsx` | Прокси-пул: добавление, тест, удаление |
| AdminMaxGateway | `admin-max-gateway.tsx` | MAX Gateway: аккаунты, QR-авторизация, статус |
| AdminTenants | `admin-tenants.tsx` | Поиск тенантов, переключение AUTO_PARTS_ENABLED |
| AdminBroadcast | `admin-broadcast.tsx` | Рассылки через Telegram notification-бот |

### Owner Pages (без AdminGuard, отдельный роутер)

| Страница | Файл | Описание |
|---------|------|----------|
| OwnerLogin | `owner-login.tsx` | Логин platform owner (отдельная форма) |
| OwnerDashboard | `owner-dashboard.tsx` | Сводный дашборд owner |
| OwnerUpdates | `owner-updates.tsx` | Загрузка и применение системных обновлений |

---

## 7. Страница Settings (~5384 строки)

**Файл:** `client/src/pages/settings.tsx`  
**Импорт:** lazy-loaded отдельным чанком.  
**Связанность:** входит в цикл App.tsx ↔ settings.tsx.

### 7 вкладок

| Вкладка | Value | Описание |
|---------|-------|----------|
| Бизнес | `business` | Название, язык, тон, адресация (вы/ты), валюта, timezone |
| Связь | `communication` | Рабочие часы, авто-ответ вне рабочего времени |
| Escalation | `escalation` | Email, Telegram username, escalationChatId |
| Обучение AI | `ai-training` | TrainingPoliciesSettings (за AI paywall) |
| Шаблоны и Оплата | `templates-payment` | TemplatesTab + Separator + PaymentMethodsTab |
| Каналы | `channels` | ChannelSettings — все 6 каналов |
| Приём заявок | `lead-intake` | LeadIntakeTab (Marquiz + Universal webhooks) |

### Ключевые под-компоненты Settings

| Компонент | Что делает |
|-----------|-----------|
| `ChannelSettings` | Статус каналов, toggle (paywall), конфиг (токен), Telegram Personal QR/код/2FA, WhatsApp Baileys QR, MAX Personal GREEN-API список аккаунтов |
| `MaxPersonalCard` | Управление аккаунтами MAX Personal. Первые 5 — бесплатно при подписке `channels`. Аккаунты 6+ требуют подписки `extra_max_accounts`. При попытке создания 6+ показывает диалог оплаты с ценой из `publicConfig.extraAccountPrice`. Кнопка при исчерпании бесплатных слотов меняется на «Добавить аккаунт — N USDT/мес». Создание аккаунта использует raw `fetch` (не `apiRequest`) чтобы корректно обработать `402`. Запрос к `GET /api/billing/extra-accounts/me` отражает статус подписки. |
| `TrainingPoliciesSettings` | Forbidden topics, AUTO_LEARNING_ENABLED флаг, always-escalate intents |
| `TemplatesTab` | CRUD шаблонов message_templates с preview рендерером |
| `PaymentMethodsTab` | CRUD + реордер payment_methods (drag-and-drop порядок) |
| `LeadIntakeTab` | Показ webhook URLs (Marquiz + Universal) с кнопками копирования |
| `DecisionEngineSettings` | tAuto, tEscalate, autosend, intentsForceHandoff (за AI paywall) |
| `AgentSettingsTab` | companyName, specialization, warehouseCity, objection scripts, systemPrompt, mileage tiers |

### Паттерн данных Settings

```typescript
// Главная форма: react-hook-form + Zod
const form = useForm<SettingsFormValues>({
  resolver: zodResolver(settingsFormSchema),
  defaultValues: { ... },
});

// Загрузка тенанта
const { data: tenant } = useQuery<Tenant>({ queryKey: ["/api/tenant"] });

// Payment success detection
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const billingParam = params.get("billing");
  // "success" — channels subscription
  // "extra_accounts_success" — extra MAX accounts subscription
  if (billingParam !== "success" && billingParam !== "extra_accounts_success") return;
  // verify payment + invalidate billing queries
}, []);
```

---

## 8. Компоненты

### AppSidebar (`components/app-sidebar.tsx`)

Навигационная панель с двумя секциями:

**Основная навигация (для тенантов):**

| Пункт | URL | Иконка |
|-------|-----|--------|
| Дашборд | `/` | LayoutDashboard |
| Диалоги | `/conversations` | MessageSquare |
| База знаний | `/knowledge-base` | BookOpen |
| Товары | `/products` | Package |
| Эскалации | `/escalations` | AlertTriangle |
| Заявки (CRM) | `/crm` | Users | Показывает счётчик новых заявок (синий Badge)
| Аналитика | `/analytics` | BarChart3 |
| Настройки | `/settings` | Settings2 |
| Оплата | `/billing` | CreditCard |
| AI Агент | `/extensions` | Bot |

**Admin-навигация (isPlatformAdmin || isPlatformOwner):**

| Пункт | URL |
|-------|-----|
| Мониторинг | `/admin/security` |
| Секреты | `/admin/secrets` |
| Биллинг | `/admin/billing` |
| Пользователи | `/admin/users` |
| Прокси | `/admin/proxies` |
| MAX Gateway | `/admin/max-gateway` |
| Тенанты | `/admin/tenants` |
| Рассылки | `/admin/broadcast` |
| Обновления | `/owner/updates` |

Бейджи: кол-во непрочитанных сообщений + кол-во активных эскалаций.

### ChatInterface (`components/chat-interface.tsx`)

- История сообщений (клиент/ассистент/owner)
- AI-подсказки с кнопками: Отправить, Редактировать, Отклонить, Эскалировать
- Поле ввода с кнопкой отправки оператором
- Индикатор "AI печатает..."
- Auto-scroll к последнему сообщению
- Поддержка вложений (image, voice, document и др.)

### SubscriptionPaywall (`components/subscription-paywall.tsx`)

Несколько экспортов для разных сценариев блокировки:

| Экспорт | Использование |
|---------|--------------|
| `<SubscriptionPaywall>` | Полная страница блокировки с CTA |
| `<ChannelPaywallOverlay>` | Overlay поверх channel-настроек |
| `<SubscriptionBadge>` | Бейдж "Trial" / "Active" |
| `<PaymentSuccessDialog>` | Диалог после успешной оплаты |
| `usePublicBillingConfig()` | Хук: subscriptionPrice, aiAgentPrice из public endpoint |

---

## 9. Хуки (Hooks)

### `use-auth.ts`

```typescript
export function useAuth() {
  // GET /api/auth/user — staleTime: 5 мин
  // Logout: немедленно queryClient.setQueryData(null) + removeQueries + navigate("/login")
  return { user, isLoading, isAuthenticated, logout, isLoggingOut };
}
```

**Поля user:**
```typescript
interface AuthUser {
  id, username?, email?, firstName?, lastName?,
  role?,           // "owner" | "admin" | "operator" | "viewer" | "guest"
  tenantId?,
  authProvider?,
  isPlatformAdmin?,
  isPlatformOwner?,
  profileImageUrl?
}
```

### `use-billing.ts`

```typescript
// Channels subscription
useBillingStatus()        // GET /api/billing/me, staleTime: 30s, refetchInterval: 60s
useCreateCheckout()       // POST /api/billing/checkout
useCancelSubscription()   // POST /api/billing/cancel

// AI Agent subscription (отдельная от channels)
useAiBillingStatus()      // GET /api/billing/ai/me
useCreateAiCheckout()     // POST /api/billing/ai/checkout
useCancelAiSubscription() // POST /api/billing/ai/cancel

isSubscriptionRequired(error)  // Проверка кода ошибки SUBSCRIPTION_REQUIRED
```

**BillingStatus:**
```typescript
interface BillingStatus {
  hasSubscription: boolean;
  status: string | null;         // "active" | "trial" | "expired" | null
  plan: { id, name, price } | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canAccess: boolean;            // true если active или trial
  isTrial: boolean;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  hadTrial: boolean;
}
```

### `use-notifications.ts`

- Запрашивает разрешение на browser notifications
- Подписывается на WS-события `new_message` → показывает browser notification
- Импортирует `showBrowserNotification` из этого хука в `websocket.ts`
- **Циклическая зависимость:** use-notifications ↔ websocket.ts (известная проблема)

### `useAutoPartsEnabled.ts`

```typescript
export function useAutoPartsEnabled(): boolean {
  // GET /api/feature-flags/AUTO_PARTS_ENABLED/check
  // Используется в Settings для условного показа VIN/FRAME UI
}
```

### `use-response-templates.ts`

```typescript
useResponseTemplates()          // GET /api/response-templates
useCreateResponseTemplate()     // POST /api/response-templates
useDeleteResponseTemplate()     // DELETE /api/response-templates/:id
```

### `use-mobile.tsx`

```typescript
export function useIsMobile() {
  // breakpoint: 768px
  // window.matchMedia("(max-width: 767px)")
  return isMobile; // boolean
}
```

---

## 10. Библиотеки (lib/)

### `queryClient.ts`

**TanStack QueryClient конфигурация:**

```typescript
defaultOptions: {
  queries: {
    queryFn: getQueryFn({ on401: "throw" }),
    refetchInterval: false,      // нет auto-refetch
    refetchOnWindowFocus: false, // нет refetch при фокусе окна
    staleTime: Infinity,         // данные никогда не устаревают автоматически
    retry: false,                // нет автоматических retry
  },
  mutations: { retry: false },
}
```

**Паттерн queryKey:** строка URL как ключ — `/api/resource` или `["/api/resource", id]`.

**`apiRequest(method, url, data?)`:**

```typescript
export async function apiRequest(method: string, url: string, data?: unknown) {
  // Добавляет X-CSRF-Token заголовок (из cookie)
  // credentials: "include" (session cookies)
  // Throws на не-OK ответах
}
```

**`getQueryFn({ on401 })`:**
- `on401: "returnNull"` → возвращает null (используется для auth check)
- `on401: "throw"` → бросает ошибку → TanStack Query показывает error state

### `websocket.ts`

**Класс `WebSocketClient`:**

```typescript
class WebSocketClient {
  connect()    // ws:// или wss:// /ws (авто-детект протокола)
  disconnect()
  on(event, handler)   // подписка
  off(event, handler)  // отписка
  
  // Стратегия реконнекта:
  // maxReconnectAttempts: 5
  // reconnectDelay: 2000ms * attempts (exponential)
}

export const wsClient = new WebSocketClient(); // синглтон
```

**Обработка событий → `queryClient.invalidateQueries`:**

| WS событие | Инвалидирует |
|-----------|-------------|
| `new_message` | `["/api/conversations", conversationId]` + весь список |
| `conversation_update` | `["/api/conversations"]` + `["/api/conversations", id]` |
| `new_conversation` | `["/api/conversations"]` |
| `new_suggestion` | `["/api/conversations", conversationId]` |

### `theme-provider.tsx`

```typescript
// Три режима: "dark" | "light" | "system"
// Хранится в localStorage: ключ "ai-sales-operator-theme"
// Применяет class "dark" | "light" на <html>

export function ThemeProvider({ defaultTheme = "light", ... })
export const useTheme = () => useContext(ThemeProviderContext)
```

---

## 11. WebSocket клиент

**Подключение:** `wsClient.connect()` в `AuthenticatedApp` при mount.  
**Отключение:** `wsClient.disconnect()` при unmount.  
**Platform staff** (без tenantId) — WS **не подключается** (сервер отверг бы с 403).

**WS событие `message_read`** — отправляется когда контакт прочитал наши сообщения (MAX, Telegram Personal, WhatsApp Personal). Payload: `{ conversationId, lastReadAt: ISO8601 }`. Клиент инвалидирует `["/api/conversations", conversationId]`. `ChatInterface` показывает двойную галочку (✓✓) на **всех** исходящих сообщениях, у которых `createdAt ≤ lastReadAt`; одиночная галочка — на отправленных позже. Это гарантирует, что уже прочитанные сообщения не теряют статус при отправке новых.

**Протокол (client → server):**

```json
{ "type": "subscribe", "conversationId": "..." }   // подписаться на конкретный разговор
{ "type": "set_tenant", "tenantId": "..." }          // привязать к тенанту (только без auth)
{ "type": "ping" }                                    // keepalive
```

**Протокол (server → client):**

```json
{ "type": "new_message", "conversationId": "...", "message": {...} }
{ "type": "conversation_update", "conversation": {...} }
{ "type": "new_conversation", "conversation": {...} }
{ "type": "new_suggestion", "conversationId": "...", "suggestion": {...} }
{ "type": "pong" }
{ "type": "error", "message": "..." }
```

---

## 12. Система стилей

### Tailwind + CSS переменные

**Файл:** `client/src/index.css`

Переменные определены в `:root` (light) и `.dark` (dark mode) для адаптивной поддержки тем. Система стилей адаптирована под премиальный дизайн **Rent Flow** с акцентным цветом Dodger Blue и круглыми формами.

**Основные переменные:**

| Переменная | Light (hsl) | Dark (hsl) | Назначение |
|-----------|------------|------------|------------|
| `--background` | 240 14% 97% | 210 9% 9% | Фон страницы |
| `--foreground` | 222.2 47.4% 11.2% | 210 20% 98% | Основной текст |
| `--primary` | 230 100% 65% | 230 100% 65% | Акцентный синий (Dodger Blue) |
| `--card` | 0 0% 100% | 210 9% 13% | Фон карточек |
| `--sidebar` | 210 9% 13% | 210 9% 11% | Фон sidebar (всегда тёмный) |
| `--destructive` | 346.8 84.1% 49.8% | 346.8 84.1% 60.2% | Красно-розовый (ошибки/удаление) |
| `--muted` | 220 13% 95% | 210 9% 15% | Приглушённые элементы |
| `--radius` | 1rem | 1rem | Базовый радиус скруглений (16px) |

**Tailwind конфиг (`tailwind.config.ts`):**
- `darkMode: ["class"]` — через CSS class на корневом элементе
- `content`: `./client/index.html`, `./client/src/**/*.{js,jsx,ts,tsx}`
- Кастомные `borderRadius` рассчитываются динамически: `lg: "var(--radius)"` (16px), `md: "calc(var(--radius) - 4px)"` (12px), `sm: "calc(var(--radius) - 8px)"` (8px).
- Все shadcn цвета подключены через CSS переменные с поддержкой альфа-канала (прозрачности).
- Добавлены полноценные семантические группы цветов (`success`, `warning`, `info`) с собственными `foreground` и `muted` состояниями для премиального отображения статусов.

### shadcn/ui

- Стиль: **new-york**
- База: **neutral**
- Через `components.json`
- `cn()` из `lib/utils.ts` — merging `clsx` + `tailwind-merge`
- `getCustomerAvatarUrl(customer)` из `lib/utils.ts` — возвращает проксированный URL аватара для `max_personal`, `whatsapp_personal`, `telegram_personal` или `null`:
  - `max_personal` → `/api/channels/max-personal/:accountId/media/photo?url=...` (CDN URL из `customer.metadata.avatarUrl`)
  - `whatsapp_personal` → `/api/whatsapp-personal/avatar?jid=...` (Baileys `profilePictureUrl`, on-demand, кэш 1 ч)
  - `telegram_personal` → `/api/telegram-personal/avatar/:accountId/:userId` (gramjs `downloadProfilePhoto`, кэш 24 ч)
  - `@lid` контакты WA пропускаются (ненадёжно). Применяется в `conversation-list`, `customer-card`, `customer-profile`.
- `getMaxAvatarUrl` — deprecated-псевдоним для `getCustomerAvatarUrl`.

> **НЕЛЬЗЯ** редактировать файлы в `client/src/components/ui/` вручную. Только через shadcn CLI.

---

## 13. Брендинг

**Файл:** `client/src/components/brand-logo.tsx`

```typescript
export const BRAND_NAME = "NexusChat";
export const BRAND_TAGLINE = "Умная автоматизация";

// SVG логотип: градиент фиолетовый (#8B5CF6) → синий (#3B82F6)
// Три пузыря с 3 точками, хвост
export function BrandLogoIcon({ className, size = 32 })
```

Используется в: LandingPage, AppSidebar, Onboarding.

---

## 14. Code Splitting (Lazy Loading)

Все страницы загружаются через `React.lazy()` с `Suspense fallback={<PageLoader />}`.

**Стратегия чанков:**

| Чанк | Что включает | Причина |
|------|-------------|---------|
| main bundle | App.tsx, core libs | Максимально маленький |
| analytics | analytics.tsx + recharts | recharts тяжёлый |
| settings | settings.tsx | ~5384 строк |
| admin-* | все admin страницы | Редко используются |
| auth | LoginPage, SignupPage и т.д. | Общий чанк, 5 named exports |

**Паттерн для named exports:**

```typescript
const LoginPage = lazy(() => import("@/pages/auth").then((m) => ({ default: m.LoginPage })));
```

**PageLoader:** `Loader2 animate-spin` по центру.

---

## 15. Паттерны работы с данными

### Чтение данных

```typescript
const { data, isLoading, error } = useQuery<Type>({
  queryKey: ["/api/resource"],         // строка URL = ключ кэша
  staleTime: Infinity,                 // дефолт: не устаревает
});

// С параметрами:
const { data } = useQuery<Type>({
  queryKey: ["/api/resource", id],
  queryFn: async () => {
    const res = await fetch(`/api/resource/${id}`, { credentials: "include" });
    if (!res.ok) throw new Error("...");
    return res.json();
  },
});
```

### Мутации

```typescript
const mutation = useMutation({
  mutationFn: async (data: InputType) => {
    const res = await apiRequest("POST", "/api/resource", data);
    return res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/resource"] });
    toast({ title: "Сохранено" });
  },
  onError: () => {
    toast({ title: "Ошибка", variant: "destructive" });
  },
});
```

### Paywall проверка

```typescript
const { data: billingStatus } = useBillingStatus();
const canAccess = billingStatus?.canAccess ?? false;

if (!canAccess) return <SubscriptionPaywall />;
// или
if (!canAccess) return <div className="relative"><ChannelPaywallOverlay />{content}</div>;
```

### Форма (react-hook-form + Zod)

```typescript
const schema = z.object({ name: z.string().min(1) });
type FormValues = z.infer<typeof schema>;

const form = useForm<FormValues>({
  resolver: zodResolver(schema),
  defaultValues: { name: "" },
});

const onSubmit = form.handleSubmit((data) => mutation.mutate(data));

return (
  <Form {...form}>
    <form onSubmit={onSubmit}>
      <FormField control={form.control} name="name" render={({ field }) => (
        <FormItem>
          <FormLabel>Название</FormLabel>
          <FormControl><Input {...field} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />
      <Button type="submit" disabled={mutation.isPending}>Сохранить</Button>
    </form>
  </Form>
);
```

---

## 16. Билинг — интеграция UI

Существуют **два независимых продукта** с отдельными подписками:

| Продукт | Endpoint | Страница | Hook |
|---------|---------|---------|------|
| Channels (мессенджеры) | `/api/billing/*` | `/billing` | `useBillingStatus` |
| AI Agent | `/api/billing/ai/*` | `/extensions` | `useAiBillingStatus` |

**Логика доступа:**

```
canAccess = status === "active" OR status === "trial"
```

**UI-паттерн для protected-контента:**

1. Блок целиком: `if (!canAccess) return <SubscriptionPaywall />`
2. Overlay: `<ChannelPaywallOverlay />` поверх контента
3. Отдельный таб с блокировкой: `{!hasAiAccess ? <AiSubscriptionRequired /> : <Content />}`

**Payment Success Flow:**

| Тип подписки | successUrl | billing param | verify endpoint | invalidates |
|---|---|---|---|---|
| channels | `/settings?billing=success` | `success` | `POST /api/billing/verify-payment` | `/api/billing/me`, `/api/billing/ai/me` |
| extra_max_accounts | `/settings?tab=channels&billing=extra_accounts_success` | `extra_accounts_success` | `POST /api/billing/extra-accounts/verify-payment` | `/api/billing/extra-accounts/me` |

1. CryptoBot redirect → settings с соответствующим `?billing=…` параметром
2. `useEffect` в Settings обнаруживает параметр, вызывает нужный verify endpoint (fallback если webhook не пришёл)
3. После верификации инвалидирует нужные query keys → UI обновляется
4. Показывает `PaymentSuccessDialog` + `markSubscriptionDialogShown(periodEnd)` (только для channels)
5. Глобально (не на settings): `AuthenticatedApp` тоже отслеживает billing status → показывает диалог (с dedupe через localStorage)

---

## 17. Критические ограничения

1. **НЕ** использовать `react-router` — только `wouter`
2. **НЕ** использовать `axios` — только `apiRequest()` из `lib/queryClient.ts`
3. **НЕ** редактировать файлы `client/src/components/ui/` вручную — только shadcn CLI
4. **НЕ** делать прямые `fetch()` без `credentials: "include"` (cookie не будет отправлен)
5. **НЕ** добавлять глобальный стейт-менеджер (Redux/Zustand) — только React Query + useState
6. **НЕ** добавлять recharts или другие тяжёлые библиотеки в main bundle без отдельного lazy чанка
7. **НЕ** использовать `refetchOnWindowFocus: true` — противоречит дефолтной конфигурации
8. **НЕ** создавать страницы без lazy() — для поддержания малого initial bundle
9. **НЕ** хардкодить цены — использовать `usePublicBillingConfig()` (цена меняется в admin)
10. **НЕ** обходить paywall проверку — каждая AI-фича должна проверять `aiBilling.canAccess`
11. **НЕ** обращаться к серверу без CSRF-токена (он добавляется в `apiRequest` автоматически)

### Паттерн добавления новой страницы

```typescript
// 1. Создать файл client/src/pages/my-page.tsx
// 2. В App.tsx добавить lazy import:
const MyPage = lazy(() => import("@/pages/my-page"));
// 3. Добавить маршрут в Router():
<Route path="/my-page" component={MyPage} />
// 4. Добавить пункт в AppSidebar (если нужно в навигации)
```

### Паттерн добавления нового хука

```typescript
// client/src/hooks/use-my-feature.ts
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function useMyData() {
  return useQuery<MyType[]>({ queryKey: ["/api/my-endpoint"] });
}

export function useCreateMyData() {
  return useMutation({
    mutationFn: async (data: Input) => {
      const res = await apiRequest("POST", "/api/my-endpoint", data);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/my-endpoint"] }),
  });
}
```

---

*Этот документ создан на основе автоматического анализа SocratiCode (2692 чанков, 308 файлов).*  
*Для поддержания актуальности — обновлять при добавлении новых страниц, компонентов, хуков.*
