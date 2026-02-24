import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  Loader2,
  ArrowLeft,
  Upload,
  Package,
  Check,
  X,
  RotateCcw,
  Clock,
  FileArchive,
  AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ru } from "date-fns/locale";

interface UpdateHistory {
  id: string;
  version: string;
  filename: string;
  fileSize: number;
  checksum: string;
  changelog: string | null;
  status: "pending" | "applied" | "failed" | "rolled_back";
  backupPath: string | null;
  appliedAt: string | null;
  appliedById: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface UpdatesResponse {
  history: UpdateHistory[];
  currentVersion: string;
}

const statusConfig = {
  pending: { label: "Ожидает", variant: "outline" as const, icon: Clock },
  applied: { label: "Применено", variant: "default" as const, icon: Check },
  failed: { label: "Ошибка", variant: "destructive" as const, icon: X },
  rolled_back: { label: "Откат", variant: "secondary" as const, icon: RotateCcw },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function OwnerUpdates() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [version, setVersion] = useState("");
  const [changelog, setChangelog] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { data, isLoading } = useQuery<UpdatesResponse>({
    queryKey: ["/api/admin/updates"],
    enabled: !!user?.isPlatformOwner,
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch("/api/admin/updates/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Upload failed");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Обновление загружено", description: "Файл успешно загружен и готов к применению" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/updates"] });
      setVersion("");
      setChangelog("");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка загрузки", description: error.message, variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/admin/updates/${id}/apply`);
    },
    onSuccess: (data: any) => {
      toast({ title: "Обновление применено", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/updates"] });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка применения", description: error.message, variant: "destructive" });
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/admin/updates/${id}/rollback`);
    },
    onSuccess: (data: any) => {
      toast({ title: "Откат выполнен", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/updates"] });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка отката", description: error.message, variant: "destructive" });
    },
  });

  const rebuildMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/system/rebuild");
    },
    onSuccess: (data: any) => {
      toast({ title: "Сборка завершена", description: data.message });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка сборки", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        navigate("/login?return=/owner/updates");
      } else if (!user.isPlatformOwner) {
        navigate("/");
      }
    }
  }, [user, authLoading, navigate]);

  if (authLoading || !user || !user.isPlatformOwner) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleUpload = () => {
    if (!selectedFile || !version) {
      toast({ title: "Заполните все поля", description: "Выберите файл и укажите версию", variant: "destructive" });
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("version", version);
    if (changelog) formData.append("changelog", changelog);

    uploadMutation.mutate(formData);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".zip")) {
        toast({ title: "Неверный формат", description: "Только ZIP файлы разрешены", variant: "destructive" });
        return;
      }
      setSelectedFile(file);
    }
  };

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
            <Badge variant="outline" className="font-mono" data-testid="badge-version">
              v{data?.currentVersion || "1.0.0"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => rebuildMutation.mutate()}
              disabled={rebuildMutation.isPending}
              data-testid="button-rebuild"
            >
              {rebuildMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Package className="h-4 w-4 mr-2" />
              )}
              Пересобрать
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card data-testid="card-upload">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Загрузить обновление
              </CardTitle>
              <CardDescription>
                Загрузите ZIP-архив с файлами обновления
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="version">Версия *</Label>
                <Input
                  id="version"
                  placeholder="1.2.0"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  data-testid="input-version"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="file">ZIP-файл *</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="file"
                    type="file"
                    accept=".zip"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="flex-1"
                    data-testid="input-file"
                  />
                </div>
                {selectedFile && (
                  <p className="text-sm text-muted-foreground">
                    {selectedFile.name} ({formatBytes(selectedFile.size)})
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="changelog">Changelog (опционально)</Label>
                <Textarea
                  id="changelog"
                  placeholder="Описание изменений..."
                  value={changelog}
                  onChange={(e) => setChangelog(e.target.value)}
                  rows={3}
                  data-testid="input-changelog"
                />
              </div>

              <Button
                onClick={handleUpload}
                disabled={uploadMutation.isPending || !selectedFile || !version}
                className="w-full"
                data-testid="button-upload"
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Загрузить
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                Важно
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Перед применением обновления автоматически создаётся резервная копия ключевых файлов.
              </p>
              <p>
                ZIP-архив может содержать файл <code className="bg-muted px-1 rounded">update.json</code> с манифестом:
              </p>
              <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
{`{
  "version": "1.2.0",
  "files": ["server/file.ts"],
  "preScript": "npm install",
  "postScript": "npm run build"
}`}
              </pre>
              <p>
                После применения может потребоваться перезагрузка сервиса.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6" data-testid="card-history">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              История обновлений
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !data?.history?.length ? (
              <p className="text-center text-muted-foreground py-8">
                Нет загруженных обновлений
              </p>
            ) : (
              <div className="space-y-4">
                {data.history.map((update) => {
                  const config = statusConfig[update.status];
                  const StatusIcon = config.icon;

                  return (
                    <div
                      key={update.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border rounded-lg"
                      data-testid={`update-${update.id}`}
                    >
                      <div className="flex items-start gap-4">
                        <div className="p-2 bg-muted rounded-lg">
                          <FileArchive className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">v{update.version}</span>
                            <Badge variant={config.variant}>
                              <StatusIcon className="h-3 w-3 mr-1" />
                              {config.label}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {update.filename} ({formatBytes(update.fileSize)})
                          </p>
                          {update.changelog && (
                            <p className="text-sm mt-1">{update.changelog}</p>
                          )}
                          {update.errorMessage && (
                            <p className="text-sm text-destructive mt-1">{update.errorMessage}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Загружено {formatDistanceToNow(new Date(update.createdAt), { addSuffix: true, locale: ru })}
                            {update.appliedAt && (
                              <> | Применено {format(new Date(update.appliedAt), "dd.MM.yyyy HH:mm")}</>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {update.status === "pending" && (
                          <Button
                            size="sm"
                            onClick={() => applyMutation.mutate(update.id)}
                            disabled={applyMutation.isPending}
                            data-testid={`button-apply-${update.id}`}
                          >
                            {applyMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Check className="h-4 w-4 mr-1" />
                                Применить
                              </>
                            )}
                          </Button>
                        )}
                        {update.status === "applied" && update.backupPath && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rollbackMutation.mutate(update.id)}
                            disabled={rollbackMutation.isPending}
                            data-testid={`button-rollback-${update.id}`}
                          >
                            {rollbackMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <RotateCcw className="h-4 w-4 mr-1" />
                                Откатить
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
