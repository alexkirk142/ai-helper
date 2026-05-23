import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Bot,
  Zap,
  MessageSquare,
  Shield,
  Check,
  Lock,
  Loader2,
  ExternalLink,
  Clock,
  BarChart3,
  Globe,
  BookOpen,
  GraduationCap,
  Wrench,
  Code2,
} from "lucide-react";
import { SiTelegram } from "react-icons/si";
import {
  useAiBillingStatus, useCreateAiCheckout, useCancelAiSubscription,
  useBillingStatus, useCreateCheckout, useCancelSubscription,
} from "@/hooks/use-billing";
import { usePublicBillingConfig } from "@/components/subscription-paywall";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { queryClient, apiRequest } from "@/lib/queryClient";

const CHAT_FEATURES = [
  { icon: MessageSquare, text: "Неограниченные разговоры с клиентами через все подключённые каналы" },
  { icon: Zap, text: "Подключение каналов: Telegram Personal, WhatsApp Personal, MAX" },
  { icon: Shield, text: "Полная защита данных клиентов и GDPR compliance" },
];

const AI_FEATURES = [
  { icon: MessageSquare, text: "Предлагает готовый ответ на каждое сообщение клиента — оператор отправляет одним кликом" },
  { icon: Zap, text: "Простые вопросы отвечает сам, сложные или нестандартные — показывает оператору на проверку" },
  { icon: BookOpen, text: "Отвечает строго по вашему каталогу товаров и базе знаний — без домыслов и выдуманных данных" },
  { icon: GraduationCap, text: "Запоминает удачные ответы вашей команды и со временем становится точнее" },
  { icon: Shield, text: "Проверяет себя перед отправкой — если не уверен в ответе, предупреждает оператора" },
];

const COMING_SOON_EXTENSIONS = [
  {
    icon: Globe,
    name: "Веб-виджет",
    description: "Встраиваемый чат-виджет для сайта с поддержкой AI",
  },
  {
    icon: BarChart3,
    name: "Расширенная аналитика",
    description: "Детальные отчёты по конверсии, воронке продаж и качеству ответов",
  },
];

function ActiveBadge() {
  return (
    <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
      <Check className="mr-1 h-3 w-3" />
      Активен
    </Badge>
  );
}

function InactiveBadge() {
  return (
    <Badge className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
      <Lock className="mr-1 h-3 w-3" />
      Не активен
    </Badge>
  );
}

function ExpiredBadge() {
  return (
    <Badge className="bg-red-500/10 text-red-600 border-red-500/20">
      <Lock className="mr-1 h-3 w-3" />
      Подписка истекла
    </Badge>
  );
}

function MaintenanceBadge() {
  return (
    <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/20">
      <Wrench className="mr-1 h-3 w-3" />
      Тех. работы
    </Badge>
  );
}

function ComingSoonBadge() {
  return (
    <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">
      <Code2 className="mr-1 h-3 w-3" />
      В разработке
    </Badge>
  );
}

