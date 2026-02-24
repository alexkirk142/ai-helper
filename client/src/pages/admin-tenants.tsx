import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Building2, Search } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

interface TenantSearchResult {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  subscriptionStatus: string;
  hadTrial: boolean;
}

interface SearchResponse {
  results: TenantSearchResult[];
  count: number;
  query: string;
}

interface FeatureFlag {
  id: string;
  name: string;
  enabled: boolean;
  tenantId: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Активен",
  suspended: "Приостановлен",
  restricted: "Ограничен",
  inactive: "Неактивен",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  suspended: "destructive",
  restricted: "secondary",
  inactive: "outline",
};

function useTenantAutoPartsFlag(tenantId: string) {
  return useQuery<FeatureFlag[]>({
    queryKey: ["/api/admin/feature-flags/tenant", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/feature-flags/tenant/${tenantId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch tenant flags");
      return res.json();
    },
    staleTime: 30 * 1000,
  });
}

function TenantRow({ tenant }: { tenant: TenantSearchResult }) {
  const { toast } = useToast();
  const { data: flags, isLoading: flagsLoading } = useTenantAutoPartsFlag(tenant.id);

  const autoPartsFlag = flags?.find((f) => f.name === "AUTO_PARTS_ENABLED");
  const isEnabled = autoPartsFlag?.enabled ?? false;

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      return apiRequest("POST", "/api/admin/feature-flags/AUTO_PARTS_ENABLED/toggle", {
        enabled,
        tenantId: tenant.id,
      });
    },
    onSuccess: (_, enabled) => {
      toast({
        title: enabled ? "Автозапчасти включены" : "Автозапчасти отключены",
        description: `Для тенанта «${tenant.name}»`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/feature-flags/tenant", tenant.id],
      });
    },
    onError: (err: any) => {
      toast({
        title: "Ошибка",
        description: err.message || "Не удалось изменить флаг",
        variant: "destructive",
      });
    },
  });

  return (
    <div
      className="flex items-center justify-between p-4 rounded-md bg-muted/50"
      data-testid={`row-tenant-${tenant.id}`}
    >
      <div className="flex items-center gap-4 min-w-0">
        <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="font-medium truncate">{tenant.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant={STATUS_VARIANTS[tenant.status] ?? "outline"} className="text-xs">
              {STATUS_LABELS[tenant.status] ?? tenant.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Подписка: {tenant.subscriptionStatus}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-sm text-muted-foreground">Автозапчасти</span>
        {flagsLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <Switch
            checked={isEnabled}
            onCheckedChange={(checked) => toggleMutation.mutate(checked)}
            disabled={toggleMutation.isPending}
            data-testid={`switch-auto-parts-${tenant.id}`}
          />
        )}
      </div>
    </div>
  );
}

export default function AdminTenants() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  if (!authLoading && !user?.isPlatformAdmin && !user?.isPlatformOwner) {
    navigate("/owner/login");
    return null;
  }

  const { data, isLoading, error } = useQuery<SearchResponse>({
    queryKey: ["/api/admin/tenants/search", debouncedQuery],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/tenants/search?q=${encodeURIComponent(debouncedQuery)}&limit=50`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to search tenants");
      return res.json();
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 30 * 1000,
  });

  const handleSearch = (value: string) => {
    setQuery(value);
    if (value.length >= 2) {
      setDebouncedQuery(value);
    } else {
      setDebouncedQuery("");
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Building2 className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Управление тенантами</h1>
          <p className="text-muted-foreground">
            Включение и отключение модуля автозапчастей для тенантов
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Поиск тенанта</CardTitle>
          <CardDescription>Введите минимум 2 символа для поиска</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Название тенанта..."
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              data-testid="input-tenant-search"
            />
          </div>

          {debouncedQuery.length < 2 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Введите название для поиска тенантов
            </p>
          )}

          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {error && (
            <p className="text-destructive text-center py-4">Не удалось выполнить поиск</p>
          )}

          {data && !isLoading && (
            <div className="space-y-2">
              {data.results.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p>Тенанты не найдены</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground mb-2">
                    Найдено: {data.count}
                  </p>
                  {data.results.map((tenant) => (
                    <TenantRow key={tenant.id} tenant={tenant} />
                  ))}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
