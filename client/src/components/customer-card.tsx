import { useState, ComponentType } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  X, Plus, User, ExternalLink, MessageSquare, Phone, Mail, Tag,
  Ban, ShieldCheck, ChevronDown, ChevronUp, Zap, Trash2,
} from "lucide-react";
import { SiTelegram, SiWhatsapp } from "react-icons/si";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn, getCustomerAvatarUrl } from "@/lib/utils";
import type { Customer } from "@shared/schema";
import {
  useResponseTemplates,
  useCreateResponseTemplate,
  useDeleteResponseTemplate,
} from "@/hooks/use-response-templates";

// ─── CRM preset tags ─────────────────────────────────────────────────────────

export const CRM_PRESET_TAGS: Array<{ label: string; color: string }> = [
  { label: "Горячий лид",         color: "bg-red-100 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300" },
  { label: "Холодный лид",        color: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950 dark:text-blue-300" },
  { label: "Ожидает оплаты",      color: "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-950 dark:text-yellow-300" },
  { label: "На стадии оформления",color: "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-300" },
  { label: "Постоянный клиент",   color: "bg-green-100 text-green-700 border-green-300 dark:bg-green-950 dark:text-green-300" },
  { label: "Требует внимания",    color: "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950 dark:text-purple-300" },
  { label: "Заказ выполнен",      color: "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300" },
  { label: "Отказался",           color: "bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-800 dark:text-gray-400" },
];

export function getTagColor(label: string): string {
  return CRM_PRESET_TAGS.find(t => t.label === label)?.color ?? "";
}

// ─── Channel icons ────────────────────────────────────────────────────────────

type IconComponent = ComponentType<{ className?: string }>;

const channelIcons: Record<string, { icon: IconComponent; label: string; color: string }> = {
  telegram:           { icon: SiTelegram,    label: "Telegram",          color: "text-blue-500" },
  telegram_personal:  { icon: SiTelegram,    label: "Telegram Personal", color: "text-blue-400" },
  whatsapp:           { icon: SiWhatsapp,    label: "WhatsApp",          color: "text-green-500" },
  whatsapp_personal:  { icon: SiWhatsapp,    label: "WhatsApp Personal", color: "text-green-600" },
  max:                { icon: MessageSquare as IconComponent, label: "MAX", color: "text-purple-500" },
  max_personal:       { icon: MessageSquare as IconComponent, label: "MAX Personal", color: "text-purple-400" },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface CustomerCardProps {
  customerId: string | null | undefined;
  compact?: boolean;
  onInsertTemplate?: (text: string) => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CustomerCard({ customerId, compact = false, onInsertTemplate }: CustomerCardProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [newTag, setNewTag] = useState("");
  const [showPresets, setShowPresets] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateContent, setNewTemplateContent] = useState("");

  const { data: templates = [] } = useResponseTemplates();
  const createTemplate = useCreateResponseTemplate();
  const deleteTemplate = useDeleteResponseTemplate();

  const { data: customer, isLoading } = useQuery<Customer>({
    queryKey: ["/api/customers", customerId],
    enabled: !!customerId,
  });

  const updateMutation = useMutation({
    mutationFn: async (patch: Partial<Pick<Customer, "tags" | "isBlocked">>) =>
      apiRequest("PATCH", `/api/customers/${customerId}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
    onError: () => {
      toast({ title: "Ошибка обновления", variant: "destructive" });
    },
  });

  const getTags = (c: Customer): string[] =>
    Array.isArray(c.tags) ? (c.tags as string[]) : [];

  const handleAddTag = (tag: string) => {
    if (!tag.trim() || !customer) return;
    const current = getTags(customer);
    if (!current.includes(tag.trim())) {
      updateMutation.mutate({ tags: [...current, tag.trim()] });
      toast({ title: `Тег «${tag.trim()}» добавлен` });
    }
    setNewTag("");
    setShowPresets(false);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (!customer) return;
    updateMutation.mutate({ tags: getTags(customer).filter(t => t !== tagToRemove) });
  };

  const handleBlock = () => {
    updateMutation.mutate({ isBlocked: true });
    setBlockDialogOpen(false);
    toast({ title: "Клиент заблокирован", description: "Его диалоги скрыты из списка" });
  };

  const handleUnblock = () => {
    updateMutation.mutate({ isBlocked: false });
    toast({ title: "Клиент разблокирован" });
  };

  if (!customerId) return null;

  if (isLoading) {
    return (
      <Card className="w-64 shrink-0" data-testid="customer-card-skeleton">
        <CardHeader className="pb-2">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="mt-2 h-4 w-24" />
          <Skeleton className="mt-1 h-3 w-16" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (!customer) {
    return (
      <Card className="w-64 shrink-0">
        <CardContent className="flex h-32 items-center justify-center text-muted-foreground">
          <User className="mr-2 h-4 w-4" />
          Клиент не найден
        </CardContent>
      </Card>
    );
  }

  const channelMeta = customer.channel ? channelIcons[customer.channel] : null;
  const ChannelIcon = channelMeta?.icon ?? (MessageSquare as IconComponent);
  const channelColor = channelMeta?.color ?? "text-muted-foreground";
  const channelLabel = channelMeta?.label ?? customer.channel ?? "Неизвестно";

  const currentTags = getTags(customer);
  const availablePresets = CRM_PRESET_TAGS.filter(p => !currentTags.includes(p.label));
  const isBlocked = (customer as any).isBlocked === true;

  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-3" data-testid="customer-card-compact">
        <Avatar className="h-10 w-10">
          {getCustomerAvatarUrl(customer) && (
            <AvatarImage src={getCustomerAvatarUrl(customer)!} alt={customer.name || ""} />
          )}
          <AvatarFallback className="text-xs">
            {customer.name?.slice(0, 2).toUpperCase() || "КЛ"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate" data-testid="text-customer-name">
              {customer.name || "Неизвестный клиент"}
            </span>
            <ChannelIcon className={`h-4 w-4 shrink-0 ${channelColor}`} />
          </div>
          {customer.phone && (
            <div className="text-xs text-muted-foreground">{customer.phone}</div>
          )}
        </div>
        <Button size="icon" variant="ghost" onClick={() => navigate(`/customers/${customerId}`)}>
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <Card className="w-64 shrink-0" data-testid="customer-card">
        {/* ── Header ── */}
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="relative">
              <Avatar className="h-12 w-12">
                {getCustomerAvatarUrl(customer) && (
                  <AvatarImage src={getCustomerAvatarUrl(customer)!} alt={customer.name || ""} />
                )}
                <AvatarFallback>
                  {customer.name?.slice(0, 2).toUpperCase() || "КЛ"}
                </AvatarFallback>
              </Avatar>
              {isBlocked && (
                <span className="absolute -bottom-1 -right-1 rounded-full bg-destructive p-0.5">
                  <Ban className="h-3 w-3 text-white" />
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/customers/${customerId}`)}
              data-testid="button-open-customer-profile"
            >
              <ExternalLink className="mr-1 h-3 w-3" />
              Профиль
            </Button>
          </div>

          <CardTitle className="mt-2 text-base" data-testid="text-customer-name">
            {customer.name || "Неизвестный клиент"}
            {isBlocked && (
              <Badge variant="destructive" className="ml-2 text-xs align-middle">
                Заблокирован
              </Badge>
            )}
          </CardTitle>

          <div className="flex items-center gap-1.5">
            <ChannelIcon className={`h-4 w-4 ${channelColor}`} />
            <span className="text-xs text-muted-foreground">{channelLabel}</span>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* ── Contacts ── */}
          {(customer.phone || customer.email) && (
            <div className="space-y-1.5">
              {customer.phone && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <span>{customer.phone}</span>
                </div>
              )}
              {customer.email && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{customer.email}</span>
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* ── Tags ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Tag className="h-3 w-3" />
                Теги
              </div>
              {availablePresets.length > 0 && (
                <button
                  className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPresets(v => !v)}
                >
                  Добавить
                  {showPresets
                    ? <ChevronUp className="h-3 w-3" />
                    : <ChevronDown className="h-3 w-3" />
                  }
                </button>
              )}
            </div>

            {/* Active tags */}
            <div className="flex flex-wrap gap-1 min-h-[24px]">
              {currentTags.length === 0 && !showPresets && (
                <span className="text-xs text-muted-foreground">Нет тегов</span>
              )}
              {currentTags.map(tag => {
                const color = getTagColor(tag);
                return (
                  <Badge
                    key={tag}
                    variant="outline"
                    className={cn("gap-1 text-xs border", color)}
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
                );
              })}
            </div>

            {/* Preset tags picker */}
            {showPresets && availablePresets.length > 0 && (
              <div className="flex flex-wrap gap-1 rounded-md border p-2 bg-muted/40">
                {availablePresets.map(preset => (
                  <button
                    key={preset.label}
                    onClick={() => handleAddTag(preset.label)}
                    className={cn(
                      "text-xs rounded-full border px-2 py-0.5 transition-opacity hover:opacity-80 cursor-pointer",
                      preset.color,
                    )}
                  >
                    + {preset.label}
                  </button>
                ))}
              </div>
            )}

            {/* Custom tag input */}
            <div className="flex gap-1">
              <Input
                placeholder="Свой тег..."
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleAddTag(newTag); }
                }}
                className="text-xs h-8"
                data-testid="input-new-tag"
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => handleAddTag(newTag)}
                disabled={!newTag.trim()}
                data-testid="button-add-tag"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Separator />

          {/* ── Quick Reply Templates ── */}
          {!compact && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  Шаблоны ответов
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setNewTemplateName("");
                    setNewTemplateContent("");
                    setTemplateDialogOpen(true);
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Добавить
                </Button>
              </div>

              {templates.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Нет шаблонов</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {templates.map((tpl) => (
                    <div key={tpl.id} className="flex items-center gap-1 group">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-7 justify-start text-xs truncate font-normal"
                        title={tpl.content}
                        onClick={() => onInsertTemplate?.(tpl.content)}
                        disabled={!onInsertTemplate}
                      >
                        {tpl.name}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteTemplate.mutate(tpl.id)}
                        disabled={deleteTemplate.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* ── Block / Unblock ── */}
          {isBlocked ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 text-green-600 border-green-400 hover:bg-green-50 dark:hover:bg-green-950"
              onClick={handleUnblock}
              disabled={updateMutation.isPending}
            >
              <ShieldCheck className="h-4 w-4" />
              Разблокировать
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => setBlockDialogOpen(true)}
              disabled={updateMutation.isPending}
            >
              <Ban className="h-4 w-4" />
              Заблокировать клиента
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Add template dialog ── */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Новый шаблон ответа</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Название кнопки</Label>
              <Input
                id="tpl-name"
                placeholder="Например: Варианты оплаты"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-content">Текст сообщения</Label>
              <Textarea
                id="tpl-content"
                placeholder="Текст который отправится клиенту..."
                value={newTemplateContent}
                onChange={(e) => setNewTemplateContent(e.target.value)}
                className="min-h-[120px] resize-none text-sm"
                maxLength={4000}
              />
              <p className="text-xs text-muted-foreground text-right">
                {newTemplateContent.length}/4000
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={!newTemplateName.trim() || !newTemplateContent.trim() || createTemplate.isPending}
              onClick={async () => {
                await createTemplate.mutateAsync({
                  name: newTemplateName.trim(),
                  content: newTemplateContent.trim(),
                });
                setTemplateDialogOpen(false);
                toast({ title: "Шаблон добавлен" });
              }}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Block confirm dialog ── */}
      <AlertDialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Заблокировать клиента?</AlertDialogTitle>
            <AlertDialogDescription>
              Диалоги с этим клиентом будут скрыты из списка разговоров.
              Сообщения в мессенджерах не блокируются — клиент сможет писать,
              но его сообщения не будут отображаться в системе.
              Вы сможете разблокировать клиента в любой момент.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBlock}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Заблокировать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
