import { useQuery } from "@tanstack/react-query";
import { MetricsCard } from "@/components/metrics-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingUp,
  Bot,
  Package,
  Book,
} from "lucide-react";
import type { DashboardMetrics, EscalationEvent, ConversationWithCustomer } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { Link } from "wouter";

function weekTrend(thisWeek: number, lastWeek: number): { value: string; direction: "up" | "down" | "neutral" } | null {
  if (lastWeek === 0) return thisWeek > 0 ? { value: `+${thisWeek}`, direction: "up" } : null;
  const pct = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  if (pct === 0) return { value: "0%", direction: "neutral" };
  return { value: `${pct > 0 ? "+" : ""}${pct}%`, direction: pct > 0 ? "up" : "down" };
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}с`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}м ${s}с` : `${m}м`;
}

export default function Dashboard() {
  const { data: metrics, isLoading: metricsLoading } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
  });

  const { data: recentEscalations, isLoading: escalationsLoading } = useQuery<EscalationEvent[]>({
    queryKey: ["/api/escalations?status=recent"],
  });

  const { data: activeConversations, isLoading: conversationsLoading } = useQuery<ConversationWithCustomer[]>({
    queryKey: ["/api/conversations?status=active"],
  });

  return (
    <div className="space-y-6 p-4 sm:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-1.5 border-b border-border/40 pb-5">
        <div className="inline-flex items-center gap-1.5 text-xs text-primary font-semibold tracking-wider uppercase">
          NexusChat CRM
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">Панель управления</h1>
        <p className="text-sm text-muted-foreground font-medium">
          Оперативный мониторинг диалогов, работы ассистента и показателей эффективности.
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="rounded-2xl border border-card-border bg-card">
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
                  <Skeleton className="h-4 w-24 rounded-full" />
                  <Skeleton className="h-9 w-9 rounded-xl" />
                </CardHeader>
                <CardContent className="pt-0">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="mt-3 h-4 w-32 rounded-full" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            {(() => {
              const wt = metrics ? weekTrend(metrics.conversationsThisWeek, metrics.conversationsLastWeek) : null;
              return (
                <MetricsCard
                  title="Всего разговоров"
                  value={metrics?.totalConversations || 0}
                  icon={<MessageSquare className="h-4 w-4" />}
                  trend={wt?.direction ?? "neutral"}
                  trendValue={wt?.value ?? ""}
                  description="за неделю"
                  data-testid="metric-total-conversations"
                />
              );
            })()}
            <MetricsCard
              title="Активных сейчас"
              value={metrics?.activeConversations || 0}
              icon={<Clock className="h-4 w-4" />}
              trend="neutral"
              description="разговоров"
              data-testid="metric-active-conversations"
            />
            <MetricsCard
              title="Эскалировано"
              value={metrics?.escalatedConversations || 0}
              icon={<AlertTriangle className="h-4 w-4" />}
              trend={metrics?.escalatedConversations && metrics.escalatedConversations > 0 ? "down" : "neutral"}
              trendValue={metrics?.escalatedConversations && metrics.escalatedConversations > 0 ? "Внимание" : ""}
              description="требуют внимания"
              data-testid="metric-escalated"
            />
            {(() => {
              const diff = (metrics?.resolvedToday ?? 0) - (metrics?.resolvedYesterday ?? 0);
              const hasDiff = metrics != null && (metrics.resolvedToday > 0 || metrics.resolvedYesterday > 0);
              return (
                <MetricsCard
                  title="Решено сегодня"
                  value={metrics?.resolvedToday || 0}
                  icon={<CheckCircle className="h-4 w-4" />}
                  trend={!hasDiff ? "neutral" : diff >= 0 ? "up" : "down"}
                  trendValue={hasDiff && diff !== 0 ? `${diff > 0 ? "+" : ""}${diff} вчера` : ""}
                  description="разговоров"
                  data-testid="metric-resolved-today"
                />
              );
            })()}
          </>
        )}
      </div>

      {/* Second Row Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="rounded-2xl border border-card-border bg-card">
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
                  <Skeleton className="h-4 w-24 rounded-full" />
                  <Skeleton className="h-9 w-9 rounded-xl" />
                </CardHeader>
                <CardContent className="pt-0">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="mt-3 h-4 w-32 rounded-full" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <MetricsCard
              title="Среднее время ответа"
              value={metrics?.avgResponseTime == null ? "—" : formatSeconds(metrics.avgResponseTime)}
              icon={<TrendingUp className="h-4 w-4" />}
              trend="neutral"
              description="за последние 30 дней"
              data-testid="metric-avg-response"
            />
            {(() => {
              const pct = Math.round((metrics?.aiAccuracy || 0) * 100);
              const trend = pct >= 80 ? "up" : pct >= 50 ? "neutral" : "down";
              return (
                <MetricsCard
                  title="Точность AI"
                  value={`${pct}%`}
                  icon={<Bot className="h-4 w-4" />}
                  trend={metrics?.aiAccuracy ? trend : "neutral"}
                  description="одобрено оператором"
                  data-testid="metric-ai-accuracy"
                />
              );
            })()}
            <MetricsCard
              title="Товаров"
              value={metrics?.productsCount || 0}
              icon={<Package className="h-4 w-4" />}
              description="в каталоге товаров"
              data-testid="metric-products"
            />
            <MetricsCard
              title="База знаний"
              value={metrics?.knowledgeDocsCount || 0}
              icon={<Book className="h-4 w-4" />}
              description="статей и регламентов"
              data-testid="metric-knowledge-base"
            />
          </>
        )}
      </div>

      {/* Activity Section */}
      <div className="grid gap-6 lg:grid-cols-2 mt-4">
        {/* Recent Escalations */}
        <Card className="rounded-2xl border border-card-border bg-card hover:shadow-xl hover:shadow-primary/[0.01] transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border/40 pb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10 text-destructive border border-destructive/10">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <CardTitle className="text-lg font-bold tracking-tight">Недавние эскалации</CardTitle>
            </div>
            <Link href="/escalations">
              <Badge variant="outline" className="cursor-pointer font-semibold rounded-lg px-2.5 py-1 text-xs hover:bg-accent/60 transition-colors">
                Все эскалации
              </Badge>
            </Link>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <ScrollArea className="h-[300px] pr-2">
              {escalationsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Skeleton className="h-9 w-9 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-full rounded-full" />
                        <Skeleton className="h-3 w-24 rounded-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentEscalations?.length === 0 ? (
                <div className="flex h-[240px] flex-col items-center justify-center text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success mb-3.5">
                    <CheckCircle className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold text-sm">Всё в порядке!</h3>
                  <p className="mt-1 text-xs text-muted-foreground max-w-[240px]">
                    В данный момент нет обращений, требующих ручного вмешательства.
                  </p>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {recentEscalations?.slice(0, 5).map((escalation) => (
                    <div
                      key={escalation.id}
                      className="flex items-start gap-3.5 rounded-xl border border-border/30 p-3 hover:bg-muted/35 hover:border-primary/10 transition-all duration-200"
                      data-testid={`escalation-item-${escalation.id}`}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 border border-destructive/15">
                        <AlertTriangle className="h-4.5 w-4.5 text-destructive animate-pulse" />
                      </div>
                      <div className="flex-1 overflow-hidden space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-bold text-foreground">
                            {escalation.reason}
                          </p>
                          <span className="text-[10px] text-muted-foreground font-semibold shrink-0">
                            {formatDistanceToNow(new Date(escalation.createdAt), {
                              addSuffix: true,
                              locale: ru,
                            })}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {escalation.summary}
                        </p>
                        <div className="pt-0.5">
                          <Badge
                            className={cn(
                              "text-[10px] font-bold rounded-full px-2.5 py-0.5",
                              escalation.status === "pending"
                                ? "bg-warning/15 text-warning border border-warning/20 hover:bg-warning/15"
                                : "bg-success/15 text-success border border-success/20 hover:bg-success/15"
                            )}
                          >
                            {escalation.status === "pending" ? "Ожидает" : escalation.status === "resolved" ? "Решено" : escalation.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Active Conversations */}
        <Card className="rounded-2xl border border-card-border bg-card hover:shadow-xl hover:shadow-primary/[0.01] transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border/40 pb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/10">
                <MessageSquare className="h-4 w-4" />
              </div>
              <CardTitle className="text-lg font-bold tracking-tight">Активные диалоги</CardTitle>
            </div>
            <Link href="/conversations">
              <Badge variant="outline" className="cursor-pointer font-semibold rounded-lg px-2.5 py-1 text-xs hover:bg-accent/60 transition-colors">
                Все диалоги
              </Badge>
            </Link>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <ScrollArea className="h-[300px] pr-2">
              {conversationsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32 rounded-full" />
                        <Skeleton className="h-3 w-full rounded-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : activeConversations?.length === 0 ? (
                <div className="flex h-[240px] flex-col items-center justify-center text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3.5">
                    <MessageSquare className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold text-sm">Тишина в эфире</h3>
                  <p className="mt-1 text-xs text-muted-foreground max-w-[240px]">
                    В данный момент у вас нет активных переписок с клиентами.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeConversations?.slice(0, 5).map((conv) => (
                    <Link
                      key={conv.id}
                      href={`/conversations?id=${conv.id}`}
                      className="block group"
                    >
                      <div
                        className="flex items-center gap-3.5 rounded-xl border border-border/30 p-3 hover:bg-muted/35 hover:border-primary/10 transition-all duration-200"
                        data-testid={`active-conv-${conv.id}`}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/15 group-hover:scale-105 transition-transform">
                          <MessageSquare className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 overflow-hidden space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-bold text-foreground">
                              {conv.customer?.name || "Неизвестный клиент"}
                            </p>
                            <Badge variant="outline" className="text-[10px] font-semibold border-border/50 bg-background/50 px-2 py-0">
                              {conv.mode === "learning" ? "Обучение" : conv.mode === "semi_auto" ? "Полуавто" : "Авто"}
                            </Badge>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {conv.lastMessage?.content || "Сообщений пока нет"}
                          </p>
                        </div>
                        {conv.unreadCount && conv.unreadCount > 0 && (
                          <div className="flex shrink-0">
                            <Badge className="rounded-full h-5 min-w-[20px] bg-primary text-primary-foreground font-extrabold text-[10px] flex items-center justify-center px-1.5 shadow-md shadow-primary/25">
                              {conv.unreadCount}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
