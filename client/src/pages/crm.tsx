import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Users,
  Phone,
  MessageSquare,
  Clock,
  AlertTriangle,
  CheckCircle2,
  PhoneCall,
  XCircle,
  Search,
  RefreshCw,
  ChevronRight,
  Bot,
  Inbox,
  LayoutGrid,
  Table as TableIcon,
  List as ListIcon,
  Plus,
  Mail,
  Briefcase,
  DollarSign,
  Download,
  Filter,
  ArrowUpDown,
  Globe,
  PlusCircle,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Lead {
  id: string;
  status: string;
  source: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  telegramUsername: string | null;
  preferredChannel: string | null;
  quizName: string | null;
  failureReason: string | null;
  conversationId: string | null;
  metadata: Record<string, unknown>;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LeadsResponse {
  leads: Lead[];
  total: number;
}

interface CrmStats {
  total: number;
  new: number;
  contacted: number;
  in_progress: number;
  converted: number;
  failed: number;
  closed: number;
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.FC<{ className?: string }>; badgeClass: string; rowClass: string; dotClass: string }> = {
  new: {
    label: "Новый лид",
    icon: Inbox,
    badgeClass: "bg-primary/10 text-primary border-primary/20 dark:bg-primary/10 dark:text-primary dark:border-primary/20",
    rowClass: "border-l-primary",
    dotClass: "bg-primary shadow-sm shadow-primary/40",
  },
  contacted: {
    label: "Связались",
    icon: PhoneCall,
    badgeClass: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
    rowClass: "border-l-amber-500",
    dotClass: "bg-amber-500 shadow-sm shadow-amber-500/40",
  },
  in_progress: {
    label: "Квалифицирован",
    icon: MessageSquare,
    badgeClass: "bg-sky-500/10 text-sky-600 border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20",
    rowClass: "border-l-sky-500",
    dotClass: "bg-sky-500 shadow-sm shadow-sky-500/40",
  },
  converted: {
    label: "Переговоры",
    icon: CheckCircle2,
    badgeClass: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
    rowClass: "border-l-emerald-500",
    dotClass: "bg-emerald-500 shadow-sm shadow-emerald-500/40",
  },
  failed: {
    label: "Слив / Неудачно",
    icon: XCircle,
    badgeClass: "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20",
    rowClass: "border-l-rose-500",
    dotClass: "bg-rose-500 shadow-sm shadow-rose-500/40",
  },
  closed: {
    label: "Закрыта",
    icon: CheckCircle2,
    badgeClass: "bg-muted text-muted-foreground border-border dark:bg-muted/30 dark:text-zinc-400",
    rowClass: "border-l-muted-foreground/30",
    dotClass: "bg-zinc-400 dark:bg-zinc-600 shadow-sm",
  },
};

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  telegram_personal: "Telegram (Личный)",
  max: "MAX Gate",
  max_personal: "MAX (Личный)",
  whatsapp: "WhatsApp API",
  whatsapp_personal: "WhatsApp (Личный)",
  auto: "Автовыбор",
};

const SOURCE_LABELS: Record<string, string> = {
  marquiz: "Marquiz",
  universal: "Webhook",
  manual: "Вручную",
};

const STATUS_TABS = [
  { value: "all", label: "Все лиды" },
  { value: "new", label: "Новые" },
  { value: "contacted", label: "Связались" },
  { value: "in_progress", label: "В работе" },
  { value: "converted", label: "Конвертированы" },
  { value: "failed", label: "Неудачные" },
  { value: "closed", label: "Закрытые" },
];

