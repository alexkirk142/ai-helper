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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Network, Trash2, Plus, Upload, Check, X, Globe, Server, RefreshCw } from "lucide-react";
import type { Proxy } from "@shared/schema";

interface MaskedProxy extends Omit<Proxy, 'password'> {
  password: string | null;
  hasPassword: boolean;
}

interface ProxiesResponse {
  proxies: MaskedProxy[];
  pagination: { total: number; limit: number; offset: number };
  stats: { available: number; assigned: number; disabled: number; failed: number };
}

interface ParsedProxy {
  host: string;
  port: number;
  protocol?: string;
  username?: string | null;
  password?: string | null;
}

const PROTOCOL_OPTIONS = [
  { value: "socks5", label: "SOCKS5" },
  { value: "socks4", label: "SOCKS4" },
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
];

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-600",
  assigned: "bg-blue-600",
  disabled: "bg-gray-500",
  failed: "bg-red-600",
};

export default function AdminProxies() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("list");
  const [addModal, setAddModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [importText, setImportText] = useState("");
  const [parsedProxies, setParsedProxies] = useState<ParsedProxy[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  
  const [newProxy, setNewProxy] = useState({
    host: "",
    port: "",
    protocol: "socks5",
    username: "",
    password: "",
    country: "",
    label: "",
  });

  const { data, isLoading, error, refetch } = useQuery<ProxiesResponse>({
    queryKey: ["/api/admin/proxies"],
    queryFn: async () => {
      const res = await fetch("/api/admin/proxies?limit=100", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch proxies");
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async (proxy: typeof newProxy) => {
      return apiRequest("POST", "/api/admin/proxies", {
        ...proxy,
        port: parseInt(proxy.port),
        username: proxy.username || null,
        password: proxy.password || null,
        country: proxy.country || null,
        label: proxy.label || null,
      });
    },
    onSuccess: () => {
      toast({ title: "Успешно", description: "Прокси добавлен" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/proxies"] });
      setAddModal(false);
      resetNewProxy();
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message || "Не удалось добавить прокси", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/proxies/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Удалено", description: "Прокси удалён" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/proxies"] });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", "/api/admin/proxies");
    },
    onSuccess: () => {
      toast({ title: "Удалено", description: "Все прокси удалены" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/proxies"] });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const parseMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/admin/proxies/parse", { text });
      return res.json();
    },
    onSuccess: (data: { parsed: ParsedProxy[]; errors: string[] }) => {
      setParsedProxies(data.parsed);
      setParseErrors(data.errors);
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (proxies: ParsedProxy[]) => {
      return apiRequest("POST", "/api/admin/proxies/import", { proxies });
    },
    onSuccess: (data: any) => {
      toast({ title: "Импортировано", description: `Добавлено ${data.imported || parsedProxies.length} прокси` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/proxies"] });
      setImportModal(false);
      setImportText("");
      setParsedProxies([]);
      setParseErrors([]);
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const resetNewProxy = () => {
    setNewProxy({
      host: "",
      port: "",
      protocol: "socks5",
      username: "",
      password: "",
      country: "",
      label: "",
    });
  };

  const handleParse = () => {
    if (!importText.trim()) return;
    parseMutation.mutate(importText);
  };

  const handleImport = () => {
    if (parsedProxies.length === 0) return;
    importMutation.mutate(parsedProxies);
  };

  const handleAdd = () => {
    if (!newProxy.host || !newProxy.port) return;
    addMutation.mutate(newProxy);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Network className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Управление прокси</h1>
            <p className="text-muted-foreground">Прокси-серверы для подключения каналов</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => refetch()}
            data-testid="button-refresh-proxies"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Обновить
          </Button>
          <Button
            variant="outline"
            onClick={() => setImportModal(true)}
            data-testid="button-import-proxies"
          >
            <Upload className="h-4 w-4 mr-2" />
            Импорт
          </Button>
          <Button
            onClick={() => setAddModal(true)}
            data-testid="button-add-proxy"
          >
            <Plus className="h-4 w-4 mr-2" />
            Добавить
          </Button>
        </div>
      </div>

      {data?.stats && (
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-600 text-white">
                <Check className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data.stats.available}</p>
                <p className="text-sm text-muted-foreground">Доступно</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-600 text-white">
                <Server className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data.stats.assigned}</p>
                <p className="text-sm text-muted-foreground">Назначено</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gray-500 text-white">
                <X className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data.stats.disabled}</p>
                <p className="text-sm text-muted-foreground">Отключено</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-600 text-white">
                <X className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data.stats.failed}</p>
                <p className="text-sm text-muted-foreground">Ошибка</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Список прокси</CardTitle>
            <CardDescription>
              Всего: {data?.pagination.total || 0} прокси
            </CardDescription>
          </div>
          {(data?.proxies?.length || 0) > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirm("Удалить все прокси?")) {
                  deleteAllMutation.mutate();
                }
              }}
              disabled={deleteAllMutation.isPending}
              data-testid="button-delete-all-proxies"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Удалить все
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : error ? (
            <p className="text-destructive text-center p-4">Не удалось загрузить прокси</p>
          ) : data?.proxies?.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground">
              <Network className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Прокси не добавлены</p>
              <p className="text-sm mt-2">Нажмите "Добавить" или "Импорт" чтобы добавить прокси</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data?.proxies?.map((proxy) => (
                <div
                  key={proxy.id}
                  className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                  data-testid={`row-proxy-${proxy.id}`}
                >
                  <div className="flex items-center gap-3">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="font-mono font-medium">
                        {proxy.protocol}://{proxy.host}:{proxy.port}
                        {(proxy.username || proxy.hasPassword) && <span className="text-muted-foreground ml-2">(auth)</span>}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        {proxy.country && <span>{proxy.country}</span>}
                        {proxy.label && <span>{proxy.label}</span>}
                        {proxy.assignedTenantId && (
                          <span>Tenant: {proxy.assignedTenantId.slice(0, 8)}...</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={STATUS_COLORS[proxy.status] || "bg-gray-500"}>
                      {proxy.status === "available" && "Доступен"}
                      {proxy.status === "assigned" && "Назначен"}
                      {proxy.status === "disabled" && "Отключён"}
                      {proxy.status === "failed" && "Ошибка"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMutation.mutate(proxy.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-proxy-${proxy.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addModal} onOpenChange={setAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить прокси</DialogTitle>
            <DialogDescription>
              Введите данные прокси-сервера
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Хост</Label>
                <Input
                  placeholder="192.168.1.1 или proxy.example.com"
                  value={newProxy.host}
                  onChange={(e) => setNewProxy({ ...newProxy, host: e.target.value })}
                  data-testid="input-proxy-host"
                />
              </div>
              <div className="space-y-2">
                <Label>Порт</Label>
                <Input
                  type="number"
                  placeholder="1080"
                  value={newProxy.port}
                  onChange={(e) => setNewProxy({ ...newProxy, port: e.target.value })}
                  data-testid="input-proxy-port"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Протокол</Label>
              <Select
                value={newProxy.protocol}
                onValueChange={(v) => setNewProxy({ ...newProxy, protocol: v })}
              >
                <SelectTrigger data-testid="select-proxy-protocol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROTOCOL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Логин (опционально)</Label>
                <Input
                  placeholder="username"
                  value={newProxy.username}
                  onChange={(e) => setNewProxy({ ...newProxy, username: e.target.value })}
                  data-testid="input-proxy-username"
                />
              </div>
              <div className="space-y-2">
                <Label>Пароль (опционально)</Label>
                <Input
                  type="password"
                  placeholder="password"
                  value={newProxy.password}
                  onChange={(e) => setNewProxy({ ...newProxy, password: e.target.value })}
                  data-testid="input-proxy-password"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Страна (опционально)</Label>
                <Input
                  placeholder="RU, NL, US"
                  value={newProxy.country}
                  onChange={(e) => setNewProxy({ ...newProxy, country: e.target.value })}
                  data-testid="input-proxy-country"
                />
              </div>
              <div className="space-y-2">
                <Label>Метка (опционально)</Label>
                <Input
                  placeholder="Основной прокси"
                  value={newProxy.label}
                  onChange={(e) => setNewProxy({ ...newProxy, label: e.target.value })}
                  data-testid="input-proxy-label"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddModal(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleAdd}
              disabled={addMutation.isPending || !newProxy.host || !newProxy.port}
              data-testid="button-save-proxy"
            >
              {addMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importModal} onOpenChange={setImportModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Импорт прокси</DialogTitle>
            <DialogDescription>
              Вставьте список прокси в любом формате
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Список прокси</Label>
              <Textarea
                placeholder={`Поддерживаемые форматы:
host:port
host:port:username:password
socks5://host:port
socks5://user:pass@host:port
http://host:port`}
                rows={8}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                className="font-mono text-sm"
                data-testid="textarea-import-proxies"
              />
            </div>
            <Button
              variant="outline"
              onClick={handleParse}
              disabled={parseMutation.isPending || !importText.trim()}
              data-testid="button-parse-proxies"
            >
              {parseMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Проверить
            </Button>
            
            {parsedProxies.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="bg-green-600">
                    {parsedProxies.length} прокси распознано
                  </Badge>
                  {parseErrors.length > 0 && (
                    <Badge variant="destructive">
                      {parseErrors.length} ошибок
                    </Badge>
                  )}
                </div>
                <div className="max-h-40 overflow-auto bg-muted/50 rounded-md p-2 font-mono text-sm">
                  {parsedProxies.slice(0, 10).map((p, i) => (
                    <div key={i}>
                      {p.protocol || "socks5"}://{p.host}:{p.port}
                      {p.username && " (auth)"}
                    </div>
                  ))}
                  {parsedProxies.length > 10 && (
                    <div className="text-muted-foreground">
                      ... и ещё {parsedProxies.length - 10}
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {parseErrors.length > 0 && (
              <div className="max-h-20 overflow-auto bg-destructive/10 rounded-md p-2 text-sm text-destructive">
                {parseErrors.slice(0, 5).map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
                {parseErrors.length > 5 && (
                  <div>... и ещё {parseErrors.length - 5} ошибок</div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setImportModal(false);
              setImportText("");
              setParsedProxies([]);
              setParseErrors([]);
            }}>
              Отмена
            </Button>
            <Button
              onClick={handleImport}
              disabled={importMutation.isPending || parsedProxies.length === 0}
              data-testid="button-confirm-import"
            >
              {importMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Импортировать {parsedProxies.length} прокси
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
