import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ConversationList } from "@/components/conversation-list";
import { ChatInterface } from "@/components/chat-interface";
import { CustomerCard } from "@/components/customer-card";
import { ChannelTabs } from "@/components/channel-tabs";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { User, ArrowLeft, Send, X, Paperclip } from "lucide-react";
import type { ConversationWithCustomer, ConversationDetail } from "@shared/schema";
import type { ChannelFilter } from "@/components/channel-tabs";

const CHANNEL_FAMILY_TYPES: Record<Exclude<ChannelFilter, "all" | "marquiz">, string[]> = {
  telegram: ["telegram", "telegram_personal"],
  max: ["max", "max_personal"],
  whatsapp: ["whatsapp", "whatsapp_personal"],
};

export default function Conversations() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testName, setTestName] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testImage, setTestImage] = useState<File | null>(null);
  const [testImagePreviewUrl, setTestImagePreviewUrl] = useState<string | null>(null);
  const testImageInputRef = useRef<HTMLInputElement>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [replyAsCustomerText, setReplyAsCustomerText] = useState("");
  const [showReplyAsCustomer, setShowReplyAsCustomer] = useState(false);
  const [replyAsCustomerFile, setReplyAsCustomerFile] = useState<File | null>(null);
  const [replyAsCustomerFilePreviewUrl, setReplyAsCustomerFilePreviewUrl] = useState<string | null>(null);
  const replyAsCustomerFileRef = useRef<HTMLInputElement>(null);

  // "Новый диалог" modal state
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newDialogChannel, setNewDialogChannel] = useState<"telegram_personal" | "max_personal" | "">("");
  const [newDialogPhone, setNewDialogPhone] = useState("");
  const [newDialogMessage, setNewDialogMessage] = useState("");
  const [newDialogPhoneError, setNewDialogPhoneError] = useState("");
  const [newDialogMaxAccountId, setNewDialogMaxAccountId] = useState<string>("");

  const { toast } = useToast();

  const handleSelectConversation = async (id: string) => {
    setSelectedId(id);
    setMobileShowChat(true);
    
    // Mark conversation as read to reset unread counter
    try {
      await apiRequest("POST", `/api/conversations/${id}/read`);
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/channel-counts"] });
    } catch (error) {
      console.error("Failed to mark conversation as read:", error);
    }
  };

  const handleBackToList = () => {
    setMobileShowChat(false);
  };

  const { data: conversations, isLoading: conversationsLoading } = useQuery<ConversationWithCustomer[]>({
    queryKey: ["/api/conversations"],
  });

  const { data: channelCounts } = useQuery<{ all: number; telegram?: number; max?: number; whatsapp?: number }>({
    queryKey: ["/api/conversations/channel-counts"],
  });

  // Count marquiz leads from already-loaded conversations (client-side)
  const marquizCount = useMemo(() => {
    if (!conversations) return 0;
    return conversations.filter(
      (c) => (c.customer?.metadata as any)?.source === "marquiz"
    ).length;
  }, [conversations]);

  const { data: personalChannelStatus } = useQuery<{ telegram_personal: boolean; max_personal: boolean }>({
    queryKey: ["/api/channels/personal-status"],
    staleTime: 60_000,
  });

  const { data: maxPersonalAccountsList } = useQuery<Array<{ accountId: string; idInstance: string; label: string | null; displayName: string | null; status: string }>>({
    queryKey: ["/api/channels/max-personal/accounts"],
    staleTime: 30_000,
    enabled: newDialogOpen && newDialogChannel === "max_personal",
  });

  const filteredConversations = useMemo(() => {
    if (!conversations) return [];
    if (channelFilter === "all") return conversations;
    if (channelFilter === "marquiz") {
      return conversations.filter(
        (c) => (c.customer?.metadata as any)?.source === "marquiz"
      );
    }
    const types = CHANNEL_FAMILY_TYPES[channelFilter];
    return conversations.filter((c) => {
      // Prefer channel.type from the channels table; fall back to customer.channel
      // for conversations without a channelId (e.g. max_personal via start-conversation).
      const channelType = c.channel?.type ?? c.customer?.channel ?? "";
      return types.includes(channelType);
    });
  }, [conversations, channelFilter]);

  const { data: conversationDetail, isLoading: detailLoading } = useQuery<ConversationDetail>({
    queryKey: ["/api/conversations", selectedId],
    enabled: !!selectedId,
  });

  const approveMutation = useMutation({
    mutationFn: async (suggestionId: string) => {
      return apiRequest("POST", `/api/suggestions/${suggestionId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", selectedId] });
      toast({ title: "Response approved and sent" });
    },
    onError: () => {
      toast({ title: "Failed to approve", variant: "destructive" });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ suggestionId, editedText }: { suggestionId: string; editedText: string }) => {
      return apiRequest("POST", `/api/suggestions/${suggestionId}/edit`, { editedText });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", selectedId] });
      toast({ title: "Edited response sent" });
    },
    onError: () => {
      toast({ title: "Failed to send edited response", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (suggestionId: string) => {
      return apiRequest("POST", `/api/suggestions/${suggestionId}/reject`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", selectedId] });
      toast({ title: "Suggestion rejected" });
    },
    onError: () => {
      toast({ title: "Failed to reject", variant: "destructive" });
    },
  });

  const escalateMutation = useMutation({
    mutationFn: async (suggestionId: string) => {
      return apiRequest("POST", `/api/suggestions/${suggestionId}/escalate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["/api/escalations"] });
      toast({ title: "Conversation escalated" });
    },
    onError: () => {
      toast({ title: "Failed to escalate", variant: "destructive" });
    },
  });

  const muteMutation = useMutation({
    mutationFn: async ({ conversationId, muted }: { conversationId: string; muted: boolean }) => {
      const res = await apiRequest("POST", `/api/conversations/${conversationId}/mute`, { muted });
      return res.json();
    },
    onSuccess: (_data, { muted }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: muted ? "ИИ отключён для этого чата" : "ИИ снова активен для этого чата" });
    },
    onError: () => {
      toast({ title: "Не удалось изменить настройку мута", variant: "destructive" });
    },
  });

  const sendManualMutation = useMutation({
    mutationFn: async ({ content, file, role = "owner" }: { content: string; file?: File; role?: string }) => {
      if (file) {
        const formData = new FormData();
        formData.append("content", content);
        formData.append("file", file);
        formData.append("role", role);
        return apiRequest("POST", `/api/conversations/${selectedId}/messages`, formData);
      }
      return apiRequest("POST", `/api/conversations/${selectedId}/messages`, { content, role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", selectedId] });
    },
    onError: () => {
      toast({ title: "Failed to send message", variant: "destructive" });
    },
  });

  const startPhoneConversationMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const response = await apiRequest("POST", `/api/telegram-personal/start-conversation`, { phoneNumber });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to start conversation");
      }
      return data;
    },
    onSuccess: (data: { conversationId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      if (data.conversationId) {
        setSelectedId(data.conversationId);
        setMobileShowChat(true);
        toast({ title: "Открыт чат с номером телефона" });
      }
    },
    onError: (error: Error) => {
      toast({ 
        title: "Не удалось начать чат", 
        description: error.message || "Номер не зарегистрирован в Telegram",
        variant: "destructive" 
      });
    },
  });

  const handlePhoneClick = (phoneNumber: string) => {
    startPhoneConversationMutation.mutate(phoneNumber);
  };

  const startMaxPersonalConversationMutation = useMutation({
    mutationFn: async (data: { phoneNumber: string; initialMessage?: string; accountId?: string }) => {
      const response = await apiRequest("POST", "/api/max-personal/start-conversation", data);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Не удалось начать диалог");
      return json as { conversationId: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setNewDialogOpen(false);
      setNewDialogPhone("");
      setNewDialogMessage("");
      setNewDialogChannel("");
      setNewDialogPhoneError("");
      setNewDialogMaxAccountId("");
      if (data.conversationId) {
        setSelectedId(data.conversationId);
        setMobileShowChat(true);
        toast({ title: "Диалог открыт" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось начать диалог", description: error.message, variant: "destructive" });
    },
  });

  const startTelegramPersonalConversationMutation = useMutation({
    mutationFn: async (data: { phoneNumber: string; initialMessage?: string }) => {
      const response = await apiRequest("POST", "/api/telegram-personal/start-conversation", data);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Не удалось начать диалог");
      return json as { conversationId: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setNewDialogOpen(false);
      setNewDialogPhone("");
      setNewDialogMessage("");
      setNewDialogChannel("");
      setNewDialogPhoneError("");
      if (data.conversationId) {
        setSelectedId(data.conversationId);
        setMobileShowChat(true);
        toast({ title: "Диалог открыт" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось начать диалог", description: error.message, variant: "destructive" });
    },
  });

  const validatePhone = (value: string): boolean => {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      setNewDialogPhoneError("Введите номер телефона в формате +79991234567");
      return false;
    }
    setNewDialogPhoneError("");
    return true;
  };

  const handleNewDialogSubmit = () => {
    if (!validatePhone(newDialogPhone)) return;
    if (newDialogChannel === "max_personal") {
      startMaxPersonalConversationMutation.mutate({
        phoneNumber: newDialogPhone.trim(),
        initialMessage: newDialogMessage.trim() || undefined,
        accountId: newDialogMaxAccountId || undefined,
      });
    } else if (newDialogChannel === "telegram_personal") {
      startTelegramPersonalConversationMutation.mutate({
        phoneNumber: newDialogPhone.trim(),
        initialMessage: newDialogMessage.trim() || undefined,
      });
    }
  };

  const newDialogPending =
    startMaxPersonalConversationMutation.isPending ||
    startTelegramPersonalConversationMutation.isPending;

  const connectedPersonalChannels = [
    personalChannelStatus?.telegram_personal && "telegram_personal",
    personalChannelStatus?.max_personal && "max_personal",
  ].filter(Boolean) as Array<"telegram_personal" | "max_personal">;

  const handleNewDialogOpen = () => {
    setNewDialogPhone("");
    setNewDialogMessage("");
    setNewDialogPhoneError("");
    setNewDialogMaxAccountId("");
    // Pre-select channel if only one is connected
    if (connectedPersonalChannels.length === 1) {
      setNewDialogChannel(connectedPersonalChannels[0]);
    } else {
      setNewDialogChannel("");
    }
    setNewDialogOpen(true);
  };

  const deleteConversationMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/conversations/${id}`);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Ошибка удаления");
      }
      return id;
    },
    onSuccess: (deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      if (selectedId === deletedId) {
        setSelectedId(null);
        setMobileShowChat(false);
      }
      toast({ title: "Диалог удалён" });
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось удалить диалог", description: error.message, variant: "destructive" });
    },
  });

  const clearTestImage = () => {
    if (testImagePreviewUrl) URL.revokeObjectURL(testImagePreviewUrl);
    setTestImage(null);
    setTestImagePreviewUrl(null);
    if (testImageInputRef.current) testImageInputRef.current.value = "";
  };

  const simulateMessageMutation = useMutation({
    mutationFn: async (data: { customerName: string; customerPhone: string; message: string; imageBase64?: string; imageMimeType?: string }) => {
      const res = await apiRequest("POST", "/api/test/simulate-message", data);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка создания диалога");
      return json;
    },
    onSuccess: (data: { conversation?: { id?: string } }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setTestDialogOpen(false);
      setTestName("");
      setTestPhone("");
      setTestMessage("");
      clearTestImage();
      toast({ title: "Тестовый диалог создан" });
      if (data.conversation?.id) {
        setSelectedId(data.conversation.id);
        setMobileShowChat(true);
      }
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось создать диалог", description: error.message, variant: "destructive" });
    },
  });

  const replyAsCustomerMutation = useMutation({
    mutationFn: async ({
      conversationId,
      message,
      imageBase64,
      imageMimeType,
    }: {
      conversationId: string;
      message: string;
      imageBase64?: string;
      imageMimeType?: string;
    }) => {
      const res = await apiRequest("POST", "/api/test/simulate-message", {
        conversationId,
        message,
        imageBase64,
        imageMimeType,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка отправки сообщения");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось отправить сообщение от клиента", description: error.message, variant: "destructive" });
    },
  });

  const handleSimulateSubmit = async () => {
    if (!testName.trim() || !testPhone.trim() || (!testMessage.trim() && !testImage)) {
      toast({ title: "Заполните имя, телефон и сообщение (или прикрепите фото)", variant: "destructive" });
      return;
    }
    let imageBase64: string | undefined;
    let imageMimeType: string | undefined;
    if (testImage) {
      imageMimeType = testImage.type || "image/jpeg";
      imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(testImage);
      });
    }
    simulateMessageMutation.mutate({
      customerName: testName.trim(),
      customerPhone: testPhone.trim(),
      message: testMessage.trim(),
      imageBase64,
      imageMimeType,
    });
  };

  const clearReplyAsCustomerFile = () => {
    if (replyAsCustomerFilePreviewUrl) URL.revokeObjectURL(replyAsCustomerFilePreviewUrl);
    setReplyAsCustomerFile(null);
    setReplyAsCustomerFilePreviewUrl(null);
    if (replyAsCustomerFileRef.current) replyAsCustomerFileRef.current.value = "";
  };

  const setReplyAsCustomerFileWithPreview = (file: File | null) => {
    if (replyAsCustomerFilePreviewUrl) URL.revokeObjectURL(replyAsCustomerFilePreviewUrl);
    setReplyAsCustomerFile(file);
    setReplyAsCustomerFilePreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const handleSendAsCustomer = async () => {
    if (!selectedId || (!replyAsCustomerText.trim() && !replyAsCustomerFile)) return;
    let imageBase64: string | undefined;
    let imageMimeType: string | undefined;
    if (replyAsCustomerFile) {
      imageMimeType = replyAsCustomerFile.type || "image/jpeg";
      const file = replyAsCustomerFile;
      imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
    replyAsCustomerMutation.mutate({
      conversationId: selectedId,
      message: replyAsCustomerText.trim(),
      imageBase64,
      imageMimeType,
    });
    setReplyAsCustomerText("");
    clearReplyAsCustomerFile();
    setShowReplyAsCustomer(false);
  };

  return (
    <>
    <div className="flex h-full overflow-hidden">
      {/* Conversation List - hidden on mobile when chat is open */}
      <div className={`w-80 shrink-0 border-r flex flex-col overflow-hidden ${mobileShowChat ? 'hidden md:flex' : 'flex'}`}>
        <ChannelTabs
          activeFilter={channelFilter}
          onFilterChange={setChannelFilter}
          counts={{
            ...(channelCounts ?? { all: 0 }),
            ...(marquizCount > 0 ? { marquiz: marquizCount } : {}),
          }}
        />
        <ConversationList
          conversations={filteredConversations}
          selectedId={selectedId || undefined}
          onSelect={handleSelectConversation}
          onDelete={(id) => deleteConversationMutation.mutate(id)}
          onNewDialog={handleNewDialogOpen}
          onCreateTestDialog={() => setTestDialogOpen(true)}
          isLoading={conversationsLoading}
        />
      </div>

      {/* Test Dialog */}
      <Dialog open={testDialogOpen} onOpenChange={(open) => {
        if (!open) clearTestImage();
        setTestDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Создать тестовый диалог</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-name">Имя клиента</Label>
              <Input
                id="test-name"
                placeholder="Тест Иванов"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-phone">Телефон</Label>
              <Input
                id="test-phone"
                placeholder="+79001234567"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-message">Сообщение</Label>
              <Textarea
                id="test-message"
                placeholder="WVWZZZ7MZ6V025007"
                rows={3}
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files);
                  const img = files.find((f) => f.type.startsWith("image/"));
                  if (img) {
                    e.preventDefault();
                    if (testImagePreviewUrl) URL.revokeObjectURL(testImagePreviewUrl);
                    setTestImage(img);
                    setTestImagePreviewUrl(URL.createObjectURL(img));
                  }
                }}
              />
            </div>
            {/* File picker */}
            <input
              ref={testImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (!file) return;
                if (testImagePreviewUrl) URL.revokeObjectURL(testImagePreviewUrl);
                setTestImage(file);
                setTestImagePreviewUrl(URL.createObjectURL(file));
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit gap-2"
              onClick={() => testImageInputRef.current?.click()}
            >
              📎 Прикрепить фото
            </Button>
            {/* Image preview */}
            {testImage && testImagePreviewUrl && (
              <div className="relative w-fit">
                <img
                  src={testImagePreviewUrl}
                  alt="Превью"
                  className="max-h-40 rounded-lg border object-cover"
                />
                <button
                  type="button"
                  onClick={clearTestImage}
                  className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs shadow"
                  aria-label="Удалить фото"
                >
                  ✕
                </button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              💡 Можно вставить фото из буфера обмена (Ctrl+V) в поле сообщения
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { clearTestImage(); setTestDialogOpen(false); }}>
              Отмена
            </Button>
            <Button onClick={handleSimulateSubmit} disabled={simulateMessageMutation.isPending}>
              {simulateMessageMutation.isPending ? "Создание..." : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Новый диалог */}
      <Dialog open={newDialogOpen} onOpenChange={(open) => {
        if (!newDialogPending) setNewDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Новый диалог</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            {connectedPersonalChannels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Нет подключённых каналов. Подключите Telegram Personal или MAX Personal в настройках.
              </p>
            ) : (
              <>
                {connectedPersonalChannels.length > 1 && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="new-dialog-channel">Канал</Label>
                    <Select
                      value={newDialogChannel}
                      onValueChange={(v) => {
                        setNewDialogChannel(v as "telegram_personal" | "max_personal");
                        setNewDialogMaxAccountId("");
                      }}
                    >
                      <SelectTrigger id="new-dialog-channel">
                        <SelectValue placeholder="Выберите канал" />
                      </SelectTrigger>
                      <SelectContent>
                        {connectedPersonalChannels.includes("telegram_personal") && (
                          <SelectItem value="telegram_personal">Telegram Personal</SelectItem>
                        )}
                        {connectedPersonalChannels.includes("max_personal") && (
                          <SelectItem value="max_personal">MAX Personal</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {/* Account selector — shown when MAX Personal is selected and there are multiple accounts */}
                {newDialogChannel === "max_personal" && maxPersonalAccountsList && maxPersonalAccountsList.filter(a => a.status === "authorized").length > 1 && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="new-dialog-max-account">Аккаунт MAX</Label>
                    <Select
                      value={newDialogMaxAccountId}
                      onValueChange={setNewDialogMaxAccountId}
                    >
                      <SelectTrigger id="new-dialog-max-account">
                        <SelectValue placeholder="Выберите аккаунт" />
                      </SelectTrigger>
                      <SelectContent>
                        {maxPersonalAccountsList
                          .filter(a => a.status === "authorized")
                          .map(acc => (
                            <SelectItem key={acc.accountId} value={acc.accountId}>
                              {acc.label || acc.displayName || `Instance ${acc.idInstance}`}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-dialog-phone">Номер телефона</Label>
                  <Input
                    id="new-dialog-phone"
                    placeholder="+79991234567"
                    value={newDialogPhone}
                    onChange={(e) => {
                      setNewDialogPhone(e.target.value);
                      if (newDialogPhoneError) setNewDialogPhoneError("");
                    }}
                    onBlur={() => {
                      if (newDialogPhone) validatePhone(newDialogPhone);
                    }}
                  />
                  {newDialogPhoneError && (
                    <p className="text-xs text-destructive">{newDialogPhoneError}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-dialog-message">Первое сообщение <span className="text-muted-foreground">(необязательно)</span></Label>
                  <Textarea
                    id="new-dialog-message"
                    placeholder="Введите сообщение..."
                    rows={3}
                    value={newDialogMessage}
                    onChange={(e) => setNewDialogMessage(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewDialogOpen(false)} disabled={newDialogPending}>
              Отмена
            </Button>
            <Button
              onClick={handleNewDialogSubmit}
              disabled={newDialogPending || connectedPersonalChannels.length === 0 || !newDialogChannel}
            >
              {newDialogPending ? "Создание..." : "Начать диалог"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Chat Area - hidden on mobile when list is shown */}
      <div className={`flex flex-1 min-w-0 overflow-hidden ${mobileShowChat ? 'flex' : 'hidden md:flex'}`}>
        <div className="flex-1 overflow-hidden relative flex flex-col">
          {/* Mobile back button */}
          <div className="md:hidden flex items-center gap-2 p-2 border-b shrink-0">
            <Button 
              size="icon" 
              variant="ghost" 
              onClick={handleBackToList}
              data-testid="button-back-to-list"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium truncate">
              {conversationDetail?.customer?.name || "Чат"}
            </span>
            {conversationDetail?.customerId && (
              <div className="ml-auto">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button size="icon" variant="ghost" data-testid="button-open-customer-panel-mobile">
                      <User className="h-4 w-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="w-80 overflow-y-auto">
                    <SheetHeader>
                      <SheetTitle>Карточка клиента</SheetTitle>
                    </SheetHeader>
                    <div className="mt-4 flex flex-col gap-4">
                      <CustomerCard customerId={conversationDetail.customerId} />
                      {conversations?.find(c => c.id === selectedId)?.customer?.channel === "mock" && selectedId && (
                        <div className="border-t pt-4">
                          <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Тест: ответ клиента</p>
                          {showReplyAsCustomer ? (
                            <div className="flex flex-col gap-2">
                              <Textarea
                                placeholder="Сообщение от клиента... (или вставьте фото)"
                                value={replyAsCustomerText}
                                onChange={(e) => setReplyAsCustomerText(e.target.value)}
                                className="min-h-[72px] resize-none text-sm"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    if (replyAsCustomerText.trim() || replyAsCustomerFile) {
                                      void handleSendAsCustomer();
                                    }
                                  }
                                  if (e.key === "Escape") { setShowReplyAsCustomer(false); setReplyAsCustomerText(""); clearReplyAsCustomerFile(); }
                                }}
                                onPaste={(e) => {
                                  const img = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
                                  if (img) { e.preventDefault(); setReplyAsCustomerFileWithPreview(img); }
                                }}
                                autoFocus
                              />
                              {replyAsCustomerFilePreviewUrl && (
                                <div className="relative w-fit">
                                  <img src={replyAsCustomerFilePreviewUrl} alt="Превью" className="max-h-20 rounded border object-cover" />
                                  <button
                                    type="button"
                                    className="absolute -top-1 -right-1 bg-white rounded-full w-4 h-4 flex items-center justify-center shadow text-xs leading-none border"
                                    onClick={clearReplyAsCustomerFile}
                                  >×</button>
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-muted-foreground"
                                  onClick={() => replyAsCustomerFileRef.current?.click()}
                                  title="Прикрепить фото"
                                >
                                  <Paperclip className="h-3.5 w-3.5" />
                                  <span className="ml-1 text-xs">Фото</span>
                                </Button>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="flex-1"
                                  onClick={() => { if (replyAsCustomerText.trim() || replyAsCustomerFile) void handleSendAsCustomer(); }}
                                  disabled={(!replyAsCustomerText.trim() && !replyAsCustomerFile) || replyAsCustomerMutation.isPending}
                                >
                                  <Send className="mr-1.5 h-3.5 w-3.5" />
                                  Отправить
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setShowReplyAsCustomer(false); setReplyAsCustomerText(""); clearReplyAsCustomerFile(); }}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button variant="outline" size="sm" className="w-full" onClick={() => setShowReplyAsCustomer(true)}>
                              <User className="mr-2 h-3.5 w-3.5" />
                              Ответить от клиента
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            )}
          </div>
          
          <div className="flex-1 overflow-hidden relative">
            <ChatInterface
              conversation={conversationDetail || null}
              onApprove={(id) => approveMutation.mutate(id)}
              onEdit={(id, text) => editMutation.mutate({ suggestionId: id, editedText: text })}
              onReject={(id) => rejectMutation.mutate(id)}
              onEscalate={(id) => escalateMutation.mutate(id)}
              onSendManual={(content, file) => sendManualMutation.mutate({ content, file })}
              onMuteToggle={(convId, muted) => muteMutation.mutate({ conversationId: convId, muted })}
              onPhoneClick={handlePhoneClick}
              isLoading={detailLoading}
            />
            {/* Desktop customer panel button */}
            {conversationDetail?.customerId && (
              <div className="absolute top-2 right-2 hidden md:block xl:hidden">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button size="icon" variant="outline" data-testid="button-open-customer-panel">
                      <User className="h-4 w-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="w-80 overflow-y-auto">
                    <SheetHeader>
                      <SheetTitle>Карточка клиента</SheetTitle>
                    </SheetHeader>
                    <div className="mt-4 flex flex-col gap-4">
                      <CustomerCard customerId={conversationDetail.customerId} />
                      {conversations?.find(c => c.id === selectedId)?.customer?.channel === "mock" && selectedId && (
                        <div className="border-t pt-4">
                          <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Тест: ответ клиента</p>
                          {showReplyAsCustomer ? (
                            <div className="flex flex-col gap-2">
                              <Textarea
                                placeholder="Сообщение от клиента... (или вставьте фото)"
                                value={replyAsCustomerText}
                                onChange={(e) => setReplyAsCustomerText(e.target.value)}
                                className="min-h-[72px] resize-none text-sm"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    if (replyAsCustomerText.trim() || replyAsCustomerFile) {
                                      void handleSendAsCustomer();
                                    }
                                  }
                                  if (e.key === "Escape") { setShowReplyAsCustomer(false); setReplyAsCustomerText(""); clearReplyAsCustomerFile(); }
                                }}
                                onPaste={(e) => {
                                  const img = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
                                  if (img) { e.preventDefault(); setReplyAsCustomerFileWithPreview(img); }
                                }}
                                autoFocus
                              />
                              {replyAsCustomerFilePreviewUrl && (
                                <div className="relative w-fit">
                                  <img src={replyAsCustomerFilePreviewUrl} alt="Превью" className="max-h-20 rounded border object-cover" />
                                  <button
                                    type="button"
                                    className="absolute -top-1 -right-1 bg-white rounded-full w-4 h-4 flex items-center justify-center shadow text-xs leading-none border"
                                    onClick={clearReplyAsCustomerFile}
                                  >×</button>
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-muted-foreground"
                                  onClick={() => replyAsCustomerFileRef.current?.click()}
                                  title="Прикрепить фото"
                                >
                                  <Paperclip className="h-3.5 w-3.5" />
                                  <span className="ml-1 text-xs">Фото</span>
                                </Button>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="flex-1"
                                  onClick={() => { if (replyAsCustomerText.trim() || replyAsCustomerFile) void handleSendAsCustomer(); }}
                                  disabled={(!replyAsCustomerText.trim() && !replyAsCustomerFile) || replyAsCustomerMutation.isPending}
                                >
                                  <Send className="mr-1.5 h-3.5 w-3.5" />
                                  Отправить
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setShowReplyAsCustomer(false); setReplyAsCustomerText(""); clearReplyAsCustomerFile(); }}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button variant="outline" size="sm" className="w-full" onClick={() => setShowReplyAsCustomer(true)}>
                              <User className="mr-2 h-3.5 w-3.5" />
                              Ответить от клиента
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            )}
          </div>
        </div>
        
        {/* Desktop customer card sidebar */}
        {conversationDetail?.customerId && (
          <div className="hidden shrink-0 border-l p-4 xl:flex xl:flex-col xl:gap-4 w-72">
            <CustomerCard customerId={conversationDetail.customerId} />
            {conversations?.find(c => c.id === selectedId)?.customer?.channel === "mock" && selectedId && (
              <div className="border-t pt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Тест: ответ клиента</p>
                {showReplyAsCustomer ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      placeholder="Сообщение от клиента... (или вставьте фото)"
                      value={replyAsCustomerText}
                      onChange={(e) => setReplyAsCustomerText(e.target.value)}
                      className="min-h-[72px] resize-none text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (replyAsCustomerText.trim() || replyAsCustomerFile) {
                            void handleSendAsCustomer();
                          }
                        }
                        if (e.key === "Escape") { setShowReplyAsCustomer(false); setReplyAsCustomerText(""); clearReplyAsCustomerFile(); }
                      }}
                      onPaste={(e) => {
                        const img = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
                        if (img) { e.preventDefault(); setReplyAsCustomerFileWithPreview(img); }
                      }}
                      autoFocus
                      data-testid="textarea-customer-reply"
                    />
                    {replyAsCustomerFilePreviewUrl && (
                      <div className="relative w-fit">
                        <img src={replyAsCustomerFilePreviewUrl} alt="Превью" className="max-h-20 rounded border object-cover" />
                        <button
                          type="button"
                          className="absolute -top-1 -right-1 bg-white rounded-full w-4 h-4 flex items-center justify-center shadow text-xs leading-none border"
                          onClick={clearReplyAsCustomerFile}
                        >×</button>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-muted-foreground"
                        onClick={() => replyAsCustomerFileRef.current?.click()}
                        title="Прикрепить фото"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        <span className="ml-1 text-xs">Фото</span>
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => { if (replyAsCustomerText.trim() || replyAsCustomerFile) void handleSendAsCustomer(); }}
                        disabled={(!replyAsCustomerText.trim() && !replyAsCustomerFile) || replyAsCustomerMutation.isPending}
                        data-testid="button-send-customer-reply"
                      >
                        <Send className="mr-1.5 h-3.5 w-3.5" />
                        Отправить
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setShowReplyAsCustomer(false); setReplyAsCustomerText(""); clearReplyAsCustomerFile(); }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowReplyAsCustomer(true)}
                    data-testid="button-reply-as-customer"
                  >
                    <User className="mr-2 h-3.5 w-3.5" />
                    Ответить от клиента
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {/* Shared hidden file input for "reply as customer" image attachment */}
    <input
      ref={replyAsCustomerFileRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        setReplyAsCustomerFileWithPreview(e.target.files?.[0] ?? null);
        e.target.value = "";
      }}
    />
    </>
  );
}
