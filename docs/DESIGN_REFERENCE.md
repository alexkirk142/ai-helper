# DESIGN_REFERENCE.md — AI Sales Operator

> Полный справочник по дизайн-системе проекта: токены, цвета, типографика, компоненты.  
> Как безопасно изменить любой визуальный аспект без поломки UI.  
> Обновлён: 2026-05-22.

---

## Содержание

1. [Архитектура дизайн-системы](#1-архитектура-дизайн-системы)
2. [Цветовые токены (CSS переменные)](#2-цветовые-токены-css-переменные)
3. [Семантические цвета — как использовать](#3-семантические-цвета--как-использовать)
4. [Типографика](#4-типографика)
5. [Скругления (border-radius)](#5-скругления-border-radius)
6. [Тени (shadows) и система elevation](#6-тени-shadows-и-система-elevation)
7. [Тёмная / светлая тема](#7-тёмная--светлая-тема)
8. [Брендинг](#8-брендинг)
9. [shadcn/ui — работа с компонентами](#9-shadcnui--работа-с-компонентами)
10. [Проблемные зоны — хардкодированные цвета](#10-проблемные-зоны--хардкодированные-цвета)
11. [Как безопасно изменить дизайн](#11-как-безопасно-изменить-дизайн)
12. [Чеклист смены акцентного цвета](#12-чеклист-смены-акцентного-цвета)
13. [Чеклист ребрендинга](#13-чеклист-ребрендинга)

---

## 1. Архитектура дизайн-системы

```
Дизайн-система
├── index.css              — ЕДИНСТВЕННЫЙ источник всех токенов (CSS переменные)
│   ├── :root {}           — Light mode токены
│   └── .dark {}           — Dark mode токены
│
├── tailwind.config.ts     — Маппинг CSS переменных → Tailwind классы
│
├── components.json        — shadcn/ui конфиг (style: "new-york", base: neutral)
│
├── components/ui/         — shadcn/ui примитивы (ТОЛЬКО через CLI)
│
└── components/brand-logo.tsx  — Логотип + BRAND_NAME + BRAND_TAGLINE
```

### Принцип работы

1. Все **семантические токены** определены как CSS-переменные в `index.css`
2. `tailwind.config.ts` переводит их в Tailwind-классы: `bg-primary`, `text-muted-foreground` и т.д.
3. Компоненты используют **только семантические классы** (в идеале), а не прямые цвета типа `bg-blue-500`
4. Смена темы — добавление класса `dark` на `<html>`, переменные меняются автоматически

### Вердикт

**Токенная система выстроена правильно.** Все 35+ переменных определены в `index.css`.  
Главная проблема — **часть компонентов и страниц обходит систему**, используя захардкоженные Tailwind-цвета.

---

## 2. Цветовые токены (CSS переменные)

### Полная таблица токенов

Все токены определены в `client/src/index.css`. Формат: `H S% L%` (для HSL через Tailwind).

#### Базовые поверхности

| Переменная | Light (HSL) | Dark (HSL) | Tailwind класс |
|-----------|------------|-----------|----------------|
| `--background` | 240 5% 98% | 240 10% 3.9% | `bg-background` |
| `--foreground` | 240 10% 4% | 0 0% 98% | `text-foreground` |
| `--border` | 240 6% 90% | 240 3.7% 15.9% | `border-border` |
| `--input` | 240 6% 90% | 240 3.7% 15.9% | `border-input` |
| `--ring` | 250 84% 54% | 250 84% 60% | `ring-ring` |

#### Карточки

| Переменная | Light | Dark | Tailwind |
|-----------|-------|------|---------|
| `--card` | 0 0% 100% | 240 10% 5.9% | `bg-card` |
| `--card-foreground` | 240 10% 4% | 0 0% 98% | `text-card-foreground` |
| `--card-border` | 240 6% 93% | 240 3.7% 12.9% | `border-card-border` |

#### Сайдбар

| Переменная | Light | Dark | Tailwind |
|-----------|-------|------|---------|
| `--sidebar` | 210 9% 13% | 210 9% 11% | `bg-sidebar` |
| `--sidebar-foreground` | 210 10% 88% | 210 10% 88% | `text-sidebar-foreground` |
| `--sidebar-border` | 210 9% 10% | 210 9% 9% | `border-sidebar-border` |
| `--sidebar-primary` | 230 100% 65% | 230 100% 65% | `bg-sidebar-primary` |
| `--sidebar-accent` | 210 9% 18% | 210 9% 16% | `bg-sidebar-accent` |

#### Акцентные

| Переменная | Light | Dark | Tailwind | Назначение |
|-----------|-------|------|---------|-----------|
| `--primary` | **230 100% 65%** | **230 100% 65%** | `bg-primary`, `text-primary` | Основной акцент (Dodger Blue #4C6BFF) |
| `--primary-foreground` | 0 0% 100% | 0 0% 100% | `text-primary-foreground` | Текст на primary |
| `--secondary` | 220 13% 95% | 210 9% 15% | `bg-secondary` | Второстепенный |
| `--muted` | 220 13% 95% | 210 9% 15% | `bg-muted` | Приглушённый фон |
| `--muted-foreground` | 220 13% 45% | 210 10% 65% | `text-muted-foreground` | Вспомогательный текст |
| `--accent` | 220 13% 93% | 210 9% 15% | `bg-accent` | Hover-состояния |
| `--destructive` | 346.8 84.1% 49.8% | 346.8 84.1% 60.2% | `bg-destructive` | Опасные действия (красно-розовый) |

#### Popover

| Переменная | Light | Dark | Tailwind |
|-----------|-------|------|---------|
| `--popover` | 210 6% 92% | 210 8% 14% | `bg-popover` |
| `--popover-foreground` | 210 8% 16% | 210 8% 94% | `text-popover-foreground` |
| `--popover-border` | 210 8% 86% | 210 10% 20% | `border-popover-border` |

#### Статусы (CSS переменные, НО проблема с Tailwind-маппингом — см. раздел 10)

| Переменная | Light HSL | Dark HSL |
|-----------|----------|---------|
| `--status-online` | 142 76% 42% | 142 76% 52% |
| `--status-away` | 45 93% 47% | 45 93% 52% |
| `--status-busy` | 0 84% 60% | 0 84% 65% |
| `--status-offline` | 210 10% 60% | 210 10% 50% |

В `tailwind.config.ts` они замаплены как **захардкоженные** `rgb()` значения (проблема!):
```typescript
status: {
  online: "rgb(34 197 94)",   // ← не использует CSS переменные
  away: "rgb(245 158 11)",
  busy: "rgb(239 68 68)",
  offline: "rgb(156 163 175)",
}
```

#### Графики

| Переменная | Light HSL | Dark HSL | Tailwind |
|-----------|----------|---------|---------|
| `--chart-1` | 210 78% 38% | 210 78% 68% | `bg-chart-1` |
| `--chart-2` | 195 68% 42% | 195 68% 72% | `bg-chart-2` |
| `--chart-3` | 165 58% 38% | 165 58% 68% | `bg-chart-3` |
| `--chart-4` | 150 52% 35% | 150 52% 65% | `bg-chart-4` |
| `--chart-5` | 135 48% 32% | 135 48% 62% | `bg-chart-5` |

#### Специальные утилитарные переменные (не в Tailwind)

| Переменная | Использование |
|-----------|--------------|
| `--elevate-1` | Hover-overlay: rgba(0,0,0,0.03) / rgba(255,255,255,0.04) |
| `--elevate-2` | Active-overlay: rgba(0,0,0,0.08) / rgba(255,255,255,0.09) |
| `--button-outline` | Граница кнопок: rgba(0,0,0,0.10) |
| `--badge-outline` | Граница бейджей: rgba(0,0,0,0.05) |
| `--opaque-button-border-intensity` | -8 (light) / 9 (dark) — для CSS `calc()` в border |
| `--*-border` | primary-border, secondary-border и т.д. — авто-расчёт через `hsl(from ...)` |

---

## 3. Семантические цвета — как использовать

### Правильный паттерн

```tsx
// ✅ ПРАВИЛЬНО — использует CSS переменные
<div className="bg-background text-foreground">
<div className="bg-card border-border text-card-foreground">
<p className="text-muted-foreground">
<Button className="bg-primary text-primary-foreground">
<Badge className="bg-destructive/10 text-destructive">

// ✅ С прозрачностью (alpha)
<div className="bg-primary/10 text-primary">    // 10% прозрачность

// ❌ НЕПРАВИЛЬНО — хардкодированный цвет, не меняется с темой
<div className="bg-blue-600 text-white">
<p className="text-green-500">
<Badge className="bg-red-100">
```

### Семантика каждого токена

| Токен | Когда использовать |
|-------|-------------------|
| `bg-background` | Фон всей страницы |
| `bg-card` | Карточки, панели |
| `bg-popover` | Дропдауны, тултипы |
| `bg-primary` | Главные CTA-кнопки, ключевые элементы |
| `bg-secondary` | Второстепенные кнопки |
| `bg-muted` | Disabled-состояния, фон skeleton |
| `bg-accent` | Hover-состояния пунктов меню |
| `bg-destructive` | Кнопки удаления/опасных действий |
| `text-foreground` | Основной текст |
| `text-muted-foreground` | Вспомогательный/описательный текст |
| `border-border` | Границы большинства элементов |
| `border-input` | Границы полей ввода |

### Для статус-цветов (правильный способ)

```tsx
// Пока status-токены в Tailwind захардкожены — используй прямо:
<div className="bg-status-online">    // зелёный
<div className="text-status-away">   // жёлтый
<div className="bg-status-busy">     // красный
<div className="bg-status-offline">  // серый

// ИЛИ используй destructive для "ошибка/занят" и success через muted:
// (до исправления маппинга в tailwind.config.ts)
```

---

## 4. Типографика

### Шрифты

Определены как CSS переменные в `:root`:

```css
--font-sans: Inter, system-ui, sans-serif;   /* основной */
--font-serif: Georgia, serif;                /* не используется */
--font-mono: JetBrains Mono, monospace;      /* не используется */
```

Подключены в `tailwind.config.ts`:
```typescript
fontFamily: {
  sans: ["var(--font-sans)"],
  serif: ["var(--font-serif)"],
  mono: ["var(--font-mono)"],
}
```

**Реально используется только `font-sans`** (через `@apply font-sans` на `body`).  
Inter загружается как системный шрифт — **не подключён через @import/link** (нет CDN-загрузки).  
Если Inter не установлен в OS — фолбэк `system-ui`.

### Иерархия заголовков (фактически используемые классы)

Нет формализованной системы типографики — каждая страница использует классы по-своему:

| Класс | Пример использования |
|-------|---------------------|
| `text-3xl font-semibold` | Главный заголовок страницы (dashboard) |
| `text-2xl font-bold` | Заголовки admin-страниц |
| `text-xl font-semibold` | Заголовки секций |
| `text-lg` (в `<CardTitle>`) | Заголовок карточки |
| `text-sm font-medium` | Основной текст строки |
| `text-xs text-muted-foreground` | Вторичные метки, даты |
| `text-sm text-muted-foreground` | Описания, подзаголовки |

**Проблема:** нет единого компонента `<PageTitle>` — заголовки хардкодятся на каждой странице.

### Рекомендуемый паттерн заголовков страниц

На разных страницах по-разному. Для консистентности рекомендуется:

```tsx
// h1 страницы — можно привести к единому виду
<h1 className="text-2xl font-bold tracking-tight">Название страницы</h1>
<p className="text-sm text-muted-foreground">Описание</p>
```

---

## 5. Скругления (border-radius)

Кастомные значения в `tailwind.config.ts` динамически вычисляются от базовой CSS переменной `--radius`:

| Tailwind класс | Значение | Пиксели |
|---------------|---------|---------|
| `rounded-sm` | `calc(var(--radius) - 8px)` | 4px |
| `rounded-md` | `calc(var(--radius) - 4px)` | 8px |
| `rounded-lg` | `var(--radius)` | 12px |
| `rounded-full` | 9999px | круг |

CSS переменная: `--radius: 1rem` (16px) — используется как базовый радиус для всех карточек, полей ввода и кнопок, обеспечивая мягкий и премиальный скруглённый дизайн в стиле современных CRM-систем (Rent Flow).

**Чтобы изменить глобальное скругление** — изменить `--radius` в `index.css` И/ИЛИ значения в `tailwind.config.ts`.

---

## 6. Тени (shadows) и система elevation

### CSS переменные теней

Определены в `index.css`, разные значения для light/dark:

| Переменная | Light | Dark |
|-----------|-------|------|
| `--shadow-2xs` | barely visible | stronger |
| `--shadow-xs` | subtle | stronger |
| `--shadow-sm` | small | stronger |
| `--shadow` | default | stronger |
| `--shadow-md` | medium | stronger |
| `--shadow-lg` | large | stronger |
| `--shadow-xl` | extra large | stronger |
| `--shadow-2xl` | max | stronger |

**Важно:** тени в dark mode значительно сильнее (opacity выше), потому что тёмный фон требует более выраженных теней.  
Но в Tailwind эти переменные **не замаплены** — нет `shadow-2xs` класса. Используются только через `style={{boxShadow: "var(--shadow-lg)"}}` если нужно.

### Elevation система (кастомные утилиты)

Определены в `@layer utilities` в `index.css`. Это нестандартная система поверх Tailwind.

```tsx
// Hover brightness
<div className="hover-elevate">        // светлеет при hover (+--elevate-1)
<div className="hover-elevate-2">      // светлеет сильнее (+--elevate-2)

// Click/active brightness  
<div className="active-elevate">
<div className="active-elevate-2">

// Toggle state (по data-атрибуту или className)
<div className="toggle-elevate data-[state=on]:toggle-elevated">
<div className="toggle-elevate toggle-elevated">  // уже в elevated состоянии

// Отключить дефолтное поведение (если нужна своя логика)
<div className="hover-elevate no-default-hover-elevate">
```

**Принцип:** `::before` pseudo-element (toggle) и `::after` pseudo-element (hover/active) накладывают полупрозрачный слой поверх контента.

---

## 7. Тёмная / светлая тема

### Механизм

```typescript
// ThemeProvider (lib/theme-provider.tsx)
// Три режима: "light" | "dark" | "system"
// Хранится в localStorage ключ "ai-sales-operator-theme"
// Применяет CSS class на <html>: document.documentElement.classList.add("dark")
```

### Конфигурация Tailwind

```typescript
darkMode: ["class"]  // смена темы через .dark класс на html
```

### Паттерн для компонентов с dark mode вариантами

```tsx
// ✅ Через CSS переменные — всё работает автоматически
<div className="bg-card text-card-foreground">  // переменные меняются с темой

// ✅ Tailwind dark: модификатор — только для хардкодированных цветов
<div className="bg-green-50 dark:bg-green-900/20">  // явное указание для обоих режимов

// ❌ Хардкодированный цвет без dark: — НЕ МЕНЯЕТСЯ при смене темы
<div className="bg-green-50">   // останется зелёным и в тёмной теме!
```

### Где встречаются dark: варианты

Страницы, использующие хардкодированные цвета, правильно добавляют `dark:` — например:
```tsx
// settings.tsx, analytics.tsx, onboarding.tsx
className="text-green-600 dark:text-green-400"
className="bg-green-50 dark:bg-green-900/20"
```
Это работает, но добавляет связанность с конкретными цветами Tailwind.

---

## 8. Брендинг

### Файл: `client/src/components/brand-logo.tsx`

```typescript
export const BRAND_NAME = "NexusChat";
export const BRAND_TAGLINE = "Умная автоматизация";

// SVG логотип — 3 пузыря + 3 точки + хвост
// Градиент: #8B5CF6 (violet-500) → #3B82F6 (blue-500)
// Размер по умолчанию: 32×32px
export function BrandLogoIcon({ className, size = 32 })
```

**Хардкодированные цвета в SVG:**
- `stopColor="#8B5CF6"` — Violet 500 (НЕ CSS переменная)
- `stopColor="#3B82F6"` — Blue 500 (НЕ CSS переменная)
- `fill="white"` — белые точки (не меняется с темой)

### Где используется

| Файл | Использование |
|------|--------------|
| `App.tsx` | LandingPage — лого в header |
| `components/app-sidebar.tsx` | Навигационная панель |
| `pages/onboarding.tsx` | Заголовок onboarding |

### Где используется BRAND_NAME

Поиск по `BRAND_NAME` покажет все места. Их немного — в header LandingPage и заголовке страницы (`<title>`).

---

## 9. shadcn/ui — работа с компонентами

### Конфигурация (`components.json`)

```json
{
  "style": "new-york",           // стиль: более плоский, меньше теней
  "baseColor": "neutral",        // базовый серый — НЕ "zinc", "slate" и т.д.
  "cssVariables": true,          // используем CSS переменные
  "prefix": ""                   // нет префикса
}
```

### Директория

Все компоненты: `client/src/components/ui/`

> **НИКОГДА не редактировать вручную.** Только через shadcn CLI.  
> Иначе при `npx shadcn@latest add button` изменения будут перезаписаны.

### Добавление нового компонента

```bash
npx shadcn@latest add [component-name]
# Пример:
npx shadcn@latest add date-picker
npx shadcn@latest add data-table
```

### Обновление компонентов

```bash
npx shadcn@latest diff        # посмотреть что изменилось
npx shadcn@latest add button  # перезаписать конкретный компонент
```

### Кастомизация компонентов

Компоненты shadcn принимают `className` — добавляй через `cn()`:

```tsx
import { cn } from "@/lib/utils";

// Расширение существующего компонента
<Button className={cn("my-custom-class", someCondition && "conditional-class")}>

// Создание обёртки (НЕ изменяй ui/button.tsx)
// client/src/components/my-special-button.tsx
export function MySpecialButton({ children, ...props }) {
  return (
    <Button variant="outline" className="border-2 border-primary" {...props}>
      {children}
    </Button>
  );
}
```

---

## 10. Проблемные зоны — хардкодированные цвета

### Сводка по файлам (количество вхождений bg-*/text-* с буквенными цветами)

| Файл | Вхождений | Основные цвета |
|------|----------|---------------|
| `pages/settings.tsx` | **81** | green, red, blue, yellow |
| `pages/analytics.tsx` | **44** | green, blue, red, yellow |
| `pages/onboarding.tsx` | **27** | green, red, yellow |
| `pages/billing.tsx` | **22** | green, blue |
| `pages/security-status.tsx` | **24** | green, red, blue, yellow |
| `components/customer-card.tsx` | **23** | channel-specific colors |
| `components/subscription-paywall.tsx` | **13** | green, blue |
| `components/chat-interface.tsx` | **16** | intent colors |
| `pages/escalations.tsx` | **9** | green, red, yellow |
| `pages/admin-proxies.tsx` | **7** | status colors |

### Категории проблем

#### 1. Статус-бейджи (зелёный/жёлтый/красный)

Встречается везде. Паттерн:
```tsx
// Текущий код
<Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">
```

**Проблема:** при смене акцентного цвета или брендинга — нужно будет заменять вручную во всех файлах.

**Как исправить** — добавить `success` токен в CSS переменные (см. раздел 11).

#### 2. Intent-цвета в ChatInterface

```tsx
// chat-interface.tsx — мэппинг intent → Tailwind цвет
const INTENT_COLORS = {
  price: { color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  availability: { color: "bg-green-500/10 text-green-600 dark:text-green-400" },
  return: { color: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  complaint: { color: "bg-red-500/10 text-red-600 dark:text-red-400" },
};
```

**Проблема:** цвета интентов захардкожены и не адаптивны к теме.

#### 3. Цвета логотипа в SVG

```tsx
// brand-logo.tsx
<stop offset="0%" stopColor="#8B5CF6" />  // Violet 500
<stop offset="100%" stopColor="#3B82F6" /> // Blue 500
```

**Проблема:** при смене бренд-цвета нужно обновить SVG отдельно. Gradient не подхватывает `--primary`.

#### 4. Статус-цвета в tailwind.config.ts

```typescript
// tailwind.config.ts — НЕПРАВИЛЬНО
status: {
  online: "rgb(34 197 94)",  // захардкожено, не читает --status-online
}
```

CSS переменные `--status-online` определены правильно, но маппинг игнорирует их.

#### 5. Inline-стили (допустимые случаи)

```tsx
// App.tsx — ширина sidebar (допустимо)
style={{ "--sidebar-width": "16rem", "--sidebar-width-icon": "3rem" }}

// security-status.tsx — динамическая ширина прогресс-бара (допустимо)
style={{ width: `${Math.min(percent, 100)}%` }}

// chat-interface.tsx — динамический z-index (допустимо)
```

Inline-стили для **динамических значений** — OK. Для **статических цветов** — плохо.

---

## 11. Как безопасно изменить дизайн

### A. Смена акцентного цвета (Primary)

**Один файл, один токен** — самое безопасное изменение.

```css
/* client/src/index.css */
:root {
  --primary: 210 78% 48%;  /* ← изменить HSL */
  --primary-foreground: 210 78% 98%;  /* светлый текст на primary */
}

.dark {
  --primary: 210 78% 52%;  /* чуть светлее для dark mode */
  --primary-foreground: 210 78% 98%;
}
```

**Важно:** `--ring` и `--sidebar-primary` тоже используют primary-подобный цвет — обновить их синхронно.

**Примеры вариантов:**

```css
/* Синий (текущий) */
--primary: 210 78% 48%;

/* Зелёный */
--primary: 142 71% 45%;

/* Фиолетовый */
--primary: 263 70% 50%;

/* Красный */
--primary: 0 72% 50%;

/* Оранжевый */
--primary: 25 95% 53%;
```

Всё что использует `bg-primary`, `text-primary`, `border-primary` — поменяется автоматически.

### B. Смена базового серого (нейтральный цвет)

Все серые используют `hue: 210` (голубоватый оттенок). Для тёплого серого:

```css
/* Нейтральный серый (без голубого оттенка) */
--background: 0 0% 98%;
--foreground: 0 0% 9%;
--border: 0 0% 89%;
--card: 0 0% 97%;
/* ... и т.д. — hue 0 вместо 210 */
```

### C. Смена радиуса скругления

```css
/* index.css */
:root {
  --radius: .5rem;  /* 8px → изменить на желаемое */
}
```

```typescript
// tailwind.config.ts — для точного контроля
borderRadius: {
  lg: ".75rem",  /* 12px вместо 9px */
  md: ".5rem",   /* 8px вместо 6px */
  sm: ".25rem",  /* 4px вместо 3px */
}
```

### D. Добавление `success` / `warning` / `info` токенов

Чтобы избавиться от захардкоженных `text-green-500`, `bg-yellow-100` и т.д.:

```css
/* index.css — добавить в :root и .dark */
:root {
  --success: 142 71% 45%;
  --success-foreground: 142 71% 98%;
  --success-muted: 142 71% 95%;
  --warning: 45 93% 47%;
  --warning-foreground: 45 93% 15%;
  --warning-muted: 45 93% 95%;
  --info: 210 78% 48%;
  --info-foreground: 210 78% 98%;
}

.dark {
  --success: 142 71% 52%;
  --success-foreground: 142 71% 98%;
  --success-muted: 142 71% 15%;
  --warning: 45 93% 52%;
  --warning-foreground: 0 0% 10%;
  --warning-muted: 45 93% 15%;
}
```

```typescript
// tailwind.config.ts — добавить в colors
success: {
  DEFAULT: "hsl(var(--success) / <alpha-value>)",
  foreground: "hsl(var(--success-foreground) / <alpha-value>)",
  muted: "hsl(var(--success-muted) / <alpha-value>)",
},
warning: {
  DEFAULT: "hsl(var(--warning) / <alpha-value>)",
  foreground: "hsl(var(--warning-foreground) / <alpha-value>)",
  muted: "hsl(var(--warning-muted) / <alpha-value>)",
},
```

После этого заменять: `text-green-600 dark:text-green-400` → `text-success`.

### E. Исправление маппинга status-цветов

```typescript
// tailwind.config.ts — ПРАВИЛЬНЫЙ вариант
status: {
  online: "hsl(var(--status-online) / <alpha-value>)",
  away: "hsl(var(--status-away) / <alpha-value>)",
  busy: "hsl(var(--status-busy) / <alpha-value>)",
  offline: "hsl(var(--status-offline) / <alpha-value>)",
},
```

### F. Смена шрифта

```css
/* index.css */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
/* или другой шрифт */

:root {
  --font-sans: 'Inter', system-ui, sans-serif;  /* заменить 'Inter' */
}
```

---

## 12. Чеклист смены акцентного цвета

- [ ] Изменить `--primary` и `--primary-foreground` в `:root` и `.dark` в `index.css`
- [ ] Синхронизировать `--ring` (обычно = `--primary`)
- [ ] Синхронизировать `--sidebar-primary` и `--sidebar-ring`
- [ ] Обновить цвета в SVG-логотипе (`brand-logo.tsx`: `stopColor="#..."`)
- [ ] Проверить все места с `border-blue-` / `text-blue-` / `bg-blue-` — они **не изменятся** автоматически и могут конфликтовать с новым цветом
- [ ] Запустить приложение и проверить: кнопки, фокус-кольца, sidebar, чекбоксы, progress bars
- [ ] Проверить dark mode

**Время:** ~15 минут при правильной системе токенов.

---

## 13. Чеклист ребрендинга

### Смена названия и слогана

```typescript
// client/src/components/brand-logo.tsx
export const BRAND_NAME = "НовоеНазвание";
export const BRAND_TAGLINE = "Новый слоган";
```

Это единственное место. Все страницы импортируют оттуда.

### Смена логотипа

```tsx
// brand-logo.tsx — заменить SVG в BrandLogoIcon
export function BrandLogoIcon({ className, size = 32 }) {
  return (
    <svg ...>
      {/* Новый SVG */}
    </svg>
  );
}
```

### Смена бренд-цветов (если отличаются от `--primary`)

1. Обновить `stopColor` в SVG логотипа
2. Если нужен отдельный бренд-цвет — добавить CSS переменную `--brand: H S% L%` и маппинг в tailwind.config.ts

### Смена email-шаблонов

```typescript
// server/services/email-provider.ts — emailTemplates.verification / passwordReset
// Заменить inline-стили:
style="background: #2563eb;"  // ← текущий синий
// На новый бренд-цвет
```

### Полный чеклист

- [ ] `brand-logo.tsx`: BRAND_NAME, BRAND_TAGLINE, SVG цвета
- [ ] `index.css`: `--primary`, серые тона
- [ ] `server/services/email-provider.ts`: HTML-шаблоны писем
- [ ] `<title>` в `client/index.html` (если есть)
- [ ] Проверить hardcoded `bg-blue-*` классы — они останутся синими

---

## Итоговые выводы

### Что хорошо сделано

| Аспект | Статус |
|--------|--------|
| Токенная система (CSS переменные) | ✅ Полная, консистентная |
| Dark mode | ✅ Работает через class, все токены дублированы |
| Tailwind интеграция | ✅ Правильный маппинг через `hsl(var(...))` |
| Elevation система | ✅ Задокументирована, использует токены |
| shadcn/ui setup | ✅ Правильно, не редактируется вручную |
| Единый источник брендинга | ✅ `brand-logo.tsx` |

### Что требует внимания

| Проблема | Серьёзность | Файлы |
|---------|-------------|-------|
| Хардкодированные semantic-цвета (green/red/yellow) | ⚠️ Средняя | settings.tsx (81), analytics.tsx (44), все страницы |
| SVG логотип с хардкодированными цветами | ⚠️ Низкая | brand-logo.tsx |
| status-цвета в tailwind.config.ts — rgb() вместо CSS переменных | ⚠️ Низкая | tailwind.config.ts |
| Нет компонента `<PageTitle>` — разные заголовки на страницах | ⚠️ Низкая | Все pages |
| Email-шаблоны с inline-стилями (не связаны с темой) | ℹ️ Косметика | email-provider.ts |
| Inter шрифт не подключён через CDN (только системный) | ℹ️ Косметика | index.css |

### Приоритет изменений

1. **Для смены акцентного цвета** — только `index.css` (5 мин)
2. **Для полного ребрендинга** — `index.css` + `brand-logo.tsx` (30 мин)
3. **Для полностью токенизированной системы** — добавить success/warning/info токены + заменить 200+ хардкодированных классов (несколько часов, по файлам)

---

*Этот документ создан на основе анализа `index.css`, `tailwind.config.ts`, `components.json` и кода всех 23 страниц.*
