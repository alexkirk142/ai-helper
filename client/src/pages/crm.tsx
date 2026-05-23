import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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

const STATUS_CONFIG: Record<string, { label: string; icon: React.FC<{ className?: string }>; badgeClass: string; rowClass: string }> = {
  new: {
    label: "Новая",
    icon: Inbox,
    badgeClass: "bg-blue-500/15 text-blue-600 border-blue-500/25",
    rowClass: "border-l-blue-400",
  },
  contacted: {
    label: "Связались",
    icon: PhoneCall,
    badgeClass: "bg-success/15 text-success border-success/25",
    rowClass: "border-l-success",
  },
  in_progress: {
    label: "В работе",
    icon: MessageSquare,
    badgeClass: "bg-warning/15 text-warning border-warning/25",
    rowClass: "border-l-warning",
  },
  converted: {
    label: "Конвертирована",
    icon: CheckCircle2,
    badgeClass: "bg-emerald-500/15 text-emerald-600 border-emerald-500/25",
    rowClass: "border-l-emerald-500",
  },
  failed: {
    label: "Неудачная",
    icon: XCircle,
    badgeClass: "bg-destructive/15 text-destructive border-destructive/25",
    rowClass: "border-l-destructive",
  },
  closed: {
    label: "Закрыта",
    icon: CheckCircle2,
    badgeClass: "bg-muted text-muted-foreground border-border",
    rowClass: "border-l-muted-foreground/30",
  },
};

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  telegram_personal: "Telegram",
  max: "MAX",
  max_personal: "MAX",
  whatsapp: "WhatsApp",
  whatsapp_personal: "WhatsApp",
  auto: "Авто",
};

const STATUS_TABS = [
  { value: "all", label: "Все" },
  { value: "new", label: "Новые" },
  { value: "contacted", label: "Связались" },
  { value: "in_progress", label: "В работе" },
  { value: "converted", label: "Конвертированы" },
  { value: "failed", label: "Неудачные" },
  { value: "closed", label: "Закрытые" },
];

async function fetchLeads(status: string, search: string, offset: number): Promise<LeadsResponse> {
  const params = new URLSearchParams({ limit: "50", offset: String(offset) });
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

function LeadCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  const cfg = STATUS_CONFIG[lead.status] ?? STATUS_CONFIG.new;
  const StatusIcon = cfg.icon;
  const channel = CHANNEL_LABELS[lead.preferredChannel ?? ""] ?? (lead.preferredChannel ?? "—");

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left group",
        "rounded-xl border border-border bg-card hover:bg-accent/30 transition-colors",
        "border-l-2 pl-3 pr-4 py-3",
        cfg.rowClass,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm truncate">
                {lead.name || "Без имени"}
              </span>
              <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-4 font-medium", cfg.badgeClass)}>
                <StatusIcon className="h-2.5 w-2.5 mr-1" />
                {cfg.label}
              </Badge>
              {lead.quizName && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 truncate max-w-[120px]">
                  {lead.quizName}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              {lead.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {lead.phone}
                </span>
              )}
              {lead.telegramUsername && (
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  @{lead.telegramUsername}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true, locale: ru })}
              </span>
              {channel && channel !== "—" && (
                <span className="text-muted-foreground/60">{channel}</span>
              )}
            </div>
            {lead.status === "failed" && lead.failureReason && (
              <div className="mt-1.5 flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="line-clamp-1">{lead.failureReason}</span>
              </div>
            )}
            {lead.notes && (
              <div className="mt-1.5 flex items-start gap-1 text-xs text-muted-foreground">
                <Bot className="h-3 w-3 shrink-0 mt-0.5" />
                <span className="line-clamp-1">{lead.notes}</span>
              </div>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0 mt-1" />
      </div>
    </button>
  );
}

