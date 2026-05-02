import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Send,
  Check,
  X,
  Edit2,
  AlertTriangle,
  Bot,
  User,
  ChevronDown,
  ChevronUp,
  FileText,
  Package,
  Zap,
  Eye,
  UserCheck,
  Info,
  Star,
  ArrowDown,
  Download,
  BarChart2,
  Paperclip,
  BellOff,
  Bell,
  ClipboardList,
} from "lucide-react";
import { CsatDialog } from "@/components/csat-dialog";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ConversationDetail, AiSuggestion, Penalty } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

interface ChatInterfaceProps {
  conversation: ConversationDetail | null;
  onApprove: (suggestionId: string) => void;
  onEdit: (suggestionId: string, editedText: string) => void;
  onReject: (suggestionId: string) => void;
  onEscalate: (suggestionId: string) => void;
  onSendManual: (content: string, files?: File[]) => void;
  onMuteToggle?: (conversationId: string, muted: boolean) => void;
  onPhoneClick?: (phoneNumber: string) => void;
  onSendSummary?: (conversationId: string) => void;
  isSendingSummary?: boolean;
  isLoading?: boolean;
}

interface UsedSource {
  type: "product" | "doc";
  id: string;
  title?: string;
  quote: string;
  similarity?: number;
}

const decisionLabels: Record<string, { label: string; icon: typeof Zap; color: string; bgColor: string }> = {
  AUTO_SEND: { 
    label: "Автоотправка", 
    icon: Zap, 
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-500/10"
  },
  NEED_APPROVAL: { 
    label: "Требует проверки", 
    icon: Eye, 
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-500/10"
  },
  ESCALATE: { 
    label: "Эскалация", 
    icon: UserCheck, 
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-500/10"
  },
};

