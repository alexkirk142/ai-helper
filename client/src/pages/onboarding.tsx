import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Building2,
  MessageSquare,
  Package,
  ShieldCheck,
  BookOpen,
  ClipboardCheck,
  ArrowRight,
  ArrowLeft,
  Check,
  Bot,
  Loader2,
  Beaker,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lock,
  Zap,
  Plus,
  Upload,
  FileSpreadsheet,
} from "lucide-react";
import { useBillingStatus } from "@/hooks/use-billing";
import { SubscriptionPaywall } from "@/components/subscription-paywall";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

type OnboardingStep = "BUSINESS" | "CHANNELS" | "PRODUCTS" | "POLICIES" | "KB" | "REVIEW" | "DONE";
type WizardStep = Exclude<OnboardingStep, "DONE">;
type OnboardingStatus = "NOT_STARTED" | "IN_PROGRESS" | "DONE";

interface TemplateDraft {
  title: string;
  docType: "policy" | "faq" | "delivery" | "returns";
  content: string;
}

interface SmokeTestResult {
  question: string;
  intent: string | null;
  decision: string;
  confidence: number;
  usedSourcesCount: number;
  penalties: { type: string; weight: number; reason: string }[];
  explanations: string[];
  hasStaleData: boolean;
  hasConflictingSources: boolean;
  passed: boolean;
}

interface SmokeTestResponse {
  results: SmokeTestResult[];
  passedCount: number;
  totalCount: number;
  check: { code: string; status: string; message: string; weight: number };
  recommendations: string[];
}

interface OnboardingState {
  tenantId: string;
  status: OnboardingStatus;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  answers: Record<string, unknown>;
  steps: readonly OnboardingStep[];
  totalSteps: number;
  updatedAt: string;
}

interface StepAnswers {
  BUSINESS?: {
    name?: string;
    currency?: string;
    timezone?: string;
    categories?: string;
    geography?: string;
  };
  CHANNELS?: {
    channels?: string[];
    primaryChannel?: string;
  };
  PRODUCTS?: {
    hasProducts?: boolean;
    productCount?: number;
  };
  POLICIES?: {
    deliveryOptions?: string;
    deliveryTimes?: string;
    returnPolicy?: string;
    paymentMethods?: string;
  };
  KB?: {
    hasDocs?: boolean;
    docCount?: number;
    generatedDrafts?: TemplateDraft[];
    appliedDocs?: boolean;
  };
  REVIEW?: {
    confirmed?: boolean;
  };
}

