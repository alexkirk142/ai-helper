import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Shield, ShieldCheck, ShieldAlert, Info, CheckCircle, AlertTriangle, XCircle, Loader2, Cpu, HardDrive, Users, Database, Activity, Server } from "lucide-react";

interface SecurityReadinessReport {
  piiMasking: "OK" | "WARN";
  piiMaskingDetails: string[];
  rbacCoverage: number;
  rbacDetails: {
    protectedEndpoints: number;
    totalApiEndpoints: number;
    protectedEndpointsList: string[];
    unprotectedEndpoints: string[];
  };
  webhookVerification: {
    telegram: boolean;
    whatsapp: boolean;
    max: boolean;
  };
  rateLimiting: {
    public: boolean;
    webhook: boolean;
    ai: boolean;
    onboarding: boolean;
    conversation: boolean;
  };
  dataDeletion: boolean;
  auditCoverage: "OK" | "WARN";
  auditDetails: {
    presentEvents: string[];
    missingEvents: string[];
  };
  generatedAt: string;
}

interface SystemMetrics {
  cpu: {
    cores: number;
    usagePercent: number;
    model: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  system: {
    platform: string;
    arch: string;
    hostname: string;
    uptime: {
      seconds: number;
      formatted: string;
    };
    loadAverage: {
      "1min": number;
      "5min": number;
      "15min": number;
    };
  };
  database: {
    activeConnections: number;
  } | null;
  users: {
    totalUsers: number;
    activeLast24h: number;
    activeLast7d: number;
    totalTenants: number;
  };
  recommendations: Array<{
    type: string;
    message: string;
  }>;
  generatedAt: string;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

function UsageBar({ percent, color, testId }: { percent: number; color: string; testId?: string }) {
  return (
    <div className="w-full bg-muted rounded-full h-3" data-testid={testId}>
      <div
        className={`h-3 rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: "OK" | "WARN" | boolean }) {
  if (status === true || status === "OK") {
    return (
      <Badge variant="default" data-testid="badge-status-ok">
        <CheckCircle className="w-3 h-3 mr-1" />
        OK
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" data-testid="badge-status-warn">
      <AlertTriangle className="w-3 h-3 mr-1" />
      WARN
    </Badge>
  );
}

function BooleanStatus({ value }: { value: boolean }) {
  if (value) {
    return <CheckCircle className="w-5 h-5 text-green-600" data-testid="icon-check" />;
  }
  return <XCircle className="w-5 h-5 text-red-600" data-testid="icon-x" />;
}

export default function SecurityStatus() {
  const { data: report, isLoading, error } = useQuery<SecurityReadinessReport>({
    queryKey: ["/api/admin/security/readiness"],
    refetchInterval: 60000,
  });

  const { data: metrics, isLoading: metricsLoading } = useQuery<SystemMetrics>({
    queryKey: ["/api/admin/system/metrics"],
    refetchInterval: 10000, // Refresh every 10 seconds for real-time monitoring
  });

  if (isLoading || metricsLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="loading-spinner">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <ShieldAlert className="w-5 h-5" />
              Ошибка загрузки
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Не удалось загрузить отчёт о безопасности. Убедитесь, что у вас есть права администратора.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!report) {
    return null;
  }

  const getCpuColor = (percent: number) => {
    if (percent >= 80) return "bg-red-500";
    if (percent >= 60) return "bg-yellow-500";
    return "bg-green-500";
  };

  const getMemoryColor = (percent: number) => {
    if (percent >= 85) return "bg-red-500";
    if (percent >= 70) return "bg-yellow-500";
    return "bg-green-500";
  };

  return (
    <div className="p-6 space-y-6" data-testid="security-status-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Мониторинг системы</h1>
            <p className="text-sm text-muted-foreground">
              Обновлено: {new Date(report.generatedAt).toLocaleString("ru-RU")}
            </p>
          </div>
        </div>
      </div>

      {/* System Load Section */}
      {metrics && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card data-testid="card-cpu">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Cpu className="w-4 h-4" />
                    CPU
                  </CardTitle>
                  <span className="text-2xl font-bold" data-testid="text-cpu-percent">{metrics.cpu.usagePercent}%</span>
                </div>
              </CardHeader>
              <CardContent>
                <UsageBar percent={metrics.cpu.usagePercent} color={getCpuColor(metrics.cpu.usagePercent)} testId="bar-cpu-usage" />
                <p className="text-xs text-muted-foreground mt-2" data-testid="text-cpu-cores">{metrics.cpu.cores} ядер</p>
              </CardContent>
            </Card>

            <Card data-testid="card-memory">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <HardDrive className="w-4 h-4" />
                    Память
                  </CardTitle>
                  <span className="text-2xl font-bold" data-testid="text-memory-percent">{metrics.memory.usagePercent}%</span>
                </div>
              </CardHeader>
              <CardContent>
                <UsageBar percent={metrics.memory.usagePercent} color={getMemoryColor(metrics.memory.usagePercent)} testId="bar-memory-usage" />
                <p className="text-xs text-muted-foreground mt-2" data-testid="text-memory-details">
                  {formatBytes(metrics.memory.used)} / {formatBytes(metrics.memory.total)}
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-users-stats">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Пользователи
                  </CardTitle>
                  <span className="text-2xl font-bold" data-testid="text-total-users">{metrics.users.totalUsers}</span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Активны за 24ч:</span>
                    <span className="font-medium" data-testid="text-active-24h">{metrics.users.activeLast24h}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Активны за 7д:</span>
                    <span className="font-medium" data-testid="text-active-7d">{metrics.users.activeLast7d}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-tenants">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Server className="w-4 h-4" />
                    Тенанты
                  </CardTitle>
                  <span className="text-2xl font-bold" data-testid="text-total-tenants">{metrics.users.totalTenants}</span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Uptime:</span>
                    <span className="font-medium" data-testid="text-uptime">{metrics.system.uptime.formatted}</span>
                  </div>
                  {metrics.database && (
                    <div className="flex justify-between">
                      <span>DB соединения:</span>
                      <span className="font-medium" data-testid="text-db-connections">{metrics.database.activeConnections}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card data-testid="card-load-average">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Load Average
              </CardTitle>
              <CardDescription>
                Средняя нагрузка за 1, 5 и 15 минут (рекомендуется &lt; {metrics.cpu.cores})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="text-center">
                  <div className={`text-3xl font-bold ${metrics.system.loadAverage["1min"] > metrics.cpu.cores ? "text-red-500" : ""}`} data-testid="text-load-1min">
                    {metrics.system.loadAverage["1min"]}
                  </div>
                  <p className="text-sm text-muted-foreground">1 мин</p>
                </div>
                <div className="text-center">
                  <div className={`text-3xl font-bold ${metrics.system.loadAverage["5min"] > metrics.cpu.cores ? "text-red-500" : ""}`} data-testid="text-load-5min">
                    {metrics.system.loadAverage["5min"]}
                  </div>
                  <p className="text-sm text-muted-foreground">5 мин</p>
                </div>
                <div className="text-center">
                  <div className={`text-3xl font-bold ${metrics.system.loadAverage["15min"] > metrics.cpu.cores ? "text-red-500" : ""}`} data-testid="text-load-15min">
                    {metrics.system.loadAverage["15min"]}
                  </div>
                  <p className="text-sm text-muted-foreground">15 мин</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {metrics.recommendations.length > 0 && (
            <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20" data-testid="card-hardware-recommendations">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="w-5 h-5" />
                  Рекомендации по железу
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2" data-testid="list-recommendations">
                  {metrics.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-yellow-700 dark:text-yellow-400" data-testid={`item-recommendation-${i}`}>
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{rec.message}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <div className="flex items-center gap-3 pt-4 border-t">
        <Shield className="w-6 h-6 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Безопасность</h2>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card data-testid="card-pii-masking">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">PII Маскирование</CardTitle>
              <StatusBadge status={report.piiMasking} />
            </div>
            <CardDescription>
              Защита персональных данных в логах и AI-промптах
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground space-y-1">
              {report.piiMaskingDetails.map((detail, i) => (
                <li key={i} className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-green-600" />
                  {detail}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card data-testid="card-rbac">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">RBAC Покрытие</CardTitle>
              <Badge variant={report.rbacCoverage >= 70 ? "default" : "secondary"} data-testid="badge-rbac-coverage">
                {report.rbacCoverage}%
              </Badge>
            </div>
            <CardDescription>
              {report.rbacDetails.protectedEndpoints} из {report.rbacDetails.totalApiEndpoints} endpoints защищены
            </CardDescription>
          </CardHeader>
          <CardContent>
            {report.rbacDetails.unprotectedEndpoints.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Публичные endpoints:</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {report.rbacDetails.unprotectedEndpoints.map((ep, i) => (
                    <li key={i} className="font-mono text-xs">{ep}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-webhook-verification">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Верификация Webhook</CardTitle>
            <CardDescription>
              HMAC-SHA256 подпись для каждого канала
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Канал</TableHead>
                  <TableHead className="text-right">Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Telegram</TableCell>
                  <TableCell className="text-right">
                    <BooleanStatus value={report.webhookVerification.telegram} />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>WhatsApp</TableCell>
                  <TableCell className="text-right">
                    <BooleanStatus value={report.webhookVerification.whatsapp} />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>MAX</TableCell>
                  <TableCell className="text-right">
                    <BooleanStatus value={report.webhookVerification.max} />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card data-testid="card-rate-limiting">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Rate Limiting</CardTitle>
            <CardDescription>
              Ограничение частоты запросов по категориям
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Категория</TableHead>
                  <TableHead className="text-right">Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(report.rateLimiting).map(([key, value]) => (
                  <TableRow key={key}>
                    <TableCell className="capitalize">{key}</TableCell>
                    <TableCell className="text-right">
                      <BooleanStatus value={value} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card data-testid="card-data-deletion">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Удаление данных (GDPR)</CardTitle>
              <StatusBadge status={report.dataDeletion} />
            </div>
            <CardDescription>
              Endpoint для полного удаления данных клиента
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              DELETE /api/customers/:id/data доступен администраторам
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-audit-coverage">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Аудит события</CardTitle>
              <StatusBadge status={report.auditCoverage} />
            </div>
            <CardDescription>
              Покрытие ключевых событий безопасности
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2 text-green-600 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                Реализованы ({report.auditDetails.presentEvents.length}):
              </p>
              <div className="flex flex-wrap gap-1">
                {report.auditDetails.presentEvents.map((event, i) => (
                  <Badge key={i} variant="outline" className="font-mono text-xs">
                    {event}
                  </Badge>
                ))}
              </div>
            </div>
            {report.auditDetails.missingEvents.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2 text-yellow-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Отсутствуют ({report.auditDetails.missingEvents.length}):
                </p>
                <div className="flex flex-wrap gap-1">
                  {report.auditDetails.missingEvents.map((event, i) => (
                    <Badge key={i} variant="secondary" className="font-mono text-xs">
                      {event}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-muted/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Info className="w-5 h-5" />
            Рекомендации
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-2 text-muted-foreground">
            {report.piiMasking === "WARN" && (
              <li className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
                <span>Включите санитизацию PII во всех prompt builders и audit logs</span>
              </li>
            )}
            {report.rbacCoverage < 70 && (
              <li className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
                <span>Добавьте requirePermission middleware к незащищённым endpoints</span>
              </li>
            )}
            {report.auditDetails.missingEvents.length > 0 && (
              <li className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
                <span>Реализуйте аудит для событий: {report.auditDetails.missingEvents.join(", ")}</span>
              </li>
            )}
            {report.piiMasking === "OK" && report.rbacCoverage >= 70 && report.auditDetails.missingEvents.length === 0 && (
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                <span>Все ключевые меры безопасности реализованы</span>
              </li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
