import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  Loader2,
  ArrowLeft,
  GitBranch,
  GitCommit,
  RefreshCw,
  Rocket,
  CheckCircle2,
  XCircle,
  Clock,
  Terminal,
  ArrowUpCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

interface GitInfo {
  local: { hash: string; message: string; date: string };
  origin: { hash: string; message: string; date: string };
  hasUpdate: boolean;
}

interface DeployStatus {
  status: "idle" | "running" | "success" | "error";
  log: string[];
  startedAt?: string;
  finishedAt?: string;
  commitBefore?: string;
  commitAfter?: string;
}

export default function OwnerUpdates() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const logRef = useRef<HTMLPreElement>(null);
  const [polling, setPolling] = useState(false);

  const { data: gitInfo, isLoading: gitLoading, refetch: refetchGit } = useQuery<GitInfo>({
    queryKey: ["/api/admin/deploy/git-info"],
    enabled: !!user?.isPlatformOwner,
    refetchInterval: polling ? false : 30000,
  });

  const { data: deployStatus, refetch: refetchStatus } = useQuery<DeployStatus>({
    queryKey: ["/api/admin/deploy/status"],
    enabled: !!user?.isPlatformOwner,
    refetchInterval: polling ? 2000 : false,
  });

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [deployStatus?.log]);

  // Stop polling when deploy finishes
  useEffect(() => {
    if (deployStatus?.status === "success" || deployStatus?.status === "error") {
      setPolling(false);
      refetchGit();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deploy/git-info"] });
    }
  }, [deployStatus?.status]);

  const deployMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/deploy"),
    onSuccess: () => {
      setPolling(true);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deploy/status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate("/login?return=/owner/updates");
      else if (!user.isPlatformOwner) navigate("/");
    }
  }, [user, authLoading, navigate]);

  if (authLoading || !user?.isPlatformOwner) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isRunning = deployStatus?.status === "running" || deployMutation.isPending;
  const hasUpdate = gitInfo?.hasUpdate;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/owner")} data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              <span className="text-lg font-semibold">Обновления системы</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {gitInfo && (
              <Badge variant="outline" className="font-mono text-xs">
                <GitCommit className="h-3 w-3 mr-1" />
                {gitInfo.local.hash}
              </Badge>
            )}
            <Button variant="ghost" size="icon" onClick={() => refetchGit()} disabled={gitLoading}>
              <RefreshCw className={`h-4 w-4 ${gitLoading ? "animate-spin" : ""}`} />
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 space-y-6">
        {/* Git Status Cards */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <GitBranch className="h-4 w-4" />
                На сервере (VPS)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {gitLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : gitInfo ? (
                <div className="space-y-1">
                  <p className="font-mono text-sm font-semibold">{gitInfo.local.hash}</p>
                  <p className="text-sm text-muted-foreground truncate">{gitInfo.local.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(gitInfo.local.date), { addSuffix: true, locale: ru })}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Нет данных</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <GitBranch className="h-4 w-4" />
                GitHub (origin/master)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {gitLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : gitInfo ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm font-semibold">{gitInfo.origin.hash}</p>
                    {hasUpdate && (
                      <Badge variant="default" className="text-xs">
                        <ArrowUpCircle className="h-3 w-3 mr-1" />
                        Доступно обновление
                      </Badge>
                    )}
                    {!hasUpdate && gitInfo && (
                      <Badge variant="secondary" className="text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Актуально
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{gitInfo.origin.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(gitInfo.origin.date), { addSuffix: true, locale: ru })}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Нет данных</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Deploy Button */}
        <Card className={hasUpdate ? "border-primary" : ""}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              Деплой из GitHub
            </CardTitle>
            <CardDescription>
              Получить последние изменения из ветки <code className="bg-muted px-1 rounded">master</code>,
              пересобрать проект и перезапустить сервисы
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground space-y-1">
              <p>Последовательность шагов:</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li><code>git fetch + reset --hard origin/master</code></li>
                <li><code>npm ci</code> — установка зависимостей</li>
                <li><code>npm run build</code> — сборка</li>
                <li><code>drizzle-kit push</code> — миграции БД</li>
                <li><code>pm2 restart ecosystem.config.cjs</code> — перезапуск</li>
              </ol>
            </div>
            <Button
              size="lg"
              className="w-full"
              onClick={() => deployMutation.mutate()}
              disabled={isRunning}
              data-testid="button-deploy"
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Деплой выполняется...
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4 mr-2" />
                  {hasUpdate ? "Обновить сервер" : "Применить деплой"}
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Deploy Log */}
        {deployStatus && deployStatus.status !== "idle" && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Terminal className="h-5 w-5" />
                  Лог деплоя
                </CardTitle>
                <div className="flex items-center gap-2">
                  {deployStatus.status === "running" && (
                    <Badge variant="outline" className="gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Выполняется
                    </Badge>
                  )}
                  {deployStatus.status === "success" && (
                    <Badge variant="default" className="gap-1 bg-green-600">
                      <CheckCircle2 className="h-3 w-3" />
                      Успешно
                    </Badge>
                  )}
                  {deployStatus.status === "error" && (
                    <Badge variant="destructive" className="gap-1">
                      <XCircle className="h-3 w-3" />
                      Ошибка
                    </Badge>
                  )}
                  {deployStatus.startedAt && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(deployStatus.startedAt), { addSuffix: true, locale: ru })}
                    </span>
                  )}
                </div>
              </div>
              {deployStatus.commitBefore && deployStatus.commitAfter && (
                <p className="text-xs text-muted-foreground mt-1">
                  {deployStatus.commitBefore} → {deployStatus.commitAfter}
                </p>
              )}
            </CardHeader>
            <CardContent>
              <pre
                ref={logRef}
                className="bg-black text-green-400 text-xs font-mono p-4 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap"
              >
                {deployStatus.log.join("\n") || "Ожидание вывода..."}
              </pre>
              {deployStatus.status === "success" && (
                <p className="text-sm text-muted-foreground mt-3 text-center">
                  Сервер перезапускается — через несколько секунд страница обновится автоматически.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
