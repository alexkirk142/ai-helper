import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Building2,
  MessageSquare,
  Clock,
  Bell,
  Bot,
  Save,
  Link2,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Smartphone,
  Lock,
  Zap,
  Plus,
  Trash2,
  Power,
  PowerOff,
  QrCode,
  Phone,
  User,
  FileText,
  CreditCard,
  Pencil,
  GripVertical,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { useBillingStatus, isSubscriptionRequired } from "@/hooks/use-billing";
import { useAutoPartsEnabled } from "@/hooks/useAutoPartsEnabled";
import { SubscriptionPaywall, ChannelPaywallOverlay, SubscriptionBadge } from "@/components/subscription-paywall";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import type { Tenant, DecisionSettings, MessageTemplate, PaymentMethod, TenantAgentSettings } from "@shared/schema";
import { VALID_INTENTS } from "@shared/schema";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

const INTENT_LABELS: Record<string, string> = {
  price: "Цена",
  availability: "Наличие",
  shipping: "Доставка",
  return: "Возврат",
  discount: "Скидка",
  complaint: "Жалоба",
  other: "Другое",
  photo_request: "Запрос фото",
  price_objection: "Возражение по цене",
  ready_to_buy: "Готов купить",
  needs_manual_quote: "Ручной расчёт",
  invalid_vin: "Неверный ВИН",
  marking_provided: "Маркировка агрегата",
  payment_blocked: "Блокировка платежа",
  warranty_question: "Вопрос о гарантии",
  want_visit: "Хочет приехать",
  what_included: "Что в комплекте",
};

const INTENT_OPTIONS = VALID_INTENTS.map(value => ({
  value,
  label: INTENT_LABELS[value] || value,
}));

const AUTO_PARTS_INTENTS = new Set(["invalid_vin", "marking_provided", "want_visit", "what_included", "mileage_preference"]);

interface DecisionEngineSettingsProps {
  autoPartsEnabled?: boolean;
}

