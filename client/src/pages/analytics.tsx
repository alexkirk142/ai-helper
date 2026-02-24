import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Star, TrendingDown, TrendingUp, AlertTriangle, DollarSign, ShoppingCart, Clock, Target, BarChart3, CheckCircle2, XCircle, AlertCircle, ThumbsDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CsatAnalytics, ConversionAnalytics, IntentAnalytics, IntentPerformance, LostDealsAnalytics, LostDealReason } from "@shared/schema";

const ratingLabels: Record<number, string> = {
  1: "Очень плохо",
  2: "Плохо", 
  3: "Нормально",
  4: "Хорошо",
  5: "Отлично",
};

const decisionLabels: Record<string, string> = {
  AUTO_SEND: "Авто-отправка",
  NEED_APPROVAL: "Требует одобрения",
  ESCALATE: "Эскалация",
};

const intentLabels: Record<string, string> = {
  price: "Цена",
  availability: "Наличие",
  shipping: "Доставка",
  return: "Возврат",
  discount: "Скидка",
  complaint: "Жалоба",
  other: "Другое",
  unknown: "Неизвестно",
};

const lostDealReasonLabels: Record<LostDealReason, string> = {
  NO_STOCK: "Нет в наличии",
  PRICE_TOO_HIGH: "Цена слишком высокая",
  ESCALATED_NO_RESPONSE: "Эскалация без ответа",
  AI_ERROR: "Ошибка AI",
  OTHER: "Другое",
};