const intentLabels: Record<string, { label: string; color: string }> = {
  price: { label: "Цена", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  availability: { label: "Наличие", color: "bg-green-500/10 text-green-600 dark:text-green-400" },
  shipping: { label: "Доставка", color: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  return: { label: "Возврат", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  discount: { label: "Скидка", color: "bg-pink-500/10 text-pink-600 dark:text-pink-400" },
  complaint: { label: "Жалоба", color: "bg-red-500/10 text-red-600 dark:text-red-400" },
  other: { label: "Другое", color: "bg-gray-500/10 text-gray-600 dark:text-gray-400" },
};

const statusLabels: Record<string, string> = {
  active: "Активен",
  waiting: "Ожидает",
  escalated: "Эскалирован",
  resolved: "Решен",
};

const phoneRegex = /(\+?[0-9][\s\-()0-9]{8,}[0-9])/g;

function parseMessageWithPhones(
  content: string,
  onPhoneClick?: (phone: string) => void,
  isOnPrimary = false
): React.ReactNode[] {
  if (!onPhoneClick) {
    return [content];
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyIndex = 0;

  const regex = new RegExp(phoneRegex.source, 'g');
  
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    
    const phoneNumber = match[1];
    const cleanPhone = phoneNumber.replace(/[\s\-()]/g, '');
    
    if (cleanPhone.length >= 10) {
      parts.push(
        <span
          key={`phone-${keyIndex++}`}
          onClick={(e) => {
            e.stopPropagation();
            onPhoneClick(cleanPhone);
          }}
          className={isOnPrimary
            ? "underline font-medium cursor-pointer opacity-90"
            : "text-primary underline font-medium cursor-pointer"
          }
          role="button"
          tabIndex={0}
          data-testid={`link-phone-${cleanPhone}`}
        >
          {phoneNumber}
        </span>
      );
    } else {
      parts.push(phoneNumber);
    }
    
    lastIndex = regex.lastIndex;
  }
  
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }
  
  return parts.length > 0 ? parts : [content];
}

// ============ Attachment types (mirrors server ParsedAttachment) ============

interface MessageAttachment {
  type: "image" | "voice" | "audio" | "video" | "video_note" | "document" | "sticker" | "poll";
  url?: string;
  fileId?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  pollQuestion?: string;
  pollOptions?: string[];
}

interface ForwardedFrom {
  name?: string;
  username?: string;
  date?: number;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentRenderer({
  attachments,
  forwardedFrom,
  isCustomer,
}: {
  attachments?: MessageAttachment[];
  forwardedFrom?: ForwardedFrom;
  isCustomer: boolean;
}) {
  if (!forwardedFrom && (!attachments || attachments.length === 0)) return null;

  return (
    <div className="mt-1 space-y-1.5">
      {forwardedFrom && (
        <div
          className={cn(
            "flex items-center gap-1 border-l-2 pl-2 text-xs opacity-70",
            isCustomer ? "border-foreground/30" : "border-primary-foreground/40",
          )}
        >
          <span className="font-medium">
            Переслано{forwardedFrom.name ? ` от: ${forwardedFrom.name}` : ""}
          </span>
        </div>
      )}
      {attachments?.map((att, i) => {
        if (att.type === "image") {
          return att.url ? (
            <img
              key={i}
              src={att.url}
              alt="Изображение"
              className="max-w-[240px] rounded-lg object-cover"
              style={{ maxHeight: 320 }}
            />
          ) : (
            <div key={i} className="text-xs opacity-60">📷 Фото недоступно</div>
          );
        }

        if (att.type === "sticker") {
          return att.url ? (
            <img
              key={i}
              src={att.url}
              alt="Стикер"
              className="h-20 w-20 object-contain"
            />
          ) : (
            <div key={i} className="text-xs opacity-60">🎭 Стикер</div>
          );
        }

        if (att.type === "voice" || att.type === "audio") {
          const label = att.type === "voice" ? "🎙 Голосовое" : "🎵 Аудио";
          const subtitle = [
            att.fileName,
            att.duration ? `${att.duration}с` : undefined,
            formatFileSize(att.fileSize),
          ]
            .filter(Boolean)
            .join(" · ");
          return att.url ? (
            <div key={i} className="space-y-1">
              <div className="text-xs opacity-70">
                {label}
                {subtitle && <span className="ml-1 opacity-60">{subtitle}</span>}
              </div>
              <audio controls src={att.url} className="h-9 w-full max-w-[240px]" preload="none" />
            </div>
          ) : (
            <div key={i} className="text-xs opacity-60">
              {label}
              {subtitle && <span className="ml-1 opacity-60">{subtitle}</span>}
            </div>
          );
        }

        if (att.type === "video_note") {
          return att.url ? (
            <video
              key={i}
              controls
              src={att.url}
              className="h-32 w-32 rounded-full object-cover"
              preload="none"
            />
          ) : (
            <div key={i} className="text-xs opacity-60">📹 Видеосообщение</div>
          );
        }

        if (att.type === "video") {
          const subtitle = [
            att.duration ? `${att.duration}с` : undefined,
            att.width && att.height ? `${att.width}×${att.height}` : undefined,
            formatFileSize(att.fileSize),
          ]
            .filter(Boolean)
            .join(" · ");
          return att.url ? (
            <div key={i} className="space-y-1">
              {subtitle && <div className="text-xs opacity-60">🎬 {subtitle}</div>}
              <video
                controls
                src={att.url}
                className="max-w-[240px] rounded-lg"
                style={{ maxHeight: 320 }}
                preload="none"
              />
            </div>
          ) : (
            <div key={i} className="text-xs opacity-60">🎬 Видео{subtitle ? ` · ${subtitle}` : ""}</div>
          );
        }

        if (att.type === "document") {
          const label = att.fileName || "Файл";
          const subtitle = formatFileSize(att.fileSize);
          return (
            <a
              key={i}
              href={att.url || "#"}
              download={att.fileName}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-opacity hover:opacity-80",
                isCustomer ? "bg-background/30" : "bg-primary-foreground/10",
              )}
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-[180px] font-medium">{label}</span>
              {subtitle && <span className="shrink-0 text-xs opacity-60">{subtitle}</span>}
            </a>
          );
        }

        if (att.type === "poll") {
          return (
            <div
              key={i}
              className={cn(
                "rounded-md px-3 py-2 text-sm space-y-1",
                isCustomer ? "bg-background/30" : "bg-primary-foreground/10",
              )}
            >
              <div className="flex items-center gap-1.5 font-medium">
                <BarChart2 className="h-3.5 w-3.5 shrink-0" />
                <span>{att.pollQuestion || "Опрос"}</span>
              </div>
              {att.pollOptions?.map((option, j) => (
                <div key={j} className="text-xs opacity-70 pl-5">
                  • {option}
                </div>
              ))}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

export function ChatInterface({
  conversation,
  onApprove,
  onEdit,
  onReject,
  onEscalate,
  onSendManual,
  onMuteToggle,
  onPhoneClick,
  onSendSummary,
  isSendingSummary,
  isLoading,
}: ChatInterfaceProps) {
  const [manualMessage, setManualMessage] = useState("");
  const [editedSuggestion, setEditedSuggestion] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showCsatDialog, setShowCsatDialog] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({}); // file.name+size → objectURL
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevConversationId = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Determine if this is a MAX Personal conversation and which account is used
  const isMaxPersonal = conversation?.customer?.channel === "max_personal";

  const { data: maxAccountsData } = useQuery<{
    accounts: Array<{ accountId: string; idInstance: string; label: string | null; displayName: string | null; status: string }>;
  }>({
    queryKey: ["/api/channels/max-personal/accounts"],
    staleTime: 60_000,
    enabled: !!isMaxPersonal,
  });
  const maxAccountsList = maxAccountsData?.accounts ?? [];

  // Find which accountId this conversation uses (from most recent message that has one)
  const activeAccountId = useMemo(() => {
    if (!conversation?.messages) return null;
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const meta = conversation.messages[i].metadata as any;
      if (meta?.accountId) return meta.accountId as string;
    }
    return null;
  }, [conversation?.messages]);

  const activeAccount = useMemo(() => {
    if (!activeAccountId || maxAccountsList.length === 0) return null;
    return maxAccountsList.find(a => a.accountId === activeAccountId) ?? null;
  }, [activeAccountId, maxAccountsList]);

  const activeAccountLabel = activeAccount
    ? (activeAccount.label || activeAccount.displayName || `Instance ${activeAccount.idInstance}`)
    : null;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: "end" });
    }
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
    setShowScrollButton(!isNearBottom);
  }, []);

  useEffect(() => {
    if (conversation?.id !== prevConversationId.current) {
      prevConversationId.current = conversation?.id || null;
      setTimeout(() => scrollToBottom("instant"), 50);
    }
  }, [conversation?.id, scrollToBottom]);

  useEffect(() => {
    if (conversation?.messages?.length) {
      const scrollArea = scrollAreaRef.current;
      if (scrollArea) {
        const viewport = scrollArea.querySelector("[data-radix-scroll-area-viewport]") as HTMLDivElement;
        if (viewport) {
          const isNearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 150;
          if (isNearBottom) {
            setTimeout(() => scrollToBottom("smooth"), 50);
          }
        }
      }
    }
  }, [conversation?.messages?.length, scrollToBottom]);

  useEffect(() => {
    if (conversation?.currentSuggestion) {
      setEditedSuggestion(conversation.currentSuggestion.suggestedReply);
    }
  }, [conversation?.currentSuggestion]);

  if (!conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <Bot className="h-16 w-16 opacity-20" />
        <p className="mt-4 text-sm">Выберите разговор для просмотра сообщений</p>
      </div>
    );
  }

  const suggestion = conversation.currentSuggestion;
  const usedSources = (suggestion?.usedSources || []) as UsedSource[];
  const explanations = (Array.isArray(suggestion?.explanations) ? suggestion.explanations : []) as string[];

  const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length > 0) {
      e.preventDefault();
      setSelectedFiles((prev) => [...prev, ...imageFiles]);
      setFilePreviews((prev) => {
        const next = { ...prev };
        imageFiles.forEach((f) => { next[fileKey(f)] = URL.createObjectURL(f); });
        return next;
      });
    }
    // No image in clipboard — let default text-paste proceed
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files ?? []);
    if (!newFiles.length) return;
    setSelectedFiles((prev) => [...prev, ...newFiles]);
    setFilePreviews((prev) => {
      const next = { ...prev };
      newFiles.forEach((f) => {
        if (f.type.startsWith("image/")) next[fileKey(f)] = URL.createObjectURL(f);
      });
      return next;
    });
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => {
      const removed = prev[index];
      const key = fileKey(removed);
      setFilePreviews((p) => {
        const next = { ...p };
        if (next[key]) { URL.revokeObjectURL(next[key]); delete next[key]; }
        return next;
      });
      return prev.filter((_, i) => i !== index);
    });
  };

  const clearFiles = () => {
    Object.values(filePreviews).forEach((url) => URL.revokeObjectURL(url));
    setSelectedFiles([]);
    setFilePreviews({});
  };

  const handleSendManual = () => {
    if (!manualMessage.trim() && selectedFiles.length === 0) return;
    onSendManual(manualMessage, selectedFiles.length > 0 ? selectedFiles : undefined);
    setManualMessage("");
    clearFiles();
  };

  const handleApproveEdit = () => {
    if (suggestion) {
      onEdit(suggestion.id, editedSuggestion);
      setIsEditing(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b p-4">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>
              {conversation.customer?.name?.slice(0, 2).toUpperCase() || "КЛ"}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">
              {conversation.customer?.name || "Неизвестный клиент"}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <span>{conversation.customer?.phone || "Нет телефона"}</span>
              <Badge variant="outline" className="text-xs">
                {conversation.mode === "learning" ? "Обучение" : conversation.mode === "semi_auto" ? "Полуавто" : "Авто"}
              </Badge>
              {isMaxPersonal && activeAccountLabel && (
                <Badge variant="outline" className="text-xs border-blue-400 text-blue-500">
                  MAX: {activeAccountLabel}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {conversation.status === "resolved" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCsatDialog(true)}
              data-testid="button-csat-open"
            >
              <Star className="mr-1 h-4 w-4" />
              Оценить
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onSendSummary?.(conversation.id)}
                disabled={isSendingSummary}
                data-testid="button-send-summary"
              >
                <ClipboardList className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Отправить выжимку диалога в Telegram
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={conversation.isMuted ? "secondary" : "ghost"}
                size="icon"
                className={cn("h-8 w-8", conversation.isMuted && "text-muted-foreground")}
                onClick={() => onMuteToggle?.(conversation.id, !conversation.isMuted)}
                data-testid="button-mute-conversation"
              >
                {conversation.isMuted ? (
                  <BellOff className="h-4 w-4" />
                ) : (
                  <Bell className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {conversation.isMuted ? "Включить ИИ-ответы" : "Замутить (ИИ не будет отвечать)"}
            </TooltipContent>
          </Tooltip>
          <Badge
            variant="secondary"
            className={cn(
              conversation.status === "escalated" && "bg-destructive/10 text-destructive"
            )}
          >
            {statusLabels[conversation.status] || conversation.status}
          </Badge>
        </div>
      </div>

      <CsatDialog
        conversationId={conversation.id}
        open={showCsatDialog}
        onOpenChange={setShowCsatDialog}
      />

      {/* Messages */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <ScrollArea 
          className="h-full p-4" 
          ref={scrollAreaRef}
          onScrollCapture={handleScroll}
        >
          <div className="space-y-4">
            {conversation.messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex gap-3",
                  message.role !== "customer" && "flex-row-reverse"
                )}
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-xs">
                    {message.role === "customer" ? (
                      <User className="h-4 w-4" />
                    ) : message.role === "assistant" ? (
                      <Bot className="h-4 w-4" />
                    ) : (
                      "ОП"
                    )}
                  </AvatarFallback>
                </Avatar>
                <div
                  className={cn(
                    "max-w-[70%] rounded-2xl px-4 py-2.5",
                    message.role === "customer"
                      ? "bg-muted"
                      : message.role === "assistant"
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent"
                  )}
                >
                  {message.content && (
                    <p className="text-sm whitespace-pre-wrap">
                      {parseMessageWithPhones(
                        message.content,
                        onPhoneClick,
                        message.role === "assistant" || message.role === "owner"
                      )}
                    </p>
                  )}
                  <AttachmentRenderer
                    attachments={
                      Array.isArray(message.attachments)
                        ? (message.attachments as MessageAttachment[])
                        : undefined
                    }
                    forwardedFrom={
                      message.metadata &&
                      typeof message.metadata === "object" &&
                      "forwardedFrom" in message.metadata
                        ? (message.metadata.forwardedFrom as ForwardedFrom)
                        : undefined
                    }
                    isCustomer={message.role === "customer"}
                  />
                  <span
                    className={cn(
                      "mt-1 block text-xs opacity-70",
                      message.role !== "customer" && "text-right"
                    )}
                  >
                    {formatDistanceToNow(new Date(message.createdAt), {
                      addSuffix: true,
                      locale: ru,
                    })}
                  </span>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
        
        {showScrollButton && (
          <div className="absolute bottom-4 right-6 z-10">
            <Button
              size="icon"
              variant="secondary"
              className="h-10 w-10 rounded-full shadow-md"
              onClick={() => scrollToBottom("smooth")}
              data-testid="button-scroll-to-bottom"
            >
              <ArrowDown className="h-5 w-5" />
            </Button>
          </div>
        )}
      </div>

      {/* AI Suggestion Panel */}
      {suggestion && suggestion.status === "pending" && (
        <Card className="mx-4 mb-4 overflow-hidden border-primary/20">
          <div className="bg-primary/5 px-4 py-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Предложение AI</span>
                {/* Phase 1: Decision Badge */}
                {suggestion.decision && decisionLabels[suggestion.decision] && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-xs",
                      decisionLabels[suggestion.decision].color,
                      decisionLabels[suggestion.decision].bgColor
                    )}
                    data-testid={`badge-decision-${suggestion.decision}`}
                  >
                    {(() => {
                      const DecisionIcon = decisionLabels[suggestion.decision].icon;
                      return <DecisionIcon className="h-3 w-3 mr-1" />;
                    })()}
                    {decisionLabels[suggestion.decision].label}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {suggestion.intent && intentLabels[suggestion.intent] && (
                  <Badge
                    variant="secondary"
                    className={cn("text-xs", intentLabels[suggestion.intent].color)}
                  >
                    {intentLabels[suggestion.intent].label}
                  </Badge>
                )}
                {/* Phase 1: Confidence with breakdown tooltip */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-xs font-mono cursor-help" data-testid="badge-confidence">
                      {Math.round((suggestion.confidence || 0) * 100)}% уверенность
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    <div className="space-y-1">
                      <div className="flex justify-between gap-4">
                        <span>Схожесть:</span>
                        <span className="font-mono">{Math.round((suggestion.similarityScore || 0) * 100)}%</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span>Интент:</span>
                        <span className="font-mono">{Math.round((suggestion.intentScore || 0) * 100)}%</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span>Самопроверка:</span>
                        <span className="font-mono">{Math.round((suggestion.selfCheckScore || 0) * 100)}%</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
          
          {/* Phase 1.1: Autosend blocked warning */}
          {suggestion.decision === "AUTO_SEND" && suggestion.autosendEligible === false && (
            <div className="px-4 py-2 bg-amber-500/10 border-t border-amber-500/20">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div className="text-xs text-amber-700 dark:text-amber-300">
                  {suggestion.autosendBlockReason === "FLAG_OFF" && "Рекомендуется автоответ, но автоотправка отключена глобально"}
                  {suggestion.autosendBlockReason === "SETTING_OFF" && "Рекомендуется автоответ, но автоотправка отключена в настройках"}
                  {suggestion.autosendBlockReason === "INTENT_NOT_ALLOWED" && `Рекомендуется автоответ, но интент "${suggestion.intent}" не разрешён для автоотправки`}
                  {!suggestion.autosendBlockReason && "Рекомендуется автоответ, но автоотправка заблокирована"}
                </div>
              </div>
            </div>
          )}
          
          {/* Phase 1: Explanations */}
          {explanations.length > 0 && (
            <div className="px-4 py-2 bg-muted/50 border-t border-border/50">
              <div className="flex items-start gap-2">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {explanations.slice(0, 3).map((exp, i) => (
                    <div key={i}>{exp}</div>
                  ))}
                </div>
              </div>
            </div>
          )}
          
          <div className="p-4">
            {isEditing ? (
              <Textarea
                value={editedSuggestion}
                onChange={(e) => setEditedSuggestion(e.target.value)}
                className="min-h-[100px] resize-none"
                data-testid="textarea-edit-suggestion"
              />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{suggestion.suggestedReply}</p>
            )}

            {/* Used Sources */}
            {usedSources.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={() => setShowSources(!showSources)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  data-testid="button-toggle-sources"
                >
                  {showSources ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  Использовано источников: {usedSources.length}
                </button>
                {showSources && (
                  <div className="mt-2 space-y-2">
                    {usedSources.map((source, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 rounded-md bg-muted p-2 text-xs"
                      >
                        {source.type === "product" ? (
                          <Package className="h-3 w-3 shrink-0 text-muted-foreground" />
                        ) : (
                          <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        <span className="text-muted-foreground">{source.quote}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {isEditing ? (
                <>
                  <Button
                    size="sm"
                    onClick={handleApproveEdit}
                    data-testid="button-save-edit"
                  >
                    <Check className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Сохранить</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setIsEditing(false);
                      setEditedSuggestion(suggestion.suggestedReply);
                    }}
                    data-testid="button-cancel-edit"
                  >
                    <X className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Отмена</span>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    onClick={() => onApprove(suggestion.id)}
                    data-testid="button-approve-suggestion"
                  >
                    <Check className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Одобрить</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsEditing(true)}
                    data-testid="button-edit-suggestion"
                  >
                    <Edit2 className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Редактировать</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onReject(suggestion.id)}
                    data-testid="button-reject-suggestion"
                  >
                    <X className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Отклонить</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => onEscalate(suggestion.id)}
                    data-testid="button-escalate"
                  >
                    <AlertTriangle className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Эскалировать</span>
                  </Button>
                </>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Manual Message Input */}
      <div className="border-t p-4">
        {/* Multi-file preview strip */}
        {selectedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 rounded-lg border bg-muted/50 p-2">
            {selectedFiles.map((file, idx) => {
              const key = fileKey(file);
              const preview = filePreviews[key];
              return (
                <div key={key + idx} className="relative group">
                  {preview ? (
                    <img
                      src={preview}
                      alt={file.name}
                      className="h-16 w-16 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 flex-col items-center justify-center rounded bg-muted text-center px-1">
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                      <span className="mt-0.5 text-[10px] leading-tight text-muted-foreground line-clamp-2 break-all">
                        {file.name}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                    onClick={() => removeFile(idx)}
                    title="Удалить"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            })}
            {/* Clear all */}
            <button
              type="button"
              className="self-start ml-auto text-xs text-muted-foreground hover:text-foreground underline"
              onClick={clearFiles}
            >
              Очистить
            </button>
          </div>
        )}

        <div className="flex gap-2">
          {/* Hidden file input — multiple allowed */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
            className="hidden"
            onChange={handleFileSelect}
            data-testid="input-file-upload"
          />
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 relative"
            onClick={() => fileInputRef.current?.click()}
            title="Прикрепить файл(ы)"
            data-testid="button-attach-file"
          >
            <Paperclip className="h-4 w-4" />
            {selectedFiles.length > 1 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold">
                {selectedFiles.length}
              </span>
            )}
          </Button>
          <Textarea
            placeholder="Введите сообщение вручную..."
            value={manualMessage}
            onChange={(e) => setManualMessage(e.target.value)}
            className="min-h-[44px] max-h-[120px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendManual();
              }
            }}
            onPaste={handlePaste}
            data-testid="textarea-manual-message"
          />
          <Button
            size="icon"
            onClick={handleSendManual}
            disabled={!manualMessage.trim() && selectedFiles.length === 0}
            data-testid="button-send-manual"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {selectedFiles.length === 0 && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            💡 Вставьте фото из буфера обмена (Ctrl+V) или нажмите <Paperclip className="inline h-3 w-3" /> для выбора нескольких файлов
          </p>
        )}
      </div>
    </div>
  );
}