const STEPS_CONFIG = [
  { id: "BUSINESS" as OnboardingStep, title: "О бизнесе", icon: Building2, description: "Расскажите о вашем бизнесе" },
  { id: "CHANNELS" as OnboardingStep, title: "Каналы", icon: MessageSquare, description: "Настройте каналы связи" },
  { id: "PRODUCTS" as OnboardingStep, title: "Товары", icon: Package, description: "Добавьте каталог товаров" },
  { id: "POLICIES" as OnboardingStep, title: "Политики", icon: ShieldCheck, description: "Настройте доставку и возвраты" },
  { id: "KB" as OnboardingStep, title: "База знаний", icon: BookOpen, description: "Добавьте полезные документы" },
  { id: "REVIEW" as OnboardingStep, title: "Проверка", icon: ClipboardCheck, description: "Проверьте и завершите настройку" },
];

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [localAnswers, setLocalAnswers] = useState<StepAnswers>({});
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [drafts, setDrafts] = useState<TemplateDraft[]>([]);
  const [editingDraft, setEditingDraft] = useState<number | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [isProductDialogOpen, setIsProductDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [addedProductsCount, setAddedProductsCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const productFormSchema = z.object({
    name: z.string().min(1, "Название обязательно"),
    sku: z.string().optional(),
    description: z.string().optional(),
    price: z.coerce.number().min(0, "Цена должна быть положительной").optional(),
    category: z.string().optional(),
    inStock: z.boolean().default(true),
  });
  
  const productForm = useForm<z.infer<typeof productFormSchema>>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: "",
      sku: "",
      description: "",
      price: 0,
      category: "",
      inStock: true,
    },
  });
  
  const { data: billingStatus } = useBillingStatus();
  const hasSubscription = billingStatus?.canAccess ?? false;
  
  const { data: onboardingState, isLoading } = useQuery<OnboardingState>({
    queryKey: ["/api/onboarding/state"],
    retry: false,
  });

  useEffect(() => {
    if (onboardingState) {
      setLocalAnswers((onboardingState.answers ?? {}) as StepAnswers);
      const stepIndex = STEPS_CONFIG.findIndex(s => s.id === onboardingState.currentStep);
      if (stepIndex >= 0 && stepIndex < STEPS_CONFIG.length) {
        setCurrentStepIndex(stepIndex);
      }
      if (onboardingState.status === "DONE") {
        setLocation("/");
      }
    }
  }, [onboardingState, setLocation]);

  const completeStepMutation = useMutation({
    mutationFn: async ({ step, answers }: { step: OnboardingStep; answers: unknown }) => {
      return apiRequest("POST", "/api/onboarding/complete-step", { step, answers });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/state"] });
    },
    onError: () => {
      toast({ title: "Не удалось сохранить прогресс. Попробуйте ещё раз.", variant: "destructive" });
    },
  });

  const updateStateMutation = useMutation({
    mutationFn: async (data: Partial<{ status: OnboardingStatus; currentStep: OnboardingStep; completedSteps: OnboardingStep[]; answers: StepAnswers }>) => {
      return apiRequest("PUT", "/api/onboarding/state", data);
    },
    onError: () => {
      toast({ title: "Не удалось обновить состояние.", variant: "destructive" });
    },
  });
  
  const createProductMutation = useMutation({
    mutationFn: async (data: z.infer<typeof productFormSchema>) => {
      return apiRequest("POST", "/api/products", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setAddedProductsCount(prev => prev + 1);
      productForm.reset();
      toast({ title: "Товар добавлен" });
    },
    onError: () => {
      toast({ title: "Не удалось добавить товар", variant: "destructive" });
    },
  });
  
  const handleAddProduct = async (data: z.infer<typeof productFormSchema>) => {
    await createProductMutation.mutateAsync(data);
  };
  
  const importProductsMutation = useMutation({
    mutationFn: async (products: Array<Record<string, unknown>>) => {
      const response = await apiRequest("POST", "/api/products/import", { products });
      return response.json() as Promise<{ count: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setAddedProductsCount(prev => prev + data.count);
      setIsImportDialogOpen(false);
      toast({ title: `Импортировано ${data.count} товаров` });
    },
    onError: () => {
      toast({ title: "Не удалось импортировать товары", variant: "destructive" });
    },
  });
  
  const parseCSV = (text: string): Array<Record<string, string>> => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const products: Array<Record<string, string>> = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      if (values.length === headers.length) {
        const product: Record<string, string> = {};
        headers.forEach((header, idx) => {
          product[header] = values[idx];
        });
        if (product.name) {
          products.push(product);
        }
      }
    }
    return products;
  };
  
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const fileName = file.name.toLowerCase();
    
    if (fileName.endsWith('.csv')) {
      const text = await file.text();
      const products = parseCSV(text);
      if (products.length > 0) {
        importProductsMutation.mutate(products);
      } else {
        toast({ title: "Файл пуст или имеет неверный формат", variant: "destructive" });
      }
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      toast({ 
        title: "Excel файлы пока не поддерживаются", 
        description: "Пожалуйста, сохраните файл как CSV и загрузите снова",
        variant: "destructive" 
      });
    } else {
      toast({ title: "Неподдерживаемый формат файла", variant: "destructive" });
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const generateTemplatesMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/onboarding/generate-templates", {
        answers: localAnswers,
        options: { includeFaq: true, includePolicy: true, includeDelivery: true, includeReturns: true },
      });
      return response.json();
    },
    onSuccess: (data: { drafts: TemplateDraft[] }) => {
      setDrafts(data.drafts);
      toast({ title: "Шаблоны сгенерированы", description: `Создано ${data.drafts.length} документов` });
    },
    onError: () => {
      toast({ title: "Не удалось сгенерировать шаблоны", variant: "destructive" });
    },
  });

  const applyTemplatesMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/onboarding/apply-templates", { drafts });
      return response.json();
    },
    onSuccess: (data: { createdDocs: number }) => {
      updateLocalAnswers("KB", "appliedDocs", true);
      updateLocalAnswers("KB", "docCount", data.createdDocs);
      setDrafts([]);
      toast({ title: "Документы добавлены", description: `${data.createdDocs} документов добавлено в базу знаний` });
    },
    onError: () => {
      toast({ title: "Не удалось применить шаблоны", variant: "destructive" });
    },
  });

  const [smokeTestResults, setSmokeTestResults] = useState<SmokeTestResponse | null>(null);
  const [smokeTestProgress, setSmokeTestProgress] = useState<{ current: number; total: number } | null>(null);
  const [isSmokeTestRunning, setIsSmokeTestRunning] = useState(false);

  const runSmokeTestWithProgress = async () => {
    setIsSmokeTestRunning(true);
    setSmokeTestProgress({ current: 0, total: 5 });
    setSmokeTestResults(null);

    try {
      const response = await fetch("/api/onboarding/run-smoke-test/stream", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to start smoke test");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));
            if (data.type === "progress") {
              setSmokeTestProgress({ current: data.current + 1, total: data.total });
            } else if (data.type === "complete") {
              setSmokeTestResults(data);
              setSmokeTestProgress(null);
              const statusText = data.check.status === "PASS" ? "пройден" : data.check.status === "WARN" ? "частично пройден" : "не пройден";
              toast({ 
                title: `Smoke-тест ${statusText}`, 
                description: `${data.passedCount} из ${data.totalCount} тестов успешно`,
                variant: data.check.status === "FAIL" ? "destructive" : "default",
              });
            } else if (data.type === "error") {
              throw new Error(data.error);
            }
          }
        }
      }
    } catch (error) {
      toast({ title: "Не удалось запустить smoke-тест", variant: "destructive" });
      setSmokeTestProgress(null);
    } finally {
      setIsSmokeTestRunning(false);
    }
  };

  const currentStep = STEPS_CONFIG[currentStepIndex];
  const isLastStep = currentStepIndex === STEPS_CONFIG.length - 1;
  const completedSteps = onboardingState?.completedSteps ?? [];

  const updateLocalAnswers = (step: WizardStep, field: string, value: unknown) => {
    setLocalAnswers(prev => ({
      ...prev,
      [step]: {
        ...(prev[step] ?? {}),
        [field]: value,
      },
    }));
  };

  const handleNext = async () => {
    const stepId = currentStep.id as WizardStep;
    const stepAnswers = localAnswers[stepId] ?? {};
    
    await completeStepMutation.mutateAsync({ step: stepId, answers: stepAnswers });
    
    if (!isLastStep) {
      setCurrentStepIndex(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  };

  const handleComplete = async () => {
    await completeStepMutation.mutateAsync({ step: "REVIEW", answers: { confirmed: true } });
    toast({ title: "Настройка завершена! Добро пожаловать в AI Sales Operator." });
    setLocation("/");
  };

  const handleSkipToStep = (index: number) => {
    if (index <= currentStepIndex || completedSteps.includes(STEPS_CONFIG[index - 1]?.id)) {
      setCurrentStepIndex(index);
    }
  };

  const progress = ((currentStepIndex + 1) / STEPS_CONFIG.length) * 100;

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="w-full max-w-2xl space-y-6">
          <div className="text-center">
            <Skeleton className="mx-auto h-16 w-16 rounded-full" />
            <Skeleton className="mx-auto mt-4 h-8 w-64" />
            <Skeleton className="mx-auto mt-2 h-4 w-48" />
          </div>
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary">
            <Bot className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="mt-4 text-3xl font-semibold">Добро пожаловать в AI Sales Operator</h1>
          <p className="mt-2 text-muted-foreground">
            Настроим вашего ИИ-помощника за несколько минут
          </p>
        </div>

        <div className="space-y-4">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between gap-1">
            {STEPS_CONFIG.map((step, index) => {
              const isCompleted = completedSteps.includes(step.id);
              const isCurrent = index === currentStepIndex;
              const isClickable = index <= currentStepIndex || (index > 0 && completedSteps.includes(STEPS_CONFIG[index - 1]?.id));
              
              return (
                <button
                  key={step.id}
                  onClick={() => isClickable && handleSkipToStep(index)}
                  disabled={!isClickable}
                  className={`flex items-center gap-2 transition-colors ${
                    isCurrent
                      ? "text-primary"
                      : isCompleted
                      ? "text-muted-foreground cursor-pointer hover:text-primary"
                      : "text-muted-foreground/50 cursor-not-allowed"
                  }`}
                  data-testid={`step-indicator-${step.id.toLowerCase()}`}
                >
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${
                      isCurrent
                        ? "border-primary bg-primary text-primary-foreground"
                        : isCompleted
                        ? "border-primary bg-primary/10"
                        : "border-muted"
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <step.icon className="h-4 w-4" />
                    )}
                  </div>
                  <span className="hidden text-sm font-medium lg:inline">
                    {step.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{currentStep.title}</CardTitle>
            <CardDescription>{currentStep.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentStep.id === "BUSINESS" && (
              <>
                <div>
                  <label className="text-sm font-medium">Название компании</label>
                  <Input
                    placeholder="Название вашего магазина"
                    value={(localAnswers.BUSINESS?.name as string) ?? ""}
                    onChange={(e) => updateLocalAnswers("BUSINESS", "name", e.target.value)}
                    className="mt-1"
                    data-testid="input-onboarding-name"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium">Валюта</label>
                    <Select
                      value={(localAnswers.BUSINESS?.currency as string) ?? "RUB"}
                      onValueChange={(v) => updateLocalAnswers("BUSINESS", "currency", v)}
                    >
                      <SelectTrigger className="mt-1" data-testid="select-onboarding-currency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="RUB">RUB (Российский рубль)</SelectItem>
                        <SelectItem value="USD">USD (Доллар США)</SelectItem>
                        <SelectItem value="EUR">EUR (Евро)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Часовой пояс</label>
                    <Select
                      value={(localAnswers.BUSINESS?.timezone as string) ?? "Europe/Moscow"}
                      onValueChange={(v) => updateLocalAnswers("BUSINESS", "timezone", v)}
                    >
                      <SelectTrigger className="mt-1" data-testid="select-onboarding-timezone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Europe/Moscow">Москва</SelectItem>
                        <SelectItem value="Europe/Kiev">Киев</SelectItem>
                        <SelectItem value="Europe/London">Лондон</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Категории товаров</label>
                  <Input
                    placeholder="напр., Электроника, Одежда, Дом и сад"
                    value={(localAnswers.BUSINESS?.categories as string) ?? ""}
                    onChange={(e) => updateLocalAnswers("BUSINESS", "categories", e.target.value)}
                    className="mt-1"
                    data-testid="input-onboarding-categories"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">География продаж</label>
                  <Input
                    placeholder="напр., Россия, страны СНГ"
                    value={(localAnswers.BUSINESS?.geography as string) ?? ""}
                    onChange={(e) => updateLocalAnswers("BUSINESS", "geography", e.target.value)}
                    className="mt-1"
                    data-testid="input-onboarding-geography"
                  />
                </div>
              </>
            )}

            {currentStep.id === "CHANNELS" && (
              <>
                <SubscriptionPaywall 
                  open={showPaywall} 
                  onOpenChange={setShowPaywall}
                  trigger="channel"
                />
                
                {!hasSubscription && (
                  <div 
                    className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4"
                    data-testid="banner-onboarding-subscription"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-500/10">
                        <Lock className="h-4 w-4 text-yellow-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm" data-testid="text-onboarding-subscription-required">
                          Для подключения каналов нужна подписка
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Вы можете выбрать каналы сейчас, но подключение станет доступно после активации подписки
                        </p>
                        <Button 
                          size="sm" 
                          variant="outline"
                          className="mt-2"
                          onClick={() => setShowPaywall(true)}
                          data-testid="button-onboarding-subscribe"
                        >
                          <Zap className="mr-2 h-3 w-3" />
                          Узнать о подписке $50/мес
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="space-y-3">
                  <label className="text-sm font-medium">Выберите каналы связи</label>
                  <p className="text-sm text-muted-foreground">
                    Выберите мессенджеры для связи с клиентами
                  </p>
                  {["telegram", "whatsapp", "vk", "web"].map((channel) => {
                    const channels = (localAnswers.CHANNELS?.channels ?? []) as string[];
                    const isSelected = channels.includes(channel);
                    return (
                      <div key={channel} className="flex items-center justify-between rounded-md border p-4">
                        <div>
                          <div className="font-medium capitalize">{channel === "vk" ? "VK / MAX" : channel}</div>
                          <div className="text-sm text-muted-foreground">
                            {channel === "telegram" && "Подключите Telegram-бота"}
                            {channel === "whatsapp" && "Интеграция с WhatsApp Business"}
                            {channel === "vk" && "Мессенджер VK Teams / MAX"}
                            {channel === "web" && "Веб-чат виджет"}
                          </div>
                        </div>
                        <Switch
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            const newChannels = checked
                              ? [...channels, channel]
                              : channels.filter(c => c !== channel);
                            updateLocalAnswers("CHANNELS", "channels", newChannels);
                          }}
                          data-testid={`switch-channel-${channel}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {currentStep.id === "PRODUCTS" && (
              <>
                <div className="rounded-md border p-6 text-center">
                  {addedProductsCount > 0 ? (
                    <>
                      <Check className="mx-auto h-12 w-12 text-green-600" />
                      <h3 className="mt-4 font-medium text-green-800 dark:text-green-200">
                        Добавлено товаров: {addedProductsCount}
                      </h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Вы можете добавить ещё товаров или перейти к следующему шагу
                      </p>
                    </>
                  ) : (
                    <>
                      <Package className="mx-auto h-12 w-12 text-muted-foreground" />
                      <h3 className="mt-4 font-medium">Каталог товаров</h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Вы можете добавить товары сейчас или позже в разделе Товары
                      </p>
                    </>
                  )}
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center sm:flex-wrap">
                    <Button
                      onClick={() => setIsProductDialogOpen(true)}
                      data-testid="button-add-products"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Добавить товар
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setIsImportDialogOpen(true)}
                      data-testid="button-import-products"
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Импорт из файла
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        updateLocalAnswers("PRODUCTS", "hasProducts", addedProductsCount > 0);
                        await completeStepMutation.mutateAsync({ step: "PRODUCTS", answers: { hasProducts: addedProductsCount > 0 } });
                        setCurrentStepIndex(prev => prev + 1);
                      }}
                      disabled={completeStepMutation.isPending}
                      data-testid="button-skip-products"
                    >
                      {completeStepMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      {addedProductsCount > 0 ? "Продолжить" : "Добавлю позже"}
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Товары помогают ИИ давать точную информацию о ценах, наличии и рекомендациях клиентам.
                </p>
                
                <Dialog open={isProductDialogOpen} onOpenChange={setIsProductDialogOpen}>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Добавить товар</DialogTitle>
                    </DialogHeader>
                    <Form {...productForm}>
                      <form onSubmit={productForm.handleSubmit(handleAddProduct)} className="space-y-4">
                        <FormField
                          control={productForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Название</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Название товара"
                                  {...field}
                                  data-testid="input-product-name"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid gap-4 sm:grid-cols-2">
                          <FormField
                            control={productForm.control}
                            name="sku"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Артикул</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="SKU-001"
                                    {...field}
                                    data-testid="input-product-sku"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={productForm.control}
                            name="price"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Цена</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    {...field}
                                    data-testid="input-product-price"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <FormField
                          control={productForm.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Категория</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="напр., Электроника"
                                  {...field}
                                  data-testid="input-product-category"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={productForm.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Описание</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Описание товара..."
                                  {...field}
                                  data-testid="textarea-product-description"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <DialogFooter>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsProductDialogOpen(false)}
                          >
                            Отмена
                          </Button>
                          <Button
                            type="submit"
                            disabled={createProductMutation.isPending}
                            data-testid="button-save-product"
                          >
                            {createProductMutation.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Plus className="mr-2 h-4 w-4" />
                            )}
                            Добавить
                          </Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
                
                <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Импорт товаров из файла</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Загрузите CSV-файл с колонками: name, sku, description, price, category, inStock
                      </p>
                      <div
                        className="flex flex-col items-center justify-center rounded-md border-2 border-dashed p-8 cursor-pointer hover-elevate"
                        onClick={() => fileInputRef.current?.click()}
                        data-testid="dropzone-csv"
                      >
                        <FileSpreadsheet className="h-12 w-12 text-muted-foreground" />
                        <p className="mt-2 text-sm text-muted-foreground">
                          Нажмите для загрузки файла
                        </p>
                        <p className="text-xs text-muted-foreground">CSV файлы</p>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".csv"
                          className="hidden"
                          onChange={handleFileUpload}
                          data-testid="input-csv-file"
                        />
                      </div>
                      {importProductsMutation.isPending && (
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-sm">Импортируем товары...</span>
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>
                        Закрыть
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            )}

            {currentStep.id === "POLICIES" && (
              <>
                <div>
                  <label className="text-sm font-medium">Варианты доставки</label>
                  <Textarea
                    placeholder="напр., Стандартная доставка, Экспресс-доставка, Пункты выдачи"
                    value={(localAnswers.POLICIES?.deliveryOptions as string) ?? ""}
                    onChange={(e) => updateLocalAnswers("POLICIES", "deliveryOptions", e.target.value)}
                    className="mt-1"
                    data-testid="textarea-onboarding-delivery"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Сроки доставки</label>
                  <Input
                    placeholder="напр., 3-5 рабочих дней"
                    value={(localAnswers.POLICIES?.deliveryTimes as string) ?? ""}
                    onChange={(e) => updateLocalAnswers("POLICIES", "deliveryTimes", e.target.value)}
                    className="mt-1"
                    data-testid="input-onboarding-times"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Политика возврата</label>
                  <Textarea
                    placeholder="Опишите условия возврата и обмена товаров..."
                    value={(localAnswers.POLICIES?.returnPolicy as string) ?? ""}
                    onChange={(e) => updateLocalAnswers("POLICIES", "returnPolicy", e.target.value)}
                    className="mt-1"
                    data-testid="textarea-onboarding-returns"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Способы оплаты</label>
                  <Input
                    placeholder="напр., Карта, Наложенный платёж, Банковский перевод"
                    value={(localAnswers.POLICIES?.paymentMethods as string) ?? ""}
                    onChange={(e) => updateLocalAnswers("POLICIES", "paymentMethods", e.target.value)}
                    className="mt-1"
                    data-testid="input-onboarding-payment"
                  />
                </div>
              </>
            )}

            {currentStep.id === "KB" && (
              <>
                {localAnswers.KB?.appliedDocs ? (
                  <div className="rounded-md border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-900/20">
                    <Check className="mx-auto h-12 w-12 text-green-600" />
                    <h3 className="mt-4 font-medium text-green-800 dark:text-green-200">Документы добавлены</h3>
                    <p className="mt-2 text-sm text-green-700 dark:text-green-300">
                      {localAnswers.KB?.docCount || 0} документов добавлено в базу знаний
                    </p>
                  </div>
                ) : drafts.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">Предпросмотр шаблонов</h3>
                      <Button
                        onClick={() => applyTemplatesMutation.mutate()}
                        disabled={applyTemplatesMutation.isPending}
                        data-testid="button-apply-templates"
                      >
                        {applyTemplatesMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="mr-2 h-4 w-4" />
                        )}
                        Применить все
                      </Button>
                    </div>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {drafts.map((draft, idx) => (
                        <div key={idx} className="rounded-md border p-4">
                          <div className="flex items-center justify-between mb-2">
                            {editingDraft === idx ? (
                              <Input
                                value={draft.title}
                                onChange={(e) => {
                                  const newDrafts = [...drafts];
                                  newDrafts[idx] = { ...draft, title: e.target.value };
                                  setDrafts(newDrafts);
                                }}
                                className="flex-1 mr-2"
                                data-testid={`input-draft-title-${idx}`}
                              />
                            ) : (
                              <h4 className="font-medium">{draft.title}</h4>
                            )}
                            <div className="flex gap-2">
                              <span className="text-xs px-2 py-1 rounded bg-muted">{draft.docType}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingDraft(editingDraft === idx ? null : idx)}
                                data-testid={`button-edit-draft-${idx}`}
                              >
                                {editingDraft === idx ? "Готово" : "Редактировать"}
                              </Button>
                            </div>
                          </div>
                          {editingDraft === idx ? (
                            <Textarea
                              value={draft.content}
                              onChange={(e) => {
                                const newDrafts = [...drafts];
                                newDrafts[idx] = { ...draft, content: e.target.value };
                                setDrafts(newDrafts);
                              }}
                              className="min-h-32"
                              data-testid={`textarea-draft-content-${idx}`}
                            />
                          ) : (
                            <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-line">
                              {draft.content.slice(0, 200)}...
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border p-6 text-center">
                    <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
                    <h3 className="mt-4 font-medium">База знаний</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Сгенерируйте шаблоны документов на основе данных вашего бизнеса
                    </p>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
                      <Button
                        onClick={() => generateTemplatesMutation.mutate()}
                        disabled={generateTemplatesMutation.isPending}
                        data-testid="button-generate-templates"
                      >
                        {generateTemplatesMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Bot className="mr-2 h-4 w-4" />
                        )}
                        Сгенерировать шаблоны
                      </Button>
                      <Button
                        variant="outline"
                        onClick={async () => {
                          updateLocalAnswers("KB", "skipped", true);
                          await completeStepMutation.mutateAsync({ step: "KB", answers: { skipped: true } });
                          setCurrentStepIndex(prev => prev + 1);
                        }}
                        disabled={completeStepMutation.isPending}
                        data-testid="button-skip-kb"
                      >
                        {completeStepMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        Пропустить
                      </Button>
                    </div>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  Документы базы знаний помогают ИИ точно отвечать на вопросы клиентов.
                </p>
              </>
            )}

            {currentStep.id === "REVIEW" && (
              <>
                <div className="space-y-4">
                  <div className="rounded-md bg-muted/50 p-4">
                    <h4 className="font-medium">Итоги настройки</h4>
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Название компании:</span>
                        <span>{localAnswers.BUSINESS?.name || "Не указано"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Валюта:</span>
                        <span>{localAnswers.BUSINESS?.currency || "RUB"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Каналы:</span>
                        <span>{(localAnswers.CHANNELS?.channels as string[])?.join(", ") || "Не выбраны"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Пройдено шагов:</span>
                        <span>{completedSteps.length} из {STEPS_CONFIG.length - 1}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border p-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <h4 className="font-medium flex items-center gap-2">
                          <Beaker className="h-4 w-4" />
                          Smoke-тест AI
                        </h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          Проверьте, как AI отвечает на типовые вопросы клиентов
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={runSmokeTestWithProgress}
                        disabled={isSmokeTestRunning}
                        data-testid="button-run-smoke-test"
                      >
                        {isSmokeTestRunning ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Beaker className="mr-2 h-4 w-4" />
                        )}
                        {smokeTestProgress 
                          ? `${smokeTestProgress.current}/${smokeTestProgress.total}...` 
                          : "Запустить тест"}
                      </Button>
                    </div>

                    {smokeTestResults && (
                      <div className="mt-4 space-y-3">
                        <div className="flex items-center gap-2">
                          {smokeTestResults.check.status === "PASS" ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : smokeTestResults.check.status === "WARN" ? (
                            <AlertTriangle className="h-5 w-5 text-yellow-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-500" />
                          )}
                          <span className="font-medium">
                            {smokeTestResults.passedCount} / {smokeTestResults.totalCount} тестов пройдено
                          </span>
                        </div>

                        <div className="space-y-2">
                          {smokeTestResults.results.map((result, idx) => (
                            <div
                              key={idx}
                              className={`rounded-md p-3 text-sm ${
                                result.passed 
                                  ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800" 
                                  : "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
                              }`}
                              data-testid={`smoke-test-result-${idx}`}
                            >
                              <div className="flex items-start gap-2">
                                {result.passed ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium truncate">{result.question}</p>
                                  <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                                    <span>Намерение: {result.intent || "—"}</span>
                                    <span>Решение: {result.decision}</span>
                                    <span>Источники: {result.usedSourcesCount}</span>
                                    {result.hasStaleData && (
                                      <span className="text-yellow-600 dark:text-yellow-400">Устаревшие данные</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {smokeTestResults.recommendations.length > 0 && (
                          <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 p-3">
                            <h5 className="font-medium text-sm mb-2">Рекомендации</h5>
                            <ul className="text-sm text-muted-foreground space-y-1">
                              {smokeTestResults.recommendations.map((rec, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                  <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                                  {rec}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Вы всегда можете изменить эти настройки позже в разделе Настройки.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between gap-4">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStepIndex === 0 || completeStepMutation.isPending}
            data-testid="button-onboarding-back"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Назад
          </Button>
          {!isLastStep ? (
            <Button 
              onClick={handleNext} 
              disabled={completeStepMutation.isPending}
              data-testid="button-onboarding-next"
            >
              {completeStepMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Далее
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleComplete}
              disabled={completeStepMutation.isPending}
              data-testid="button-onboarding-complete"
            >
              {completeStepMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Завершить настройку
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
