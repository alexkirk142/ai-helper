import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { 
  Shield, Loader2, ArrowLeft, Users, Clock, CreditCard, 
  TrendingUp, Calendar, DollarSign
} from "lucide-react";

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

  const { data: metrics, isLoading: metricsLoading } = useQuery<BillingMetrics>({
    queryKey: ["/api/admin/billing/metrics"],
    queryFn: async () => {
      const res = await fetch("/api/admin/billing/metrics", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch billing metrics");
      return res.json();
    },
    enabled: !!user?.isPlatformOwner || !!user?.isPlatformAdmin,
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
