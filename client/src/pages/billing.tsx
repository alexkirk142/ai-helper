import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  CreditCard, 
  Check, 
  Clock, 
  Zap, 
  MessageSquare, 
  Bot, 
  Shield, 
  ExternalLink,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { SiTelegram } from "react-icons/si";
import { useBillingStatus, useCreateCheckout, useCancelSubscription } from "@/hooks/use-billing";
import { useToast } from "@/hooks/use-toast";
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

const PLAN_FEATURES = [
  { icon: MessageSquare, text: "Неограниченные разговоры с клиентами" },
  { icon: Bot, text: "AI-предложения ответов с обучением" },
  { icon: Zap, text: "Подключение всех каналов: Telegram, WhatsApp, MAX" },
  { icon: Shield, text: "Полная защита данных и GDPR compliance" },
];

export default function Billing() {
  const { toast } = useToast();
  const { data: billing, isLoading, refetch } = useBillingStatus();
  const createCheckout = useCreateCheckout();
  const cancelSubscription = useCancelSubscription();
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const handleSubscribe = async () => {
    try {
      const result = await createCheckout.mutateAsync();
      if (result.url) {
        window.open(result.url, "_blank");
        toast({
          title: "Переход к оплате",
          description: "Откроется CryptoBot в Telegram для оплаты",
        });
        const checkInterval = setInterval(async () => {
          const { data } = await refetch();
          if (data?.canAccess && data?.status === "active") {
            clearInterval(checkInterval);
            toast({
              title: "Подписка активирована!",
              description: "Спасибо за оплату. Все функции теперь доступны.",
            });
          }
        }, 3000);
        setTimeout(() => clearInterval(checkInterval), 300000);
      } else if (result.error) {
        toast({
          title: "Ошибка",
          description: result.error,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось создать сессию оплаты",
        variant: "destructive",
      });
    }
  };

  const handleCancel = async () => {
    try {
      await cancelSubscription.mutateAsync();
      toast({
        title: "Подписка отменена",
        description: "Подписка будет активна до конца оплаченного периода",
      });
      setShowCancelDialog(false);
      refetch();
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось отменить подписку",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const getStatusBadge = () => {
    if (billing?.isTrial && billing?.canAccess) {
      const daysText = billing.trialDaysRemaining === 1 
        ? "1 день" 
        : billing.trialDaysRemaining && billing.trialDaysRemaining < 5
          ? `${billing.trialDaysRemaining} дня`
          : `${billing.trialDaysRemaining} дней`;
      return (
        <Badge className="bg-blue-500/10 text-blue-600 border-blue-200" data-testid="badge-trial-status">
          <Clock className="mr-1 h-3 w-3" />
          Пробный период: {daysText}
        </Badge>
      );
    }
    
    if (billing?.status === "active") {
      return (
        <Badge className="bg-green-500/10 text-green-600 border-green-200" data-testid="badge-active-status">
          <Check className="mr-1 h-3 w-3" />
          Активна
        </Badge>
      );
    }
    
    if (billing?.status === "expired") {
      return (
        <Badge className="bg-red-500/10 text-red-600 border-red-200" data-testid="badge-expired-status">
          <AlertCircle className="mr-1 h-3 w-3" />
          Пробный период истёк
        </Badge>
      );
    }
    
    if (billing?.status === "canceled" && billing?.canAccess) {
      return (
        <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-200" data-testid="badge-canceled-status">
          <AlertCircle className="mr-1 h-3 w-3" />
          Отменена (активна до конца периода)
        </Badge>
      );
    }
    
    return (
      <Badge className="bg-muted text-muted-foreground" data-testid="badge-no-subscription">
        Нет подписки
      </Badge>
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-billing-title">Оплата и подписка</h1>
        <p className="text-muted-foreground">Управление вашей подпиской на AI Sales Operator</p>
      </div>

      <Card data-testid="card-current-plan">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Текущий тариф
              </CardTitle>
              <CardDescription>Статус вашей подписки</CardDescription>
            </div>
            {getStatusBadge()}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {billing?.canAccess ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div>
                  <h3 className="font-semibold">AI Sales Operator Pro</h3>
                  <p className="text-sm text-muted-foreground">
                    {billing?.isTrial 
                      ? "Полный доступ на время пробного периода"
                      : "Полный доступ ко всем функциям"
                    }
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold">50 USDT</div>
                  <div className="text-xs text-muted-foreground">/месяц</div>
                </div>
              </div>

              {billing?.isTrial && (
                <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20">
                  <div className="flex items-start gap-3">
                    <Clock className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-blue-900 dark:text-blue-100">
                        Пробный период заканчивается через {billing.trialDaysRemaining} {billing.trialDaysRemaining === 1 ? "день" : billing.trialDaysRemaining && billing.trialDaysRemaining < 5 ? "дня" : "дней"}
                      </p>
                      <p className="text-sm text-blue-700 dark:text-blue-300">
                        Оформите подписку, чтобы продолжить пользоваться всеми функциями после окончания пробного периода.
                      </p>
                      <Button 
                        onClick={handleSubscribe}
                        disabled={createCheckout.isPending}
                        className="mt-3"
                        size="sm"
                        data-testid="button-subscribe-trial"
                      >
                        {createCheckout.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <SiTelegram className="mr-2 h-4 w-4" />
                        )}
                        Оформить подписку
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {billing?.currentPeriodEnd && billing?.status === "active" && (
                <p className="text-sm text-muted-foreground">
                  Следующее списание: {new Date(billing.currentPeriodEnd).toLocaleDateString("ru-RU")}
                </p>
              )}

              {billing?.status === "active" && !billing?.cancelAtPeriodEnd && (
                <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" data-testid="button-cancel-subscription">
                      Отменить подписку
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Отменить подписку?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Подписка будет активна до конца оплаченного периода. После этого доступ к функциям будет ограничен.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction 
                        onClick={handleCancel}
                        disabled={cancelSubscription.isPending}
                        data-testid="button-confirm-cancel"
                      >
                        {cancelSubscription.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Подтвердить
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {billing?.status === "expired" && billing?.hadTrial && (
                <div className="p-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-red-900 dark:text-red-100">
                        Ваш 3-дневный пробный период завершён
                      </p>
                      <p className="text-sm text-red-700 dark:text-red-300">
                        Оформите подписку для продолжения работы с платформой.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <div>
                      <h3 className="font-semibold text-lg">AI Sales Operator Pro</h3>
                      <p className="text-sm text-muted-foreground">Полный доступ ко всем функциям</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold">50 USDT</div>
                      <div className="text-xs text-muted-foreground">/месяц</div>
                    </div>
                  </div>

                  <div className="space-y-3 mb-6">
                    {PLAN_FEATURES.map((feature, idx) => (
                      <div key={idx} className="flex items-center gap-3 text-sm">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          <Check className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <span>{feature.text}</span>
                      </div>
                    ))}
                  </div>

                  <Button 
                    onClick={handleSubscribe}
                    disabled={createCheckout.isPending}
                    className="w-full"
                    size="lg"
                    data-testid="button-subscribe"
                  >
                    {createCheckout.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Подготовка...
                      </>
                    ) : (
                      <>
                        <SiTelegram className="mr-2 h-4 w-4" />
                        Оплатить через CryptoBot
                        <ExternalLink className="ml-2 h-3 w-3" />
                      </>
                    )}
                  </Button>
                  
                  <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-xs">USDT</Badge>
                    <Badge variant="outline" className="text-xs">TON</Badge>
                    <Badge variant="outline" className="text-xs">BTC</Badge>
                    <Badge variant="outline" className="text-xs">ETH</Badge>
                  </div>
                </CardContent>
              </Card>

              <p className="text-xs text-center text-muted-foreground">
                Безопасная оплата криптовалютой через CryptoBot. Отмена в любое время.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-payment-info">
        <CardHeader>
          <CardTitle className="text-base">Информация об оплате</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Оплата производится через CryptoBot (@CryptoBot в Telegram) с поддержкой криптовалют: 
            USDT, TON, BTC, ETH, LTC, BNB, TRX, USDC.
          </p>
          <p>
            После оплаты подписка активируется автоматически. При возникновении вопросов 
            обращайтесь в поддержку.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
