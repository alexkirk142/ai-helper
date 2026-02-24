import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, MessageCircle, Trash2, MessageSquarePlus } from "lucide-react";
import { SiTelegram, SiWhatsapp } from "react-icons/si";
import { cn } from "@/lib/utils";
import type { ConversationWithCustomer } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

// Channel icons mapping
function ChannelIcon({ type, className }: { type?: string; className?: string }) {
  switch (type) {
    case "telegram":
    case "telegram_personal":
      return <SiTelegram className={cn("text-[#0088cc]", className)} />;
    case "whatsapp":
    case "whatsapp_personal":
      return <SiWhatsapp className={cn("text-[#25D366]", className)} />;
    case "max":
    case "max_personal":
      return (
        <div className={cn("flex items-center justify-center rounded-full bg-blue-600 text-white font-bold", className)} style={{ fontSize: '0.5rem', width: '1em', height: '1em' }}>
          M
        </div>
      );
    default:
      return <MessageCircle className={cn("text-muted-foreground", className)} />;
  }
}

interface ConversationListProps {
  conversations: ConversationWithCustomer[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  onCreateTestDialog?: () => void;
  onNewDialog?: () => void;
  isLoading?: boolean;
}

const statusColors: Record<string, string> = {
  active: "bg-status-online",
  waiting: "bg-status-away",
  escalated: "bg-status-busy",
  resolved: "bg-status-offline",
};

const modeLabels: Record<string, string> = {
  learning: "Обучение",
  semi_auto: "Полуавто",
  auto: "Авто",
};

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onDelete,
  onCreateTestDialog,
  onNewDialog,
  isLoading,
}: ConversationListProps) {
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const handleDeleteConfirm = () => {
    if (deleteTargetId && onDelete) {
      onDelete(deleteTargetId);
    }
    setDeleteTargetId(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b p-3 flex flex-col gap-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Поиск разговоров..."
            className="pl-9"
            data-testid="input-search-conversations"
          />
        </div>
        {onNewDialog && (
          <Button
            variant="default"
            size="sm"
            className="w-full gap-2"
            onClick={onNewDialog}
            data-testid="button-new-dialog"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Новый диалог
          </Button>
        )}
        {onCreateTestDialog && (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={onCreateTestDialog}
          >
            <MessageSquarePlus className="h-4 w-4" />
            Создать тестовый диалог
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="flex gap-3 rounded-md p-3">
                  <div className="h-10 w-10 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-24 rounded bg-muted" />
                    <div className="h-3 w-full rounded bg-muted" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="text-muted-foreground">Пока нет разговоров</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Разговоры появятся здесь, когда клиенты напишут вам
            </p>
          </div>
        ) : (
          <div className="p-2 w-full">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={cn(
                  "group relative flex w-full max-w-full gap-3 rounded-md p-3 text-left transition-colors hover-elevate cursor-pointer",
                  selectedId === conversation.id && "bg-accent"
                )}
                data-testid={`conversation-item-${conversation.id}`}
                onClick={() => onSelect(conversation.id)}
              >
                <div className="relative">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="text-xs">
                      {conversation.customer?.name?.slice(0, 2).toUpperCase() || "КЛ"}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    className={cn(
                      "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background",
                      statusColors[conversation.status]
                    )}
                  />
                </div>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {conversation.customer?.name || "Неизвестный клиент"}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {conversation.lastMessageAt &&
                        formatDistanceToNow(new Date(conversation.lastMessageAt), {
                          addSuffix: false,
                          locale: ru,
                        })}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {conversation.lastMessage?.content || "Нет сообщений"}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {conversation.channel?.type && (
                      <ChannelIcon type={conversation.channel.type} className="h-3.5 w-3.5" />
                    )}
                    <Badge variant="outline" className="text-xs">
                      {modeLabels[conversation.mode] || conversation.mode}
                    </Badge>
                    {conversation.unreadCount > 0 && (
                      <Badge className="text-xs">
                        {conversation.unreadCount}
                      </Badge>
                    )}
                  </div>
                </div>
                {onDelete && (
                  <button
                    className="absolute top-1 right-1 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTargetId(conversation.id);
                    }}
                    data-testid={`delete-conversation-${conversation.id}`}
                    aria-label="Удалить диалог"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTargetId} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить диалог?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Диалог и все сообщения будут удалены навсегда.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
