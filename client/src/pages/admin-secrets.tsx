import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Key, Shield, Check, X, RotateCw, MessageCircle, Send, Coins, Bot, MessageSquare, Eye, EyeOff, Bell, Database } from "lucide-react";
import { SiTelegram, SiWhatsapp, SiOpenai } from "react-icons/si";

interface SecretMetadata {
  id: string;
  scope: "global" | "tenant";
  tenantId: string | null;
  keyName: string;
  last4: string | null;
  createdAt: string;
  updatedAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
}

interface SecretsResponse {
  secrets: SecretMetadata[];
  pagination: { limit: number; offset: number; count: number };
}

interface IntegrationConfig {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  secrets: {
    keyName: string;
    label: string;
    placeholder: string;
    required: boolean;
    hint?: string;
  }[];
}

const INTEGRATIONS: IntegrationConfig[] = [
  {
    id: "telegram",
    name: "Telegram Bot",
    description: "Бот для общения с клиентами через Telegram",
    icon: <SiTelegram className="h-6 w-6" />,
    color: "bg-[#0088cc]",
    secrets: [
      {
        keyName: "TELEGRAM_BOT_TOKEN",
        label: "Bot Token",
        placeholder: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
        required: true,
        hint: "Получите у @BotFather в Telegram",
      },
    ],
  },
  {
    id: "telegram-personal",
    name: "Telegram Personal",
    description: "Подключение личного аккаунта Telegram через MTProto",
    icon: <SiTelegram className="h-6 w-6" />,
    color: "bg-[#8B5CF6]",
    secrets: [
      {
        keyName: "TELEGRAM_API_ID",
        label: "API ID",
        placeholder: "12345678",
        required: true,
        hint: "Получите на my.telegram.org → API development tools",
      },
      {
        keyName: "TELEGRAM_API_HASH",
        label: "API Hash",
        placeholder: "0123456789abcdef0123456789abcdef",
        required: true,
        hint: "Секретный хеш с my.telegram.org",
      },
    ],
  },
  {
    id: "telegram-escalation",
    name: "Telegram для эскалаций",
    description: "Бот для отправки уведомлений об эскалированных разговорах",
    icon: <Bell className="h-6 w-6" />,
    color: "bg-[#FF6B35]",
    secrets: [
      {
        keyName: "TELEGRAM_ESCALATION_BOT_TOKEN",
        label: "Bot Token",
        placeholder: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
        required: true,
        hint: "Создайте отдельного бота у @BotFather для уведомлений",
      },
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    description: "Официальный WhatsApp Business API",
    icon: <SiWhatsapp className="h-6 w-6" />,
    color: "bg-[#25D366]",
    secrets: [
      {
        keyName: "WHATSAPP_ACCESS_TOKEN",
        label: "Access Token",
        placeholder: "EAAxxxxxxx...",
        required: true,
        hint: "Токен из Meta Business Suite",
      },
      {
        keyName: "WHATSAPP_PHONE_NUMBER_ID",
        label: "Phone Number ID",
        placeholder: "123456789012345",
        required: true,
        hint: "ID номера из WhatsApp Business API",
      },
      {
        keyName: "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
        label: "Webhook Verify Token",
        placeholder: "your-verify-token",
        required: false,
        hint: "Токен для верификации вебхука",
      },
    ],
  },
  {
    id: "max",
    name: "MAX (VK Teams)",
    description: "Мессенджер MAX (VK Teams) для корпоративного общения",
    icon: <MessageSquare className="h-6 w-6" />,
    color: "bg-[#0077FF]",
    secrets: [
      {
        keyName: "MAX_TOKEN",
        label: "Bot Token",
        placeholder: "xxx.xxx.xxx",
        required: true,
        hint: "Токен бота из настроек MAX",
      },
    ],
  },
  {
    id: "cryptobot",
    name: "CryptoBot",
    description: "Криптовалютные платежи через Telegram CryptoBot",
    icon: <Coins className="h-6 w-6" />,
    color: "bg-[#F7931A]",
    secrets: [
      {
        keyName: "CRYPTO_PAY_API_TOKEN",
        label: "API Token",
        placeholder: "12345:AAxxxxxxx...",
        required: true,
        hint: "Получите в @CryptoBot → Crypto Pay → API",
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT модели для генерации ответов AI",
    icon: <SiOpenai className="h-6 w-6" />,
    color: "bg-[#10a37f]",
    secrets: [
      {
        keyName: "OPENAI_API_KEY",
        label: "API Key",
        placeholder: "sk-xxxxxxxxxxxxxxxx",
        required: true,
        hint: "Ключ API из platform.openai.com",
      },
    ],
  },
  {
    id: "partsapi",
    name: "PartsAPI",
    description: "Декодирование VIN по оригинальным каталогам (partsapi.ru)",
    icon: <Database className="h-6 w-6" />,
    color: "bg-[#6366f1]",
    secrets: [
      {
        keyName: "PARTSAPI_KEY",
        label: "API Key",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        required: false,
        hint: "Ключ API из личного кабинета partsapi.ru",
      },
    ],
  },
];

export default function AdminSecrets() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("integrations");
  const [editModal, setEditModal] = useState<{ open: boolean; integration: IntegrationConfig | null; secretKey: string }>({
    open: false,
    integration: null,
    secretKey: "",
  });
  const [secretValue, setSecretValue] = useState("");
  const [reason, setReason] = useState("");
  const [showValue, setShowValue] = useState(false);

  const { data, isLoading, error } = useQuery<SecretsResponse>({
    queryKey: ["/api/admin/secrets"],
    queryFn: async () => {
      const res = await fetch("/api/admin/secrets?limit=50", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch secrets");
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async ({ keyName, value, reason }: { keyName: string; value: string; reason: string }) => {
      return apiRequest("POST", "/api/admin/secrets", {
        scope: "global",
        keyName,
        plaintextValue: value,
        reason,
      });
    },
    onSuccess: () => {
      toast({ title: "Сохранено", description: "Секрет успешно сохранён" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/secrets"] });
      closeModal();
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message || "Не удалось сохранить секрет", variant: "destructive" });
    },
  });

  const closeModal = () => {
    setEditModal({ open: false, integration: null, secretKey: "" });
    setSecretValue("");
    setReason("");
    setShowValue(false);
  };

  const getSecretStatus = (keyName: string): { configured: boolean; last4: string | null; secret: SecretMetadata | null } => {
    if (!data?.secrets) return { configured: false, last4: null, secret: null };
    const secret = data.secrets.find((s) => s.keyName === keyName && s.scope === "global" && !s.revokedAt);
    return { configured: !!secret, last4: secret?.last4 || null, secret: secret || null };
  };

  const getIntegrationStatus = (integration: IntegrationConfig): "configured" | "partial" | "not_configured" => {
    const requiredSecrets = integration.secrets.filter((s) => s.required);
    const configuredRequired = requiredSecrets.filter((s) => getSecretStatus(s.keyName).configured);
    
    if (configuredRequired.length === requiredSecrets.length) return "configured";
    if (configuredRequired.length > 0) return "partial";
    return "not_configured";
  };

  const openEditModal = (integration: IntegrationConfig, secretKey: string) => {
    setEditModal({ open: true, integration, secretKey });
    setSecretValue("");
    setReason("");
    setShowValue(false);
  };

  const handleSave = () => {
    if (!editModal.secretKey || !secretValue || !reason) return;
    saveMutation.mutate({ keyName: editModal.secretKey, value: secretValue, reason });
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("ru-RU");
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Интеграции и API ключи</h1>
          <p className="text-muted-foreground">Управление всеми интеграциями платформы</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="integrations" data-testid="tab-integrations">Интеграции</TabsTrigger>
          <TabsTrigger value="all-secrets" data-testid="tab-all-secrets">Все секреты</TabsTrigger>
        </TabsList>

        <TabsContent value="integrations" className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : error ? (
            <Card>
              <CardContent className="p-8 text-center text-destructive">
                Не удалось загрузить секреты. Проверьте подключение.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {INTEGRATIONS.map((integration) => {
                const status = getIntegrationStatus(integration);
                return (
                  <Card key={integration.id} className="relative overflow-visible" data-testid={`card-integration-${integration.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg text-white ${integration.color}`}>
                          {integration.icon}
                        </div>
                        <div className="flex-1">
                          <CardTitle className="text-lg flex items-center gap-2">
                            {integration.name}
                            {status === "configured" && (
                              <Badge variant="default" className="bg-green-600">
                                <Check className="h-3 w-3 mr-1" />
                                Настроено
                              </Badge>
                            )}
                            {status === "partial" && (
                              <Badge variant="secondary" className="bg-yellow-600 text-white">
                                Частично
                              </Badge>
                            )}
                            {status === "not_configured" && (
                              <Badge variant="outline">
                                <X className="h-3 w-3 mr-1" />
                                Не настроено
                              </Badge>
                            )}
                          </CardTitle>
                          <CardDescription className="text-sm">{integration.description}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {integration.secrets.map((secretDef) => {
                        const { configured, last4 } = getSecretStatus(secretDef.keyName);
                        return (
                          <div
                            key={secretDef.keyName}
                            className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <Key className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium text-sm">{secretDef.label}</span>
                                {secretDef.required && (
                                  <span className="text-xs text-destructive">*</span>
                                )}
                              </div>
                              {configured && last4 && (
                                <span className="text-xs text-muted-foreground font-mono ml-6">
                                  ****{last4}
                                </span>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant={configured ? "outline" : "default"}
                              onClick={() => openEditModal(integration, secretDef.keyName)}
                              data-testid={`button-edit-${secretDef.keyName}`}
                            >
                              {configured ? (
                                <>
                                  <RotateCw className="h-3 w-3 mr-1" />
                                  Изменить
                                </>
                              ) : (
                                <>
                                  <Key className="h-3 w-3 mr-1" />
                                  Добавить
                                </>
                              )}
                            </Button>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="all-secrets" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Все секреты</CardTitle>
              <CardDescription>
                {data?.secrets?.length || 0} секрет(ов) в системе
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : error ? (
                <p className="text-destructive text-center p-4">Не удалось загрузить секреты</p>
              ) : data?.secrets?.length === 0 ? (
                <p className="text-center text-muted-foreground p-8">Секреты не найдены</p>
              ) : (
                <div className="space-y-2">
                  {data?.secrets?.map((secret) => (
                    <div
                      key={secret.id}
                      className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                      data-testid={`row-secret-${secret.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Key className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-mono font-medium">{secret.keyName}</div>
                          <div className="text-xs text-muted-foreground">
                            {secret.scope === "global" ? "Глобальный" : `Тенант: ${secret.tenantId?.slice(0, 8)}...`}
                            {secret.last4 && <span className="ml-2">****{secret.last4}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {secret.revokedAt ? (
                          <Badge variant="destructive">Отозван</Badge>
                        ) : (
                          <Badge variant="default">Активен</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDate(secret.updatedAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editModal.open} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              {getSecretStatus(editModal.secretKey).configured ? "Изменить секрет" : "Добавить секрет"}
            </DialogTitle>
            <DialogDescription>
              {editModal.integration && (
                <span className="flex items-center gap-2">
                  <span className={`p-1 rounded text-white ${editModal.integration.color}`}>
                    {editModal.integration.icon}
                  </span>
                  {editModal.integration.name}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Ключ</Label>
              <Input
                value={editModal.secretKey}
                disabled
                className="font-mono bg-muted"
              />
            </div>
            {editModal.integration?.secrets.find((s) => s.keyName === editModal.secretKey)?.hint && (
              <p className="text-sm text-muted-foreground">
                {editModal.integration.secrets.find((s) => s.keyName === editModal.secretKey)?.hint}
              </p>
            )}
            <div className="space-y-2">
              <Label>Значение</Label>
              <div className="relative">
                <Input
                  type={showValue ? "text" : "password"}
                  placeholder={editModal.integration?.secrets.find((s) => s.keyName === editModal.secretKey)?.placeholder}
                  value={secretValue}
                  onChange={(e) => setSecretValue(e.target.value)}
                  className="pr-10"
                  data-testid="input-secret-value"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowValue(!showValue)}
                >
                  {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Причина изменения</Label>
              <Textarea
                placeholder="Например: Первоначальная настройка интеграции"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="input-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>
              Отмена
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending || !secretValue || !reason}
              data-testid="button-save-secret"
            >
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
