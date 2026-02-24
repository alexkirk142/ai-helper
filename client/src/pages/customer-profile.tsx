import { useState, ComponentType } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  Tag,
  Plus,
  X,
  Trash2,
  StickyNote,
  MessageSquare,
  Calendar,
  Brain,
  MapPin,
  CreditCard,
  Truck,
  Save,
  TrendingUp,
} from "lucide-react";
import { SiTelegram, SiWhatsapp } from "react-icons/si";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import type { Customer, CustomerNote, CustomerMemory } from "@shared/schema";

type IconComponent = ComponentType<{ className?: string }>;

const TOPIC_LABELS: Record<string, string> = {
  price: "Цена",
  availability: "Наличие",
  shipping: "Доставка",
  return: "Возврат",
  discount: "Скидки",
  complaint: "Жалобы",
};

const channelIcons: Record<string, { icon: IconComponent; label: string; color: string }> = {
  telegram: { icon: SiTelegram, label: "Telegram", color: "text-blue-500" },
  whatsapp: { icon: SiWhatsapp, label: "WhatsApp", color: "text-green-500" },
  whatsapp_personal: { icon: SiWhatsapp, label: "WhatsApp Personal", color: "text-green-600" },
  max: { icon: MessageSquare as IconComponent, label: "MAX", color: "text-purple-500" },
};

const getTags = (c: Customer): string[] => {
  if (Array.isArray(c.tags)) return c.tags;
  return [];
};