async function fetchLeads(status: string, search: string, offset: number): Promise<LeadsResponse> {
  const params = new URLSearchParams({ limit: "150", offset: String(offset) });
  if (status !== "all") params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  const res = await fetch(`/api/crm/leads?${params}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch leads");
  return res.json();
}

async function fetchStats(): Promise<CrmStats> {
  const res = await fetch("/api/crm/stats", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

function getInitials(name: string | null): string {
  if (!name) return "Л";
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getRelativeDate(dateStr: string): string {
  const d = new Date(dateStr);
  return formatDistanceToNow(d, { addSuffix: true, locale: ru });
}

function formatPrice(value: unknown): string {
  if (!value) return "—";
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(num);
}

// ─── LEAD CARD COMPONENT (Kanban Board Style) ─────────────────────────────────
function LeadKanbanCard({ 
  lead, 
  onClick, 
  onDragStart 
}: { 
  lead: Lead; 
  onClick: () => void;
  onDragStart?: (e: React.DragEvent, id: string) => void;
}) {
  const cfg = STATUS_CONFIG[lead.status] ?? STATUS_CONFIG.new;
  const initials = getInitials(lead.name);
  
  // Try to find price or estimated deal value in metadata
  const dealValue = lead.metadata?.price || lead.metadata?.value || lead.metadata?.budget || null;
  const company = lead.metadata?.company || lead.metadata?.organization || null;

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={(e) => onDragStart && onDragStart(e, lead.id)}
      onClick={onClick}
      className={cn(
        "group relative flex flex-col w-full bg-card rounded-2xl border border-card-border p-5 hover:shadow-lg transition-all duration-300 cursor-pointer hover:border-border/80 active:scale-[0.99] select-none"
      )}
    >
      {/* Card Header: Avatar & Name & Date */}
      <div className="flex items-start gap-3">
        <Avatar className="h-9 w-9 border border-border/40 shrink-0">
          <AvatarFallback className={cn("text-xs font-bold text-white", 
            lead.status === "new" ? "bg-primary" :
            lead.status === "contacted" ? "bg-amber-500" :
            lead.status === "in_progress" ? "bg-sky-500" :
            lead.status === "converted" ? "bg-emerald-500" :
            "bg-zinc-400 dark:bg-zinc-600"
          )}>
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-0.5">
          <h4 className="font-bold text-sm tracking-tight text-foreground line-clamp-1 group-hover:text-primary transition-colors">
            {lead.name || "Без имени"}
          </h4>
          <p className="text-[10px] text-muted-foreground font-medium flex items-center gap-1 mt-0.5">
            <Clock className="h-3 w-3 text-muted-foreground/50" />
            {getRelativeDate(lead.createdAt)}
          </p>
        </div>
      </div>

      {/* Card Divider */}
      <div className="border-t border-border/30 my-3.5" />

      {/* Card Fields */}
      <div className="space-y-2 text-xs font-medium text-muted-foreground/85">
        {lead.phone && (
          <div className="flex items-center gap-2.5">
            <Phone className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            <span className="truncate text-foreground/80">{lead.phone}</span>
          </div>
        )}
        
        {lead.email && (
          <div className="flex items-center gap-2.5">
            <Mail className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            <span className="truncate text-foreground/80">{lead.email}</span>
          </div>
        )}

        {lead.quizName && (
          <div className="flex items-center gap-2.5">
            <Globe className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            <span className="truncate text-foreground/80" title={lead.quizName}>
              {lead.quizName}
            </span>
          </div>
        )}

        {company && (
          <div className="flex items-center gap-2.5">
            <Briefcase className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            <span className="truncate text-foreground/80">{String(company)}</span>
          </div>
        )}

        <div className="flex items-center gap-2.5">
          <DollarSign className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
          <span className={cn("font-bold text-xs", dealValue ? "text-primary" : "text-foreground/40")}>
            {dealValue ? formatPrice(dealValue) : "—"}
          </span>
        </div>
      </div>

      {/* Card Divider */}
      <div className="border-t border-border/30 my-3.5" />

      {/* Card Footer: Source & Assignee styled like LimesCRM */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
            Источник
          </span>
          <span className="text-xs font-bold text-foreground/80 truncate">
            {SOURCE_LABELS[lead.source] || lead.source}
          </span>
        </div>

        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <span className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
            Ответственный
          </span>
          <div className="flex items-center gap-1">
            <Avatar className="h-6 w-6 border border-border/50 bg-background shadow-xs">
              <AvatarFallback className={cn("text-[10px] font-bold", 
                lead.preferredChannel && lead.preferredChannel !== "auto" 
                  ? "bg-primary/10 text-primary" 
                  : "bg-muted text-muted-foreground"
              )}>
                {lead.preferredChannel && lead.preferredChannel !== "auto" ? (
                  <Bot className="h-3 w-3 text-primary" />
                ) : (
                  "О"
                )}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LEAD DETAIL DIALOG COMPONENT ──────────────────────────────────────────────
function LeadDetailDialog({
  lead,
  onClose,
  onUpdated,
}: {
  lead: Lead;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [status, setStatus] = useState(lead.status);
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [name, setName] = useState(lead.name ?? "");
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [email, setEmail] = useState(lead.email ?? "");
  const [telegramUsername, setTelegramUsername] = useState(lead.telegramUsername ?? "");
  const [preferredChannel, setPreferredChannel] = useState(lead.preferredChannel ?? "auto");
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (data: Partial<Lead>) => {
      const res = await apiRequest("PATCH", `/api/crm/leads/${lead.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Карточка заявки сохранена успешно" });
      onUpdated();
      onClose();
    },
    onError: () => {
      toast({ title: "Ошибка при сохранении данных", variant: "destructive" });
    },
  });

  const cfg = STATUS_CONFIG[lead.status] ?? STATUS_CONFIG.new;
  const StatusIcon = cfg.icon;

  const metaEntries = Object.entries(lead.metadata ?? {}).filter(
    ([k, v]) => v && !["source", "quizName", "price", "value", "budget", "company", "organization"].includes(k)
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl rounded-2xl p-6 overflow-hidden">
        <DialogHeader className="pb-4 border-b border-border/40">
          <DialogTitle className="flex items-center gap-2.5 text-lg font-bold">
            <Users className="h-5 w-5 text-primary" />
            <span>Детали лида: {lead.name || "Без имени"}</span>
            <Badge variant="outline" className={cn("text-xs px-2.5 py-0.5 ml-2 font-bold", cfg.badgeClass)}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {cfg.label}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground font-medium pt-1">
            Создан: {format(new Date(lead.createdAt), "d MMMM yyyy HH:mm", { locale: ru })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 py-4 max-h-[60vh] overflow-y-auto pr-1">
          {/* Main Info Inputs */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Основная информация</h3>
            
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">ФИО клиента</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Введите имя клиента..."
                className="h-9 text-sm rounded-xl border-border/60"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Номер телефона</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+7 (999) 000-00-00"
                className="h-9 text-sm rounded-xl border-border/60"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Email</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@mail.ru"
                className="h-9 text-sm rounded-xl border-border/60"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Telegram @username</Label>
              <Input
                value={telegramUsername}
                onChange={(e) => setTelegramUsername(e.target.value)}
                placeholder="username"
                className="h-9 text-sm rounded-xl border-border/60"
              />
            </div>
          </div>

          {/* Status & Technical Settings */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Статус и Каналы</h3>
            
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Статус заявки</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 text-sm rounded-xl border-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {Object.entries(STATUS_CONFIG).map(([val, conf]) => (
                    <SelectItem key={val} value={val} className="text-sm rounded-lg my-0.5">
                      <div className="flex items-center gap-2 font-medium">
                        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", conf.dotClass)} />
                        {conf.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Предпочтительный канал</Label>
              <Select value={preferredChannel} onValueChange={setPreferredChannel}>
                <SelectTrigger className="h-9 text-sm rounded-xl border-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {Object.entries(CHANNEL_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val} className="text-sm rounded-lg my-0.5 font-medium">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {lead.quizName && (
              <div className="rounded-xl border bg-muted/20 p-3 space-y-1.5 text-xs font-medium">
                <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold block">
                  Интеграция:
                </span>
                <p className="text-foreground flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                  Квиз: <span className="font-bold text-foreground/90">{lead.quizName}</span>
                </p>
                {lead.conversationId && (
                  <p className="text-muted-foreground text-[11px]">
                    ID беседы: <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[10px] text-foreground">{lead.conversationId}</code>
                  </p>
                )}
              </div>
            )}

            {lead.failureReason && (
              <div className="flex items-start gap-2.5 rounded-xl bg-destructive/5 border border-destructive/20 p-3 text-xs font-medium text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Ошибка отправки: {lead.failureReason}</span>
              </div>
            )}
          </div>

          {/* Notes (Span-2) */}
          <div className="md:col-span-2 space-y-1.5">
            <Label className="text-xs font-bold">Заметки оператора / AI-выжимка</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Введите внутренние заметки по этой заявке..."
              className="text-sm resize-none rounded-xl border-border/60 min-h-[80px]"
              rows={3}
            />
          </div>

          {/* Metadata Grid */}
          {metaEntries.length > 0 && (
            <div className="md:col-span-2 space-y-2 mt-2">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Параметры Marquiz / Webhook</h3>
              <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-border/40 bg-muted/10 p-3 text-xs font-medium">
                {metaEntries.slice(0, 16).map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground/80 uppercase tracking-wide truncate">{k.replace(/_/g, " ")}</span>
                    <span className="text-foreground truncate font-semibold">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-4 border-t border-border/40 flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} className="rounded-xl font-bold h-9">
            Отмена
          </Button>
          <Button
            size="sm"
            onClick={() => mutation.mutate({ status, name, phone, email, telegramUsername, preferredChannel, notes })}
            disabled={mutation.isPending}
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/95 shadow-md shadow-primary/10 font-bold h-9"
          >
            {mutation.isPending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── CREATE NEW LEAD DIALOG COMPONENT ──────────────────────────────────────────
function CreateLeadDialog({
  onClose,
  onCreated,
  defaultStatus = "new",
}: {
  onClose: () => void;
  onCreated: () => void;
  defaultStatus?: string;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [telegramUsername, setTelegramUsername] = useState("");
  const [preferredChannel, setPreferredChannel] = useState("auto");
  const [status, setStatus] = useState(defaultStatus);
  const [quizName, setQuizName] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/crm/leads", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Новая заявка успешно добавлена в CRM" });
      onCreated();
      onClose();
    },
    onError: () => {
      toast({ title: "Ошибка при создании заявки", variant: "destructive" });
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md rounded-2xl p-6">
        <DialogHeader className="pb-3 border-b border-border/40">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <PlusCircle className="h-5 w-5 text-primary" />
            <span>Добавить новую заявку</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">ФИО клиента</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Иван Иванов"
              className="h-9 text-sm rounded-xl border-border/60"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Номер телефона</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 (999) 000-00-00"
              className="h-9 text-sm rounded-xl border-border/60"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Email</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@mail.ru"
              className="h-9 text-sm rounded-xl border-border/60"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Telegram @username</Label>
            <Input
              value={telegramUsername}
              onChange={(e) => setTelegramUsername(e.target.value)}
              placeholder="username"
              className="h-9 text-sm rounded-xl border-border/60"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Статус лида</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 text-sm rounded-xl border-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {Object.entries(STATUS_CONFIG).map(([val, conf]) => (
                    <SelectItem key={val} value={val} className="text-sm rounded-lg my-0.5">
                      <div className="flex items-center gap-2 font-medium">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", conf.dotClass)} />
                        {conf.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Канал связи</Label>
              <Select value={preferredChannel} onValueChange={setPreferredChannel}>
                <SelectTrigger className="h-9 text-sm rounded-xl border-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {Object.entries(CHANNEL_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val} className="text-sm rounded-lg my-0.5 font-medium">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Название квиза / Источник</Label>
            <Input
              value={quizName}
              onChange={(e) => setQuizName(e.target.value)}
              placeholder="Квиз: Автоподбор"
              className="h-9 text-sm rounded-xl border-border/60"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Заметки оператора</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Добавьте внутренний комментарий..."
              className="text-sm resize-none rounded-xl border-border/60 min-h-[60px]"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="pt-3 border-t border-border/40 flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} className="rounded-xl font-bold h-9">
            Отмена
          </Button>
          <Button
            size="sm"
            onClick={() => mutation.mutate({ name, phone, email, telegramUsername, preferredChannel, status, quizName, notes })}
            disabled={mutation.isPending}
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/95 shadow-md shadow-primary/10 font-bold h-9"
          >
            {mutation.isPending ? "Добавляем..." : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── MAIN CRM PAGE COMPONENT ───────────────────────────────────────────────────
export default function CrmPage() {
  const [viewMode, setViewMode] = useState<"board" | "table" | "list">("board");
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [createLeadPresetStatus, setCreateLeadPresetStatus] = useState("new");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Filters & Sorting state
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");

  // Debounce search
  const handleSearchChange = (v: string) => {
    setSearch(v);
    clearTimeout((handleSearchChange as any)._t);
    (handleSearchChange as any)._t = setTimeout(() => setDebouncedSearch(v), 350);
  };

  const { data: stats } = useQuery<CrmStats>({
    queryKey: ["/api/crm/stats"],
    queryFn: fetchStats,
    refetchInterval: 15000,
  });

  // Fetch leads: for Board view, we fetch ALL leads (activeTab = "all") to construct the board columns client-side.
  // For Table & List views, we fetch filtered by the selected tab.
  const queryStatusFilter = viewMode === "board" ? "all" : activeTab;

  const { data, isLoading, refetch } = useQuery<LeadsResponse>({
    queryKey: ["/api/crm/leads", queryStatusFilter, debouncedSearch],
    queryFn: () => fetchLeads(queryStatusFilter, debouncedSearch, 0),
    refetchInterval: 15000,
  });

  const leads = data?.leads ?? [];
  const totalLeadsCount = stats?.total ?? 0;

  // Mutation to update lead status (used for drag and drop)
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/crm/leads/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] });
    },
    onError: () => {
      toast({ title: "Не удалось переместить лид", variant: "destructive" });
    },
  });

  // Client-side filtering and sorting of leads for synchronized search, filters, and sorting!
  const processedLeads = useMemo(() => {
    let result = [...leads];

    // 1. Filter by source if selected
    if (sourceFilter !== "all") {
      result = result.filter(l => l.source === sourceFilter);
    }

    // 2. Sort by selected option
    result.sort((a, b) => {
      if (sortBy === "newest") {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sortBy === "oldest") {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      if (sortBy === "value_desc") {
        const valA = Number(a.metadata?.price || a.metadata?.value || a.metadata?.budget || 0);
        const valB = Number(b.metadata?.price || b.metadata?.value || b.metadata?.budget || 0);
        return valB - valA;
      }
      if (sortBy === "value_asc") {
        const valA = Number(a.metadata?.price || a.metadata?.value || a.metadata?.budget || 0);
        const valB = Number(b.metadata?.price || b.metadata?.value || b.metadata?.budget || 0);
        return valA - valB;
      }
      return 0;
    });

    return result;
  }, [leads, sourceFilter, sortBy]);

  const handleUpdated = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] });
  };

  const openCreateLead = (statusPreset: string = "new") => {
    setCreateLeadPresetStatus(statusPreset);
    setCreateLeadOpen(true);
  };

  // CSV Export
  const handleExportCSV = () => {
    if (!processedLeads.length) return;
    const headers = ["ID", "Name", "Phone", "Email", "Telegram", "Status", "Source", "Quiz Name", "Created At", "Notes"];
    const rows = processedLeads.map(l => [
      l.id,
      l.name || "",
      l.phone || "",
      l.email || "",
      l.telegramUsername || "",
      l.status,
      l.source,
      l.quizName || "",
      new Date(l.createdAt).toLocaleDateString("ru-RU"),
      (l.notes || "").replace(/\n/g, " ")
    ]);
    
    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(";"))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `leads_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Organize Kanban Columns using processed leads
  const kanbanColumns = useMemo(() => {
    const columns: Record<string, { title: string; statusValue: string; leads: Lead[]; config: any }> = {
      new: { title: "Новый лид", statusValue: "new", leads: [], config: STATUS_CONFIG.new },
      contacted: { title: "Связались", statusValue: "contacted", leads: [], config: STATUS_CONFIG.contacted },
      in_progress: { title: "Квалифицирован", statusValue: "in_progress", leads: [], config: STATUS_CONFIG.in_progress },
      converted: { title: "Переговоры", statusValue: "converted", leads: [], config: STATUS_CONFIG.converted },
      failed: { title: "Слив / Неудачно", statusValue: "failed", leads: [], config: STATUS_CONFIG.failed },
    };

    processedLeads.forEach(lead => {
      // Group closed with failed
      const colKey = lead.status === "closed" ? "failed" : lead.status;
      if (columns[colKey]) {
        columns[colKey].leads.push(lead);
      }
    });

    return Object.values(columns);
  }, [processedLeads]);

  return (
    <div className="flex flex-col h-full bg-background/50">
      {/* Header Area styled like LimesCRM */}
      <div className="border-b border-border/40 px-6 py-5 flex items-center justify-between gap-4 flex-wrap bg-card/10 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 shadow-sm">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground leading-none">Заявки (CRM)</h1>
              <Badge className="rounded-full bg-primary/10 text-primary border border-primary/20 font-bold px-2 py-0 text-xs">
                {totalLeadsCount}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-medium pt-1">
              Управляйте воронкой лидов и заявками клиентов из внешних систем
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2.5">
          {stats && stats.new > 0 && (
            <Badge className="rounded-full bg-primary/10 text-primary border border-primary/20 font-bold text-xs px-2.5 py-0.5 shadow-xs">
              {stats.new} новых
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-9 w-9 p-0 rounded-xl border border-border/40 bg-card hover:bg-muted/10">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {/* View Selectors & Controls Area styled EXACTLY like LimesCRM */}
      <div className="border-b border-border/40 px-6 py-3.5 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3.5 bg-card/5 backdrop-blur-sm select-none">
        
        {/* Left Side: Segmented Controls for Board/Table/List */}
        <div className="flex items-center gap-1 bg-muted/60 dark:bg-muted/30 border border-border/40 p-1 rounded-xl shadow-xs shrink-0 font-semibold">
          <button
            onClick={() => setViewMode("board")}
            className={cn(
              "h-8 rounded-lg text-xs gap-1.5 font-bold transition-all px-4 flex items-center justify-center",
              viewMode === "board" 
                ? "bg-background text-foreground shadow-sm border border-border/10" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted/10"
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5 text-primary" />
            Доска
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={cn(
              "h-8 rounded-lg text-xs gap-1.5 font-bold transition-all px-4 flex items-center justify-center",
              viewMode === "table" 
                ? "bg-background text-foreground shadow-sm border border-border/10" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted/10"
            )}
          >
            <TableIcon className="h-3.5 w-3.5 text-primary" />
            Таблица
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "h-8 rounded-lg text-xs gap-1.5 font-bold transition-all px-4 flex items-center justify-center",
              viewMode === "list" 
                ? "bg-background text-foreground shadow-sm border border-border/10" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted/10"
            )}
          >
            <ListIcon className="h-3.5 w-3.5 text-primary" />
            Список
          </button>
        </div>

        {/* Right Side: Filters, Search, and + Lead Button */}
        <div className="flex items-center gap-2.5 w-full lg:w-auto flex-wrap sm:flex-nowrap justify-between sm:justify-end">
          {/* Search Input */}
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <Input
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Поиск лидов..."
              className="pl-9 h-9 text-xs rounded-xl border-border/60 bg-card/40 focus-visible:bg-card/100"
            />
          </div>

          {/* Filter Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3.5 rounded-xl border-border/60 text-xs font-bold gap-1.5 hover:bg-muted/10 bg-card/20 text-muted-foreground hover:text-foreground transition-all duration-200"
              >
                <Filter className="h-3.5 w-3.5 text-muted-foreground/85" />
                {sourceFilter === "all" ? "Фильтр" : `Источник: ${SOURCE_LABELS[sourceFilter] || sourceFilter}`}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-xl p-1 border-border/40 bg-card shadow-md">
              <DropdownMenuItem onClick={() => setSourceFilter("all")} className={cn("text-xs font-semibold rounded-lg", sourceFilter === "all" && "bg-primary/10 text-primary font-bold")}>
                Все источники
              </DropdownMenuItem>
              <DropdownMenuSeparator className="border-border/30 my-1" />
              <DropdownMenuItem onClick={() => setSourceFilter("marquiz")} className={cn("text-xs font-semibold rounded-lg", sourceFilter === "marquiz" && "bg-primary/10 text-primary font-bold")}>
                Marquiz
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSourceFilter("universal")} className={cn("text-xs font-semibold rounded-lg", sourceFilter === "universal" && "bg-primary/10 text-primary font-bold")}>
                Универсальный Webhook
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSourceFilter("manual")} className={cn("text-xs font-semibold rounded-lg", sourceFilter === "manual" && "bg-primary/10 text-primary font-bold")}>
                Создано вручную
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sort By Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3.5 rounded-xl border-border/60 text-xs font-bold gap-1.5 hover:bg-muted/10 bg-card/20 text-muted-foreground hover:text-foreground transition-all duration-200"
              >
                <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/85" />
                {sortBy === "newest" ? "Сначала новые" : sortBy === "oldest" ? "Сначала старые" : sortBy === "value_desc" ? "Сумма (убыв.)" : "Сумма (возр.)"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-xl p-1 border-border/40 bg-card shadow-md">
              <DropdownMenuItem onClick={() => setSortBy("newest")} className={cn("text-xs font-semibold rounded-lg", sortBy === "newest" && "bg-primary/10 text-primary font-bold")}>
                Сначала новые
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("oldest")} className={cn("text-xs font-semibold rounded-lg", sortBy === "oldest" && "bg-primary/10 text-primary font-bold")}>
                Сначала старые
              </DropdownMenuItem>
              <DropdownMenuSeparator className="border-border/30 my-1" />
              <DropdownMenuItem onClick={() => setSortBy("value_desc")} className={cn("text-xs font-semibold rounded-lg", sortBy === "value_desc" && "bg-primary/10 text-primary font-bold")}>
                Сумма сделки (убывание)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("value_asc")} className={cn("text-xs font-semibold rounded-lg", sortBy === "value_asc" && "bg-primary/10 text-primary font-bold")}>
                Сумма сделки (возрастание)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Export Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={processedLeads.length === 0}
            className="h-9 px-3.5 rounded-xl border-border/60 text-xs font-bold gap-1.5 hover:bg-muted/10 bg-card/20 text-muted-foreground hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5 text-muted-foreground/80" />
            Экспорт
          </Button>

          {/* Add New Lead Button (Styled with beautiful violet-purple color instead of green) */}
          <Button
            size="sm"
            onClick={() => openCreateLead("new")}
            className="h-9 px-4 rounded-xl text-xs font-bold gap-1.5 bg-primary text-primary-foreground hover:bg-primary/95 shadow-md shadow-primary/15 transition-all duration-200 active:scale-[0.98] w-full sm:w-auto shrink-0"
          >
            <Plus className="h-4 w-4" />
            Новый лид
          </Button>
        </div>
      </div>

      {/* Tabs list shown only for List or Table view (Board view shows all statuses at once) */}
      {viewMode !== "board" && (
        <div className="border-b border-border/30 px-6 py-2 bg-card/5 select-none overflow-x-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="h-9 text-xs bg-muted/20 border border-border/30 rounded-xl p-1 gap-1">
              {STATUS_TABS.map((tab) => {
                const count = tab.value === "all" ? stats?.total : stats?.[tab.value as keyof CrmStats];
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="text-xs px-3.5 h-7 rounded-lg font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    {tab.label}
                    {count != null && count > 0 && (
                      <span className="ml-1.5 text-[9px] bg-muted-foreground/15 dark:bg-muted/50 rounded-full px-1.5 py-0.5 font-bold leading-none inline-block">
                        {count}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* MAIN VIEW CONTENT CONTAINER */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          /* Loading Skeletons */
          viewMode === "board" ? (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 h-full">
              {[...Array(5)].map((_, colIdx) => (
                <div key={colIdx} className="space-y-3 bg-card/10 border border-card-border/50 rounded-2xl p-4">
                  <Skeleton className="h-6 w-2/3 rounded-lg" />
                  <Skeleton className="h-28 w-full rounded-2xl" />
                  <Skeleton className="h-28 w-full rounded-2xl" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-2xl" />
              ))}
            </div>
          )
        ) : processedLeads.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center h-[50vh] text-center max-w-md mx-auto">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 shrink-0 shadow-sm animate-pulse">
              <Users className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-bold text-base text-foreground">Заявок пока нет</h3>
            <p className="text-xs text-muted-foreground mt-1.5 font-medium leading-relaxed">
              {activeTab === "all" 
                ? "Заявки автоматически создаются при получении ответов в Marquiz или через универсальный webhook-интегратор." 
                : `Нет заявок со статусом «${STATUS_CONFIG[activeTab]?.label ?? activeTab}»`}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openCreateLead(activeTab === "all" ? "new" : activeTab)}
              className="mt-5 rounded-xl text-xs font-bold gap-1 border-primary/30 hover:border-primary/60 text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              Создать первую заявку вручную
            </Button>
          </div>
        ) : (
          /* Core Content Renderers */
          <>
            {/* 1. KANBAN BOARD VIEW */}
            {viewMode === "board" && (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 h-full items-start min-w-[1100px] select-none">
                {kanbanColumns.map((col) => (
                  <div 
                    key={col.statusValue} 
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const leadId = e.dataTransfer.getData("text/plain");
                      if (leadId) {
                        updateStatusMutation.mutate({ id: leadId, status: col.statusValue });
                      }
                    }}
                    className="flex flex-col max-h-[70vh] bg-card/10 dark:bg-card/5 border border-border/30 rounded-2xl p-4 space-y-4 shadow-2xs hover:border-border/60 transition-colors duration-200"
                  >
                    
                    {/* Column Header styled beautifully like LimesCRM */}
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", col.config.dotClass)} />
                        <h3 className="font-bold text-xs tracking-tight text-foreground uppercase truncate">
                          {col.title}
                        </h3>
                        <Badge 
                          variant="secondary" 
                          className={cn("text-[10px] font-bold px-1.5 py-0 h-4 shrink-0 rounded-full", 
                            col.statusValue === "new" ? "bg-primary/10 text-primary" :
                            col.statusValue === "contacted" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" :
                            col.statusValue === "in_progress" ? "bg-sky-500/10 text-sky-600 dark:text-sky-400" :
                            col.statusValue === "converted" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
                            "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                          )}
                        >
                          {col.leads.length}
                        </Badge>
                      </div>
                      
                      <button
                        onClick={() => openCreateLead(col.statusValue)}
                        className="h-6 w-6 rounded-lg border border-border/40 bg-background text-muted-foreground hover:text-foreground flex items-center justify-center hover:bg-muted/10 transition-colors shadow-2xs"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Column Leads List */}
                    <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-[150px]">
                      {col.leads.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 px-4 border border-dashed border-border/40 rounded-2xl text-center bg-card/5">
                          <PlusCircle className="h-5 w-5 text-muted-foreground/30 mb-1.5" />
                          <p className="text-[10px] text-muted-foreground font-semibold">Перетащите сюда</p>
                          <p className="text-[9px] text-muted-foreground/80 mt-0.5">или нажмите +</p>
                        </div>
                      ) : (
                        col.leads.map((lead) => (
                          <LeadKanbanCard
                            key={lead.id}
                            lead={lead}
                            onClick={() => setSelectedLead(lead)}
                            onDragStart={(e, id) => {
                              e.dataTransfer.setData("text/plain", id);
                            }}
                          />
                        ))
                      )}
                    </div>

                    {/* Quick Add At Bottom */}
                    <button
                      onClick={() => openCreateLead(col.statusValue)}
                      className="w-full py-2.5 border border-dashed border-border/30 hover:border-primary/40 bg-card/10 hover:bg-card/25 rounded-xl text-[10px] font-bold text-muted-foreground hover:text-primary flex items-center justify-center gap-1 transition-all duration-200"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Добавить карточку
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 2. PREMIUM TABLE VIEW */}
            {viewMode === "table" && (
              <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border/40 bg-muted/20 text-[10px] text-muted-foreground font-bold uppercase tracking-wider select-none">
                        <th className="px-5 py-3">Имя клиента</th>
                        <th className="px-4 py-3">Телефон</th>
                        <th className="px-4 py-3">Email</th>
                        <th className="px-4 py-3">Квиз / Интеграция</th>
                        <th className="px-4 py-3">Канал связи</th>
                        <th className="px-4 py-3">Статус</th>
                        <th className="px-4 py-3">Дата создания</th>
                        <th className="px-5 py-3 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30 text-xs font-medium">
                      {processedLeads.map((lead) => {
                        const cfg = STATUS_CONFIG[lead.status] ?? STATUS_CONFIG.new;
                        const StatusIcon = cfg.icon;
                        return (
                          <tr
                            key={lead.id}
                            onClick={() => setSelectedLead(lead)}
                            className="hover:bg-muted/10 cursor-pointer transition-colors"
                          >
                            <td className="px-5 py-3.5 font-bold text-foreground">
                              <div className="flex items-center gap-2.5">
                                <Avatar className="h-7 w-7 border border-border/40">
                                  <AvatarFallback className="text-[10px] bg-primary/10 text-primary font-bold">
                                    {getInitials(lead.name)}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="truncate max-w-[140px]">{lead.name || "Без имени"}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-foreground/80 font-mono">{lead.phone || "—"}</td>
                            <td className="px-4 py-3.5 text-foreground/80">{lead.email || "—"}</td>
                            <td className="px-4 py-3.5">
                              <span className="truncate max-w-[180px] block text-foreground/80">{lead.quizName || "—"}</span>
                            </td>
                            <td className="px-4 py-3.5">
                              <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-muted/40 border-border/40">
                                {CHANNEL_LABELS[lead.preferredChannel ?? ""] ?? (lead.preferredChannel || "—")}
                              </Badge>
                            </td>
                            <td className="px-4 py-3.5">
                              <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5 font-bold", cfg.badgeClass)}>
                                <StatusIcon className="h-3 w-3 mr-1 shrink-0" />
                                {cfg.label}
                              </Badge>
                            </td>
                            <td className="px-4 py-3.5 text-muted-foreground font-medium">
                              {format(new Date(lead.createdAt), "dd.MM.yyyy HH:mm")}
                            </td>
                            <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedLead(lead)}
                                className="h-7 px-2 text-[10px] font-bold rounded-lg border hover:bg-muted/20"
                              >
                                Открыть
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 3. PREMIUM LIST VIEW */}
            {viewMode === "list" && (
              <div className="space-y-3 max-w-4xl mx-auto">
                {processedLeads.map((lead) => {
                  const cfg = STATUS_CONFIG[lead.status] ?? STATUS_CONFIG.new;
                  const StatusIcon = cfg.icon;
                  return (
                    <button
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      className={cn(
                        "w-full text-left group relative",
                        "rounded-2xl border border-card-border bg-card hover:bg-muted/5 hover:shadow-md transition-all duration-300",
                        "border-l-4 pl-5 pr-5 py-3.5 flex items-center justify-between gap-4",
                        lead.status === "new" ? "border-l-primary" :
                        lead.status === "contacted" ? "border-l-amber-500" :
                        lead.status === "in_progress" ? "border-l-sky-500" :
                        lead.status === "converted" ? "border-l-emerald-500" :
                        "border-l-rose-500"
                      )}
                    >
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        <Avatar className="h-10 w-10 border border-border/40 shrink-0">
                          <AvatarFallback className="text-xs font-bold bg-muted text-muted-foreground">
                            {getInitials(lead.name)}
                          </AvatarFallback>
                        </Avatar>
                        
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-foreground truncate">
                              {lead.name || "Без имени"}
                            </span>
                            <Badge variant="outline" className={cn("text-[10px] font-bold px-2 py-0", cfg.badgeClass)}>
                              <StatusIcon className="h-2.5 w-2.5 mr-1" />
                              {cfg.label}
                            </Badge>
                            {lead.quizName && (
                              <Badge variant="secondary" className="text-[10px] px-2 py-0 bg-muted/60 font-medium">
                                {lead.quizName}
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-3 mt-1 text-xs font-medium text-muted-foreground flex-wrap">
                            {lead.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3" />
                                {lead.phone}
                              </span>
                            )}
                            {lead.email && (
                              <span className="flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {lead.email}
                              </span>
                            )}
                            <span className="flex items-center gap-1 text-[11px]">
                              <Clock className="h-3 w-3 text-muted-foreground/60" />
                              {getRelativeDate(lead.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider bg-muted/40 px-2 py-1 rounded-lg border border-border/30">
                          {SOURCE_LABELS[lead.source] || lead.source}
                        </span>
                        <ChevronRight className="h-5 w-5 text-muted-foreground/30 group-hover:text-primary transition-all group-hover:translate-x-0.5 shrink-0" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* LEAD DETAILS DIALOG CONTROLLER */}
      {selectedLead && (
        <LeadDetailDialog
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdated={handleUpdated}
        />
      )}

      {/* CREATE NEW LEAD DIALOG CONTROLLER */}
      {createLeadOpen && (
        <CreateLeadDialog
          onClose={() => setCreateLeadOpen(false)}
          onCreated={handleUpdated}
          defaultStatus={createLeadPresetStatus}
        />
      )}
    </div>
  );
}