function DecisionEngineSettings({ autoPartsEnabled = false }: DecisionEngineSettingsProps) {
  const { toast } = useToast();
  
  const { data: settings, isLoading } = useQuery<DecisionSettings>({
    queryKey: ["/api/settings/decision"],
  });

  const [tAuto, setTAuto] = useState(0.80);
  const [tEscalate, setTEscalate] = useState(0.40);
  const [autosendAllowed, setAutosendAllowed] = useState(false);
  const [intentsAutosendAllowed, setIntentsAutosendAllowed] = useState<string[]>([
    "price", "availability", "shipping", "other"
  ]);
  const [intentsForceHandoff, setIntentsForceHandoff] = useState<string[]>([
    "discount", "complaint"
  ]);

  useEffect(() => {
    if (settings) {
      setTAuto(settings.tAuto ?? 0.80);
      setTEscalate(settings.tEscalate ?? 0.40);
      setAutosendAllowed(settings.autosendAllowed ?? false);
      setIntentsAutosendAllowed((settings.intentsAutosendAllowed as string[]) ?? ["price", "availability", "shipping", "other"]);
      setIntentsForceHandoff((settings.intentsForceHandoff as string[]) ?? ["discount", "complaint"]);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<DecisionSettings>) => {
      return apiRequest("PATCH", "/api/settings/decision", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/decision"] });
      toast({ title: "Настройки Decision Engine сохранены" });
    },
    onError: () => {
      toast({ title: "Не удалось сохранить настройки", variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      tAuto,
      tEscalate,
      autosendAllowed,
      intentsAutosendAllowed,
      intentsForceHandoff,
    });
  };

  const toggleAutosendIntent = (intent: string) => {
    setIntentsAutosendAllowed(prev => 
      prev.includes(intent) 
        ? prev.filter(i => i !== intent)
        : [...prev, intent]
    );
  };

  const toggleHandoffIntent = (intent: string) => {
    setIntentsForceHandoff(prev => 
      prev.includes(intent) 
        ? prev.filter(i => i !== intent)
        : [...prev, intent]
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Decision Engine</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Decision Engine
          <Badge variant="outline" className="font-normal">Phase 1</Badge>
        </CardTitle>
        <CardDescription>
          Настройка автоматического принятия решений AI
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Порог автоотправки (tAuto): {Math.round(tAuto * 100)}%</Label>
              <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                Auto-send
              </Badge>
            </div>
            <Slider
              value={[tAuto * 100]}
              onValueChange={([value]) => setTAuto(value / 100)}
              max={100}
              min={Math.round(tEscalate * 100) + 1}
              step={1}
              data-testid="slider-t-auto"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Если уверенность выше {Math.round(tAuto * 100)}%, ответ отправляется автоматически
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Порог эскалации (tEscalate): {Math.round(tEscalate * 100)}%</Label>
              <Badge variant="secondary" className="bg-red-500/10 text-red-600">
                Escalate
              </Badge>
            </div>
            <Slider
              value={[tEscalate * 100]}
              onValueChange={([value]) => setTEscalate(value / 100)}
              max={Math.round(tAuto * 100) - 1}
              min={0}
              step={1}
              data-testid="slider-t-escalate"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Если уверенность ниже {Math.round(tEscalate * 100)}%, разговор эскалируется оператору
            </p>
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-4">
            <div>
              <Label>Разрешить автоотправку</Label>
              <p className="text-xs text-muted-foreground mt-1">
                AI может отправлять ответы без одобрения оператора
              </p>
            </div>
            <Switch
              checked={autosendAllowed}
              onCheckedChange={setAutosendAllowed}
              data-testid="switch-autosend-allowed"
            />
          </div>

          {autosendAllowed && (
            <div className="space-y-2">
              <Label>Интенты для автоотправки</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Выберите типы запросов, для которых разрешена автоотправка
              </p>
              <div className="flex flex-wrap gap-2">
                {INTENT_OPTIONS.filter(i => autoPartsEnabled || !AUTO_PARTS_INTENTS.has(i.value)).map((intent) => (
                  <Badge
                    key={intent.value}
                    variant={intentsAutosendAllowed.includes(intent.value) ? "default" : "outline"}
                    className={cn(
                      "cursor-pointer",
                      intentsAutosendAllowed.includes(intent.value) && "bg-green-500/20 text-green-700 dark:text-green-300"
                    )}
                    onClick={() => toggleAutosendIntent(intent.value)}
                    data-testid={`badge-autosend-${intent.value}`}
                  >
                    {intent.label}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <Label>Интенты → всегда эскалировать (ESCALATE)</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Эти интенты всегда вызывают полную эскалацию оператору — независимо от уверенности AI
          </p>
          <div className="flex flex-wrap gap-2">
            {INTENT_OPTIONS.filter(i => autoPartsEnabled || !AUTO_PARTS_INTENTS.has(i.value)).map((intent) => (
              <Badge
                key={intent.value}
                variant={intentsForceHandoff.includes(intent.value) ? "default" : "outline"}
                className={cn(
                  "cursor-pointer",
                  intentsForceHandoff.includes(intent.value) && "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                )}
                onClick={() => toggleHandoffIntent(intent.value)}
                data-testid={`badge-handoff-${intent.value}`}
              >
                {intent.label}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            data-testid="button-save-decision-settings"
          >
            <Save className="mr-2 h-4 w-4" />
            Сохранить настройки Decision Engine
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const NIGHT_MODE_OPTIONS = [
  { value: "DELAY", label: "Увеличить задержку" },
  { value: "AUTO_REPLY", label: "Автоответ" },
  { value: "DISABLE", label: "Не отправлять" },
];

function HumanDelaySettings() {
  const { toast } = useToast();
  
  interface HumanDelaySettingsData {
    tenantId: string;
    enabled: boolean;
    nightMode: string;
    nightDelayMultiplier: number;
    nightAutoReplyText: string;
    minDelayMs: number;
    maxDelayMs: number;
    typingIndicatorEnabled: boolean;
  }

  const { data: settings, isLoading } = useQuery<HumanDelaySettingsData>({
    queryKey: ["/api/settings/human-delay"],
  });

  const [enabled, setEnabled] = useState(false);
  const [nightMode, setNightMode] = useState("DELAY");
  const [nightDelayMultiplier, setNightDelayMultiplier] = useState(3.0);
  const [nightAutoReplyText, setNightAutoReplyText] = useState("");
  const [minDelayMs, setMinDelayMs] = useState(3000);
  const [maxDelayMs, setMaxDelayMs] = useState(120000);
  const [typingIndicatorEnabled, setTypingIndicatorEnabled] = useState(true);

  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled ?? false);
      setNightMode(settings.nightMode ?? "DELAY");
      setNightDelayMultiplier(settings.nightDelayMultiplier ?? 3.0);
      setNightAutoReplyText(settings.nightAutoReplyText ?? "");
      setMinDelayMs(settings.minDelayMs ?? 3000);
      setMaxDelayMs(settings.maxDelayMs ?? 120000);
      setTypingIndicatorEnabled(settings.typingIndicatorEnabled ?? true);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<HumanDelaySettingsData>) => {
      return apiRequest("PATCH", "/api/settings/human-delay", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/human-delay"] });
      toast({ title: "Настройки задержки сохранены" });
    },
    onError: () => {
      toast({ title: "Не удалось сохранить настройки", variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      enabled,
      nightMode,
      nightDelayMultiplier,
      nightAutoReplyText,
      minDelayMs,
      maxDelayMs,
      typingIndicatorEnabled,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Human-like Delay</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Human-like Delay
          <Badge variant="outline" className="font-normal">Phase 2</Badge>
        </CardTitle>
        <CardDescription>
          Имитация человеческих задержек при отправке ответов
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-md border p-4">
          <div>
            <Label>Включить задержку ответов</Label>
            <p className="text-xs text-muted-foreground mt-1">
              AI будет отправлять ответы с человекоподобной задержкой
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            data-testid="switch-human-delay-enabled"
          />
        </div>

        {enabled && (
          <>
            <Separator />

            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">Поведение в нерабочее время</Label>
                <Select value={nightMode} onValueChange={setNightMode}>
                  <SelectTrigger data-testid="select-night-mode">
                    <SelectValue placeholder="Выберите режим" />
                  </SelectTrigger>
                  <SelectContent>
                    {NIGHT_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {nightMode === "DELAY" && "Задержка увеличивается в ночное время"}
                  {nightMode === "AUTO_REPLY" && "Отправляется автоответ вместо AI-ответа"}
                  {nightMode === "DISABLE" && "Ответы не отправляются в нерабочее время"}
                </p>
              </div>

              {nightMode === "DELAY" && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Множитель ночной задержки: x{nightDelayMultiplier.toFixed(1)}</Label>
                  </div>
                  <Slider
                    value={[nightDelayMultiplier * 10]}
                    onValueChange={([value]) => setNightDelayMultiplier(value / 10)}
                    max={100}
                    min={10}
                    step={5}
                    data-testid="slider-night-multiplier"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Задержка умножается на {nightDelayMultiplier.toFixed(1)} в нерабочее время
                  </p>
                </div>
              )}

              {nightMode === "AUTO_REPLY" && (
                <div>
                  <Label className="mb-2 block">Текст автоответа</Label>
                  <Input
                    value={nightAutoReplyText}
                    onChange={(e) => setNightAutoReplyText(e.target.value)}
                    placeholder="Спасибо за сообщение! Мы ответим в рабочее время."
                    data-testid="input-night-auto-reply"
                  />
                </div>
              )}
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-2 block">Мин. задержка (сек)</Label>
                <Input
                  type="number"
                  value={Math.round(minDelayMs / 1000)}
                  onChange={(e) => setMinDelayMs(Number(e.target.value) * 1000)}
                  min={0}
                  max={Math.round(maxDelayMs / 1000)}
                  data-testid="input-min-delay"
                />
              </div>
              <div>
                <Label className="mb-2 block">Макс. задержка (сек)</Label>
                <Input
                  type="number"
                  value={Math.round(maxDelayMs / 1000)}
                  onChange={(e) => setMaxDelayMs(Number(e.target.value) * 1000)}
                  min={Math.round(minDelayMs / 1000)}
                  data-testid="input-max-delay"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <Label>Показывать индикатор набора</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Показывать "печатает..." пока AI готовит ответ
                </p>
              </div>
              <Switch
                checked={typingIndicatorEnabled}
                onCheckedChange={setTypingIndicatorEnabled}
                data-testid="switch-typing-indicator"
              />
            </div>
          </>
        )}

        <div className="flex justify-end pt-4">
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            data-testid="button-save-human-delay-settings"
          >
            <Save className="mr-2 h-4 w-4" />
            Сохранить настройки задержки
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface TrainingPolicy {
  tenantId: string;
  alwaysEscalateIntents: string[];
  forbiddenTopics: string[];
  disabledLearningIntents: string[];
  updatedAt: string;
}

interface TrainingPoliciesSettingsProps {
  autoPartsEnabled?: boolean;
}

function TrainingPoliciesSettings({ autoPartsEnabled = false }: TrainingPoliciesSettingsProps) {
  const { toast } = useToast();

  const { data: policy, isLoading } = useQuery<TrainingPolicy>({
    queryKey: ["/api/admin/training-policies"],
  });

  const [alwaysEscalateIntents, setAlwaysEscalateIntents] = useState<string[]>([]);
  const [forbiddenTopics, setForbiddenTopics] = useState<string[]>([]);
  const [disabledLearningIntents, setDisabledLearningIntents] = useState<string[]>([]);
  const [newForbiddenTopic, setNewForbiddenTopic] = useState("");

  useEffect(() => {
    if (policy) {
      setAlwaysEscalateIntents(policy.alwaysEscalateIntents ?? []);
      setForbiddenTopics(policy.forbiddenTopics ?? []);
      setDisabledLearningIntents(policy.disabledLearningIntents ?? []);
    }
  }, [policy]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<TrainingPolicy>) => {
      return apiRequest("PUT", "/api/admin/training-policies", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/training-policies"] });
      toast({ title: "Политики обучения сохранены" });
    },
    onError: () => {
      toast({ title: "Не удалось сохранить политики", variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      alwaysEscalateIntents,
      forbiddenTopics,
      disabledLearningIntents,
    });
  };

  const toggleAlwaysEscalateIntent = (intent: string) => {
    setAlwaysEscalateIntents(prev =>
      prev.includes(intent)
        ? prev.filter(i => i !== intent)
        : [...prev, intent]
    );
  };

  const toggleDisabledLearningIntent = (intent: string) => {
    setDisabledLearningIntents(prev =>
      prev.includes(intent)
        ? prev.filter(i => i !== intent)
        : [...prev, intent]
    );
  };

  const addForbiddenTopic = () => {
    if (newForbiddenTopic.trim() && !forbiddenTopics.includes(newForbiddenTopic.trim())) {
      setForbiddenTopics(prev => [...prev, newForbiddenTopic.trim()]);
      setNewForbiddenTopic("");
    }
  };

  const removeForbiddenTopic = (topic: string) => {
    setForbiddenTopics(prev => prev.filter(t => t !== topic));
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Политики обучения AI</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Политики обучения AI
          <Badge variant="outline" className="font-normal">Обучение</Badge>
        </CardTitle>
        <CardDescription>
          Настройка правил обучения и поведения AI
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Интенты → требовать одобрения (NEED_APPROVAL)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Понижает AUTO_SEND до ручной проверки — NOT эскалация, просто требует одобрения оператора
            </p>
            <div className="flex flex-wrap gap-2">
              {INTENT_OPTIONS.filter(i => autoPartsEnabled || !AUTO_PARTS_INTENTS.has(i.value)).map((intent) => (
                <Badge
                  key={intent.value}
                  variant={alwaysEscalateIntents.includes(intent.value) ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer",
                    alwaysEscalateIntents.includes(intent.value) && "bg-orange-500/20 text-orange-700 dark:text-orange-300"
                  )}
                  onClick={() => toggleAlwaysEscalateIntent(intent.value)}
                  data-testid={`badge-always-escalate-${intent.value}`}
                >
                  {intent.label}
                </Badge>
              ))}
            </div>
          </div>

          <Separator />

          <div>
            <Label className="mb-2 block">Интенты исключённые из обучения</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Ответы с этими интентами не будут использоваться в few-shot примерах для AI
            </p>
            <div className="flex flex-wrap gap-2">
              {INTENT_OPTIONS.filter(i => autoPartsEnabled || !AUTO_PARTS_INTENTS.has(i.value)).map((intent) => (
                <Badge
                  key={intent.value}
                  variant={disabledLearningIntents.includes(intent.value) ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer",
                    disabledLearningIntents.includes(intent.value) && "bg-purple-500/20 text-purple-700 dark:text-purple-300"
                  )}
                  onClick={() => toggleDisabledLearningIntent(intent.value)}
                  data-testid={`badge-disabled-learning-${intent.value}`}
                >
                  {intent.label}
                </Badge>
              ))}
            </div>
          </div>

          <Separator />

          <div>
            <Label className="mb-2 block">Запрещённые темы</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Разговоры содержащие эти слова не будут сохраняться в обучающий датасет
            </p>
            <div className="flex gap-2 mb-2">
              <Input
                placeholder="Введите тему для исключения..."
                value={newForbiddenTopic}
                onChange={(e) => setNewForbiddenTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addForbiddenTopic())}
                data-testid="input-forbidden-topic"
              />
              <Button
                variant="outline"
                onClick={addForbiddenTopic}
                disabled={!newForbiddenTopic.trim()}
                data-testid="button-add-forbidden-topic"
              >
                Добавить
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {forbiddenTopics.map((topic) => (
                <Badge
                  key={topic}
                  variant="secondary"
                  className="cursor-pointer bg-red-500/10 text-red-700 dark:text-red-300"
                  onClick={() => removeForbiddenTopic(topic)}
                  data-testid={`badge-forbidden-${topic}`}
                >
                  {topic}
                  <XCircle className="ml-1 h-3 w-3" />
                </Badge>
              ))}
              {forbiddenTopics.length === 0 && (
                <span className="text-xs text-muted-foreground">Нет запрещённых тем</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            data-testid="button-save-training-policies"
          >
            <Save className="mr-2 h-4 w-4" />
            Сохранить политики
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface ChannelStatus {
  channel: string;
  enabled: boolean;
  connected: boolean;
  lastError?: string;
  botInfo?: {
    user_id?: number;
    first_name?: string;
    username?: string;
  };
}

type AuthStep = "idle" | "method-select" | "phone-input" | "phone-code" | "qr" | "2fa" | "success";

interface TelegramBotCardProps {
  channelStatuses?: ChannelStatus[];
  featureFlags?: Record<string, boolean>;
  toggleChannelMutation: ReturnType<typeof useMutation<any, any, { channel: string; enabled: boolean }>>;
  testConnection: (channel: string, token?: string) => Promise<void>;
  saveConfigMutation: ReturnType<typeof useMutation<any, any, { channel: string; token?: string; webhookSecret?: string }>>;
  testingConnection: boolean;
}

function TelegramBotCard({ 
  channelStatuses, 
  featureFlags, 
  toggleChannelMutation, 
  testConnection,
  saveConfigMutation,
  testingConnection 
}: TelegramBotCardProps) {
  const [botToken, setBotToken] = useState("");

  const telegramStatus = channelStatuses?.find(c => c.channel === "telegram");
  const telegramEnabled = featureFlags?.TELEGRAM_CHANNEL_ENABLED ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          Telegram Bot
          {telegramStatus?.connected ? (
            <Badge variant="outline" className="bg-green-500/10 text-green-600">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Подключен
            </Badge>
          ) : telegramEnabled ? (
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600">
              <AlertCircle className="mr-1 h-3 w-3" />
              Не настроен
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-muted text-muted-foreground">
              <XCircle className="mr-1 h-3 w-3" />
              Отключен
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Подключите Telegram бота для автоматических ответов клиентам
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-md border p-4">
          <div>
            <Label>Включить Telegram Bot</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Использовать бота для автоматических ответов
            </p>
          </div>
          <Switch
            checked={telegramEnabled}
            onCheckedChange={(checked) => toggleChannelMutation.mutate({ channel: "telegram", enabled: checked })}
            disabled={toggleChannelMutation.isPending}
            data-testid="switch-telegram-bot-enabled"
          />
        </div>

        {telegramEnabled && (
          <>
            <Separator />

            {telegramStatus?.connected && telegramStatus.botInfo && (
              <div className="rounded-md bg-green-500/10 p-4">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">Бот подключен</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Имя: {telegramStatus.botInfo.first_name || "N/A"} 
                  {telegramStatus.botInfo.username && ` (@${telegramStatus.botInfo.username})`}
                </p>
              </div>
            )}

            {telegramStatus?.lastError && (
              <div className="rounded-md bg-red-500/10 p-4">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                  <XCircle className="h-5 w-5" />
                  <span className="font-medium">Ошибка подключения</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{telegramStatus.lastError}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <Label htmlFor="telegram-bot-token">Токен бота</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Получите токен у @BotFather в Telegram
                </p>
                <Input
                  id="telegram-bot-token"
                  type="password"
                  placeholder={telegramStatus?.connected ? "••••••••" : "Введите токен бота"}
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  data-testid="input-telegram-bot-token"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => testConnection("telegram", botToken)}
                disabled={testingConnection || (!botToken && !telegramStatus?.connected)}
                data-testid="button-test-telegram-connection"
              >
                {testingConnection ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Проверить подключение
              </Button>
              <Button
                onClick={() => saveConfigMutation.mutate({ 
                  channel: "telegram", 
                  token: botToken || undefined
                })}
                disabled={saveConfigMutation.isPending || !botToken}
                data-testid="button-save-telegram-config"
              >
                <Save className="mr-2 h-4 w-4" />
                Сохранить
              </Button>
            </div>

            <Separator />

            <div>
              <Label>Webhook URL</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Установите этот URL как webhook для бота через @BotFather или Bot API
              </p>
              <code className="block rounded-md bg-muted px-3 py-2 text-sm font-mono break-all">
                {window.location.origin}/webhooks/telegram
              </code>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface TelegramAccount {
  id: string;
  phoneNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  userId: string | null;
  status: string;
  authMethod: string | null;
  isEnabled: boolean;
  isConnected: boolean;
  createdAt: string;
}

interface TelegramPersonalCardProps {
  channelStatuses?: ChannelStatus[];
  featureFlags?: Record<string, boolean>;
  toggleChannelMutation: ReturnType<typeof useMutation<any, any, { channel: string; enabled: boolean }>>;
  refetch: () => void;
}

function TelegramPersonalCard({ channelStatuses, featureFlags, toggleChannelMutation, refetch }: TelegramPersonalCardProps) {
  const { toast } = useToast();
  const [authStep, setAuthStep] = useState<AuthStep>("idle");
  const [password, setPassword] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);
  const [qrImageDataUrl, setQrImageDataUrl] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [codeResendTimer, setCodeResendTimer] = useState(0);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const resendTimerRef = useRef<NodeJS.Timeout | null>(null);

  const telegramPersonalEnabled = featureFlags?.TELEGRAM_PERSONAL_CHANNEL_ENABLED ?? false;

  // Fetch accounts list
  const { data: accountsData, refetch: refetchAccounts } = useQuery({
    queryKey: ["/api/telegram-personal/accounts"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/telegram-personal/accounts");
      return response.json();
    },
    enabled: telegramPersonalEnabled,
    refetchInterval: 10000,
  });

  const accounts: TelegramAccount[] = accountsData?.accounts ?? [];
  const activeAccounts = accounts.filter(a => a.status === "active");
  const hasConnected = activeAccounts.some(a => a.isConnected);

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const startResendTimer = () => {
    setCodeResendTimer(60);
    if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    resendTimerRef.current = setInterval(() => {
      setCodeResendTimer(prev => {
        if (prev <= 1) {
          if (resendTimerRef.current) clearInterval(resendTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const resetAuthState = () => {
    stopPolling();
    setAuthStep("idle");
    setSessionId(null);
    setCurrentAccountId(null);
    setQrImageDataUrl(null);
    setQrExpiresAt(null);
    setPassword("");
    setPhoneNumber("");
    setPhoneCode("");
    setCodeResendTimer(0);
    if (resendTimerRef.current) clearInterval(resendTimerRef.current);
  };

  // --- Phone auth flow ---
  const startPhoneAuth = async () => {
    if (!phoneNumber.trim()) {
      toast({ title: "Введите номер телефона", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/api/telegram-personal/accounts/send-code", { phoneNumber });
      const result = await response.json();

      if (result.success) {
        setSessionId(result.sessionId);
        setCurrentAccountId(result.accountId);
        setAuthStep("phone-code");
        startResendTimer();
        toast({ title: "Код отправлен", description: "Проверьте Telegram или SMS" });
      } else {
        toast({ title: "Ошибка", description: result.error, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Ошибка", description: error.message || "Не удалось отправить код", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const verifyPhoneCode = async () => {
    if (!phoneCode.trim() || phoneCode.length < 5) {
      toast({ title: "Введите код", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/api/telegram-personal/accounts/verify-code", {
        accountId: currentAccountId,
        sessionId,
        phoneNumber,
        code: phoneCode,
      });
      const result = await response.json();

      if (result.success) {
        setAuthStep("success");
        toast({ title: "Авторизация успешна", description: `Аккаунт подключен` });
        refetchAccounts();
        refetch();
      } else if (result.needs2FA) {
        setAuthStep("2fa");
        toast({ title: "Требуется 2FA", description: "Введите пароль двухфакторной аутентификации" });
      } else {
        toast({ title: "Ошибка", description: result.error, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Ошибка", description: error.message || "Неверный код", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const verify2FA = async () => {
    if (!password.trim()) {
      toast({ title: "Введите пароль", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const is2FAForQr = authStep === "2fa" && sessionId?.startsWith("tg_qr_");
      const url = is2FAForQr
        ? "/api/telegram-personal/accounts/verify-qr-2fa"
        : "/api/telegram-personal/accounts/verify-password";

      const response = await apiRequest("POST", url, {
        accountId: currentAccountId,
        sessionId,
        password,
      });
      const result = await response.json();

      if (result.success) {
        setAuthStep("success");
        toast({ title: "Авторизация успешна" });
        refetchAccounts();
        refetch();
      } else {
        toast({ title: "Ошибка", description: result.error || "Неверный пароль", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Ошибка", description: error.message || "Не удалось проверить пароль", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // --- QR auth flow ---
  const startQrAuth = async () => {
    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/api/telegram-personal/accounts/start-qr", {});
      const result = await response.json();

      if (result.success) {
        setSessionId(result.sessionId);
        setCurrentAccountId(result.accountId);
        setQrImageDataUrl(result.qrImageDataUrl);
        setQrExpiresAt(result.expiresAt);
        setAuthStep("qr");
        pollIntervalRef.current = setInterval(() => checkQrAuth(result.sessionId, result.accountId), 2000);
      } else {
        toast({ title: "Ошибка", description: result.error, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Ошибка", description: error.message || "Не удалось получить QR-код", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const checkQrAuth = async (sid: string, accId: string) => {
    try {
      const response = await apiRequest("POST", "/api/telegram-personal/accounts/check-qr", {
        sessionId: sid,
        accountId: accId,
      });
      const result = await response.json();

      if (result.status === "authorized") {
        stopPolling();
        setAuthStep("success");
        toast({ title: "Авторизация успешна" });
        refetchAccounts();
        refetch();
      } else if (result.status === "needs_2fa") {
        stopPolling();
        setAuthStep("2fa");
        toast({ title: "Требуется 2FA" });
      } else if (result.status === "expired") {
        stopPolling();
        toast({ title: "QR-код истек", variant: "destructive" });
        resetAuthState();
      } else if (result.qrImageDataUrl) {
        setQrImageDataUrl(result.qrImageDataUrl);
        setQrExpiresAt(result.expiresAt);
      }
    } catch {
      // Ignore polling errors
    }
  };

  const cancelAuth = async () => {
    stopPolling();
    if (sessionId) {
      try {
        await apiRequest("POST", "/api/telegram-personal/accounts/cancel-auth", {
          sessionId,
          accountId: currentAccountId,
        });
      } catch {}
    }
    resetAuthState();
  };

  // --- Account management ---
  const deleteAccount = async (accountId: string) => {
    try {
      await apiRequest("DELETE", `/api/telegram-personal/accounts/${accountId}`);
      toast({ title: "Аккаунт удалён" });
      refetchAccounts();
      refetch();
    } catch (error: any) {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    }
  };

  const toggleAccount = async (accountId: string, enabled: boolean) => {
    try {
      await apiRequest("PATCH", `/api/telegram-personal/accounts/${accountId}`, { isEnabled: enabled });
      toast({ title: enabled ? "Аккаунт включен" : "Аккаунт отключен" });
      refetchAccounts();
    } catch (error: any) {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    }
  };

  useEffect(() => {
    return () => {
      stopPolling();
      if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    };
  }, []);

  // Auto-submit phone code when 5+ digits entered
  useEffect(() => {
    if (authStep === "phone-code" && phoneCode.length >= 5 && !isLoading) {
      verifyPhoneCode();
    }
  }, [phoneCode]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Telegram Personal
          {hasConnected ? (
            <Badge variant="outline" className="bg-green-500/10 text-green-600">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              {activeAccounts.length} акк.
            </Badge>
          ) : telegramPersonalEnabled ? (
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600">
              <AlertCircle className="mr-1 h-3 w-3" />
              Не настроен
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-muted text-muted-foreground">
              <XCircle className="mr-1 h-3 w-3" />
              Отключен
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Подключите личные аккаунты Telegram для отправки сообщений клиентам
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-md border p-4">
          <div>
            <Label>Включить Telegram Personal</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Использовать личные аккаунты для переписки
            </p>
          </div>
          <Switch
            checked={telegramPersonalEnabled}
            onCheckedChange={(checked) => toggleChannelMutation.mutate({ channel: "telegram_personal", enabled: checked })}
            disabled={toggleChannelMutation.isPending}
            data-testid="switch-telegram-personal-enabled"
          />
        </div>

        {telegramPersonalEnabled && (
          <>
            {/* Account list */}
            {accounts.length > 0 && authStep === "idle" && (
              <div className="space-y-2">
                {accounts.filter(a => a.status === "active").map(account => (
                  <div key={account.id} className="rounded-md border p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn(
                        "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
                        account.isConnected ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"
                      )}>
                        <User className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {account.firstName || account.phoneNumber || "Telegram"}
                          {account.username ? ` (@${account.username})` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {account.isConnected ? "Активен" : account.isEnabled ? "Отключен от сервера" : "Выключен"}
                          {account.authMethod === "phone" ? " · Телефон" : account.authMethod === "qr" ? " · QR" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => toggleAccount(account.id, !account.isEnabled)}
                        title={account.isEnabled ? "Выключить" : "Включить"}
                      >
                        {account.isEnabled ? <Power className="h-4 w-4 text-green-600" /> : <PowerOff className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => deleteAccount(account.id)}
                        title="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add account or auth flow */}
            {authStep === "idle" ? (
              <Button
                variant="outline"
                onClick={() => setAuthStep("method-select")}
                disabled={accounts.filter(a => a.status === "active").length >= 5}
                data-testid="button-telegram-add-account"
              >
                <Plus className="mr-2 h-4 w-4" />
                Добавить аккаунт
              </Button>
            ) : authStep === "method-select" ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">Выберите способ авторизации</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    className="rounded-lg border-2 border-muted p-4 hover:border-primary transition-colors text-left"
                    onClick={() => setAuthStep("phone-input")}
                  >
                    <Phone className="h-6 w-6 mb-2 text-primary" />
                    <p className="font-medium text-sm">По номеру телефона</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Код подтверждения придёт в Telegram или SMS
                    </p>
                  </button>
                  <button
                    className="rounded-lg border-2 border-muted p-4 hover:border-primary transition-colors text-left"
                    onClick={startQrAuth}
                    disabled={isLoading}
                  >
                    <QrCode className="h-6 w-6 mb-2 text-primary" />
                    <p className="font-medium text-sm">По QR-коду</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Отсканируйте в приложении Telegram
                    </p>
                  </button>
                </div>
                <Button variant="ghost" size="sm" onClick={resetAuthState}>
                  Отмена
                </Button>
              </div>
            ) : authStep === "phone-input" ? (
              <div className="space-y-4">
                <div>
                  <Label className="mb-2 block">Номер телефона</Label>
                  <Input
                    type="tel"
                    placeholder="+7 999 123 45 67"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && startPhoneAuth()}
                    data-testid="input-telegram-phone"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    В международном формате, например: +79991234567
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={startPhoneAuth} disabled={isLoading || !phoneNumber.trim()}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Smartphone className="mr-2 h-4 w-4" />}
                    Получить код
                  </Button>
                  <Button variant="outline" onClick={resetAuthState} disabled={isLoading}>Отмена</Button>
                </div>
              </div>
            ) : authStep === "phone-code" ? (
              <div className="space-y-4">
                <div>
                  <Label className="mb-2 block">Код подтверждения</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="12345"
                    maxLength={6}
                    value={phoneCode}
                    onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, ""))}
                    data-testid="input-telegram-code"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Код отправлен на {phoneNumber}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={verifyPhoneCode} disabled={isLoading || phoneCode.length < 5}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    Подтвердить
                  </Button>
                  {codeResendTimer > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      Повторно через {codeResendTimer} сек
                    </span>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={startPhoneAuth} disabled={isLoading}>
                      Отправить повторно
                    </Button>
                  )}
                  <Button variant="outline" onClick={cancelAuth} disabled={isLoading}>Отмена</Button>
                </div>
              </div>
            ) : authStep === "qr" ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center">
                  {qrImageDataUrl ? (
                    <div className="p-4 bg-white rounded-lg">
                      <img
                        src={qrImageDataUrl}
                        alt="QR код для авторизации"
                        className="w-64 h-64"
                        data-testid="img-telegram-qr"
                      />
                    </div>
                  ) : (
                    <div className="w-64 h-64 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground mt-4 text-center">
                    Откройте Telegram → Настройки → Устройства → Подключить устройство
                  </p>
                  {qrExpiresAt && (
                    <p className="text-xs text-muted-foreground">Код обновляется автоматически</p>
                  )}
                </div>
                <div className="flex justify-center">
                  <Button variant="outline" onClick={cancelAuth}>Отмена</Button>
                </div>
              </div>
            ) : authStep === "2fa" ? (
              <div className="space-y-4">
                <div>
                  <Label className="mb-2 block">Пароль 2FA</Label>
                  <Input
                    type="password"
                    placeholder="Пароль двухфакторной аутентификации"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && verify2FA()}
                    data-testid="input-telegram-2fa"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Введите облачный пароль из настроек безопасности Telegram
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={verify2FA} disabled={isLoading} data-testid="button-telegram-verify-2fa">
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                    Подтвердить
                  </Button>
                  <Button variant="outline" onClick={cancelAuth} disabled={isLoading}>Отмена</Button>
                </div>
              </div>
            ) : authStep === "success" ? (
              <div className="rounded-md border p-4 bg-green-500/5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="font-medium">Аккаунт успешно подключен!</p>
                    <p className="text-sm text-muted-foreground">Входящие сообщения будут приходить автоматически</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="mt-3" onClick={resetAuthState}>
                  Готово
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface WhatsAppCardProps {
  channelStatuses?: ChannelStatus[];
  featureFlags?: Record<string, boolean>;
  toggleChannelMutation: ReturnType<typeof useMutation<any, any, { channel: string; enabled: boolean }>>;
  testConnection: (channel: string, token?: string) => Promise<void>;
  saveWhatsAppConfigMutation: ReturnType<typeof useMutation<any, any, { accessToken?: string; phoneNumberId?: string; verifyToken?: string; appSecret?: string }>>;
  testingConnection: boolean;
}

function WhatsAppCard({ 
  channelStatuses, 
  featureFlags, 
  toggleChannelMutation, 
  testConnection,
  saveWhatsAppConfigMutation,
  testingConnection 
}: WhatsAppCardProps) {
  const [accessToken, setAccessToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [appSecret, setAppSecret] = useState("");

  const whatsappStatus = channelStatuses?.find(c => c.channel === "whatsapp");
  const whatsappEnabled = featureFlags?.WHATSAPP_CHANNEL_ENABLED ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          WhatsApp Business
          {whatsappStatus?.connected ? (
            <Badge variant="outline" className="bg-green-500/10 text-green-600">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Подключен
            </Badge>
          ) : whatsappEnabled ? (
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600">
              <AlertCircle className="mr-1 h-3 w-3" />
              Не настроен
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-muted text-muted-foreground">
              <XCircle className="mr-1 h-3 w-3" />
              Отключен
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Интеграция с WhatsApp Business API для приема и отправки сообщений
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-md border p-4">
          <div>
            <Label>Включить WhatsApp Business</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Разрешить прием сообщений через WhatsApp
            </p>
          </div>
          <Switch
            checked={whatsappEnabled}
            onCheckedChange={(checked) => toggleChannelMutation.mutate({ channel: "whatsapp", enabled: checked })}
            disabled={toggleChannelMutation.isPending}
            data-testid="switch-whatsapp-enabled"
          />
        </div>

        {whatsappEnabled && (
          <>
            <Separator />

            {whatsappStatus?.connected && (
              <div className="rounded-md bg-green-500/10 p-4">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">WhatsApp подключен</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Готов к приему и отправке сообщений
                </p>
              </div>
            )}

            {whatsappStatus?.lastError && (
              <div className="rounded-md bg-red-500/10 p-4">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                  <XCircle className="h-5 w-5" />
                  <span className="font-medium">Ошибка подключения</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{whatsappStatus.lastError}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <Label htmlFor="whatsapp-access-token">Access Token</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Токен доступа из Meta Business Suite (developers.facebook.com)
                </p>
                <Input
                  id="whatsapp-access-token"
                  type="password"
                  placeholder={whatsappStatus?.connected ? "••••••••" : "Введите access token"}
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  data-testid="input-whatsapp-access-token"
                />
              </div>

              <div>
                <Label htmlFor="whatsapp-phone-number-id">Phone Number ID</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  ID номера телефона из WhatsApp Business API
                </p>
                <Input
                  id="whatsapp-phone-number-id"
                  type="text"
                  placeholder={whatsappStatus?.connected ? "••••••••" : "Введите Phone Number ID"}
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  data-testid="input-whatsapp-phone-number-id"
                />
              </div>

              <div>
                <Label htmlFor="whatsapp-verify-token">Verify Token</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Токен для верификации webhook (произвольная строка)
                </p>
                <Input
                  id="whatsapp-verify-token"
                  type="password"
                  placeholder="Токен верификации webhook"
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  data-testid="input-whatsapp-verify-token"
                />
              </div>

              <div>
                <Label htmlFor="whatsapp-app-secret">App Secret (опционально)</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Секрет приложения для проверки подписи webhook (HMAC-SHA256)
                </p>
                <Input
                  id="whatsapp-app-secret"
                  type="password"
                  placeholder="Опциональный секрет приложения"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  data-testid="input-whatsapp-app-secret"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => testConnection("whatsapp", accessToken)}
                disabled={testingConnection || (!accessToken && !whatsappStatus?.connected)}
                data-testid="button-test-whatsapp-connection"
              >
                {testingConnection ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Проверить подключение
              </Button>
              <Button
                onClick={() => saveWhatsAppConfigMutation.mutate({ 
                  accessToken: accessToken || undefined,
                  phoneNumberId: phoneNumberId || undefined,
                  verifyToken: verifyToken || undefined,
                  appSecret: appSecret || undefined
                })}
                disabled={saveWhatsAppConfigMutation.isPending || (!accessToken && !phoneNumberId)}
                data-testid="button-save-whatsapp-config"
              >
                <Save className="mr-2 h-4 w-4" />
                Сохранить конфигурацию
              </Button>
            </div>

            <Separator />

            <div>
              <Label>Webhook URL</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Укажите этот URL в настройках WhatsApp Business API на Meta for Developers
              </p>
              <code className="block rounded-md bg-muted px-3 py-2 text-sm font-mono break-all">
                {window.location.origin}/webhooks/whatsapp
              </code>
            </div>

            <div className="rounded-md bg-muted/50 p-4">
              <p className="text-sm text-muted-foreground">
                <strong>Важно:</strong> WhatsApp Business API позволяет отправлять произвольные сообщения только в течение 24 часов после последнего сообщения от клиента. 
                После этого периода можно отправлять только шаблонные сообщения (Template Messages).
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface WhatsAppPersonalCardProps {
  channelStatuses?: ChannelStatus[];
  featureFlags?: Record<string, boolean>;
  toggleChannelMutation: ReturnType<typeof useMutation<any, any, { channel: string; enabled: boolean }>>;
  refetch: () => void;
}

type WhatsAppAuthStatus = "disconnected" | "connecting" | "qr_ready" | "pairing_code_ready" | "connected" | "error" | "reconnecting";
type WhatsAppAuthMethod = "qr" | "phone";

function MaxPersonalCard({ channelStatuses }: Pick<WhatsAppPersonalCardProps, "channelStatuses">) {
  const maxPersonalStatus = channelStatuses?.find(c => c.channel === "max_personal");
  const isConnected = maxPersonalStatus?.connected ?? false;
  const accounts: Array<{ displayName?: string | null; label?: string | null }> =
    (maxPersonalStatus as any)?.accounts ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Max Personal
          {isConnected ? (
            <Badge variant="outline" className="bg-green-500/10 text-green-600">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Подключен
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-muted text-muted-foreground">
              <XCircle className="mr-1 h-3 w-3" />
              Не подключен
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Личный аккаунт MAX через GREEN-API
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isConnected ? (
          <div className="space-y-2">
            {accounts.map((acc, idx) => (
              <div key={idx} className="rounded-md border p-3 bg-green-500/5 flex items-center gap-3">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <div>
                  <p className="font-medium text-sm">
                    {acc.displayName ?? `Аккаунт ${idx + 1}`}
                    {acc.label ? <span className="text-muted-foreground font-normal"> ({acc.label})</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">Статус: авторизован</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border p-4 flex items-start gap-3">
            <XCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-muted-foreground">Не подключён</p>
              <p className="text-sm text-muted-foreground mt-1">
                Обратитесь к администратору платформы для подключения MAX-аккаунта
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WhatsAppPersonalCard({ channelStatuses, featureFlags, toggleChannelMutation, refetch }: WhatsAppPersonalCardProps) {
  const { toast } = useToast();
  const [authStatus, setAuthStatus] = useState<WhatsAppAuthStatus>("disconnected");
  const [authMethod, setAuthMethod] = useState<WhatsAppAuthMethod | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [connectedUser, setConnectedUser] = useState<{ id: string; name: string; phone: string } | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const whatsappPersonalStatus = channelStatuses?.find(c => c.channel === "whatsapp_personal");
  const whatsappPersonalEnabled = featureFlags?.WHATSAPP_PERSONAL_CHANNEL_ENABLED ?? false;

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const startAuth = async () => {
    setIsLoading(true);
    setAuthMethod("qr");
    try {
      const response = await apiRequest("POST", "/api/whatsapp-personal/start-auth", {});
      const result = await response.json();
      
      if (result.success) {
        if (result.status === "connected") {
          setAuthStatus("connected");
          toast({ title: "Подключение успешно", description: "WhatsApp аккаунт уже авторизован" });
          refetch();
        } else if (result.qrDataUrl) {
          setQrDataUrl(result.qrDataUrl);
          setAuthStatus("qr_ready");
          pollIntervalRef.current = setInterval(checkAuth, 2000);
        }
      } else {
        toast({ title: "Ошибка", description: result.error, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Ошибка", description: error.message || "Не удалось начать авторизацию", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const startAuthWithPhone = async () => {
    if (!phoneNumber.trim()) {
      toast({ title: "Ошибка", description: "Введите номер телефона", variant: "destructive" });
      return;
    }
    
    setIsLoading(true);
    setAuthMethod("phone");
    try {
      const response = await apiRequest("POST", "/api/whatsapp-personal/start-auth-phone", { phoneNumber });
      const result = await response.json();
      
      if (result.success) {
        if (result.status === "connected") {
          setAuthStatus("connected");
          toast({ title: "Подключение успешно", description: "WhatsApp аккаунт уже авторизован" });
          refetch();
        } else if (result.pairingCode) {
          setPairingCode(result.pairingCode);
          setAuthStatus("pairing_code_ready");
          pollIntervalRef.current = setInterval(checkAuth, 2000);
        }
      } else {
        toast({ title: "Ошибка", description: result.error, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Ошибка", description: error.message || "Не удалось начать авторизацию", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const checkAuth = async () => {
    try {
      const response = await apiRequest("POST", "/api/whatsapp-personal/check-auth", {});
      const result = await response.json();
      
      if (result.status === "connected") {
        stopPolling();
        setConnectedUser(result.user);
        setAuthStatus("connected");
        toast({ title: "Авторизация успешна", description: `Аккаунт: ${result.user?.name || result.user?.phone || "подключен"}` });
        refetch();
      } else if (result.status === "qr_ready" && result.qrDataUrl) {
        setQrDataUrl(result.qrDataUrl);
        setAuthStatus("qr_ready");
      } else if (result.status === "pairing_code_ready" && result.pairingCode) {
        setPairingCode(result.pairingCode);
        setAuthStatus("pairing_code_ready");
      } else if (result.status === "connecting") {
        setAuthStatus("connecting");
      } else if (result.status === "error" || result.status === "disconnected") {
        stopPolling();
        setAuthStatus("disconnected");
        if (result.error) {
          toast({ title: "Ошибка", description: result.error, variant: "destructive" });
        }
      }
    } catch {
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/whatsapp-personal/logout", {});
      setAuthStatus("disconnected");
      setConnectedUser(null);
      setQrDataUrl(null);
      setPairingCode(null);
      setAuthMethod(null);
      toast({ title: "Выход выполнен" });
      refetch();
    } catch (error: any) {
      toast({ title: "Ошибка", description: error.message || "Не удалось выйти", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const cancelAuth = () => {
    stopPolling();
    setAuthStatus("disconnected");
    setQrDataUrl(null);
    setPairingCode(null);
    setAuthMethod(null);
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  const isConnected = whatsappPersonalStatus?.connected || authStatus === "connected";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5" />
          WhatsApp Personal
          {isConnected ? (
            <Badge variant="outline" className="bg-green-500/10 text-green-600">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Подключен
            </Badge>
          ) : whatsappPersonalEnabled ? (
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600">
              <AlertCircle className="mr-1 h-3 w-3" />
              Не настроен
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-muted text-muted-foreground">
              <XCircle className="mr-1 h-3 w-3" />
              Отключен
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Подключите личный аккаунт WhatsApp через QR-код или номер телефона
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-md border p-4">
          <div>
            <Label>Включить WhatsApp Personal</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Использовать личный аккаунт для переписки
            </p>
          </div>
          <Switch
            checked={whatsappPersonalEnabled}
            onCheckedChange={(checked) => toggleChannelMutation.mutate({ channel: "whatsapp_personal", enabled: checked })}
            disabled={toggleChannelMutation.isPending}
            data-testid="switch-whatsapp-personal-enabled"
          />
        </div>

        {whatsappPersonalEnabled && (
          <>
            <div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div>
                  <p className="font-medium text-yellow-700 dark:text-yellow-400">Важное предупреждение</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Это неофициальный метод интеграции. WhatsApp может ограничить или заблокировать аккаунт при подозрительной активности. Используйте с осторожностью.
                  </p>
                </div>
              </div>
            </div>

            {isConnected && connectedUser ? (
              <div className="rounded-md border p-4 bg-green-500/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="font-medium">Аккаунт подключен</p>
                      <p className="text-sm text-muted-foreground">
                        {connectedUser.name || connectedUser.phone}
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={logout} disabled={isLoading}>
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Отключить"}
                  </Button>
                </div>
              </div>
            ) : whatsappPersonalStatus?.connected && whatsappPersonalStatus.botInfo ? (
              <div className="rounded-md border p-4 bg-green-500/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="font-medium">Аккаунт подключен</p>
                      <p className="text-sm text-muted-foreground">
                        {whatsappPersonalStatus.botInfo.first_name}
                        {whatsappPersonalStatus.botInfo.username && ` (+${whatsappPersonalStatus.botInfo.username})`}
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={logout} disabled={isLoading}>
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Отключить"}
                  </Button>
                </div>
              </div>
            ) : authStatus === "disconnected" ? (
              <div className="space-y-4">
                <div className="rounded-md border p-4 bg-muted/30">
                  <p className="text-sm mb-3">
                    Выберите способ подключения WhatsApp аккаунта:
                  </p>
                </div>
                
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-md border p-4 space-y-3">
                    <h4 className="font-medium text-sm">Через QR-код</h4>
                    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>Откройте WhatsApp на телефоне</li>
                      <li>Настройки - Связанные устройства</li>
                      <li>Нажмите "Привязать устройство"</li>
                      <li>Отсканируйте QR-код</li>
                    </ol>
                    <Button onClick={startAuth} disabled={isLoading} className="w-full" data-testid="button-whatsapp-start-qr">
                      {isLoading && authMethod === "qr" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Smartphone className="mr-2 h-4 w-4" />
                      )}
                      Получить QR-код
                    </Button>
                  </div>
                  
                  <div className="rounded-md border p-4 space-y-3">
                    <h4 className="font-medium text-sm">По номеру телефона</h4>
                    <p className="text-xs text-muted-foreground">
                      Введите номер телефона WhatsApp и получите код для ввода в приложении
                    </p>
                    <Input
                      placeholder="+7 999 123 45 67"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      data-testid="input-whatsapp-phone"
                    />
                    <Button onClick={startAuthWithPhone} disabled={isLoading || !phoneNumber.trim()} className="w-full" data-testid="button-whatsapp-start-phone">
                      {isLoading && authMethod === "phone" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Smartphone className="mr-2 h-4 w-4" />
                      )}
                      Получить код
                    </Button>
                  </div>
                </div>
              </div>
            ) : authStatus === "qr_ready" || (authStatus === "connecting" && authMethod === "qr") ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center">
                  {authStatus === "connecting" ? (
                    <div className="w-64 h-64 flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <p className="text-sm text-muted-foreground">Обновление QR-кода...</p>
                    </div>
                  ) : qrDataUrl ? (
                    <div className="p-4 bg-white rounded-lg">
                      <img 
                        src={qrDataUrl} 
                        alt="QR код для авторизации WhatsApp" 
                        className="w-64 h-64"
                        data-testid="img-whatsapp-qr"
                      />
                    </div>
                  ) : (
                    <div className="w-64 h-64 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground mt-4 text-center">
                    Отсканируйте QR-код в приложении WhatsApp
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Код обновляется автоматически каждые 20 сек
                  </p>
                </div>
                <div className="flex justify-center">
                  <Button variant="outline" onClick={cancelAuth}>
                    Отмена
                  </Button>
                </div>
              </div>
            ) : authStatus === "pairing_code_ready" || (authStatus === "connecting" && authMethod === "phone") ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center">
                  {authStatus === "connecting" ? (
                    <div className="h-32 flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <p className="text-sm text-muted-foreground">Подключение...</p>
                    </div>
                  ) : pairingCode ? (
                    <div className="text-center space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Введите этот код в WhatsApp:
                      </p>
                      <div className="text-4xl font-mono font-bold tracking-widest bg-muted p-4 rounded-lg" data-testid="text-pairing-code">
                        {pairingCode.slice(0, 4)}-{pairingCode.slice(4)}
                      </div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p>1. Откройте WhatsApp - Настройки - Связанные устройства</p>
                        <p>2. Нажмите "Привязать устройство"</p>
                        <p>3. Выберите "Связать по номеру телефона"</p>
                        <p>4. Введите код выше</p>
                      </div>
                    </div>
                  ) : (
                    <div className="h-32 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex justify-center">
                  <Button variant="outline" onClick={cancelAuth}>
                    Отмена
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ChannelSettings() {
  const { toast } = useToast();
  const [maxToken, setMaxToken] = useState("");
  const [maxWebhookSecret, setMaxWebhookSecret] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  const { data: billingStatus } = useBillingStatus();
  const canAccess = billingStatus?.canAccess ?? false;

  const { data: channelStatuses, isLoading, refetch } = useQuery<ChannelStatus[]>({
    queryKey: ["/api/channels/status"],
  });

  const { data: featureFlags } = useQuery<Record<string, boolean>>({
    queryKey: ["/api/channels/feature-flags"],
  });

  const toggleChannelMutation = useMutation({
    mutationFn: async ({ channel, enabled }: { channel: string; enabled: boolean }) => {
      return apiRequest("POST", `/api/channels/${channel}/toggle`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channels/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/channels/feature-flags"] });
      toast({ title: "Настройки канала обновлены" });
    },
    onError: async (error: any) => {
      if (error?.response) {
        try {
          const data = await error.response.json();
          if (isSubscriptionRequired(data)) {
            setShowPaywall(true);
            return;
          }
        } catch {}
      }
      toast({ title: "Не удалось обновить настройки канала", variant: "destructive" });
    },
  });

  const saveConfigMutation = useMutation({
    mutationFn: async (config: { channel: string; token?: string; webhookSecret?: string }) => {
      return apiRequest("POST", `/api/channels/${config.channel}/config`, config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channels/status"] });
      toast({ title: "Конфигурация сохранена" });
      setMaxToken("");
      setMaxWebhookSecret("");
    },
    onError: () => {
      toast({ title: "Не удалось сохранить конфигурацию", variant: "destructive" });
    },
  });

  const saveWhatsAppConfigMutation = useMutation({
    mutationFn: async (config: { accessToken?: string; phoneNumberId?: string; verifyToken?: string; appSecret?: string }) => {
      return apiRequest("POST", `/api/channels/whatsapp/config`, config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channels/status"] });
      toast({ title: "Конфигурация WhatsApp сохранена" });
    },
    onError: () => {
      toast({ title: "Не удалось сохранить конфигурацию WhatsApp", variant: "destructive" });
    },
  });

  const testConnection = async (channel: string, testToken?: string) => {
    setTestingConnection(true);
    try {
      const response = await apiRequest("POST", `/api/channels/${channel}/test`, { 
        token: testToken || undefined 
      });
      const result = await response.json();
      if (result.success) {
        toast({ 
          title: "Подключение успешно", 
          description: result.botInfo?.first_name 
            ? `Бот: ${result.botInfo.first_name} (@${result.botInfo.username || 'N/A'})`
            : "Токен действителен"
        });
        refetch();
      } else {
        toast({ 
          title: "Ошибка подключения", 
          description: result.error || "Не удалось подключиться",
          variant: "destructive" 
        });
      }
    } catch {
      toast({ title: "Ошибка проверки подключения", variant: "destructive" });
    } finally {
      setTestingConnection(false);
    }
  };

  const maxStatus = channelStatuses?.find(c => c.channel === "max");
  const maxEnabled = featureFlags?.MAX_CHANNEL_ENABLED ?? false;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Каналы связи</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <SubscriptionPaywall 
        open={showPaywall} 
        onOpenChange={setShowPaywall}
        trigger="channel"
      />
      
      {!canAccess && (
        <Card className="mb-6 border-yellow-500/30 bg-yellow-500/5" data-testid="banner-subscription-warning">
          <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/10">
                <Lock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="font-medium" data-testid="text-subscription-warning">Подписка не активна</p>
                <p className="text-sm text-muted-foreground">
                  Подключение каналов требует активной подписки
                </p>
              </div>
            </div>
            <Button 
              onClick={() => setShowPaywall(true)} 
              data-testid="button-channels-subscribe"
              className="w-full sm:w-auto"
            >
              <Zap className="mr-2 h-4 w-4" />
              Активировать за $50/мес
            </Button>
          </CardContent>
        </Card>
      )}

      <ChannelPaywallOverlay canAccess={canAccess} onSubscribeClick={() => setShowPaywall(true)}>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5" />
                MAX Messenger
            {maxStatus?.connected ? (
              <Badge variant="outline" className="bg-green-500/10 text-green-600">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Подключен
              </Badge>
            ) : maxEnabled ? (
              <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600">
                <AlertCircle className="mr-1 h-3 w-3" />
                Не настроен
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-muted text-muted-foreground">
                <XCircle className="mr-1 h-3 w-3" />
                Отключен
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Интеграция с MAX (VK Teams) для приема и отправки сообщений
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-4">
            <div>
              <Label>Включить канал MAX</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Разрешить прием сообщений через MAX Messenger
              </p>
            </div>
            <Switch
              checked={maxEnabled}
              onCheckedChange={(checked) => toggleChannelMutation.mutate({ channel: "max", enabled: checked })}
              disabled={toggleChannelMutation.isPending}
              data-testid="switch-max-enabled"
            />
          </div>

          {maxEnabled && (
            <>
              <Separator />

              {maxStatus?.connected && maxStatus.botInfo && (
                <div className="rounded-md bg-green-500/10 p-4">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-medium">Бот подключен</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Имя: {maxStatus.botInfo.first_name || "N/A"} 
                    {maxStatus.botInfo.username && ` (@${maxStatus.botInfo.username})`}
                  </p>
                </div>
              )}

              {maxStatus?.lastError && (
                <div className="rounded-md bg-red-500/10 p-4">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                    <XCircle className="h-5 w-5" />
                    <span className="font-medium">Ошибка подключения</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{maxStatus.lastError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <Label htmlFor="max-token">API Токен</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Получите токен в platform.max.ru в разделе "Мои боты"
                  </p>
                  <Input
                    id="max-token"
                    type="password"
                    placeholder={maxStatus?.connected ? "••••••••" : "Введите токен бота"}
                    value={maxToken}
                    onChange={(e) => setMaxToken(e.target.value)}
                    data-testid="input-max-token"
                  />
                </div>

                <div>
                  <Label htmlFor="max-webhook-secret">Webhook Secret (опционально)</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Секретный ключ для проверки подлинности webhook-запросов
                  </p>
                  <Input
                    id="max-webhook-secret"
                    type="password"
                    placeholder="Опциональный секрет"
                    value={maxWebhookSecret}
                    onChange={(e) => setMaxWebhookSecret(e.target.value)}
                    data-testid="input-max-webhook-secret"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => testConnection("max", maxToken)}
                  disabled={testingConnection || (!maxToken && !maxStatus?.connected)}
                  data-testid="button-test-max-connection"
                >
                  {testingConnection ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Проверить подключение
                </Button>
                <Button
                  onClick={() => saveConfigMutation.mutate({ 
                    channel: "max", 
                    token: maxToken || undefined,
                    webhookSecret: maxWebhookSecret || undefined
                  })}
                  disabled={saveConfigMutation.isPending || (!maxToken && !maxWebhookSecret)}
                  data-testid="button-save-max-config"
                >
                  <Save className="mr-2 h-4 w-4" />
                  Сохранить конфигурацию
                </Button>
              </div>

              <Separator />

              <div>
                <Label>Webhook URL</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Укажите этот URL в настройках бота на platform.max.ru
                </p>
                <code className="block rounded-md bg-muted px-3 py-2 text-sm font-mono">
                  {window.location.origin}/webhooks/max
                </code>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <TelegramBotCard 
        channelStatuses={channelStatuses}
        featureFlags={featureFlags}
        toggleChannelMutation={toggleChannelMutation}
        testConnection={testConnection}
        saveConfigMutation={saveConfigMutation}
        testingConnection={testingConnection}
      />

      <TelegramPersonalCard 
        channelStatuses={channelStatuses}
        featureFlags={featureFlags}
        toggleChannelMutation={toggleChannelMutation}
        refetch={refetch}
      />

      <WhatsAppCard 
        channelStatuses={channelStatuses}
        featureFlags={featureFlags}
        toggleChannelMutation={toggleChannelMutation}
        testConnection={testConnection}
        saveWhatsAppConfigMutation={saveWhatsAppConfigMutation}
        testingConnection={testingConnection}
      />

      <WhatsAppPersonalCard
        channelStatuses={channelStatuses}
        featureFlags={featureFlags}
        toggleChannelMutation={toggleChannelMutation}
        refetch={refetch}
      />

      <MaxPersonalCard
        channelStatuses={channelStatuses}
      />
        </div>
      </ChannelPaywallOverlay>
    </>
  );
}

const settingsFormSchema = z.object({
  name: z.string().min(1, "Название бизнеса обязательно"),
  language: z.string(),
  tone: z.string(),
  addressStyle: z.string(),
  currency: z.string(),
  timezone: z.string(),
  workingHoursStart: z.string(),
  workingHoursEnd: z.string(),
  autoReplyOutsideHours: z.boolean(),
  escalationEmail: z.string().email().optional().or(z.literal("")),
  escalationTelegram: z.string().optional(),
  allowDiscounts: z.boolean(),
  maxDiscountPercent: z.coerce.number().min(0).max(100),
});

type SettingsFormValues = z.infer<typeof settingsFormSchema>;

// ============================================================
// TEMPLATES TAB
// ============================================================

const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  price_result: "Результат поиска",
  price_options: "Варианты (выбор)",
  payment_options: "Варианты оплаты",
  not_found: "Не найдено",
  tag_request: "Запрос шильдика",
};

const PRICE_RESULT_VARIABLES = [
  "transmission_model",
  "oem",
  "min_price",
  "max_price",
  "avg_price",
  "origin",
  "car_brand",
  "date",
];

const PRICE_OPTIONS_VARIABLES = [
  "budget_price",
  "budget_mileage",
  "mid_price",
  "mid_mileage",
  "quality_price",
  "quality_mileage",
  "transmission_model",
  "oem",
  "date",
];

const TEMPLATE_SAMPLE_VALUES: Record<string, string> = {
  transmission_model: "JATCO JF011E",
  oem: "31020-1XJ1B",
  min_price: "45 000",
  max_price: "65 000",
  avg_price: "52 000",
  origin: "Япония",
  car_brand: "Nissan",
  date: (() => {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}.${mm}.${d.getFullYear()}`;
  })(),
  // price_options tier variables
  budget_price: "44 000",
  budget_mileage: "98 000",
  mid_price: "57 000",
  mid_mileage: "74 000",
  quality_price: "71 000",
  quality_mileage: "52 000",
};

function renderTemplatePreview(content: string): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    TEMPLATE_SAMPLE_VALUES[key] ?? `{{${key}}}`,
  );
}

function TemplatesTab() {
  const { toast } = useToast();
  const autoPartsEnabled = useAutoPartsEnabled();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MessageTemplate | null>(null);
  const [variablesOpen, setVariablesOpen] = useState(false);

  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("");
  const [formContent, setFormContent] = useState("");

  const { data: templates, isLoading } = useQuery<MessageTemplate[]>({
    queryKey: ["/api/templates"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; type: string; content: string }) => {
      const res = await apiRequest("POST", "/api/templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({ title: "Шаблон создан" });
      setSheetOpen(false);
    },
    onError: () => {
      toast({ title: "Не удалось создать шаблон", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Pick<MessageTemplate, "name" | "content" | "isActive">> }) => {
      const res = await apiRequest("PATCH", `/api/templates/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({ title: "Шаблон обновлён" });
      setSheetOpen(false);
    },
    onError: () => {
      toast({ title: "Не удалось обновить шаблон", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({ title: "Шаблон удалён" });
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Не удалось удалить шаблон", variant: "destructive" });
    },
  });

  function openCreate() {
    setEditingTemplate(null);
    setFormName("");
    setFormType("");
    setFormContent("");
    setVariablesOpen(false);
    setSheetOpen(true);
  }

  function openEdit(t: MessageTemplate) {
    setEditingTemplate(t);
    setFormName(t.name);
    setFormType(t.type);
    setFormContent(t.content);
    setVariablesOpen(false);
    setSheetOpen(true);
  }

  function insertVariable(variable: string) {
    const ta = textareaRef.current;
    const text = `{{${variable}}}`;
    if (!ta) {
      setFormContent((prev) => prev + text);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setFormContent((prev) => prev.slice(0, start) + text + prev.slice(end));
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + text.length, start + text.length);
    }, 0);
  }

  function handleSave() {
    if (!formName.trim() || !formContent.trim()) return;
    if (!editingTemplate && !formType) return;
    if (editingTemplate) {
      updateMutation.mutate({
        id: editingTemplate.id,
        data: { name: formName, content: formContent },
      });
    } else {
      createMutation.mutate({ name: formName, type: formType, content: formContent });
    }
  }

  const grouped = (templates ?? []).reduce<Record<string, MessageTemplate[]>>((acc, t) => {
    if (!acc[t.type]) acc[t.type] = [];
    acc[t.type].push(t);
    return acc;
  }, {});

  const isEditing = editingTemplate !== null;
  const activeType = isEditing ? editingTemplate?.type : formType;
  const isPriceResult = activeType === "price_result";
  const isPriceOptions = activeType === "price_options";
  const hasVariables = isPriceResult || isPriceOptions;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">Шаблоны сообщений</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Настройка шаблонов для автоматических ответов
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-template">
          <Plus className="mr-2 h-4 w-4" />
          Добавить шаблон
        </Button>
      </div>

      {(templates?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Шаблоны не добавлены. Создайте первый шаблон.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">
                {TEMPLATE_TYPE_LABELS[type] ?? type}
              </h3>
              <div className="space-y-3">
                {items.map((t) => (
                  <Card key={t.id}>
                    <CardContent className="flex items-center justify-between py-4 px-5 gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{t.name}</p>
                        <Badge variant="secondary" className="mt-1 text-xs">
                          {TEMPLATE_TYPE_LABELS[t.type] ?? t.type}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Switch
                          checked={t.isActive}
                          onCheckedChange={(checked) =>
                            updateMutation.mutate({ id: t.id, data: { isActive: checked } })
                          }
                          data-testid={`switch-template-${t.id}`}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(t)}
                          data-testid={`button-edit-template-${t.id}`}
                        >
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Редактировать
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(t)}
                          data-testid={`button-delete-template-${t.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit / Create Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {isEditing ? "Редактировать шаблон" : "Новый шаблон"}
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-5 py-6">
            {!isEditing && (
              <div className="space-y-2">
                <Label htmlFor="template-type">Тип шаблона</Label>
                <Select value={formType} onValueChange={setFormType}>
                  <SelectTrigger id="template-type" data-testid="select-template-type">
                    <SelectValue placeholder="Выберите тип" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TEMPLATE_TYPE_LABELS)
                      .filter(([val]) =>
                        autoPartsEnabled ? true : val !== "price_result" && val !== "price_options" && val !== "tag_request"
                      )
                      .map(([val, label]) => (
                        <SelectItem key={val} value={val}>
                          {label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="template-name">Название шаблона</Label>
              <Input
                id="template-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Введите название"
                data-testid="input-template-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-content">Текст шаблона</Label>
              <Textarea
                id="template-content"
                ref={textareaRef}
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="Текст шаблона с {{переменными}}"
                className="font-mono min-h-[200px] resize-y"
                data-testid="textarea-template-content"
              />
            </div>

            {hasVariables && (
              <Collapsible open={variablesOpen} onOpenChange={setVariablesOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-between">
                    Доступные переменные
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 transition-transform",
                        variablesOpen && "rotate-180",
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <div className="flex flex-wrap gap-2">
                    {(isPriceOptions ? PRICE_OPTIONS_VARIABLES : PRICE_RESULT_VARIABLES).map((v) => (
                      <Badge
                        key={v}
                        variant="outline"
                        className="cursor-pointer font-mono text-xs hover:bg-accent"
                        onClick={() => insertVariable(v)}
                      >
                        {`{{${v}}}`}
                      </Badge>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {formContent && (
              <div className="space-y-2">
                <Label>Предпросмотр</Label>
                <div className="rounded-md border bg-muted/40 p-4 text-sm whitespace-pre-wrap">
                  {renderTemplatePreview(formContent)}
                </div>
              </div>
            )}
          </div>

          <SheetFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setSheetOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              data-testid="button-save-template"
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить шаблон?</AlertDialogTitle>
            <AlertDialogDescription>
              Шаблон «{deleteTarget?.name}» будет удалён без возможности восстановления.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ============================================================
// PAYMENT METHODS TAB
// ============================================================

function PaymentMethodsTab() {
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PaymentMethod | null>(null);

  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");

  const { data: methods, isLoading } = useQuery<PaymentMethod[]>({
    queryKey: ["/api/payment-methods"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; description?: string }) => {
      const res = await apiRequest("POST", "/api/payment-methods", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-methods"] });
      toast({ title: "Способ оплаты добавлен" });
      setDialogOpen(false);
    },
    onError: () => {
      toast({ title: "Не удалось добавить способ оплаты", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Pick<PaymentMethod, "title" | "description" | "isActive">>;
    }) => {
      const res = await apiRequest("PATCH", `/api/payment-methods/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-methods"] });
      toast({ title: "Способ оплаты обновлён" });
      setDialogOpen(false);
    },
    onError: () => {
      toast({ title: "Не удалось обновить", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/payment-methods/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-methods"] });
      toast({ title: "Способ оплаты удалён" });
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Не удалось удалить", variant: "destructive" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (items: Array<{ id: string; order: number }>) => {
      await apiRequest("PATCH", "/api/payment-methods/reorder", { items });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-methods"] });
    },
    onError: () => {
      toast({ title: "Не удалось изменить порядок", variant: "destructive" });
    },
  });

  function openCreate() {
    setEditingMethod(null);
    setFormTitle("");
    setFormDescription("");
    setDialogOpen(true);
  }

  function openEdit(m: PaymentMethod) {
    setEditingMethod(m);
    setFormTitle(m.title);
    setFormDescription(m.description ?? "");
    setDialogOpen(true);
  }

  function handleSave() {
    if (!formTitle.trim()) return;
    const payload = {
      title: formTitle,
      description: formDescription.trim() || undefined,
    };
    if (editingMethod) {
      updateMutation.mutate({ id: editingMethod.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const sortedMethods = [...(methods ?? [])].sort((a, b) => a.order - b.order);

  function moveUp(index: number) {
    if (index === 0) return;
    const newOrder = sortedMethods.map((m, i) => ({ id: m.id, order: i }));
    const tmp = newOrder[index].order;
    newOrder[index].order = newOrder[index - 1].order;
    newOrder[index - 1].order = tmp;
    reorderMutation.mutate(newOrder);
  }

  function moveDown(index: number) {
    if (index === sortedMethods.length - 1) return;
    const newOrder = sortedMethods.map((m, i) => ({ id: m.id, order: i }));
    const tmp = newOrder[index].order;
    newOrder[index].order = newOrder[index + 1].order;
    newOrder[index + 1].order = tmp;
    reorderMutation.mutate(newOrder);
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">Способы оплаты</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Список способов оплаты, предлагаемых клиентам
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-payment-method">
          <Plus className="mr-2 h-4 w-4" />
          Добавить
        </Button>
      </div>

      {sortedMethods.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Способы оплаты не добавлены. Добавьте первый способ оплаты.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedMethods.map((m, index) => (
            <Card key={m.id}>
              <CardContent className="flex items-center gap-3 py-3 px-5">
                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{m.title}</p>
                  {m.description && (
                    <p className="text-sm text-muted-foreground truncate">{m.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    onClick={() => moveUp(index)}
                    data-testid={`button-move-up-${m.id}`}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === sortedMethods.length - 1}
                    onClick={() => moveDown(index)}
                    data-testid={`button-move-down-${m.id}`}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Switch
                    checked={m.isActive}
                    onCheckedChange={(checked) =>
                      updateMutation.mutate({ id: m.id, data: { isActive: checked } })
                    }
                    data-testid={`switch-payment-method-${m.id}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEdit(m)}
                    data-testid={`button-edit-payment-method-${m.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteTarget(m)}
                    data-testid={`button-delete-payment-method-${m.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingMethod ? "Редактировать способ оплаты" : "Добавить способ оплаты"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="payment-title">Название</Label>
              <Input
                id="payment-title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Наличные при получении"
                data-testid="input-payment-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-description">Описание (необязательно)</Label>
              <Input
                id="payment-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Уточните сумму заранее"
                data-testid="input-payment-description"
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleSave}
              disabled={!formTitle.trim() || isSaving}
              data-testid="button-save-payment-method"
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить способ оплаты?</AlertDialogTitle>
            <AlertDialogDescription>
              «{deleteTarget?.title}» будет удалён без возможности восстановления.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const DEFAULT_AGENT_SYSTEM_PROMPT = `Вы — профессиональный менеджер по продажам, помогающий клиентам с их запросами.

ВАЖНЫЕ ПРАВИЛА:
1. НИКОГДА не придумывайте цены, наличие или сроки доставки. Используйте только факты из предоставленного контекста.
2. Если информации нет, задавайте уточняющие вопросы.
3. Отвечайте кратко и по существу.
4. При вопросах о скидках и жалобах — переключайте на оператора.`;

interface CompanyAgentCardProps {
  autoPartsEnabled?: boolean;
}

function CompanyAgentCard({ autoPartsEnabled = false }: CompanyAgentCardProps) {
  const { toast } = useToast();

  const [companyName, setCompanyName] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [warehouseCity, setWarehouseCity] = useState("");
  const [warrantyMonths, setWarrantyMonths] = useState("");
  const [warrantyKm, setWarrantyKm] = useState("");
  const [installDays, setInstallDays] = useState("");
  const [qrDiscountPercent, setQrDiscountPercent] = useState("");
  const [mileageLow, setMileageLow] = useState("");
  const [mileageMid, setMileageMid] = useState("");
  const [mileageHigh, setMileageHigh] = useState("");

  const { data: settings, isLoading } = useQuery<TenantAgentSettings>({
    queryKey: ["/api/agent-settings"],
  });

  useEffect(() => {
    if (settings) {
      setCompanyName(settings.companyName ?? "");
      setSpecialization(settings.specialization ?? "");
      setWarehouseCity(settings.warehouseCity ?? "");
      setWarrantyMonths(settings.warrantyMonths?.toString() ?? "");
      setWarrantyKm(settings.warrantyKm?.toString() ?? "");
      setInstallDays(settings.installDays?.toString() ?? "");
      setQrDiscountPercent(settings.qrDiscountPercent?.toString() ?? "");
      setMileageLow(settings.mileageLow?.toString() ?? "");
      setMileageMid(settings.mileageMid?.toString() ?? "");
      setMileageHigh(settings.mileageHigh?.toString() ?? "");
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PUT", "/api/agent-settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-settings"] });
      toast({ title: "Настройки компании сохранены" });
    },
    onError: () => {
      toast({ title: "Не удалось сохранить настройки", variant: "destructive" });
    },
  });

  function handleSave() {
    saveMutation.mutate({
      ...(settings ?? {}),
      companyName: companyName.trim() || null,
      specialization: specialization.trim() || null,
      warehouseCity: warehouseCity.trim() || null,
      warrantyMonths: warrantyMonths !== "" ? parseInt(warrantyMonths, 10) : null,
      warrantyKm: warrantyKm !== "" ? parseInt(warrantyKm, 10) : null,
      installDays: installDays !== "" ? parseInt(installDays, 10) : null,
      qrDiscountPercent: qrDiscountPercent !== "" ? parseInt(qrDiscountPercent, 10) : null,
      mileageLow: mileageLow !== "" ? parseInt(mileageLow, 10) : null,
      mileageMid: mileageMid !== "" ? parseInt(mileageMid, 10) : null,
      mileageHigh: mileageHigh !== "" ? parseInt(mileageHigh, 10) : null,
    });
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>О компании</CardTitle>
          <CardDescription>
            Эти данные AI агент использует при общении с клиентами
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="company-name">Название компании</Label>
              <Input
                id="company-name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Название вашей организации"
                data-testid="input-company-name"
              />
              <p className="text-xs text-muted-foreground">
                Используется AI агентом при общении с клиентами
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-specialization">Специализация</Label>
              <Input
                id="company-specialization"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                placeholder="Чем занимается ваша компания"
                data-testid="input-company-specialization"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-warehouse-city">Город склада</Label>
              <Input
                id="company-warehouse-city"
                value={warehouseCity}
                onChange={(e) => setWarehouseCity(e.target.value)}
                placeholder="Откуда отправляете товар"
                data-testid="input-company-warehouse-city"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-warranty-months">Гарантия (месяцы)</Label>
              <Input
                id="company-warranty-months"
                type="number"
                value={warrantyMonths}
                onChange={(e) => setWarrantyMonths(e.target.value)}
                placeholder="12"
                data-testid="input-company-warranty-months"
              />
            </div>
            {autoPartsEnabled && (
              <div className="space-y-2">
                <Label htmlFor="company-warranty-km">Гарантия (км)</Label>
                <Input
                  id="company-warranty-km"
                  type="number"
                  value={warrantyKm}
                  onChange={(e) => setWarrantyKm(e.target.value)}
                  placeholder="30000"
                  data-testid="input-company-warranty-km"
                />
              </div>
            )}
            {autoPartsEnabled && (
              <div className="space-y-2">
                <Label htmlFor="company-install-days">Дней на установку</Label>
                <Input
                  id="company-install-days"
                  type="number"
                  value={installDays}
                  onChange={(e) => setInstallDays(e.target.value)}
                  placeholder="14"
                  data-testid="input-company-install-days"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="company-qr-discount">Скидка при QR/СБП (%)</Label>
              <Input
                id="company-qr-discount"
                type="number"
                value={qrDiscountPercent}
                onChange={(e) => setQrDiscountPercent(e.target.value)}
                placeholder="10"
                data-testid="input-company-qr-discount"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {autoPartsEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>Диапазоны пробега</CardTitle>
            <CardDescription>
              Определяет как разбивать варианты на категории по пробегу при двухшаговом диалоге цен
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mileage-low">Низкий пробег (до, км)</Label>
                <Input
                  id="mileage-low"
                  type="number"
                  value={mileageLow}
                  onChange={(e) => setMileageLow(e.target.value)}
                  placeholder="60000"
                  data-testid="input-mileage-low"
                />
                <p className="text-xs text-muted-foreground">Лучшие варианты — дороже</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mileage-mid">Средний пробег (до, км)</Label>
                <Input
                  id="mileage-mid"
                  type="number"
                  value={mileageMid}
                  onChange={(e) => setMileageMid(e.target.value)}
                  placeholder="90000"
                  data-testid="input-mileage-mid"
                />
                <p className="text-xs text-muted-foreground">Оптимальные варианты</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mileage-high">Высокий пробег (от, км)</Label>
                <Input
                  id="mileage-high"
                  type="number"
                  value={mileageHigh}
                  onChange={(e) => setMileageHigh(e.target.value)}
                  placeholder="90000"
                  data-testid="input-mileage-high"
                />
                <p className="text-xs text-muted-foreground">Бюджетные варианты — дешевле</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleSave}
          disabled={saveMutation.isPending}
          data-testid="button-save-company-settings"
        >
          {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          <Save className="mr-2 h-4 w-4" />
          Сохранить
        </Button>
      </div>
    </div>
  );
}

function AIAgentSettingsCard() {
  const { toast } = useToast();

  const [systemPrompt, setSystemPrompt] = useState("");
  const [objectionPayment, setObjectionPayment] = useState("");
  const [objectionOnline, setObjectionOnline] = useState("");
  const [closingScript, setClosingScript] = useState("");
  const [customFacts, setCustomFacts] = useState<Array<{ key: string; value: string }>>([]);
  const [showDefaultPrompt, setShowDefaultPrompt] = useState(false);

  const { data: settings, isLoading } = useQuery<TenantAgentSettings>({
    queryKey: ["/api/agent-settings"],
  });

  useEffect(() => {
    if (settings) {
      setSystemPrompt(settings.systemPrompt ?? "");
      setObjectionPayment(settings.objectionPayment ?? "");
      setObjectionOnline(settings.objectionOnline ?? "");
      setClosingScript(settings.closingScript ?? "");
      const facts = (settings.customFacts as Record<string, string> | null) ?? {};
      setCustomFacts(Object.entries(facts).map(([key, value]) => ({ key, value: String(value) })));
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PUT", "/api/agent-settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-settings"] });
      toast({ title: "Настройки AI агента сохранены" });
    },
    onError: () => {
      toast({ title: "Не удалось сохранить настройки агента", variant: "destructive" });
    },
  });

  function handleSave() {
    const factsObj: Record<string, string> = {};
    for (const { key, value } of customFacts) {
      if (key.trim()) factsObj[key.trim()] = value;
    }
    saveMutation.mutate({
      ...(settings ?? {}),
      systemPrompt: systemPrompt.trim() || null,
      objectionPayment: objectionPayment.trim() || null,
      objectionOnline: objectionOnline.trim() || null,
      closingScript: closingScript.trim() || null,
      customFacts: factsObj,
    });
  }

  function addFact() {
    setCustomFacts((prev) => [...prev, { key: "", value: "" }]);
  }

  function updateFact(index: number, field: "key" | "value", val: string) {
    setCustomFacts((prev) => prev.map((f, i) => (i === index ? { ...f, [field]: val } : f)));
  }

  function removeFact(index: number) {
    setCustomFacts((prev) => prev.filter((_, i) => i !== index));
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Системный промпт</CardTitle>
            <CardDescription>
              Основной характер и поведение агента. Если оставить пустым — используется стандартный промпт.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowDefaultPrompt(true)}
              data-testid="button-view-default-prompt"
            >
              <FileText className="mr-2 h-4 w-4" />
              Посмотреть стандартный промпт
            </Button>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Опишите как должен вести себя ваш агент..."
              className="min-h-[200px] font-mono text-sm"
              data-testid="textarea-system-prompt"
            />
            <p className="text-xs text-muted-foreground">
              Если заполнено — полностью заменяет стандартный промпт
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Скрипты ответов</CardTitle>
            <CardDescription>
              Готовые ответы на типовые возражения клиентов
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-objection-payment">
                Ответ на «оплата при получении»
              </Label>
              <Textarea
                id="ai-objection-payment"
                value={objectionPayment}
                onChange={(e) => setObjectionPayment(e.target.value)}
                placeholder="Мы не частники, работаем по регламенту организации..."
                rows={3}
                data-testid="textarea-objection-payment"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-objection-online">
                Ответ на «онлайн платёж опасен»
              </Label>
              <Textarea
                id="ai-objection-online"
                value={objectionOnline}
                onChange={(e) => setObjectionOnline(e.target.value)}
                placeholder="Понимаем ваши опасения. При оплате через безопасную сделку..."
                rows={3}
                data-testid="textarea-objection-online"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-closing-script">Скрипт закрытия сделки</Label>
              <Textarea
                id="ai-closing-script"
                value={closingScript}
                onChange={(e) => setClosingScript(e.target.value)}
                placeholder="Для оформления заказа напишите: ФИО, телефон, email..."
                rows={3}
                data-testid="textarea-closing-script"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Дополнительные факты</CardTitle>
            <CardDescription>
              Любая дополнительная информация о компании для агента
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Эти факты автоматически добавляются в промпт агента
            </p>
            {customFacts.map((fact, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={fact.key}
                  onChange={(e) => updateFact(index, "key", e.target.value)}
                  placeholder="Ключ"
                  className="flex-1"
                  data-testid={`fact-key-${index}`}
                />
                <Input
                  value={fact.value}
                  onChange={(e) => updateFact(index, "value", e.target.value)}
                  placeholder="Значение"
                  className="flex-1"
                  data-testid={`fact-value-${index}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeFact(index)}
                  data-testid={`button-remove-fact-${index}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addFact}
              data-testid="button-add-fact"
            >
              <Plus className="mr-2 h-4 w-4" />
              Добавить факт
            </Button>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={handleSave}
            disabled={saveMutation.isPending}
            data-testid="button-save-agent-settings"
          >
            {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Сохранить
          </Button>
        </div>
      </div>

      <Dialog open={showDefaultPrompt} onOpenChange={setShowDefaultPrompt}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Стандартный промпт</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-96">
            <pre className="text-sm whitespace-pre-wrap font-mono bg-muted rounded p-4">
              {DEFAULT_AGENT_SYSTEM_PROMPT}
            </pre>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDefaultPrompt(false)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const autoPartsEnabled = useAutoPartsEnabled();

  const { data: tenant, isLoading } = useQuery<Tenant>({
    queryKey: ["/api/tenant"],
  });

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      name: "",
      language: "ru",
      tone: "formal",
      addressStyle: "vy",
      currency: "RUB",
      timezone: "Europe/Moscow",
      workingHoursStart: "09:00",
      workingHoursEnd: "18:00",
      autoReplyOutsideHours: true,
      escalationEmail: "",
      escalationTelegram: "",
      allowDiscounts: false,
      maxDiscountPercent: 0,
    },
    values: tenant
      ? {
          name: tenant.name,
          language: tenant.language,
          tone: tenant.tone,
          addressStyle: tenant.addressStyle,
          currency: tenant.currency,
          timezone: tenant.timezone,
          workingHoursStart: tenant.workingHoursStart || "09:00",
          workingHoursEnd: tenant.workingHoursEnd || "18:00",
          autoReplyOutsideHours: tenant.autoReplyOutsideHours ?? true,
          escalationEmail: tenant.escalationEmail || "",
          escalationTelegram: tenant.escalationTelegram || "",
          allowDiscounts: tenant.allowDiscounts ?? false,
          maxDiscountPercent: tenant.maxDiscountPercent || 0,
        }
      : undefined,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: SettingsFormValues) => {
      return apiRequest("PATCH", "/api/tenant", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant"] });
      toast({ title: "Настройки сохранены" });
    },
    onError: () => {
      toast({ title: "Не удалось сохранить настройки", variant: "destructive" });
    },
  });

  const handleSubmit = (data: SettingsFormValues) => {
    updateMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-48" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold">Настройки</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Настройка поведения и параметров AI Sales Operator
        </p>
      </div>

      <Tabs defaultValue="company" className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="company" data-testid="tab-company">
            <Building2 className="mr-2 h-4 w-4" />
            Компания
          </TabsTrigger>
          <TabsTrigger value="ai-agent" data-testid="tab-ai-agent">
            <Bot className="mr-2 h-4 w-4" />
            AI Агент
          </TabsTrigger>
          <TabsTrigger value="automation" data-testid="tab-automation">
            <Zap className="mr-2 h-4 w-4" />
            Автоматизация
          </TabsTrigger>
          <TabsTrigger value="ai-training" data-testid="tab-ai-training">
            <MessageSquare className="mr-2 h-4 w-4" />
            Обучение AI
          </TabsTrigger>
          <TabsTrigger value="templates-payment" data-testid="tab-templates-payment">
            <FileText className="mr-2 h-4 w-4" />
            Шаблоны и Оплата
          </TabsTrigger>
          <TabsTrigger value="channels" data-testid="tab-channels">
            <Link2 className="mr-2 h-4 w-4" />
            Каналы
          </TabsTrigger>
        </TabsList>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            {/* Tab 1: Компания */}
            <TabsContent value="company">
              <div className="space-y-6">
                <CompanyAgentCard autoPartsEnabled={autoPartsEnabled} />

                <Card>
                  <CardHeader>
                    <CardTitle>Параметры аккаунта</CardTitle>
                    <CardDescription>
                      Валюта и часовой пояс для вашего бизнеса
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="currency"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Валюта</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-currency">
                                  <SelectValue placeholder="Выберите валюту" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="RUB">RUB (Российский рубль)</SelectItem>
                                <SelectItem value="USD">USD (Доллар США)</SelectItem>
                                <SelectItem value="EUR">EUR (Евро)</SelectItem>
                                <SelectItem value="UAH">UAH (Украинская гривна)</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="timezone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Часовой пояс</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-timezone">
                                  <SelectValue placeholder="Выберите часовой пояс" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="Europe/Moscow">Москва</SelectItem>
                                <SelectItem value="Europe/Kiev">Киев</SelectItem>
                                <SelectItem value="Europe/London">Лондон</SelectItem>
                                <SelectItem value="America/New_York">Нью-Йорк</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={updateMutation.isPending}
                    data-testid="button-save-settings"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Сохранить
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* Tab 2: AI Агент */}
            <TabsContent value="ai-agent">
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Стиль общения</CardTitle>
                    <CardDescription>
                      Как AI должен общаться с клиентами
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="language"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Язык</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-language">
                                <SelectValue placeholder="Выберите язык" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="ru">Русский</SelectItem>
                              <SelectItem value="en">Английский</SelectItem>
                              <SelectItem value="uk">Украинский</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="tone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Тон общения</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-tone">
                                  <SelectValue placeholder="Выберите тон" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="formal">Формальный</SelectItem>
                                <SelectItem value="friendly">Дружеский</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="addressStyle"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Обращение</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-address-style">
                                  <SelectValue placeholder="Выберите стиль" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="vy">На Вы</SelectItem>
                                <SelectItem value="ty">На Ты</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="flex justify-end pt-2">
                      <Button
                        type="submit"
                        disabled={updateMutation.isPending}
                        data-testid="button-save-communication"
                      >
                        <Save className="mr-2 h-4 w-4" />
                        Сохранить стиль
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <AIAgentSettingsCard />
              </div>
            </TabsContent>

            {/* Tab 3: Автоматизация */}
            <TabsContent value="automation">
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Рабочие часы</CardTitle>
                    <CardDescription>
                      Когда AI работает в автоматическом режиме
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="workingHoursStart"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Начало работы</FormLabel>
                            <FormControl>
                              <Input
                                type="time"
                                {...field}
                                data-testid="input-working-start"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="workingHoursEnd"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Конец работы</FormLabel>
                            <FormControl>
                              <Input
                                type="time"
                                {...field}
                                data-testid="input-working-end"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Скидки</CardTitle>
                    <CardDescription>
                      Разрешить AI предлагать скидки клиентам
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="allowDiscounts"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-md border p-4">
                          <div>
                            <FormLabel>Разрешить AI предлагать скидки</FormLabel>
                            <FormDescription>
                              AI сможет предлагать скидки в установленных пределах
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-allow-discounts"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    {form.watch("allowDiscounts") && (
                      <FormField
                        control={form.control}
                        name="maxDiscountPercent"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Максимальная скидка (%)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                {...field}
                                data-testid="input-max-discount"
                              />
                            </FormControl>
                            <FormDescription>
                              Максимальный процент скидки, который AI может предложить
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    <div className="flex justify-end pt-2">
                      <Button
                        type="submit"
                        disabled={updateMutation.isPending}
                        data-testid="button-save-automation"
                      >
                        <Save className="mr-2 h-4 w-4" />
                        Сохранить
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <DecisionEngineSettings autoPartsEnabled={autoPartsEnabled} />
                <HumanDelaySettings />
              </div>
            </TabsContent>

            {/* Tab 4: Обучение AI */}
            <TabsContent value="ai-training">
              <div className="space-y-6">
                <p className="text-sm text-muted-foreground">
                  Эти настройки влияют на качество AI со временем — как агент обучается на реальных разговорах
                </p>
                <TrainingPoliciesSettings autoPartsEnabled={autoPartsEnabled} />
              </div>
            </TabsContent>

            {/* Tab 5: Шаблоны и Оплата */}
            <TabsContent value="templates-payment">
              <div className="space-y-8">
                <TemplatesTab />
                <Separator />
                <PaymentMethodsTab />
              </div>
            </TabsContent>

            {/* Tab 6: Каналы */}
            <TabsContent value="channels">
              <ChannelSettings />
            </TabsContent>
          </form>
        </Form>
      </Tabs>
    </div>
  );
}
