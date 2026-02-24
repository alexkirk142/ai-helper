import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { 
  Shield, Loader2, ArrowLeft, Search, UserX, UserCheck, 
  Calendar, Clock, Mail, Building2, Crown, Ban, Eye, 
  CreditCard, History, LogIn, Plus, Wrench, Radio, CheckCircle2, XCircle, AlertCircle
} from "lucide-react";

interface UserListItem {
  id: string;
  username: string;
  email: string | null;
  role: string;
  tenantId: string | null;
  tenantName?: string;
  isPlatformAdmin: boolean;
  isPlatformOwner: boolean;
  authProvider: string | null;
  isDisabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserDetail extends UserListItem {
  failedLoginAttempts: number;
  lockedUntil: string | null;
  disabledAt: string | null;
  disabledReason: string | null;
  emailVerifiedAt: string | null;
  subscriptionStatus?: string;
  trialEndsAt?: string | null;
  grantEndsAt?: string | null;
}

interface AuditLogEntry {
  id: string;
  actionType: string;
  targetType: string;
  targetId: string;
  adminId: string;
  reason: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

interface FeatureFlag {
  id: string;
  name: string;
  enabled: boolean;
  tenantId: string | null;
}

export default function AdminUsers() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [actionDialog, setActionDialog] = useState<{ type: "block" | "unblock" | "impersonate"; user: UserListItem } | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [subscriptionDialog, setSubscriptionDialog] = useState(false);
  const [grantDuration, setGrantDuration] = useState("30");