function LeadDetailDialog({ lead, onClose, onUpdated }: { lead: Lead; onClose: () => void; onUpdated: () => void }) {
  const [status, setStatus] = useState(lead.status);
  const [notes, setNotes] = useState(lead.notes ?? "");
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (data: { status: string; notes: string }) => {
      const res = await apiRequest("PATCH", `/api/crm/leads/${lead.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Заявка обновлена" });
      onUpdated();
      onClose();
    },
    onError: () => {
      toast({ title: "Ошибка при обновлении", variant: "destructive" });
    },
  });

  const cfg = STATUS_CONFIG[lead.status] ?? STATUS_CONFIG.new;
  const StatusIcon = cfg.icon;

  const metaEntries = Object.entries(lead.metadata ?? {}).filter(
    ([k, v]) => v && !["source", "quizName"].includes(k)
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            {lead.name || "Без имени"}
            <Badge variant="outline" className={cn("text-xs ml-1", cfg.badgeClass)}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {cfg.label}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Contact info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {lead.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-3.5 w-3.5" />
                <span>{lead.phone}</span>
              </div>
            )}
            {lead.telegramUsername && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" />
                <span>@{lead.telegramUsername}</span>
              </div>
            )}
            {lead.quizName && (
              <div className="col-span-2 text-xs text-muted-foreground">
                Квиз: <span className="font-medium text-foreground">{lead.quizName}</span>
              </div>
            )}
            <div className="col-span-2 text-xs text-muted-foreground">
              Получена: {format(new Date(lead.createdAt), "d MMM yyyy HH:mm", { locale: ru })}
            </div>
            {lead.conversationId && (
              <div className="col-span-2 text-xs text-muted-foreground">
                Разговор: <code className="bg-muted rounded px-1 text-[10px]">{lead.conversationId}</code>
              </div>
            )}
          </div>

          {/* Failure reason */}
          {lead.failureReason && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/5 border border-destructive/20 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{lead.failureReason}</span>
            </div>
          )}

          {/* Extra metadata fields */}
          {metaEntries.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
              {metaEntries.slice(0, 8).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-muted-foreground capitalize min-w-[80px]">{k}:</span>
                  <span className="text-foreground font-medium">{String(v)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Status change */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Статус заявки</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_CONFIG).map(([val, conf]) => (
                  <SelectItem key={val} value={val} className="text-sm">
                    {conf.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Заметки оператора</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Добавьте заметки о клиенте..."
              className="text-sm resize-none"
              rows={3}
            />
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>
              Отмена
            </Button>
            <Button
              size="sm"
              onClick={() => mutation.mutate({ status, notes })}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Сохраняем..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CrmPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const queryClient = useQueryClient();

  // Debounce search
  const handleSearchChange = (v: string) => {
    setSearch(v);
    clearTimeout((handleSearchChange as any)._t);
    (handleSearchChange as any)._t = setTimeout(() => setDebouncedSearch(v), 350);
  };

  const { data: stats } = useQuery<CrmStats>({
    queryKey: ["/api/crm/stats"],
    queryFn: fetchStats,
    refetchInterval: 30000,
  });

  const { data, isLoading, refetch } = useQuery<LeadsResponse>({
    queryKey: ["/api/crm/leads", activeTab, debouncedSearch],
    queryFn: () => fetchLeads(activeTab, debouncedSearch, 0),
    refetchInterval: 30000,
  });

  const leads = data?.leads ?? [];
  const total = data?.total ?? 0;

  const handleUpdated = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">CRM — Заявки</h1>
            <p className="text-xs text-muted-foreground">
              Все входящие заявки из Marquiz и Universal webhook
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {stats && (
            <div className="flex items-center gap-1.5">
              {stats.new > 0 && (
                <Badge className="rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/25 font-bold text-[10px]">
                  {stats.new} новых
                </Badge>
              )}
              {stats.failed > 0 && (
                <Badge variant="outline" className="rounded-full bg-destructive/10 text-destructive border-destructive/25 font-bold text-[10px]">
                  {stats.failed} неудачных
                </Badge>
              )}
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-8 w-8 p-0">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="border-b px-4 sm:px-6 py-2 flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-8 text-xs">
            {STATUS_TABS.map((tab) => {
              const count = tab.value === "all" ? stats?.total : stats?.[tab.value as keyof CrmStats];
              return (
                <TabsTrigger key={tab.value} value={tab.value} className="text-xs px-2.5 h-7">
                  {tab.label}
                  {count != null && count > 0 && (
                    <span className="ml-1 text-[9px] bg-muted text-muted-foreground rounded-full px-1.5 py-0 font-bold leading-4 inline-block">
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        <div className="relative sm:ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Поиск по имени, телефону..."
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-medium">
              {activeTab === "all" ? "Заявок пока нет" : `Нет заявок со статусом «${STATUS_CONFIG[activeTab]?.label ?? activeTab}»`}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Заявки появятся здесь после первого обращения через Marquiz или Universal webhook
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {leads.map((lead) => (
                <LeadCard key={lead.id} lead={lead} onClick={() => setSelectedLead(lead)} />
              ))}
            </div>
            {total > leads.length && (
              <p className="text-xs text-muted-foreground text-center mt-4">
                Показано {leads.length} из {total}
              </p>
            )}
          </>
        )}
      </div>

      {selectedLead && (
        <LeadDetailDialog
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}
