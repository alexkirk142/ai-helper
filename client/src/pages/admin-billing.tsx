import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/hooks/use-toast";
import { 
  Shield, Loader2, ArrowLeft, Users, Clock, CreditCard, 
  TrendingUp, Calendar, DollarSign, Settings2, Save, Ban, Bot, MessageSquare, Gift
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface PricesData {
  subscriptionPrice: number;
  aiAgentPrice: number;
  trialHours: number;
}

interface SubscriptionRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  feature: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: string | null;
}

interface GrantRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  feature: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}

interface BillingMetrics {
  activeSubscriptions: number;
  activeGrants: number;
  trialCount: number;
  expiredTrials: number;
  upcomingRenewals: {
    count: number;
    totalAmount: number;
    renewals: Array<{
      tenantId: string;
      tenantName: string;
      endsAt: string;
      amount: number;
    }>;
  };
  totalRevenue: number;
}

export default function AdminBilling() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: metrics, isLoading: metricsLoading } = useQuery<BillingMetrics>({
    queryKey: ["/api/admin/billing/metrics"],
    queryFn: async () => {
      const res = await fetch("/api/admin/billing/metrics", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch billing metrics");
      return res.json();
    },
    enabled: !!user?.isPlatformOwner || !!user?.isPlatformAdmin,
  });

  const { data: prices, isLoading: pricesLoading } = useQuery<PricesData>({
    queryKey: ["/api/admin/billing/prices"],
    queryFn: async () => {
      const res = await fetch("/api/admin/billing/prices", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch prices");
      return res.json();
    },
    enabled: !!user?.isPlatformOwner || !!user?.isPlatformAdmin,
  });

  const [subscriptionPrice, setSubscriptionPrice] = useState("");
  const [aiAgentPrice, setAiAgentPrice]           = useState("");
  const [trialHours, setTrialHours]               = useState("");

  useEffect(() => {
    if (prices) {
      setSubscriptionPrice(String(prices.subscriptionPrice));
      setAiAgentPrice(String(prices.aiAgentPrice));
      setTrialHours(String(prices.trialHours));
    }
  }, [prices]);

  const { data: allSubscriptions, isLoading: subsLoading, refetch: refetchSubs } = useQuery<SubscriptionRow[]>({
    queryKey: ["/api/admin/billing/subscriptions"],
    queryFn: async () => {
      const res = await fetch("/api/admin/billing/subscriptions", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch subscriptions");
      return res.json();
    },
    enabled: !!user?.isPlatformOwner || !!user?.isPlatformAdmin,
  });

  const { data: allGrants, isLoading: grantsLoading, refetch: refetchGrants } = useQuery<GrantRow[]>({
    queryKey: ["/api/admin/billing/grants"],
    queryFn: async () => {
      const res = await fetch("/api/admin/billing/grants", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch grants");
      return res.json();
    },
    enabled: !!user?.isPlatformOwner || !!user?.isPlatformAdmin,
  });

  const revokeGrantMutation = useMutation({
    mutationFn: async (grantId: string) => {
      const res = await apiRequest("POST", `/api/admin/billing/grants/${grantId}/revoke`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to revoke grant");
      }
      return res.json();
    },
    onSuccess: () => {
      refetchGrants();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/metrics"] });
      toast({ title: "Грант отозван" });
    },
    onError: (e: any) => {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    },
  });

  const cancelSubMutation = useMutation({
    mutationFn: async ({ tenantId, feature }: { tenantId: string; feature: string }) => {
      const res = await apiRequest("POST", `/api/admin/billing/subscriptions/${tenantId}/cancel`, { feature });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to cancel subscription");
      }
      return res.json();
    },
    onSuccess: () => {
      refetchSubs();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/metrics"] });
      toast({ title: "Подписка аннулирована" });
    },
    onError: (e: any) => {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    },
  });

  const savepricesMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, number> = {};
      const sp = parseFloat(subscriptionPrice);
      const ap = parseFloat(aiAgentPrice);
      const th = parseInt(trialHours, 10);
      if (!isNaN(sp) && sp > 0) body.subscriptionPrice = sp;
      if (!isNaN(ap) && ap > 0) body.aiAgentPrice = ap;
      if (!isNaN(th) && th > 0) body.trialHours = th;
      const res = await apiRequest("PUT", "/api/admin/billing/prices", body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save prices");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/billing/prices"] });
      toast({ title: "Цены сохранены", description: "Новые цены вступят в силу для следующих счётов" });
    },
    onError: (e: any) => {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    },
  });

  if (authLoading || metricsLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user?.isPlatformOwner && !user?.isPlatformAdmin) {
    navigate("/owner/login");
    return null;
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/owner")} data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <span className="font-semibold">Биллинг платформы</span>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="container py-6 space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card data-testid="card-active-subscriptions">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Активные подписки</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-active-subscriptions">
                {metrics?.activeSubscriptions || 0}
              </div>
              <p className="text-xs text-muted-foreground">Оплаченные подписки</p>
            </CardContent>
          </Card>

          <Card data-testid="card-active-grants">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Активные гранты</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-active-grants">
                {metrics?.activeGrants || 0}
              </div>
              <p className="text-xs text-muted-foreground">Выданный доступ</p>
            </CardContent>
          </Card>

          <Card data-testid="card-trials">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Триалы</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-trials">
                {metrics?.trialCount || 0}
              </div>
              <p className="text-xs text-muted-foreground">Активные пробные периоды</p>
            </CardContent>
          </Card>

          <Card data-testid="card-expired-trials">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Истёкшие триалы</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-expired-trials">
                {metrics?.expiredTrials || 0}
              </div>
              <p className="text-xs text-muted-foreground">Ожидают оплаты</p>
            </CardContent>
          </Card>
        </div>

        {/* ── Price settings ── */}
        <Card data-testid="card-prices">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Цены и условия
            </CardTitle>
            <CardDescription>
              Изменения вступают в силу для новых счётов — существующие подписки не пересчитываются
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pricesLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка цен…
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="price-subscription">
                      Подписка на каналы (USDT/мес)
                    </Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="price-subscription"
                        type="number"
                        min="1"
                        step="0.01"
                        className="pl-9"
                        value={subscriptionPrice}
                        onChange={(e) => setSubscriptionPrice(e.target.value)}
                        data-testid="input-subscription-price"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Telegram Personal, WhatsApp, MAX Personal
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="price-ai">
                      AI-агент (USDT/мес)
                    </Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="price-ai"
                        type="number"
                        min="1"
                        step="0.01"
                        className="pl-9"
                        value={aiAgentPrice}
                        onChange={(e) => setAiAgentPrice(e.target.value)}
                        data-testid="input-ai-price"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Расширение AI-ответов и автоматизация
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="price-trial">
                      Триальный период (часы)
                    </Label>
                    <div className="relative">
                      <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="price-trial"
                        type="number"
                        min="1"
                        step="1"
                        className="pl-9"
                        value={trialHours}
                        onChange={(e) => setTrialHours(e.target.value)}
                        data-testid="input-trial-hours"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Применяется к новым тенантам
                    </p>
                  </div>
                </div>

                <Button
                  onClick={() => savepricesMutation.mutate()}
                  disabled={savepricesMutation.isPending}
                  data-testid="button-save-prices"
                >
                  {savepricesMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Сохранить цены
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Subscription management ── */}
        <Card data-testid="card-subscriptions">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Управление подписками
            </CardTitle>
            <CardDescription>
              Активные, триальные и незавершённые подписки. Аннулирование действует немедленно.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {subsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка…
              </div>
            ) : !allSubscriptions?.length ? (
              <p className="text-center text-muted-foreground py-8">Нет активных подписок</p>
            ) : (
              <div className="space-y-2">
                {allSubscriptions.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 gap-3 flex-wrap"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {sub.feature === "ai_agent" ? (
                        <Bot className="h-4 w-4 text-purple-500 shrink-0" />
                      ) : (
                        <MessageSquare className="h-4 w-4 text-blue-500 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium truncate">{sub.tenantName || sub.tenantId}</p>
                        <p className="text-xs text-muted-foreground">
                          {sub.feature === "ai_agent" ? "AI Агент" : "Каналы"} ·{" "}
                          {sub.currentPeriodEnd
                            ? `до ${formatDate(sub.currentPeriodEnd)}`
                            : "без даты окончания"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant={sub.status === "active" ? "default" : sub.status === "trialing" ? "secondary" : "outline"}
                      >
                        {sub.status === "active" ? "Активна" :
                         sub.status === "trialing" ? "Триал" :
                         sub.status === "incomplete" ? "Ожидает оплаты" : sub.status}
                      </Badge>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            disabled={cancelSubMutation.isPending}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Аннулировать подписку?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Подписка <strong>{sub.feature === "ai_agent" ? "AI Агент" : "Каналы"}</strong> для{" "}
                              <strong>{sub.tenantName || sub.tenantId}</strong> будет немедленно отменена.
                              Пользователь потеряет доступ прямо сейчас.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive hover:bg-destructive/90"
                              onClick={() =>
                                cancelSubMutation.mutate({ tenantId: sub.tenantId, feature: sub.feature })
                              }
                            >
                              Аннулировать
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Active grants ── */}
        <Card data-testid="card-grants">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5" />
              Активные гранты доступа
            </CardTitle>
            <CardDescription>
              Ручной доступ выданный администратором. Отзыв действует немедленно.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {grantsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка…
              </div>
            ) : !allGrants?.length ? (
              <p className="text-center text-muted-foreground py-8">Нет активных грантов</p>
            ) : (
              <div className="space-y-2">
                {allGrants.map((grant) => (
                  <div
                    key={grant.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 gap-3 flex-wrap"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {grant.feature === "ai_agent" ? (
                        <Bot className="h-4 w-4 text-purple-500 shrink-0" />
                      ) : (
                        <MessageSquare className="h-4 w-4 text-blue-500 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium truncate">{grant.tenantName || grant.tenantId}</p>
                        <p className="text-xs text-muted-foreground">
                          {grant.feature === "ai_agent" ? "AI Агент" : "Каналы"} · до {formatDate(grant.endsAt)}
                        </p>
                        {grant.reason && (
                          <p className="text-xs text-muted-foreground italic truncate">{grant.reason}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary">Грант</Badge>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            disabled={revokeGrantMutation.isPending}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Отозвать грант?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Грант доступа <strong>{grant.feature === "ai_agent" ? "AI Агент" : "Каналы"}</strong> для{" "}
                              <strong>{grant.tenantName || grant.tenantId}</strong> будет немедленно отозван.
                              Пользователь потеряет доступ прямо сейчас.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive hover:bg-destructive/90"
                              onClick={() => revokeGrantMutation.mutate(grant.id)}
                            >
                              Отозвать
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-upcoming-renewals">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Ближайшие продления (30 дней)
                </CardTitle>
                <CardDescription>Подписки которые должны быть продлены</CardDescription>
              </div>
              <Badge variant="outline" className="text-lg px-4 py-2" data-testid="badge-upcoming-total">
                <DollarSign className="h-4 w-4 mr-1" />
                {metrics?.upcomingRenewals?.totalAmount || 0} USDT
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {metrics?.upcomingRenewals?.renewals?.length ? (
              <div className="space-y-3">
                {metrics.upcomingRenewals.renewals.map((renewal) => (
                  <div
                    key={renewal.tenantId}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div>
                      <p className="font-medium">{renewal.tenantName}</p>
                      <p className="text-sm text-muted-foreground">
                        Истекает: {formatDate(renewal.endsAt)}
                      </p>
                    </div>
                    <Badge variant="secondary">{renewal.amount} USDT</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                Нет подписок к продлению в ближайшие 30 дней
              </p>
            )}
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Всего к продлению: {metrics?.upcomingRenewals?.count || 0} подписок
                </span>
                <span className="font-semibold">
                  {metrics?.upcomingRenewals?.totalAmount || 0} USDT
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
