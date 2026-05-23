import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Search, MessageCircle, Trash2, MessageSquarePlus, CheckCheck, Loader2 } from "lucide-react";
import { SiTelegram, SiWhatsapp } from "react-icons/si";
import { cn } from "@/lib/utils";
import type { ConversationWithCustomer } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

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
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-blue-600 text-white font-bold",
            className,
          )}
          style={{ fontSize: "0.5rem", width: "1em", height: "1em" }}
        >
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
  onMarkAllRead?: () => void;
  isMarkingAllRead?: boolean;
  onNewDialog?: () => void;
  isLoading?: boolean;
  hasMoreServer?: boolean;
  isFetchingMore?: boolean;
  onLoadMoreServer?: () => void;
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

// Render PAGE_SIZE items initially, load more as user scrolls
const PAGE_SIZE = 60;

// Highlight matching text inside a string
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-800 text-inherit rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// Extract a short snippet around the matched word
function getSnippet(content: string, query: string, radius = 40): string {
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return content.slice(0, 80);
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + query.length + radius);
  return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onDelete,
  onMarkAllRead,
  isMarkingAllRead,
  onNewDialog,
  isLoading,
  hasMoreServer,
  isFetchingMore,
  onLoadMoreServer,
}: ConversationListProps) {
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Debounce: fire server search 400ms after user stops typing
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const isServerSearch = debouncedQuery.length >= 2;

  // Server-side full-text search
  const { data: searchResults, isFetching: searchLoading } = useQuery<ConversationWithCustomer[]>({
    queryKey: ["/api/conversations/search", debouncedQuery],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/search?q=${encodeURIComponent(debouncedQuery)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: isServerSearch,
    staleTime: 30_000,
  });

  const handleDeleteConfirm = () => {
    if (deleteTargetId && onDelete) {
      onDelete(deleteTargetId);
    }
    setDeleteTargetId(null);
  };

  // When server search is active — use results; otherwise client-side filter
  const filtered = isServerSearch
    ? (searchResults ?? [])
    : searchQuery.trim()
      ? conversations.filter((c) => {
          const q = searchQuery.toLowerCase();
          return (
            c.customer?.name?.toLowerCase().includes(q) ||
            c.customer?.phone?.toLowerCase().includes(q) ||
            c.lastMessage?.content?.toLowerCase().includes(q)
          );
        })
      : conversations;

  // Reset visible count only when the filter changes or the list SHRINKS
  // (filter applied / channel switch). Do NOT reset when more server data arrives
  // (list grows) — that would jump back to the top.
  const prevFilterKey = useRef("");
  const prevLength = useRef(0);
  const filterKey = debouncedQuery;
  const listShrunk = conversations.length < prevLength.current;
  if (filterKey !== prevFilterKey.current || listShrunk) {
    prevFilterKey.current = filterKey;
    setVisibleCount(PAGE_SIZE);
  }
  prevLength.current = conversations.length;

  const visibleItems = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  // Keep a reference to the active observer so we can disconnect before creating a new one.
  // React 18 does not invoke the return value of ref callbacks as cleanup.
  const observerRef = useRef<IntersectionObserver | null>(null);

  // IntersectionObserver sentinel — load next local page, or fetch next server page
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (!node || (!hasMore && !hasMoreServer)) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries[0].isIntersecting) return;
          if (hasMore) {
            setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length));
          } else if (hasMoreServer && onLoadMoreServer && !isFetchingMore) {
            onLoadMoreServer();
          }
        },
        { threshold: 0.1 },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [hasMore, filtered.length, hasMoreServer, isFetchingMore, onLoadMoreServer],
  );

  const showLoading = isLoading || (isServerSearch && searchLoading && !searchResults);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="p-3 pb-2 flex flex-col gap-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени, номеру..."
            className="pl-9 pr-8 rounded-xl bg-background/40 border-border/40 focus-visible:bg-background transition-all"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-conversations"
          />
          {searchLoading && isServerSearch && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        {isServerSearch && !searchLoading && searchResults && (
          <p className="text-[10px] font-semibold text-muted-foreground px-1">
            Найдено: {searchResults.length} {searchResults.length === 1 ? "диалог" : "диалогов"} · поиск по сообщениям
          </p>
        )}
        <div className="flex gap-2">
          {onNewDialog && (
            <Button
              variant="default"
              size="sm"
              className="flex-1 gap-2 rounded-xl text-xs font-semibold shadow-md shadow-primary/10"
              onClick={onNewDialog}
              data-testid="button-new-dialog"
            >
              <MessageSquarePlus className="h-4 w-4" />
              Новый диалог
            </Button>
          )}
          {onMarkAllRead && (
            <Button
              variant="outline"
              size="sm"
              className={cn("rounded-xl text-xs font-medium hover:bg-card/80", onNewDialog ? "gap-1.5 px-3" : "flex-1 gap-2")}
              onClick={onMarkAllRead}
              disabled={isMarkingAllRead}
              title="Отметить все как прочитанные"
              data-testid="button-mark-all-read"
            >
              {isMarkingAllRead
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <CheckCheck className="h-4 w-4 text-primary" />}
              {!onNewDialog && "Прочитать все"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {showLoading ? (
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
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="text-muted-foreground">
              {searchQuery ? "Ничего не найдено" : "Пока нет разговоров"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {searchQuery
                ? "Попробуйте изменить запрос"
                : "Разговоры появятся здесь, когда клиенты напишут вам"}
            </p>
          </div>
        ) : (
          <div className="p-2 w-full">
            {visibleItems.map((conversation) => {
              const isMarquizLead =
                (conversation.customer?.metadata as any)?.source === "marquiz";

              // In search mode: prefer matched message snippet over last message
              const displayQuery = isServerSearch ? debouncedQuery : searchQuery.trim();
              const matchedMsg = conversation.matchedMessage;
              const showMatchedSnippet = isServerSearch && matchedMsg &&
                matchedMsg.id !== conversation.lastMessage?.id;
              const snippetText = showMatchedSnippet
                ? getSnippet(matchedMsg!.content, displayQuery)
                : conversation.lastMessage?.content;

              return (
                <div
                  key={conversation.id}
                  className={cn(
                    "group relative flex w-full max-w-full gap-3 rounded-xl p-3 text-left transition-all duration-200 hover:bg-muted/40 cursor-pointer border border-transparent mb-1",
                    selectedId === conversation.id ? "bg-primary/[0.04] border-primary/10 shadow-sm" : "hover:border-border/30",
                  )}
                  data-testid={`conversation-item-${conversation.id}`}
                  onClick={() => onSelect(conversation.id)}
                >
                  {/* Active left indicator bar */}
                  {selectedId === conversation.id && (
                    <div className="absolute left-0 top-3 bottom-3 w-1.5 rounded-r-full bg-primary shadow-[1px_0_8px_rgba(var(--primary),0.4)]" />
                  )}

                  <div className="relative">
                    <Avatar className="h-10 w-10 border border-border/30 shadow-sm">
                      <AvatarFallback className="text-xs font-bold bg-muted text-muted-foreground">
                        {conversation.customer?.name?.slice(0, 2).toUpperCase() || "КЛ"}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      className={cn(
                        "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background shadow-sm",
                        statusColors[conversation.status],
                      )}
                    />
                  </div>

                  <div className="flex-1 min-w-0 overflow-hidden space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn(
                        "truncate text-sm font-bold text-foreground",
                        selectedId === conversation.id ? "text-primary font-extrabold" : ""
                      )}>
                        {displayQuery ? (
                          <Highlight
                            text={conversation.customer?.name || "Неизвестный клиент"}
                            query={displayQuery}
                          />
                        ) : (
                          conversation.customer?.name || "Неизвестный клиент"
                        )}
                      </span>
                      <span className="shrink-0 text-[10px] font-semibold text-muted-foreground/80">
                        {conversation.lastMessageAt &&
                          formatDistanceToNow(new Date(conversation.lastMessageAt), {
                            addSuffix: false,
                            locale: ru,
                          })}
                      </span>
                    </div>

                    <div className="truncate text-xs text-muted-foreground/90 font-medium">
                      {snippetText ? (
                        displayQuery ? (
                          <Highlight text={snippetText} query={displayQuery} />
                        ) : (
                          snippetText
                        )
                      ) : (
                        "Нет сообщений"
                      )}
                    </div>

                    {showMatchedSnippet && (
                      <div className="text-[10px] text-muted-foreground/60 font-medium truncate">
                        в старом сообщении
                      </div>
                    )}

                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      {conversation.channel?.type && (
                        <ChannelIcon type={conversation.channel.type} className="h-3.5 w-3.5" />
                      )}
                      <Badge variant="outline" className="text-[10px] font-bold border-border/50 bg-background/50 px-2 py-0">
                        {modeLabels[conversation.mode] || conversation.mode}
                      </Badge>
                      {isMarquizLead && (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-bold border-orange-400 text-orange-500 bg-orange-500/[0.04]"
                        >
                          Заявка
                        </Badge>
                      )}
                      {(conversation.unreadCount ?? 0) > 0 && (
                        <Badge className="ml-auto rounded-full h-5 min-w-[20px] bg-primary text-primary-foreground font-extrabold text-[10px] flex items-center justify-center px-1.5 shadow-md shadow-primary/20 hover:bg-primary">
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
              );
            })}

            {/* Sentinel — auto-loads next local chunk or next server page */}
            {(hasMore || hasMoreServer) && (
              <div ref={sentinelRef} className="h-10 flex items-center justify-center gap-2">
                {isFetchingMore ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Загрузка...</span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Показано {visibleCount} из {filtered.length}
                    {hasMoreServer ? "+" : ""}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <AlertDialog
        open={!!deleteTargetId}
        onOpenChange={(open) => !open && setDeleteTargetId(null)}
      >
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
