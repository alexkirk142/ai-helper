import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Phone, MessageSquare, Clock, User, Bot } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

interface FailedLead {
  id: string;
  status: string;
  createdAt: string;
  lastMessageAt: string;
  customer: {
    id: string;
    name: string | null;
    phone: string | null;
    channel: string;
    metadata?: Record<string, unknown>;
  };
  lastMessage?: {
    content: string;
    metadata?: Record<string, unknown>;
  };
}

const FAILURE_REASON_LABELS: Record<string, string> = {
  telegram_failed: "Telegram недоступен",
  max_no_phone: "Нет номера для MAX",
  max_no_account: "Нет аккаунта MAX",
  no_contact_info: "Нет контактных данных",
  all_channels_failed: "Все каналы недоступны",
};

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  max: "MAX",
  auto: "Авто",
};

export default function FailedLeads() {
  const { data: leads, isLoading } = useQuery<FailedLead[]>({
    queryKey: ["/api/failed-leads"],
    queryFn: async () => {
      const res = await fetch("/api/failed-leads", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 30000,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4 flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive" />
        <div>
          <h1 className="text-lg font-semibold">Неудачные заявки</h1>
          <p className="text-sm text-muted-foreground">
            Заявки из Marquiz, по которым не удалось отправить сообщение ни в один мессенджер
          </p>
        </div>
        {leads && leads.length > 0 && (
          <Badge variant="destructive" className="ml-auto">
            {leads.length}
          </Badge>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : !leads || leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <MessageSquare className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-medium">Неудачных заявок нет</p>
            <p className="text-sm text-muted-foreground mt-1">
              Все заявки из Marquiz успешно доставлены
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {leads.map((lead) => {
              const meta = (lead.lastMessage?.metadata ?? {}) as Record<string, string>;
              const failureReason = meta.failureReason ?? "";
              const preferredChannel = meta.preferredChannel ?? "auto";
              const phone = lead.customer.phone
                || (lead.customer.metadata as any)?.phone
                || meta.phone
                || "—";
              const tgUsername = (lead.customer.metadata as any)?.telegramUsername
                || meta.telegramUsername;

              return (
                <Card key={lead.id} className="border-destructive/30 bg-destructive/5">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-destructive/15 flex items-center justify-center shrink-0">
                          <User className="h-4 w-4 text-destructive" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">
                              {lead.customer.name || "Без имени"}
                            </span>
                            <Badge variant="outline" className="text-xs border-destructive/40 text-destructive">
                              <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                                {FAILURE_REASON_LABELS[failureReason] ?? (failureReason || "Ошибка доставки")}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {CHANNEL_LABELS[preferredChannel] ?? preferredChannel}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                            {phone && phone !== "—" && (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3" />
                                {phone}
                              </span>
                            )}
                            {tgUsername && (
                              <span className="flex items-center gap-1">
                                <MessageSquare className="h-3 w-3" />
                                @{tgUsername}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true, locale: ru })}
                            </span>
                          </div>

                          {lead.lastMessage?.content && (
                            <div className="mt-2 flex items-start gap-1.5">
                              <Bot className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {lead.lastMessage.content}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