function formatCurrency(amount: number, currency: string = "RUB"): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function CsatTab() {
  const { data: csat, isLoading } = useQuery<CsatAnalytics>({
    queryKey: ["/api/analytics/csat"],
  });

  const getScoreColor = (score: number) => {
    if (score >= 4.5) return "text-green-500";
    if (score >= 3.5) return "text-yellow-500";
    return "text-red-500";
  };

  const getScoreIcon = (score: number) => {
    if (score >= 4) return <TrendingUp className="h-5 w-5 text-green-500" />;
    if (score >= 3) return <TrendingDown className="h-5 w-5 text-yellow-500" />;
    return <AlertTriangle className="h-5 w-5 text-red-500" />;
  };

  if (isLoading) {
    return <div className="text-muted-foreground text-center py-8">Загрузка...</div>;
  }

  if (!csat) {
    return <div className="text-muted-foreground text-center py-8">Не удалось загрузить данные</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Средний балл</CardTitle>
            <Star className="h-4 w-4 text-yellow-400" />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${getScoreColor(csat.avgScore)}`}>
              {csat.avgScore.toFixed(1)}
              <span className="text-lg text-muted-foreground">/5</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              На основе {csat.totalRatings} оценок
            </p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Распределение оценок</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {csat.distribution.map((d) => (
              <div key={d.rating} className="flex items-center gap-3">
                <div className="flex w-24 items-center gap-1">
                  {Array.from({ length: d.rating }).map((_, i) => (
                    <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <Progress value={d.percentage} className="flex-1" />
                <div className="w-16 text-right text-sm text-muted-foreground">
                  {d.count} ({d.percentage}%)
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">По типу решения</CardTitle>
            <CardDescription>Как AI обработал запросы</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {csat.byDecision.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            ) : (
              csat.byDecision.map((d) => (
                <div key={d.key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getScoreIcon(d.avgScore)}
                    <span className="text-sm">{decisionLabels[d.key] || d.key}</span>
                  </div>
                  <div className="text-right">
                    <span className={`font-medium ${getScoreColor(d.avgScore)}`}>
                      {d.avgScore.toFixed(1)}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">({d.count})</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">По интентам</CardTitle>
            <CardDescription>Оценки по типам вопросов</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {csat.byIntent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            ) : (
              csat.byIntent.map((d) => (
                <div key={d.key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getScoreIcon(d.avgScore)}
                    <span className="text-sm">{intentLabels[d.key] || d.key}</span>
                  </div>
                  <div className="text-right">
                    <span className={`font-medium ${getScoreColor(d.avgScore)}`}>
                      {d.avgScore.toFixed(1)}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">({d.count})</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {csat.problemIntents.length > 0 && (
          <Card className="border-destructive/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Проблемные интенты
              </CardTitle>
              <CardDescription>Интенты с низкой оценкой (ниже 3.5)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {csat.problemIntents.map((d) => (
                <div key={d.key} className="flex items-center justify-between">
                  <Badge variant="destructive">{intentLabels[d.key] || d.key}</Badge>
                  <span className="text-destructive font-medium">{d.avgScore.toFixed(1)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {csat.totalRatings === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Star className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">Нет оценок</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Оценки CSAT появятся после закрытия диалогов
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ConversionTab() {
  const { data: conversion, isLoading } = useQuery<ConversionAnalytics>({
    queryKey: ["/api/analytics/conversion"],
  });

  if (isLoading) {
    return <div className="text-muted-foreground text-center py-8">Загрузка...</div>;
  }

  if (!conversion) {
    return <div className="text-muted-foreground text-center py-8">Не удалось загрузить данные</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Конверсия</CardTitle>
            <Target className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">
              {conversion.conversionRate.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {conversion.totalConversions} из {conversion.totalConversations} диалогов
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Выручка</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-500">
              {formatCurrency(conversion.totalRevenue, conversion.currency)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Всего покупок
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Средний чек</CardTitle>
            <ShoppingCart className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-500">
              {formatCurrency(conversion.avgAmount, conversion.currency)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              На одну покупку
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Время до покупки</CardTitle>
            <Clock className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-500">
              {conversion.avgTimeToConversion !== null 
                ? `${conversion.avgTimeToConversion.toFixed(1)}ч`
                : "—"
              }
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              В среднем
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Топ интенты по выручке</CardTitle>
            <CardDescription>Какие темы приносят больше денег</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {conversion.topIntentsByRevenue.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            ) : (
              conversion.topIntentsByRevenue.map((d, index) => (
                <div key={d.key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="w-6 h-6 p-0 flex items-center justify-center text-xs">
                      {index + 1}
                    </Badge>
                    <span className="text-sm">{intentLabels[d.key] || d.key}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-green-500">
                      {formatCurrency(d.totalRevenue, conversion.currency)}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">({d.count})</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">По типу решения AI</CardTitle>
            <CardDescription>Эффективность автоматизации</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {conversion.byDecision.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            ) : (
              conversion.byDecision.map((d) => (
                <div key={d.key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{decisionLabels[d.key] || d.key}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-green-500">
                      {formatCurrency(d.totalRevenue, conversion.currency)}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      (ср. {formatCurrency(d.avgAmount, conversion.currency)})
                    </span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {conversion.totalConversions === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <ShoppingCart className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">Нет конверсий</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Данные о покупках появятся после записи конверсий через API или вручную
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function getStatusBadge(status: IntentPerformance["status"]) {
  switch (status) {
    case "good":
      return (
        <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Хорошо
        </Badge>
      );
    case "warning":
      return (
        <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30">
          <AlertCircle className="mr-1 h-3 w-3" />
          Внимание
        </Badge>
      );
    case "critical":
      return (
        <Badge variant="outline" className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30">
          <XCircle className="mr-1 h-3 w-3" />
          Критично
        </Badge>
      );
  }
}

function getMetricColor(value: number, thresholds: { good: number; warning: number }, inverse = false) {
  if (inverse) {
    if (value <= thresholds.good) return "text-green-600 dark:text-green-400";
    if (value <= thresholds.warning) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  }
  if (value >= thresholds.good) return "text-green-600 dark:text-green-400";
  if (value >= thresholds.warning) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function LostDealsTab() {
  const { data: analytics, isLoading } = useQuery<LostDealsAnalytics>({
    queryKey: ["/api/analytics/lost-deals"],
  });

  if (isLoading) {
    return <div className="text-muted-foreground text-center py-8" data-testid="loading-lost-deals">Загрузка...</div>;
  }

  if (!analytics) {
    return <div className="text-muted-foreground text-center py-8" data-testid="error-lost-deals">Не удалось загрузить данные</div>;
  }

  const topReason = analytics.byReason[0];
  const topIntent = analytics.byIntent[0];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Всего потеряно</CardTitle>
            <ThumbsDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600 dark:text-red-400" data-testid="total-lost-deals">
              {analytics.totalLostDeals}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Сделок потеряно
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Главная причина</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-orange-600 dark:text-orange-400" data-testid="top-reason">
              {topReason ? lostDealReasonLabels[topReason.reason] : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {topReason ? `${topReason.percentage}% случаев` : "Нет данных"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Проблемный интент</CardTitle>
            <Target className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-blue-600 dark:text-blue-400" data-testid="top-intent">
              {topIntent ? intentLabels[topIntent.intent] || topIntent.intent : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {topIntent ? `${topIntent.percentage}% потерь` : "Нет данных"}
            </p>
          </CardContent>
        </Card>
      </div>

      {analytics.byReason.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Потери по причинам</CardTitle>
            <CardDescription>Где мы теряем клиентов</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Причина</TableHead>
                  <TableHead className="text-right">Количество</TableHead>
                  <TableHead className="text-right">Доля</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.byReason.map((item) => (
                  <TableRow key={item.reason} data-testid={`reason-row-${item.reason}`}>
                    <TableCell className="font-medium">
                      {lostDealReasonLabels[item.reason]}
                    </TableCell>
                    <TableCell className="text-right">{item.count}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={item.percentage >= 30 ? "destructive" : "secondary"}>
                        {item.percentage}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground" data-testid="no-lost-deals">
            Нет данных о потерянных сделках
          </CardContent>
        </Card>
      )}

      {analytics.byIntent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Потери по интентам</CardTitle>
            <CardDescription>Какие типы обращений приводят к потерям</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Интент</TableHead>
                  <TableHead className="text-right">Количество</TableHead>
                  <TableHead className="text-right">Доля</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.byIntent.map((item) => (
                  <TableRow key={item.intent} data-testid={`intent-row-${item.intent}`}>
                    <TableCell className="font-medium">
                      {intentLabels[item.intent] || item.intent}
                    </TableCell>
                    <TableCell className="text-right">{item.count}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">
                        {item.percentage}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function IntentTab() {
  const { data: analytics, isLoading } = useQuery<IntentAnalytics>({
    queryKey: ["/api/analytics/intents"],
  });

  if (isLoading) {
    return <div className="text-muted-foreground text-center py-8">Загрузка...</div>;
  }

  if (!analytics) {
    return <div className="text-muted-foreground text-center py-8">Не удалось загрузить данные</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Всего интентов</CardTitle>
            <BarChart3 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{analytics.totalIntents}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Типов обращений
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Всего диалогов</CardTitle>
            <Target className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{analytics.totalConversations}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Обработано AI
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Требуют внимания</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">
              {analytics.intents.filter(i => i.status !== "good").length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Интентов с проблемами
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Эффективность по интентам</CardTitle>
          <CardDescription>Детальный анализ каждого типа обращений</CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.intents.length === 0 ? (
            <div className="py-8 text-center">
              <BarChart3 className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-medium">Нет данных</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Данные появятся после обработки диалогов AI
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Интент</TableHead>
                    <TableHead className="text-right">Диалогов</TableHead>
                    <TableHead className="text-right">Autosend</TableHead>
                    <TableHead className="text-right">Эскалация</TableHead>
                    <TableHead className="text-right">Confidence</TableHead>
                    <TableHead className="text-right">CSAT</TableHead>
                    <TableHead className="text-right">Конверсия</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Рекомендация</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.intents.map((intent) => (
                    <TableRow key={intent.intent} data-testid={`intent-row-${intent.intent}`}>
                      <TableCell className="font-medium">
                        {intentLabels[intent.intent] || intent.intent}
                      </TableCell>
                      <TableCell className="text-right">{intent.totalConversations}</TableCell>
                      <TableCell className={`text-right ${getMetricColor(intent.autosendRate, { good: 50, warning: 20 })}`}>
                        {intent.autosendRate}%
                      </TableCell>
                      <TableCell className={`text-right ${getMetricColor(intent.escalationRate, { good: 20, warning: 40 }, true)}`}>
                        {intent.escalationRate}%
                      </TableCell>
                      <TableCell className={`text-right ${getMetricColor(intent.avgConfidence, { good: 80, warning: 60 })}`}>
                        {intent.avgConfidence}%
                      </TableCell>
                      <TableCell className={`text-right ${getMetricColor(intent.csatAvg, { good: 4, warning: 3 })}`}>
                        {intent.csatAvg > 0 ? intent.csatAvg.toFixed(1) : "—"}
                      </TableCell>
                      <TableCell className={`text-right ${getMetricColor(intent.conversionRate, { good: 30, warning: 15 })}`}>
                        {intent.conversionRate}%
                      </TableCell>
                      <TableCell>{getStatusBadge(intent.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px]">
                        {intent.recommendation}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Analytics() {
  const [activeTab, setActiveTab] = useState("csat");

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Аналитика</h1>
        <p className="text-muted-foreground">Метрики эффективности AI и бизнеса</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="csat" data-testid="tab-csat">
            <Star className="mr-2 h-4 w-4" />
            CSAT
          </TabsTrigger>
          <TabsTrigger value="conversion" data-testid="tab-conversion">
            <ShoppingCart className="mr-2 h-4 w-4" />
            Конверсии
          </TabsTrigger>
          <TabsTrigger value="intents" data-testid="tab-intents">
            <BarChart3 className="mr-2 h-4 w-4" />
            Интенты
          </TabsTrigger>
          <TabsTrigger value="lost-deals" data-testid="tab-lost-deals">
            <ThumbsDown className="mr-2 h-4 w-4" />
            Потери
          </TabsTrigger>
        </TabsList>

        <TabsContent value="csat" className="mt-0">
          <CsatTab />
        </TabsContent>

        <TabsContent value="conversion" className="mt-0">
          <ConversionTab />
        </TabsContent>

        <TabsContent value="intents" className="mt-0">
          <IntentTab />
        </TabsContent>

        <TabsContent value="lost-deals" className="mt-0">
          <LostDealsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
