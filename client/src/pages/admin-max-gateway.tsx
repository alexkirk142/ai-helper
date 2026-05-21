import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Shield,
  ArrowLeft,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Plus,
  Upload,
  Server,
  Wifi,
  WifiOff,
  QrCode,
} from "lucide-react";

interface GatewayStats {
  totals: {
    instances: number;
    authenticated: number;
    connected: number;
    awaitingQr: number;
    withTenant: number;
    noTenant: number;
  };
  byTenant: unknown[];
}

interface GatewayInstance {
  instanceId: string;
  tenantId?: string;
  connected: boolean;
  authenticated: boolean;
  displayName?: string;
  phone?: string;
  chatsCount?: number;
  lastLogin?: number;
  awaitingQr: boolean;
}

interface GatewayProxy {
  id: string;
  url: string;
  label?: string;
  active: boolean;
  addedAt: number;
  instanceCount: number;
}

function maskProxyUrl(url: string): string {
  return url.replace(/:([^@]+)@/, ":***@");
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("ru");
}

export default function AdminMaxGateway() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [instanceSearch, setInstanceSearch] = useState("");
  const [showAddProxy, setShowAddProxy] = useState(false);
  const [showUploadProxy, setShowUploadProxy] = useState(false);
  const [proxyText, setProxyText] = useState("");
  const [proxyLabel, setProxyLabel] = useState("");
  const [proxyUploadText, setProxyUploadText] = useState("");
  const [proxyUploadLabel, setProxyUploadLabel] = useState("");
  const [proxyUploadReplace, setProxyUploadReplace] = useState(false);

  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useQuery<GatewayStats>({
    queryKey: ["/api/admin/max-gateway/stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/max-gateway/stats", { credentials: "include" });
      if (!res.ok) throw new Error("Не удалось загрузить статистику");
      return res.json();
    },
    staleTime: 30 * 1000,
    enabled: !!user?.isPlatformOwner || !!user?.isPlatformAdmin,
  });

  const {
    data: instancesData,
    isLoading: instancesLoading,
    refetch: refetchInstances,
  } = useQuery<{ instances: GatewayInstance[] }>({
    queryKey: ["/api/admin/max-gateway/instances"],
    queryFn: async () => {
      const res = await fetch("/api/admin/max-gateway/instances", { credentials: "include" });
      if (!res.ok) throw new Error("Не удалось загрузить инстансы");
      return res.json();
    },
    staleTime: 30 * 1000,
    enabled: !!user?.isPlatformOwner || !!user?.isPlatformAdmin,
  });

  const {
    data: proxiesData,
    isLoading: proxiesLoading,
    refetch: refetchProxies,
  } = useQuery<{ proxies: GatewayProxy[]; total: number; active: number }>({
    queryKey: ["/api/admin/max-gateway/proxies"],
    queryFn: async () => {
      const res = await fetch("/api/admin/max-gateway/proxies", { credentials: "include" });
      if (!res.ok) throw new Error("Не удалось загрузить прокси");
      return res.json();
    },
    staleTime: 30 * 1000,
    enabled: !!user?.isPlatformOwner || !!user?.isPlatformAdmin,
  });

  const addProxyMutation = useMutation({
    mutationFn: async ({ proxies, label }: { proxies: string; label?: string }) => {
      const res = await apiRequest("POST", "/api/admin/max-gateway/proxies", { proxies, label });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка добавления прокси");
      return data;
    },
    onSuccess: () => {
      setProxyText("");
      setProxyLabel("");
      setShowAddProxy(false);
      toast({ title: "Прокси добавлены" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/max-gateway/proxies"] });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const uploadProxyMutation = useMutation({
    mutationFn: async ({ text, label, replace }: { text: string; label?: string; replace?: boolean }) => {
      const res = await apiRequest("POST", "/api/admin/max-gateway/proxies/upload", { text, label, replace });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки прокси");
      return data;
    },
    onSuccess: () => {
      setProxyUploadText("");
      setProxyUploadLabel("");
      setProxyUploadReplace(false);
      setShowUploadProxy(false);
      toast({ title: "Список прокси загружен" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/max-gateway/proxies"] });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const deleteProxyMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/max-gateway/proxies/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка удаления прокси");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Прокси удалён" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/max-gateway/proxies"] });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const deleteInstanceMutation = useMutation({
    mutationFn: async (instanceId: string) => {
      const res = await apiRequest("DELETE", `/api/admin/max-gateway/instances/${instanceId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка удаления");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Инстанс удалён" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/max-gateway/instances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/max-gateway/stats"] });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка удаления", description: err.message, variant: "destructive" });
    },
  });

  const clearProxiesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/admin/max-gateway/proxies");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка очистки");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Пул прокси очищен" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/max-gateway/proxies"] });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const toggleProxyMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/max-gateway/proxies/${id}`, { active });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка обновления");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/max-gateway/proxies"] });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const handleRefresh = () => {
    refetchStats();
    refetchInstances();
    refetchProxies();
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user?.isPlatformOwner && !user?.isPlatformAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Нет доступа</p>
      </div>
    );
  }

  const instances = instancesData?.instances ?? [];
  const proxies = proxiesData?.proxies ?? [];

  const filteredInstances = instanceSearch.trim()
    ? instances.filter(
        (i) =>
          i.instanceId.toLowerCase().includes(instanceSearch.toLowerCase()) ||
          (i.tenantId ?? "").toLowerCase().includes(instanceSearch.toLowerCase()) ||
          (i.displayName ?? "").toLowerCase().includes(instanceSearch.toLowerCase()) ||
          (i.phone ?? "").includes(instanceSearch)
      )
    : instances;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">MAX Gateway</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Обновить
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        <Tabs defaultValue="instances">
          <TabsList>
            <TabsTrigger value="instances">Инстансы</TabsTrigger>
            <TabsTrigger value="proxies">Прокси</TabsTrigger>
          </TabsList>

          {/* === Инстансы === */}
          <TabsContent value="instances" className="space-y-4 mt-4">
            {/* Stats grid */}
            {statsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Загрузка статистики...</span>
              </div>
            ) : stats ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="Всего инстансов"
                  value={stats.totals.instances}
                  icon={<Server className="h-4 w-4 text-muted-foreground" />}
                />
                <StatCard
                  label="Аутентифицировано"
                  value={stats.totals.authenticated}
                  icon={<Shield className="h-4 w-4 text-green-500" />}
                  highlight="green"
                />
                <StatCard
                  label="Подключено"
                  value={stats.totals.connected}
                  icon={<Wifi className="h-4 w-4 text-blue-500" />}
                  highlight="blue"
                />
                <StatCard
                  label="Ожидают QR"
                  value={stats.totals.awaitingQr}
                  icon={<QrCode className="h-4 w-4 text-amber-500" />}
                  highlight="amber"
                />
              </div>
            ) : null}

            {/* Search */}
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Поиск по instanceId, tenantId, телефону..."
                value={instanceSearch}
                onChange={(e) => setInstanceSearch(e.target.value)}
              />
            </div>

            {/* Table */}
            <Card>
              <CardContent className="p-0">
                {instancesLoading ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Загрузка инстансов...</span>
                  </div>
                ) : filteredInstances.length === 0 ? (
                  <p className="text-center text-muted-foreground py-10">Инстансы не найдены</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Instance ID</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Tenant</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Имя / Телефон</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Статус</th>
                          <th className="text-right px-4 py-3 font-medium text-muted-foreground">Чаты</th>
                          <th className="text-right px-4 py-3 font-medium text-muted-foreground">Последний вход</th>
                          <th className="px-4 py-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredInstances.map((inst) => (
                          <tr key={inst.instanceId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-mono text-xs">{inst.instanceId}</td>
                            <td className="px-4 py-3">
                              {inst.tenantId ? (
                                <span className="text-xs">{inst.tenantId}</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div>
                                <p className="truncate max-w-[160px]">{inst.displayName || "—"}</p>
                                {inst.phone && (
                                  <p className="text-xs text-muted-foreground">{inst.phone}</p>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`inline-block w-2 h-2 rounded-full ${inst.connected ? "bg-green-500" : "bg-gray-400"}`}
                                />
                                <span className="text-xs">
                                  {inst.connected ? "Online" : "Offline"}
                                </span>
                                {inst.authenticated && (
                                  <Badge variant="secondary" className="text-xs py-0">auth</Badge>
                                )}
                                {inst.awaitingQr && (
                                  <Badge variant="outline" className="text-xs py-0 text-amber-600 border-amber-400">QR</Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-muted-foreground">
                              {inst.chatsCount ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                              {inst.lastLogin ? formatDate(inst.lastLogin) : "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Удалить инстанс"
                                onClick={() => {
                                  if (confirm(`Удалить инстанс ${inst.instanceId}?`)) {
                                    deleteInstanceMutation.mutate(inst.instanceId);
                                  }
                                }}
                                disabled={deleteInstanceMutation.isPending}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* === Прокси === */}
          <TabsContent value="proxies" className="space-y-4 mt-4">
            {/* Proxy stats + actions */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="flex items-center gap-4">
                {proxiesData && (
                  <>
                    <div className="text-sm">
                      <span className="font-medium">{proxiesData.total}</span>
                      <span className="text-muted-foreground ml-1">всего</span>
                    </div>
                    <div className="text-sm">
                      <span className="font-medium text-green-600">{proxiesData.active}</span>
                      <span className="text-muted-foreground ml-1">активных</span>
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setShowAddProxy((v) => !v); setShowUploadProxy(false); }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Добавить
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setShowUploadProxy((v) => !v); setShowAddProxy(false); }}
                >
                  <Upload className="h-3.5 w-3.5 mr-1" />
                  Загрузить список
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm("Очистить весь пул прокси?")) {
                      clearProxiesMutation.mutate();
                    }
                  }}
                  disabled={clearProxiesMutation.isPending}
                >
                  {clearProxiesMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                  )}
                  Очистить всё
                </Button>
              </div>
            </div>

            {/* Add proxy form */}
            {showAddProxy && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Добавить прокси</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Прокси (host:port:user:pass, по одному на строку)</Label>
                    <Textarea
                      placeholder={"192.168.1.1:1080:user:pass\n192.168.1.2:1080:user2:pass2"}
                      value={proxyText}
                      onChange={(e) => setProxyText(e.target.value)}
                      rows={4}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Метка (необязательно)</Label>
                    <Input
                      placeholder="Например: Дата-центр 1"
                      value={proxyLabel}
                      onChange={(e) => setProxyLabel(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => addProxyMutation.mutate({ proxies: proxyText, label: proxyLabel || undefined })}
                      disabled={!proxyText.trim() || addProxyMutation.isPending}
                    >
                      {addProxyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                      Добавить
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowAddProxy(false)}>
                      Отмена
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Upload proxy list form */}
            {showUploadProxy && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Загрузить список прокси</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Список прокси (host:port:user:pass)</Label>
                    <Textarea
                      placeholder={"192.168.1.1:1080:user:pass\n192.168.1.2:1080:user2:pass2"}
                      value={proxyUploadText}
                      onChange={(e) => setProxyUploadText(e.target.value)}
                      rows={6}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Метка (необязательно)</Label>
                    <Input
                      placeholder="Пакет прокси №1"
                      value={proxyUploadLabel}
                      onChange={(e) => setProxyUploadLabel(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="replace-pool"
                      checked={proxyUploadReplace}
                      onCheckedChange={(v) => setProxyUploadReplace(v === true)}
                    />
                    <Label htmlFor="replace-pool" className="text-xs cursor-pointer">
                      Заменить весь пул (удалить старые прокси)
                    </Label>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        uploadProxyMutation.mutate({
                          text: proxyUploadText,
                          label: proxyUploadLabel || undefined,
                          replace: proxyUploadReplace,
                        })
                      }
                      disabled={!proxyUploadText.trim() || uploadProxyMutation.isPending}
                    >
                      {uploadProxyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                      Загрузить
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowUploadProxy(false)}>
                      Отмена
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Proxies table */}
            <Card>
              <CardContent className="p-0">
                {proxiesLoading ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Загрузка прокси...</span>
                  </div>
                ) : proxies.length === 0 ? (
                  <p className="text-center text-muted-foreground py-10">Прокси не добавлены</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">URL</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Метка</th>
                          <th className="text-center px-4 py-3 font-medium text-muted-foreground">Активен</th>
                          <th className="text-right px-4 py-3 font-medium text-muted-foreground">Инстансы</th>
                          <th className="text-right px-4 py-3 font-medium text-muted-foreground">Добавлен</th>
                          <th className="px-4 py-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {proxies.map((proxy) => (
                          <tr key={proxy.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-mono text-xs max-w-[240px] truncate">
                              {maskProxyUrl(proxy.url)}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {proxy.label || "—"}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <Switch
                                checked={proxy.active}
                                onCheckedChange={(v) => toggleProxyMutation.mutate({ id: proxy.id, active: v })}
                                disabled={toggleProxyMutation.isPending}
                              />
                            </td>
                            <td className="px-4 py-3 text-right text-muted-foreground">
                              {proxy.instanceCount}
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                              {formatDate(proxy.addedAt)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => deleteProxyMutation.mutate(proxy.id)}
                                disabled={deleteProxyMutation.isPending}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  highlight?: "green" | "blue" | "amber";
}

function StatCard({ label, value, icon, highlight }: StatCardProps) {
  const valueClass =
    highlight === "green"
      ? "text-green-600"
      : highlight === "blue"
      ? "text-blue-600"
      : highlight === "amber"
      ? "text-amber-600"
      : "";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${valueClass}`}>{value}</p>
          </div>
          <div className="mt-0.5">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
