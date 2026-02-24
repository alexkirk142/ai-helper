import { useQuery } from "@tanstack/react-query";
import { MetricsCard } from "@/components/metrics-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
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
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold">Панель управления</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Обзор работы AI Sales Operator
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="mt-2 h-3 w-32" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <MetricsCard
              title="Всего разговоров"
              value={metrics?.totalConversations || 0}
              icon={<MessageSquare className="h-4 w-4" />}
              trend="up"
              trendValue="+12%"
              description="за неделю"
              data-testid="metric-total-conversations"
            />
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
              trendValue={metrics?.escalatedConversations && metrics.escalatedConversations > 0 ? "" : ""}
              description="требуют внимания"
              data-testid="metric-escalated"
            />
            <MetricsCard
              title="Решено сегодня"
              value={metrics?.resolvedToday || 0}
              icon={<CheckCircle className="h-4 w-4" />}
              trend="up"
              trendValue="+8"
              description="разговоров"
              data-testid="metric-resolved-today"
            />
          </>
        )}
      </div>

      {/* Second Row Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="mt-2 h-3 w-32" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <MetricsCard
              title="Среднее время ответа"
              value={`${metrics?.avgResponseTime || 0}с`}
              icon={<TrendingUp className="h-4 w-4" />}
              trend="up"
              trendValue="-15%"
              description="быстрее среднего"
              data-testid="metric-avg-response"
            />
            <MetricsCard
              title="Точность AI"
              value={`${Math.round((metrics?.aiAccuracy || 0) * 100)}%`}
              icon={<Bot className="h-4 w-4" />}
              trend="up"
              trendValue="+3%"
              description="одобрено"
              data-testid="metric-ai-accuracy"
            />
            <MetricsCard
              title="Товаров"
              value={metrics?.productsCount || 0}
              icon={<Package className="h-4 w-4" />}
              description="в каталоге"
              data-testid="metric-products"
            />
            <MetricsCard
              title="База знаний"
              value={metrics?.knowledgeDocsCount || 0}
              icon={<Book className="h-4 w-4" />}
              description="документов"
              data-testid="metric-knowledge-base"
            />
          </>
        )}
      </div>

      {/* Activity Section */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Escalations */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-lg">Недавние эскалации</CardTitle>
            <Link href="/escalations">
              <Badge variant="outline" className="cursor-pointer">
                Все
              </Badge>
            </Link>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[280px]">
              {escalationsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentEscalations?.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <CheckCircle className="h-12 w-12 text-status-online opacity-50" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Нет ожидающих эскалаций
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recentEscalations?.slice(0, 5).map((escalation) => (
                    <div
                      key={escalation.id}
                      className="flex items-start gap-3 rounded-md p-2 hover-elevate"
                      data-testid={`escalation-item-${escalation.id}`}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <p className="truncate text-sm font-medium">
                          {escalation.reason}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {escalation.summary}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(escalation.createdAt), {
                            addSuffix: true,
                            locale: ru,
                          })}
                        </span>
                      </div>
                      <Badge
                        variant={
                          escalation.status === "pending"
                            ? "destructive"
                            : "secondary"
                        }
                        className="shrink-0 text-xs"
                      >
                        {escalation.status === "pending" ? "Ожидает" : escalation.status === "resolved" ? "Решено" : escalation.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Active Conversations */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-lg">Активные разговоры</CardTitle>
            <Link href="/conversations">
              <Badge variant="outline" className="cursor-pointer">
                Все
              </Badge>
            </Link>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[280px]">
              {conversationsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : activeConversations?.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <MessageSquare className="h-12 w-12 text-muted-foreground opacity-50" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Нет активных разговоров
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeConversations?.slice(0, 5).map((conv) => (
                    <Link
                      key={conv.id}
                      href={`/conversations?id=${conv.id}`}
                      className="block"
                    >
                      <div
                        className="flex items-center gap-3 rounded-md p-2 hover-elevate"
                        data-testid={`active-conv-${conv.id}`}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          <MessageSquare className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <p className="truncate text-sm font-medium">
                            {conv.customer?.name || "Неизвестный"}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {conv.lastMessage?.content || "Нет сообщений"}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="outline" className="text-xs">
                            {conv.mode === "learning" ? "Обучение" : conv.mode === "semi_auto" ? "Полуавто" : "Авто"}
                          </Badge>
                          {conv.unreadCount && conv.unreadCount > 0 && (
                            <Badge className="text-xs">{conv.unreadCount}</Badge>
                          )}
                        </div>
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
