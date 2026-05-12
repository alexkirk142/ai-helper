import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Lock, 
  Zap, 
  MessageSquare, 
  Bot, 
  Shield, 
  Check, 
  Loader2,
  ExternalLink,
  Clock,
  Bell,
  PartyPopper,
} from "lucide-react";
import { SiTelegram } from "react-icons/si";
import { useCreateCheckout, useBillingStatus } from "@/hooks/use-billing";
import { useToast } from "@/hooks/use-toast";

function usePublicBillingConfig() {
  return useQuery<{ notifyBotUsername: string | null }>({
    queryKey: ["/api/billing/public-config"],
    staleTime: 5 * 60 * 1000,
  });
}

interface SubscriptionPaywallProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: "channel" | "feature";
}

const PLAN_FEATURES = [
  { icon: MessageSquare, text: "Неограниченные разговоры с клиентами" },
  { icon: Bot, text: "AI-предложения ответов с обучением" },
  { icon: Zap, text: "Подключение всех каналов: Telegram, WhatsApp, MAX" },
  { icon: Shield, text: "Полная защита данных и GDPR compliance" },
];

export function SubscriptionPaywall({ 
  open, 
  onOpenChange,
  trigger = "channel" 
}: SubscriptionPaywallProps) {
  const { toast } = useToast();
  const createCheckout = useCreateCheckout();
  const { data: billing, refetch } = useBillingStatus();
  
  const isTrialExpired = billing?.hadTrial && billing?.status === "expired";

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
          if (data?.canAccess) {
            clearInterval(checkInterval);
            onOpenChange(false);
            toast({
              title: "Подписка активирована!",
              description: "Теперь вы можете подключать каналы связи",
            });
          }
        }, 3000);
        setTimeout(() => clearInterval(checkInterval), 300000);
      } else if (result.error) {
        toast({
          title: "Ошибка",
          description: result.error || "Не удалось создать сессию оплаты",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Ошибка",
          description: "CryptoBot не вернул ссылку для оплаты. Проверьте настройки биллинга.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      const message = error?.message || "Не удалось создать сессию оплаты";
      toast({
        title: "Ошибка",
        description: message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="subscription-paywall-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            {isTrialExpired ? "Пробный период завершён" : "Требуется подписка"}
          </DialogTitle>
          <DialogDescription>
            {isTrialExpired 
              ? "Ваш 3-дневный пробный период истёк. Оформите подписку для продолжения работы"
              : trigger === "channel" 
                ? "Для подключения каналов связи необходима активная подписка"
                : "Эта функция доступна только с активной подпиской"
            }
          </DialogDescription>
        </DialogHeader>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-lg">NexusChat Pro</h3>
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
      </DialogContent>
    </Dialog>
  );
}

interface ChannelPaywallOverlayProps {
  canAccess: boolean;
  onSubscribeClick: () => void;
  children: React.ReactNode;
}

export function ChannelPaywallOverlay({ 
  canAccess, 
  onSubscribeClick, 
  children 
}: ChannelPaywallOverlayProps) {
  if (canAccess) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <div className="opacity-50 pointer-events-none select-none">
        {children}
      </div>
      <div 
        className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg"
        data-testid="overlay-subscription-required"
      >
        <div className="text-center p-6">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h4 className="font-medium mb-1" data-testid="text-subscription-inactive">Подписка не активна</h4>
          <p className="text-sm text-muted-foreground mb-4" data-testid="text-subscription-required">
            Подключение каналов требует активной подписки
          </p>
          <Button 
            onClick={onSubscribeClick}
            size="sm"
            data-testid="button-activate-subscription"
          >
            <Zap className="mr-2 h-4 w-4" />
            Активировать за $50/мес
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SubscriptionBadge() {
  const { data: billing, isLoading } = useBillingStatus();

  if (isLoading) return null;

  // Show trial badge with remaining time
  if (billing?.isTrial && billing?.canAccess) {
    const daysText = billing.trialDaysRemaining === 1 
      ? "1 день" 
      : billing.trialDaysRemaining && billing.trialDaysRemaining < 5
        ? `${billing.trialDaysRemaining} дня`
        : `${billing.trialDaysRemaining} дней`;
    
    return (
      <Badge variant="outline" className="bg-blue-500/10 text-blue-600" data-testid="badge-trial">
        <Clock className="mr-1 h-3 w-3" />
        Пробный: {daysText}
      </Badge>
    );
  }

  // Show active subscription badge
  if (billing?.canAccess) {
    return (
      <Badge variant="outline" className="bg-green-500/10 text-green-600" data-testid="badge-pro">
        <Check className="mr-1 h-3 w-3" />
        Pro
      </Badge>
    );
  }

  // Show expired trial or no subscription badge
  if (billing?.hadTrial && billing?.status === "expired") {
    return (
      <Badge variant="outline" className="bg-red-500/10 text-red-600" data-testid="badge-trial-expired">
        <Lock className="mr-1 h-3 w-3" />
        Пробный истёк
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600" data-testid="badge-no-subscription">
      <Lock className="mr-1 h-3 w-3" />
      Нет подписки
    </Badge>
  );
}

const SUCCESS_FEATURES = [
  { icon: MessageSquare, text: "Отправка сообщений через все каналы" },
  { icon: Bot,          text: "AI-подсказки и автоответы" },
  { icon: Zap,          text: "Telegram Personal, WhatsApp Personal, Max Personal" },
  { icon: Shield,       text: "Полная защита данных" },
];

interface PaymentSuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PaymentSuccessDialog({ open, onOpenChange }: PaymentSuccessDialogProps) {
  const { data: config } = usePublicBillingConfig();
  const notifyBotUsername = config?.notifyBotUsername;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="payment-success-dialog">
        <DialogHeader className="items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 mb-2">
            <PartyPopper className="h-7 w-7 text-green-600" />
          </div>
          <DialogTitle className="text-xl">Подписка активирована!</DialogTitle>
          <DialogDescription>
            Теперь все каналы связи доступны. Вы можете начать работу прямо сейчас.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {SUCCESS_FEATURES.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-2">
              <Icon className="h-4 w-4 text-green-600 shrink-0" />
              <span className="text-sm">{text}</span>
            </div>
          ))}
        </div>

        {notifyBotUsername && (
          <>
            <Separator />
            <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Bell className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Уведомления об окончании подписки</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Подключите бота, чтобы получать напоминания за 3 дня и 1 день до окончания подписки.
                  </p>
                </div>
              </div>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => window.open(`https://t.me/${notifyBotUsername}`, "_blank")}
              >
                <SiTelegram className="mr-2 h-4 w-4 text-[#2AABEE]" />
                Подключить уведомления в Telegram
                <ExternalLink className="ml-2 h-3 w-3 opacity-60" />
              </Button>
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            className="w-full"
            onClick={() => onOpenChange(false)}
            data-testid="button-payment-success-close"
          >
            <Check className="mr-2 h-4 w-4" />
            Отлично, начать работу
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
