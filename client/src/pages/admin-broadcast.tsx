import { useLocation } from "wouter";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/hooks/use-toast";
import {
  Shield, Loader2, ArrowLeft, Send, Users, MessageSquare, CheckCircle2
} from "lucide-react";
import { SiTelegram } from "react-icons/si";

interface Subscriber {
  id: string;
  chat_id: string;
  first_name: string | null;
  username: string | null;
  created_at: string;
}

interface BroadcastResult {
  success: boolean;
  sent: number;
  failed: number;
  total: number;
}

export default function AdminBroadcast() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [lastResult, setLastResult] = useState<BroadcastResult | null>(null);

  const { data: subscribers, isLoading: subsLoading } = useQuery<Subscriber[]>({
    queryKey: ["/api/admin/notify/subscribers"],
    queryFn: async () => {
      const res = await fetch("/api/admin/notify/subscribers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch subscribers");
      return res.json();
    },
    enabled: !!user?.isPlatformOwner || !!user?.isPlatformAdmin,
  });

  const broadcastMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/admin/notify/broadcast", { message: text });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Broadcast failed");
      }
      return res.json() as Promise<BroadcastResult>;
    },
    onSuccess: (data) => {
      setLastResult(data);
      setMessage("");
      toast({
        title: `Рассылка отправлена`,
        description: `Доставлено: ${data.sent} из ${data.total}`,
      });
    },
    onError: (e: any) => {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    },
  });

  if (authLoading) {
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

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/owner")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <span className="font-semibold">Рассылки через бота</span>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="container py-6 space-y-6 max-w-3xl">

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Подписчиков бота</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {subsLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (subscribers?.length ?? 0)}
              </div>
              <p className="text-xs text-muted-foreground">Запустили /start</p>
            </CardContent>
          </Card>

          {lastResult && (
            <Card className="border-green-500/30 bg-green-500/5">
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Последняя рассылка</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{lastResult.sent}</div>
                <p className="text-xs text-muted-foreground">
                  Доставлено из {lastResult.total}
                  {lastResult.failed > 0 && ` · ${lastResult.failed} ошибок`}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Compose */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Новое сообщение
            </CardTitle>
            <CardDescription>
              Сообщение будет отправлено всем {subscribers?.length ?? 0} подписчикам.
              Поддерживается Markdown: *жирный*, _курсив_, `код`.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="Введите текст сообщения..."
              className="min-h-[140px] resize-none font-mono text-sm"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={4096}
            />
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground">{message.length} / 4096</span>
              <Button
                onClick={() => broadcastMutation.mutate(message)}
                disabled={!message.trim() || broadcastMutation.isPending || !subscribers?.length}
              >
                {broadcastMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Отправить рассылку
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Subscribers list */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SiTelegram className="h-5 w-5 text-[#2AABEE]" />
              Список подписчиков
            </CardTitle>
            <CardDescription>Пользователи запустившие бота уведомлений</CardDescription>
          </CardHeader>
          <CardContent>
            {subsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
              </div>
            ) : !subscribers?.length ? (
              <p className="text-center text-muted-foreground py-8">
                Пока никто не запустил бота. Ссылка на бота отображается в диалоге успешной оплаты.
              </p>
            ) : (
              <div className="space-y-2">
                {subscribers.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <SiTelegram className="h-4 w-4 text-[#2AABEE] shrink-0" />
                      <div>
                        <p className="font-medium text-sm">
                          {sub.first_name || `Chat ${sub.chat_id}`}
                          {sub.username && (
                            <span className="text-muted-foreground font-normal ml-1">
                              @{sub.username}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          ID: {sub.chat_id} · {formatDate(sub.created_at)}
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary">Активен</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