export default function Extensions() {
  const { toast } = useToast();

  // Chat subscription (channels)
  const { data: chatBilling, isLoading: chatLoading, refetch: refetchChat } = useBillingStatus();
  const createChatCheckout = useCreateCheckout();
  const cancelChatSubscription = useCancelSubscription();
  const [chatPurchaseLoading, setChatPurchaseLoading] = useState(false);

  // AI Agent subscription
  const { data: billing, isLoading, refetch } = useAiBillingStatus();
  const createCheckout = useCreateAiCheckout();
  const cancelSubscription = useCancelAiSubscription();
  const [purchaseLoading, setPurchaseLoading] = useState(false);

  const { data: publicConfig } = usePublicBillingConfig();
  const aiPrice = publicConfig?.aiAgentPrice ?? 30;
  const subPrice = publicConfig?.subscriptionPrice ?? 50;
  const channelsMode = publicConfig?.channelsMode ?? "active";
  const aiAgentMode = publicConfig?.aiAgentMode ?? "active";

  // Chat subscription states
  const isChatActive = chatBilling?.canAccess === true;
  const isChatTrial = chatBilling?.isTrial && chatBilling?.canAccess;
  const isChatExpired = !chatBilling?.canAccess && chatBilling?.hadTrial && (chatBilling?.status === "expired" || chatBilling?.status === "canceled");
  const isChatPastDue = chatBilling?.status === "past_due";

  // AI subscription states
  const isActive = billing?.canAccess === true;
  const isExpired = !billing?.canAccess && billing?.hasSubscription && billing?.status === "canceled";
  const isPastDue = billing?.status === "past_due";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") !== "success") return;

    const url = new URL(window.location.href);
    url.searchParams.delete("billing");
    window.history.replaceState({}, "", url.toString());

    apiRequest("POST", "/api/billing/ai/verify-payment")
      .then((r) => r.json())
      .then((data: any) => {
        if (data?.activated) {
          sessionStorage.setItem("ai_billing_success", "1");
          queryClient.invalidateQueries({ queryKey: ["/api/billing/ai/me"] });
          toast({
            title: "AI Ассистент активирован!",
            description: "Подписка активна. AI начнёт генерировать подсказки в разговорах.",
          });
          setTimeout(() => sessionStorage.removeItem("ai_billing_success"), 4000);
        } else {
          queryClient.invalidateQueries({ queryKey: ["/api/billing/ai/me"] });
        }
      })
      .catch(() => {});
  }, []);

  const handleChatPurchase = async () => {
    setChatPurchaseLoading(true);
    try {
      const result = await createChatCheckout.mutateAsync();
      if (result.url) {
        window.open(result.url, "_blank");
        toast({
          title: "Переход к оплате",
          description: "Откроется CryptoBot в Telegram для оплаты",
        });
        const interval = setInterval(async () => {
          const { data } = await refetchChat();
          if (data?.canAccess) {
            clearInterval(interval);
            setChatPurchaseLoading(false);
            toast({
              title: "Подписка на чаты активирована!",
              description: "Теперь вы можете подключать каналы связи.",
            });
          }
        }, 3000);
        setTimeout(() => {
          clearInterval(interval);
          setChatPurchaseLoading(false);
        }, 300000);
      } else if (result.error) {
        toast({ title: "Ошибка", description: result.error, variant: "destructive" });
        setChatPurchaseLoading(false);
      }
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось создать сессию оплаты",
        variant: "destructive",
      });
      setChatPurchaseLoading(false);
    }
  };

  const handlePurchase = async () => {
    setPurchaseLoading(true);
    try {
      const result = await createCheckout.mutateAsync();
      if (result.url) {
        window.open(result.url, "_blank");
        toast({
          title: "Переход к оплате",
          description: "Откроется CryptoBot в Telegram для оплаты",
        });
        const interval = setInterval(async () => {
          const { data } = await refetch();
          if (data?.canAccess && data?.status === "active") {
            clearInterval(interval);
            setPurchaseLoading(false);
            toast({
              title: "AI Ассистент активирован!",
              description: "Подписка активна. AI начнёт генерировать подсказки в разговорах.",
            });
          }
        }, 3000);
        setTimeout(() => {
          clearInterval(interval);
          setPurchaseLoading(false);
        }, 300000);
      } else if (result.error) {
        toast({ title: "Ошибка", description: result.error, variant: "destructive" });
        setPurchaseLoading(false);
      }
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось создать сессию оплаты",
        variant: "destructive",
      });
      setPurchaseLoading(false);
    }
  };

  return (
    <div className="container mx-auto max-w-4xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-bold">Подписки и расширения</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Управляйте подписками и подключайте дополнительные возможности
        </p>
      </div>

      <Separator />

      {/* Subscriptions Section */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Подписки
        </h2>

        {/* Chat Subscription Card */}
        <Card className={cn(
          "border-2 transition-colors",
          isChatActive ? "border-primary/30 bg-primary/5" : "border-border"
        )}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Подписка на чаты</CardTitle>
                  <CardDescription className="text-xs">
                    Подключайте каналы и ведите разговоры с клиентами
                  </CardDescription>
                </div>
              </div>
              <div className="shrink-0 flex flex-wrap gap-1.5 justify-end">
                {channelsMode === "maintenance" && <MaintenanceBadge />}
                {channelsMode === "coming_soon" && <ComingSoonBadge />}
                {chatLoading ? (
                  <Badge variant="outline">
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Загрузка...
                  </Badge>
                ) : isChatTrial ? (
                  <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                    <Clock className="mr-1 h-3 w-3" />
                    Пробный период
                  </Badge>
                ) : isChatActive ? (
                  <ActiveBadge />
                ) : isChatPastDue ? (
                  <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/20">
                    <Clock className="mr-1 h-3 w-3" />
                    Требует оплаты
                  </Badge>
                ) : isChatExpired ? (
                  <ExpiredBadge />
                ) : (
                  <InactiveBadge />
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <ul className="space-y-2">
              {CHAT_FEATURES.map((feature, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm">
                  <div className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                    isChatActive ? "bg-primary/10" : "bg-muted"
                  )}>
                    {isChatActive ? (
                      <Check className="h-3 w-3 text-primary" />
                    ) : (
                      <Lock className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                  <span className={cn(isChatActive ? "" : "text-muted-foreground")}>
                    {feature.text}
                  </span>
                </li>
              ))}
            </ul>

            <Separator />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-2xl font-bold">
                  {subPrice} USDT
                  <span className="ml-1 text-sm font-normal text-muted-foreground">/месяц</span>
                </div>
                {isChatTrial && chatBilling?.trialEndsAt && (
                  <p className="text-xs text-blue-600">
                    Пробный период до{" "}
                    {new Date(chatBilling.trialEndsAt).toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "long",
                    })}
                  </p>
                )}
                {isChatActive && !isChatTrial && chatBilling?.currentPeriodEnd && (
                  <p className="text-xs text-muted-foreground">
                    Активна до{" "}
                    {new Date(chatBilling.currentPeriodEnd).toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                )}
                {isChatPastDue && (
                  <p className="text-xs text-orange-600">Требуется продление подписки</p>
                )}
              </div>

              {isChatActive && !isChatTrial ? (
                <div className="flex flex-col gap-2 self-start">
                  <Badge className="bg-green-500/10 text-green-600 border-green-500/20 px-4 py-2 text-sm">
                    <Check className="mr-2 h-4 w-4" />
                    Подписка активна
                  </Badge>
                  {chatBilling?.cancelAtPeriodEnd ? (
                    <p className="text-xs text-muted-foreground text-center">Отмена в конце периода</p>
                  ) : (
                    <button
                      onClick={() => cancelChatSubscription.mutate()}
                      disabled={cancelChatSubscription.isPending}
                      className="text-xs text-muted-foreground underline hover:text-destructive"
                    >
                      Отменить подписку
                    </button>
                  )}
                </div>
              ) : channelsMode === "maintenance" ? (
                <Button size="lg" className="self-start" disabled>
                  <Wrench className="mr-2 h-4 w-4" />
                  Временно недоступно
                </Button>
              ) : channelsMode === "coming_soon" ? (
                <Button size="lg" className="self-start" disabled variant="outline">
                  <Code2 className="mr-2 h-4 w-4" />
                  Скоро
                </Button>
              ) : (
                <Button
                  onClick={handleChatPurchase}
                  disabled={chatPurchaseLoading || createChatCheckout.isPending}
                  size="lg"
                  className="self-start"
                >
                  {chatPurchaseLoading || createChatCheckout.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Подготовка...
                    </>
                  ) : (
                    <>
                      <SiTelegram className="mr-2 h-4 w-4" />
                      {isChatExpired || isChatPastDue ? "Продлить подписку" : `Активировать — ${subPrice} USDT/мес`}
                      <ExternalLink className="ml-2 h-3 w-3" />
                    </>
                  )}
                </Button>
              )}
            </div>

            {!isChatActive && !chatLoading && channelsMode === "active" && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant="outline" className="text-xs">USDT</Badge>
                <Badge variant="outline" className="text-xs">TON</Badge>
                <Badge variant="outline" className="text-xs">BTC</Badge>
                <Badge variant="outline" className="text-xs">ETH</Badge>
                <span className="self-center text-xs text-muted-foreground">
                  — безопасная оплата через CryptoBot
                </span>
              </div>
            )}
            {!isChatActive && channelsMode === "maintenance" && (
              <p className="text-xs text-orange-600">
                Оформление новых подписок временно приостановлено. Мы уже работаем над решением.
              </p>
            )}
          </CardContent>
        </Card>

        {/* AI Agent Card */}
        <Card className={cn(
          "border-2 transition-colors",
          isActive ? "border-primary/30 bg-primary/5" : "border-border"
        )}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Bot className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">AI Ассистент</CardTitle>
                  <CardDescription className="text-xs">
                    Отвечает на вопросы клиентов и учится с каждым диалогом
                  </CardDescription>
                </div>
              </div>
              <div className="shrink-0 flex flex-wrap gap-1.5 justify-end">
                {aiAgentMode === "maintenance" && <MaintenanceBadge />}
                {aiAgentMode === "coming_soon" && <ComingSoonBadge />}
                {isLoading ? (
                  <Badge variant="outline">
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Загрузка...
                  </Badge>
                ) : isActive ? (
                  <ActiveBadge />
                ) : isPastDue ? (
                  <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/20">
                    <Clock className="mr-1 h-3 w-3" />
                    Требует оплаты
                  </Badge>
                ) : isExpired ? (
                  <ExpiredBadge />
                ) : (
                  <InactiveBadge />
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <ul className="space-y-2">
              {AI_FEATURES.map((feature, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm">
                  <div className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                    isActive ? "bg-primary/10" : "bg-muted"
                  )}>
                    {isActive ? (
                      <Check className="h-3 w-3 text-primary" />
                    ) : (
                      <Lock className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                  <span className={cn(isActive ? "" : "text-muted-foreground")}>
                    {feature.text}
                  </span>
                </li>
              ))}
            </ul>

            <Separator />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-2xl font-bold">
                  {aiPrice} USDT
                  <span className="ml-1 text-sm font-normal text-muted-foreground">/месяц</span>
                </div>
                {isActive && billing?.currentPeriodEnd && (
                  <p className="text-xs text-muted-foreground">
                    Активна до{" "}
                    {new Date(billing.currentPeriodEnd).toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                )}
                {isPastDue && (
                  <p className="text-xs text-orange-600">
                    Требуется продление подписки
                  </p>
                )}
              </div>

              {isActive ? (
                <div className="flex flex-col gap-2 self-start">
                  <Badge className="bg-green-500/10 text-green-600 border-green-500/20 px-4 py-2 text-sm">
                    <Check className="mr-2 h-4 w-4" />
                    Подписка активна
                  </Badge>
                  {billing?.cancelAtPeriodEnd ? (
                    <p className="text-xs text-muted-foreground text-center">Отмена в конце периода</p>
                  ) : (
                    <button
                      onClick={() => cancelSubscription.mutate()}
                      disabled={cancelSubscription.isPending}
                      className="text-xs text-muted-foreground underline hover:text-destructive"
                    >
                      Отменить подписку
                    </button>
                  )}
                </div>
              ) : aiAgentMode === "maintenance" ? (
                <Button size="lg" className="self-start" disabled>
                  <Wrench className="mr-2 h-4 w-4" />
                  Временно недоступно
                </Button>
              ) : aiAgentMode === "coming_soon" ? (
                <Button size="lg" className="self-start" disabled variant="outline">
                  <Code2 className="mr-2 h-4 w-4" />
                  Скоро
                </Button>
              ) : (
                <Button
                  onClick={handlePurchase}
                  disabled={purchaseLoading || createCheckout.isPending}
                  size="lg"
                  className="self-start"
                >
                  {purchaseLoading || createCheckout.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Подготовка...
                    </>
                  ) : (
                    <>
                      <SiTelegram className="mr-2 h-4 w-4" />
                      {isExpired || isPastDue ? "Продлить подписку" : `Активировать — ${aiPrice} USDT/мес`}
                      <ExternalLink className="ml-2 h-3 w-3" />
                    </>
                  )}
                </Button>
              )}
            </div>

            {!isActive && !isLoading && aiAgentMode === "active" && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant="outline" className="text-xs">USDT</Badge>
                <Badge variant="outline" className="text-xs">TON</Badge>
                <Badge variant="outline" className="text-xs">BTC</Badge>
                <Badge variant="outline" className="text-xs">ETH</Badge>
                <span className="self-center text-xs text-muted-foreground">
                  — безопасная оплата через CryptoBot
                </span>
              </div>
            )}
            {!isActive && aiAgentMode === "maintenance" && (
              <p className="text-xs text-orange-600">
                Оформление новых подписок временно приостановлено. Мы уже работаем над решением.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Coming Soon Section */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Скоро
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          {COMING_SOON_EXTENSIONS.map((ext) => (
            <Card key={ext.name} className="opacity-60">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <ext.icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{ext.name}</CardTitle>
                      <Badge variant="outline" className="text-xs">Скоро</Badge>
                    </div>
                    <CardDescription className="text-xs mt-0.5">
                      {ext.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