  const { data: usersData, isLoading: usersLoading, refetch: refetchUsers } = useQuery<{ users: UserListItem[]; total: number }>({
    queryKey: ["/api/admin/users", { q: searchQuery }],
    queryFn: async () => {
      const url = searchQuery.length >= 2 
        ? `/api/admin/users?q=${encodeURIComponent(searchQuery)}`
        : "/api/admin/users";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    enabled: !!user?.isPlatformOwner || !!user?.isPlatformAdmin,
  });

  const { data: userDetail, isLoading: detailLoading } = useQuery<UserDetail>({
    queryKey: ["/api/admin/users", selectedUser?.id, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${selectedUser?.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch user details");
      return res.json();
    },
    enabled: !!selectedUser?.id,
  });

  const { data: auditLogs } = useQuery<{ logs: AuditLogEntry[] }>({
    queryKey: ["/api/admin/users", selectedUser?.id, "audit"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${selectedUser?.id}/audit`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      return res.json();
    },
    enabled: !!selectedUser?.id,
  });

  const blockMutation = useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/disable`, { reason });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Пользователь заблокирован" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setActionDialog(null);
      setActionReason("");
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const unblockMutation = useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/enable`, { reason });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Пользователь разблокирован" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setActionDialog(null);
      setActionReason("");
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/impersonate`, { reason });
      return res.json() as Promise<{ redirectUrl: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "Вход в аккаунт пользователя" });
      window.location.href = data.redirectUrl || "/";
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const grantMutation = useMutation({
    mutationFn: async ({ tenantId, days, reason }: { tenantId: string; days: number; reason: string }) => {
      const res = await apiRequest("POST", `/api/admin/tenants/${tenantId}/grant`, { days, reason });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Подписка продлена" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      if (selectedUser?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users", selectedUser.id, "detail"] });
      }
      setSubscriptionDialog(false);
      setGrantDuration("30");
      setActionReason("");
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const tenantId = selectedUser?.tenantId ?? null;

  const { data: tenantFlags, isLoading: flagsLoading } = useQuery<FeatureFlag[]>({
    queryKey: ["/api/admin/feature-flags/tenant", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/feature-flags/tenant/${tenantId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch feature flags");
      return res.json();
    },
    enabled: !!tenantId,
  });

  const autoPartsFlag = tenantFlags?.find((f) => f.name === "AUTO_PARTS_ENABLED");

  const toggleFlagMutation = useMutation({
    mutationFn: async ({ enabled }: { enabled: boolean }) => {
      const res = await apiRequest("POST", "/api/admin/feature-flags/AUTO_PARTS_ENABLED/toggle", {
        enabled,
        tenantId,
      });
      return res.json();
    },
    onSuccess: (_data, { enabled }) => {
      toast({ title: enabled ? "Автозапчасти включены" : "Автозапчасти отключены" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags/tenant", tenantId] });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  interface MaxPersonalAccountItem {
    accountId: string;
    idInstance: string;
    apiTokenInstance: string;
    displayName?: string | null;
    status: string;
    webhookRegistered?: boolean | null;
    label?: string | null;
  }

  interface MaxPersonalListData {
    accounts: MaxPersonalAccountItem[];
  }

  const [maxPersonalShowForm, setMaxPersonalShowForm] = useState(false);
  const [maxPersonalIdInstance, setMaxPersonalIdInstance] = useState("");
  const [maxPersonalApiToken, setMaxPersonalApiToken] = useState("");
  const [maxPersonalLabel, setMaxPersonalLabel] = useState("");

  const { data: maxPersonalData, isLoading: maxPersonalLoading, refetch: refetchMaxPersonal } = useQuery<MaxPersonalListData>({
    queryKey: ["/api/admin/users", selectedUser?.id, "max-personal"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${selectedUser?.id}/max-personal`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch MAX Personal accounts");
      return res.json();
    },
    enabled: !!selectedUser?.id,
  });

  const maxPersonalAccList = maxPersonalData?.accounts ?? [];
  const maxPersonalAtLimit = maxPersonalAccList.length >= 5;

  const addMaxPersonalMutation = useMutation({
    mutationFn: async ({ idInstance, apiTokenInstance, label }: { idInstance: string; apiTokenInstance: string; label?: string }) => {
      const res = await apiRequest("POST", `/api/admin/users/${selectedUser?.id}/max-personal`, {
        idInstance,
        apiTokenInstance,
        label: label || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Сохранено", description: "MAX Personal аккаунт подключён" });
      setMaxPersonalIdInstance("");
      setMaxPersonalApiToken("");
      setMaxPersonalLabel("");
      setMaxPersonalShowForm(false);
      refetchMaxPersonal();
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const deleteMaxPersonalMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const res = await apiRequest("DELETE", `/api/admin/users/${selectedUser?.id}/max-personal/${accountId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Отключено", description: "MAX Personal аккаунт удалён" });
      refetchMaxPersonal();
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user?.isPlatformOwner && !user?.isPlatformAdmin) {
    navigate("/owner/login");
    return null;
  }

  const handleSearch = () => {
    if (searchQuery.length >= 2) {
      refetchUsers();
    }
  };

  const handleAction = () => {
    if (!actionDialog || actionReason.length < 3) return;
    
    if (actionDialog.type === "block") {
      blockMutation.mutate({ userId: actionDialog.user.id, reason: actionReason });
    } else if (actionDialog.type === "unblock") {
      unblockMutation.mutate({ userId: actionDialog.user.id, reason: actionReason });
    } else if (actionDialog.type === "impersonate") {
      impersonateMutation.mutate({ userId: actionDialog.user.id, reason: actionReason });
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (user: UserListItem) => {
    if (user.isPlatformOwner) {
      return <Badge variant="default" className="bg-amber-600"><Crown className="h-3 w-3 mr-1" />Владелец</Badge>;
    }
    if (user.isPlatformAdmin) {
      return <Badge variant="default" className="bg-blue-600"><Shield className="h-3 w-3 mr-1" />Админ</Badge>;
    }
    if (user.isDisabled) {
      return <Badge variant="destructive"><Ban className="h-3 w-3 mr-1" />Заблокирован</Badge>;
    }
    return <Badge variant="secondary">Активен</Badge>;
  };

  const getAuthProviderBadge = (provider: string | null) => {
    switch (provider) {
      case "oidc":
        return <Badge variant="outline">OIDC</Badge>;
      case "local":
        return <Badge variant="outline">Email</Badge>;
      case "mixed":
        return <Badge variant="outline">Смешанный</Badge>;
      default:
        return <Badge variant="outline">—</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/owner")}
              data-testid="button-back-to-owner"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              <span className="text-lg font-semibold" data-testid="text-admin-users-brand">Управление пользователями</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Поиск пользователей</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="Email или имя..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    data-testid="input-user-search"
                  />
                  <Button 
                    size="icon" 
                    onClick={handleSearch}
                    disabled={searchQuery.length < 2}
                    data-testid="button-user-search"
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Список пользователей</CardTitle>
                <CardDescription>
                  {usersData?.total ? `Найдено: ${usersData.total}` : "Введите запрос для поиска"}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {usersLoading ? (
                  <div className="flex justify-center p-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : usersData?.users?.length ? (
                  <div className="divide-y max-h-[500px] overflow-y-auto">
                    {usersData.users.map((u) => (
                      <div
                        key={u.id}
                        className={`p-3 hover-elevate cursor-pointer ${selectedUser?.id === u.id ? "bg-accent" : ""}`}
                        onClick={() => setSelectedUser(u as UserDetail)}
                        data-testid={`user-item-${u.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{u.username}</p>
                            <p className="text-xs text-muted-foreground truncate">{u.email || "—"}</p>
                          </div>
                          {getStatusBadge(u)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground p-6">
                    {searchQuery.length >= 2 ? "Пользователи не найдены" : "Начните поиск"}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2">
            {selectedUser ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {selectedUser.username}
                        {getStatusBadge(selectedUser)}
                      </CardTitle>
                      <CardDescription>{selectedUser.email || "Без email"}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {!selectedUser.isPlatformOwner && !selectedUser.isPlatformAdmin && (
                        <>
                          {selectedUser.isDisabled ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setActionDialog({ type: "unblock", user: selectedUser })}
                              data-testid="button-unblock-user"
                            >
                              <UserCheck className="h-4 w-4 mr-2" />
                              Разблокировать
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setActionDialog({ type: "block", user: selectedUser })}
                              data-testid="button-block-user"
                            >
                              <UserX className="h-4 w-4 mr-2" />
                              Заблокировать
                            </Button>
                          )}
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => setActionDialog({ type: "impersonate", user: selectedUser })}
                            data-testid="button-impersonate-user"
                          >
                            <LogIn className="h-4 w-4 mr-2" />
                            Войти
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="info">
                    <TabsList>
                      <TabsTrigger value="info" data-testid="tab-user-info">
                        <Eye className="h-4 w-4 mr-2" />
                        Информация
                      </TabsTrigger>
                      <TabsTrigger value="subscription" data-testid="tab-user-subscription">
                        <CreditCard className="h-4 w-4 mr-2" />
                        Подписка
                      </TabsTrigger>
                      <TabsTrigger value="audit" data-testid="tab-user-audit">
                        <History className="h-4 w-4 mr-2" />
                        Действия
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="info" className="mt-4 space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <Mail className="h-4 w-4" />
                            Email
                          </p>
                          <p className="font-medium">{selectedUser.email || "—"}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <Building2 className="h-4 w-4" />
                            Тенант
                          </p>
                          <p className="font-medium">{selectedUser.tenantName || selectedUser.tenantId || "—"}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <Shield className="h-4 w-4" />
                            Роль
                          </p>
                          <p className="font-medium capitalize">{selectedUser.role}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Авторизация</p>
                          {getAuthProviderBadge(selectedUser.authProvider)}
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            Регистрация
                          </p>
                          <p className="font-medium">{formatDate(selectedUser.createdAt)}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            Последний вход
                          </p>
                          <p className="font-medium">{formatDate(selectedUser.lastLoginAt)}</p>
                        </div>
                      </div>

                      {(userDetail?.isDisabled || userDetail?.lockedUntil) && (
                        <Card className="border-destructive bg-destructive/5">
                          <CardContent className="pt-4">
                            <p className="text-sm font-medium text-destructive mb-2">Ограничения аккаунта</p>
                            {userDetail.isDisabled && (
                              <p className="text-sm">
                                Заблокирован: {formatDate(userDetail.disabledAt)}
                                {userDetail.disabledReason && (
                                  <span className="block text-muted-foreground">Причина: {userDetail.disabledReason}</span>
                                )}
                              </p>
                            )}
                            {userDetail.lockedUntil && (
                              <p className="text-sm">
                                Временная блокировка до: {formatDate(userDetail.lockedUntil)}
                                <span className="block text-muted-foreground">
                                  Неудачных попыток: {userDetail.failedLoginAttempts}
                                </span>
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      )}
                    </TabsContent>

                    <TabsContent value="subscription" className="mt-4">
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm font-medium">Статус подписки</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <Badge variant={userDetail?.subscriptionStatus === "active" ? "default" : "secondary"}>
                                {userDetail?.subscriptionStatus || "Нет подписки"}
                              </Badge>
                            </CardContent>
                          </Card>
                          {userDetail?.trialEndsAt && (
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium">Пробный период</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <p className="text-sm">До: {formatDate(userDetail.trialEndsAt)}</p>
                              </CardContent>
                            </Card>
                          )}
                          {userDetail?.grantEndsAt && (
                            <Card className="border-green-500/50">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-green-600 dark:text-green-400">Активный грант</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <p className="text-sm">До: {formatDate(userDetail.grantEndsAt)}</p>
                              </CardContent>
                            </Card>
                          )}
                        </div>
                        <Button 
                          variant="outline" 
                          onClick={() => setSubscriptionDialog(true)}
                          disabled={!selectedUser.tenantId}
                          data-testid="button-manage-subscription"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Продлить подписку
                        </Button>

                        {selectedUser.tenantId && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <Wrench className="h-4 w-4" />
                                Функции
                              </CardTitle>
                              <CardDescription>Дополнительные модули для тенанта</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="flex items-center justify-between gap-4">
                                <div className="space-y-0.5">
                                  <p className="text-sm font-medium">Автозапчасти</p>
                                  <p className="text-xs text-muted-foreground">
                                    Включить модуль подбора запчастей по VIN
                                  </p>
                                </div>
                                {flagsLoading ? (
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                ) : (
                                  <Switch
                                    checked={autoPartsFlag?.enabled ?? false}
                                    onCheckedChange={(enabled) => toggleFlagMutation.mutate({ enabled })}
                                    disabled={toggleFlagMutation.isPending}
                                    data-testid="switch-auto-parts-enabled"
                                  />
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {selectedUser.tenantId && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <Radio className="h-4 w-4" />
                                Каналы
                              </CardTitle>
                              <CardDescription>Мессенджер-подключения для этого тенанта</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-medium">MAX Personal (GREEN-API)</p>
                                  {!maxPersonalLoading && !maxPersonalAtLimit && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setMaxPersonalShowForm((v) => !v)}
                                    >
                                      <Plus className="h-3 w-3 mr-1" />
                                      Добавить аккаунт
                                    </Button>
                                  )}
                                </div>

                                {maxPersonalLoading ? (
                                  <div className="flex items-center gap-2 text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span className="text-sm">Загрузка...</span>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {maxPersonalAccList.length === 0 && (
                                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                                        <XCircle className="h-4 w-4 shrink-0" />
                                        Аккаунты не подключены
                                      </div>
                                    )}

                                    {maxPersonalAccList.map((acc, idx) => (
                                      <div key={acc.accountId} className="rounded-md border p-3 bg-green-500/5 space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                                            <div className="min-w-0">
                                              <p className="text-sm font-medium truncate">
                                                Аккаунт {idx + 1}
                                                {acc.label ? ` — ${acc.label}` : ""}
                                                {acc.displayName ? ` (${acc.displayName})` : ""}
                                              </p>
                                              <p className="text-xs text-muted-foreground truncate">
                                                Статус: {acc.status} · Instance: {acc.idInstance}
                                              </p>
                                            </div>
                                          </div>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => deleteMaxPersonalMutation.mutate(acc.accountId)}
                                            disabled={deleteMaxPersonalMutation.isPending}
                                            data-testid={`button-max-personal-disconnect-${acc.accountId}`}
                                          >
                                            {deleteMaxPersonalMutation.isPending ? (
                                              <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                              "Удалить"
                                            )}
                                          </Button>
                                        </div>
                                        {acc.webhookRegistered === false && (
                                          <div className="flex items-center gap-2 text-amber-600 text-xs">
                                            <AlertCircle className="h-3 w-3 shrink-0" />
                                            Вебхук не зарегистрирован — входящие сообщения не поступят
                                          </div>
                                        )}
                                      </div>
                                    ))}

                                    {maxPersonalAtLimit && (
                                      <p className="text-xs text-muted-foreground">Максимум 5 аккаунтов достигнут</p>
                                    )}

                                    {!maxPersonalAtLimit && (maxPersonalShowForm || maxPersonalAccList.length === 0) && (
                                      <div className="rounded-md border p-3 space-y-2 bg-muted/30">
                                        <p className="text-xs text-muted-foreground font-medium">
                                          Добавить аккаунт ({maxPersonalAccList.length}/5 использовано)
                                        </p>
                                        <div className="space-y-1">
                                          <Label className="text-xs">Instance ID</Label>
                                          <Input
                                            placeholder="1234567890"
                                            value={maxPersonalIdInstance}
                                            onChange={(e) => setMaxPersonalIdInstance(e.target.value)}
                                            data-testid="input-max-personal-id-instance"
                                          />
                                        </div>
                                        <div className="space-y-1">
                                          <Label className="text-xs">API Token</Label>
                                          <Input
                                            placeholder="••••••••••••••••"
                                            type="password"
                                            value={maxPersonalApiToken}
                                            onChange={(e) => setMaxPersonalApiToken(e.target.value)}
                                            data-testid="input-max-personal-api-token"
                                          />
                                        </div>
                                        <div className="space-y-1">
                                          <Label className="text-xs">Метка (необязательно)</Label>
                                          <Input
                                            placeholder="Основной, Продажи…"
                                            value={maxPersonalLabel}
                                            onChange={(e) => setMaxPersonalLabel(e.target.value)}
                                            data-testid="input-max-personal-label"
                                          />
                                        </div>
                                        <Button
                                          size="sm"
                                          onClick={() =>
                                            addMaxPersonalMutation.mutate({
                                              idInstance: maxPersonalIdInstance,
                                              apiTokenInstance: maxPersonalApiToken,
                                              label: maxPersonalLabel || undefined,
                                            })
                                          }
                                          disabled={
                                            !maxPersonalIdInstance ||
                                            !maxPersonalApiToken ||
                                            addMaxPersonalMutation.isPending
                                          }
                                          data-testid="button-max-personal-save"
                                        >
                                          {addMaxPersonalMutation.isPending ? (
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                          ) : null}
                                          Сохранить и активировать
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="audit" className="mt-4">
                      {auditLogs?.logs?.length ? (
                        <div className="space-y-2 max-h-[400px] overflow-y-auto">
                          {auditLogs.logs.map((log) => (
                            <Card key={log.id} className="p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-medium text-sm">{log.actionType}</p>
                                  <p className="text-xs text-muted-foreground">{log.reason || "Без причины"}</p>
                                </div>
                                <p className="text-xs text-muted-foreground whitespace-nowrap">
                                  {formatDate(log.createdAt)}
                                </p>
                              </div>
                            </Card>
                          ))}
                        </div>
                      ) : (
                        <p className="text-center text-muted-foreground py-8">Нет записей</p>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            ) : (
              <Card className="h-full flex items-center justify-center">
                <CardContent className="text-center py-12">
                  <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-lg font-medium">Выберите пользователя</p>
                  <p className="text-muted-foreground">Найдите и выберите пользователя для просмотра деталей</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>

      <Dialog open={!!actionDialog} onOpenChange={() => { setActionDialog(null); setActionReason(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.type === "block" && "Заблокировать пользователя"}
              {actionDialog?.type === "unblock" && "Разблокировать пользователя"}
              {actionDialog?.type === "impersonate" && "Войти в аккаунт"}
            </DialogTitle>
            <DialogDescription>
              {actionDialog?.type === "block" && `Пользователь ${actionDialog.user.username} не сможет войти в систему`}
              {actionDialog?.type === "unblock" && `Пользователь ${actionDialog.user.username} сможет снова войти`}
              {actionDialog?.type === "impersonate" && `Вы войдёте в аккаунт ${actionDialog.user.username} для настройки`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="Причина действия (минимум 3 символа)..."
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              className="min-h-[80px]"
              data-testid="input-action-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionDialog(null); setActionReason(""); }}>
              Отмена
            </Button>
            <Button
              onClick={handleAction}
              disabled={actionReason.length < 3 || blockMutation.isPending || unblockMutation.isPending || impersonateMutation.isPending}
              variant={actionDialog?.type === "block" ? "destructive" : "default"}
              data-testid="button-confirm-action"
            >
              {(blockMutation.isPending || unblockMutation.isPending || impersonateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Подтвердить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={subscriptionDialog} onOpenChange={() => { setSubscriptionDialog(false); setActionReason(""); setGrantDuration("30"); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Продлить подписку</DialogTitle>
            <DialogDescription>
              Выберите период продления для {selectedUser?.username}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Период продления</Label>
              <Select value={grantDuration} onValueChange={setGrantDuration}>
                <SelectTrigger data-testid="select-grant-duration">
                  <SelectValue placeholder="Выберите период" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 дней</SelectItem>
                  <SelectItem value="14">14 дней</SelectItem>
                  <SelectItem value="30">30 дней (1 месяц)</SelectItem>
                  <SelectItem value="90">90 дней (3 месяца)</SelectItem>
                  <SelectItem value="180">180 дней (6 месяцев)</SelectItem>
                  <SelectItem value="365">365 дней (1 год)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Причина (необязательно)</Label>
              <Textarea
                placeholder="Например: подарок, компенсация, партнёр..."
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                className="min-h-[60px]"
                data-testid="input-grant-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSubscriptionDialog(false); setActionReason(""); setGrantDuration("30"); }}>
              Отмена
            </Button>
            <Button
              onClick={() => {
                if (selectedUser?.tenantId) {
                  grantMutation.mutate({
                    tenantId: selectedUser.tenantId,
                    days: parseInt(grantDuration),
                    reason: actionReason || `Продление на ${grantDuration} дней`,
                  });
                }
              }}
              disabled={!selectedUser?.tenantId || grantMutation.isPending}
              data-testid="button-confirm-grant"
            >
              {grantMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Продлить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