export default function CustomerProfile() {
  const [, params] = useRoute("/customers/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const customerId = params?.id;

  const [newTag, setNewTag] = useState("");
  const [noteText, setNoteText] = useState("");
  const [editedPrefs, setEditedPrefs] = useState<Record<string, string>>({});
  const [isEditingPrefs, setIsEditingPrefs] = useState(false);

  const { data: customer, isLoading: customerLoading } = useQuery<Customer>({
    queryKey: ["/api/customers", customerId],
    enabled: !!customerId,
  });

  const { data: notes, isLoading: notesLoading } = useQuery<CustomerNote[]>({
    queryKey: ["/api/customers", customerId, "notes"],
    enabled: !!customerId,
  });

  const { data: memory, isLoading: memoryLoading } = useQuery<CustomerMemory>({
    queryKey: ["/api/customers", customerId, "memory"],
    enabled: !!customerId,
  });

  const updatePreferencesMutation = useMutation({
    mutationFn: async (preferences: Record<string, string>) => {
      return apiRequest("PATCH", `/api/customers/${customerId}/memory`, { preferences });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "memory"] });
      setIsEditingPrefs(false);
      toast({ title: "Предпочтения сохранены" });
    },
    onError: () => {
      toast({ title: "Ошибка сохранения", variant: "destructive" });
    },
  });

  const handleEditPrefs = () => {
    const prefs = (memory?.preferences ?? {}) as Record<string, string>;
    setEditedPrefs(prefs);
    setIsEditingPrefs(true);
  };
  
  const getPreference = (key: string): string => {
    const prefs = (memory?.preferences ?? {}) as Record<string, string>;
    return prefs[key] || "—";
  };

  const handleSavePrefs = () => {
    updatePreferencesMutation.mutate(editedPrefs);
  };

  const handleCancelEdit = () => {
    setIsEditingPrefs(false);
    setEditedPrefs({});
  };

  const updatePref = (key: string, value: string) => {
    setEditedPrefs((prev) => ({ ...prev, [key]: value }));
  };

  const updateTagsMutation = useMutation({
    mutationFn: async (tags: string[]) => {
      return apiRequest("PATCH", `/api/customers/${customerId}`, { tags });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId] });
      toast({ title: "Теги обновлены" });
    },
    onError: () => {
      toast({ title: "Ошибка обновления тегов", variant: "destructive" });
    },
  });

  const createNoteMutation = useMutation({
    mutationFn: async (noteText: string) => {
      return apiRequest("POST", `/api/customers/${customerId}/notes`, { noteText });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "notes"] });
      setNoteText("");
      toast({ title: "Заметка добавлена" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Ошибка создания заметки", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      return apiRequest("DELETE", `/api/customers/${customerId}/notes/${noteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "notes"] });
      toast({ title: "Заметка удалена" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Ошибка удаления заметки", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const handleAddTag = () => {
    if (!newTag.trim() || !customer) return;
    const currentTags = getTags(customer);
    if (!currentTags.includes(newTag.trim())) {
      updateTagsMutation.mutate([...currentTags, newTag.trim()]);
    }
    setNewTag("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (!customer) return;
    const currentTags = getTags(customer);
    updateTagsMutation.mutate(currentTags.filter((t: string) => t !== tagToRemove));
  };

  const handleCreateNote = () => {
    if (!noteText.trim()) return;
    createNoteMutation.mutate(noteText);
  };

  if (customerLoading) {
    return (
      <div className="container mx-auto max-w-4xl p-6" data-testid="customer-profile-skeleton">
        <div className="mb-6 flex items-center gap-4">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <Skeleton className="mx-auto h-20 w-20 rounded-full" />
                <Skeleton className="mx-auto mt-4 h-6 w-32" />
                <Skeleton className="mx-auto mt-2 h-4 w-24" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          </div>
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="container mx-auto max-w-4xl p-6">
        <Button variant="ghost" onClick={() => navigate("/conversations")} data-testid="button-back">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Назад
        </Button>
        <Card className="mt-6">
          <CardContent className="flex h-48 flex-col items-center justify-center text-muted-foreground">
            <User className="h-12 w-12 opacity-20" />
            <p className="mt-4">Клиент не найден</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ChannelIcon = customer.channel && channelIcons[customer.channel]
    ? channelIcons[customer.channel].icon
    : MessageSquare;
  const channelColor = customer.channel && channelIcons[customer.channel]
    ? channelIcons[customer.channel].color
    : "text-muted-foreground";
  const channelLabel = customer.channel && channelIcons[customer.channel]
    ? channelIcons[customer.channel].label
    : customer.channel || "Неизвестно";

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/conversations")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold">Профиль клиента</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Card data-testid="customer-info-card">
            <CardHeader className="text-center">
              <Avatar className="mx-auto h-20 w-20">
                <AvatarFallback className="text-2xl">
                  {customer.name?.slice(0, 2).toUpperCase() || "КЛ"}
                </AvatarFallback>
              </Avatar>
              <CardTitle className="mt-4" data-testid="text-customer-name">
                {customer.name || "Неизвестный клиент"}
              </CardTitle>
              <CardDescription className="flex items-center justify-center gap-1.5">
                <ChannelIcon className={`h-4 w-4 ${channelColor}`} />
                {channelLabel}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {customer.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{customer.phone}</span>
                </div>
              )}
              {customer.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{customer.email}</span>
                </div>
              )}
              {customer.externalId && (
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-xs text-muted-foreground truncate">
                    {customer.externalId}
                  </span>
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center gap-1 text-sm font-medium">
                  <Tag className="h-4 w-4" />
                  Теги
                </div>
                <div className="flex flex-wrap gap-1">
                  {getTags(customer).map((tag: string) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="gap-1"
                      data-testid={`tag-${tag}`}
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20"
                        data-testid={`button-remove-tag-${tag}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                  {getTags(customer).length === 0 && (
                    <span className="text-sm text-muted-foreground">Нет тегов</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Новый тег..."
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddTag();
                      }
                    }}
                    data-testid="input-new-tag"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddTag}
                    disabled={!newTag.trim() || updateTagsMutation.isPending}
                    data-testid="button-add-tag"
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Добавить
                  </Button>
                </div>
              </div>

              {customer.createdAt && (
                <>
                  <Separator />
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    Создан{" "}
                    {formatDistanceToNow(new Date(customer.createdAt), {
                      addSuffix: true,
                      locale: ru,
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card data-testid="customer-notes-card">
            <CardHeader>
              <div className="flex items-center gap-2">
                <StickyNote className="h-5 w-5" />
                <CardTitle>Заметки</CardTitle>
              </div>
              <CardDescription>
                Внутренние заметки об этом клиенте
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Textarea
                  placeholder="Добавить заметку о клиенте..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  className="min-h-[80px] resize-none"
                  data-testid="textarea-new-note"
                />
                <div className="flex justify-end">
                  <Button
                    onClick={handleCreateNote}
                    disabled={!noteText.trim() || createNoteMutation.isPending}
                    data-testid="button-create-note"
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Добавить заметку
                  </Button>
                </div>
              </div>

              <Separator />

              {notesLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : notes && notes.length > 0 ? (
                <ScrollArea className="max-h-[400px]">
                  <div className="space-y-3">
                    {notes.map((note) => (
                      <div
                        key={note.id}
                        className="group relative rounded-lg border p-3"
                        data-testid={`note-${note.id}`}
                      >
                        <p className="whitespace-pre-wrap text-sm pr-8">{note.noteText}</p>
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {formatDistanceToNow(new Date(note.createdAt), {
                            addSuffix: true,
                            locale: ru,
                          })}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="absolute right-2 top-2 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => deleteNoteMutation.mutate(note.id)}
                          disabled={deleteNoteMutation.isPending}
                          data-testid={`button-delete-note-${note.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <StickyNote className="h-12 w-12 opacity-20" />
                  <p className="mt-2 text-sm">Нет заметок</p>
                  <p className="text-xs">Добавьте первую заметку выше</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6" data-testid="customer-memory-card">
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  <CardTitle>Память о клиенте</CardTitle>
                </div>
                {!isEditingPrefs && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEditPrefs}
                    data-testid="button-edit-preferences"
                  >
                    Редактировать
                  </Button>
                )}
                {isEditingPrefs && (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelEdit}
                      data-testid="button-cancel-edit-preferences"
                    >
                      Отмена
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSavePrefs}
                      disabled={updatePreferencesMutation.isPending}
                      data-testid="button-save-preferences"
                    >
                      <Save className="mr-1 h-4 w-4" />
                      Сохранить
                    </Button>
                  </div>
                )}
              </div>
              <CardDescription>
                Предпочтения и часто задаваемые вопросы
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {memoryLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    <h4 className="text-sm font-medium">Предпочтения</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          Город
                        </label>
                        {isEditingPrefs ? (
                          <Input
                            placeholder="Москва"
                            value={editedPrefs.city || ""}
                            onChange={(e) => updatePref("city", e.target.value)}
                            data-testid="input-pref-city"
                          />
                        ) : (
                          <p className="text-sm" data-testid="text-pref-city">
                            {getPreference("city")}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Truck className="h-4 w-4" />
                          Доставка
                        </label>
                        {isEditingPrefs ? (
                          <Input
                            placeholder="Курьером до двери"
                            value={editedPrefs.delivery || ""}
                            onChange={(e) => updatePref("delivery", e.target.value)}
                            data-testid="input-pref-delivery"
                          />
                        ) : (
                          <p className="text-sm" data-testid="text-pref-delivery">
                            {getPreference("delivery")}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CreditCard className="h-4 w-4" />
                          Оплата
                        </label>
                        {isEditingPrefs ? (
                          <Input
                            placeholder="Картой онлайн"
                            value={editedPrefs.payment || ""}
                            onChange={(e) => updatePref("payment", e.target.value)}
                            data-testid="input-pref-payment"
                          />
                        ) : (
                          <p className="text-sm" data-testid="text-pref-payment">
                            {getPreference("payment")}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      <h4 className="text-sm font-medium">Частые темы</h4>
                    </div>
                    {memory?.frequentTopics && Object.keys(memory.frequentTopics).length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(memory.frequentTopics)
                          .sort(([, a], [, b]) => (b as number) - (a as number))
                          .map(([topic, count]) => (
                            <Badge
                              key={topic}
                              variant="secondary"
                              className="gap-1"
                              data-testid={`topic-badge-${topic}`}
                            >
                              {TOPIC_LABELS[topic] || topic}
                              <span className="ml-1 rounded bg-muted px-1 text-xs">
                                {count as number}
                              </span>
                            </Badge>
                          ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Темы будут добавляться автоматически на основе диалогов
                      </p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
