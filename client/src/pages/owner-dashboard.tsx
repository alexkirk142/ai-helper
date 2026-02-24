import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Shield, Loader2, Users, Key, Building2, Activity, Package, Network } from "lucide-react";

export default function OwnerDashboard() {
  const [, navigate] = useLocation();
  const { user, logout, isLoggingOut, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        navigate("/login?return=/owner");
      } else if (!user.isPlatformOwner) {
        navigate("/");
      }
    }
  }, [user, isLoading, navigate]);

  if (isLoading || !user || !user.isPlatformOwner) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold" data-testid="text-owner-console-brand">Owner Console</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground" data-testid="text-owner-email">
              {user?.email}
            </span>
            <ThemeToggle />
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => logout()}
              disabled={isLoggingOut}
              data-testid="button-owner-logout"
            >
              {isLoggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : "Выйти"}
            </Button>
          </div>
        </div>
      </header>
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold" data-testid="text-owner-dashboard-title">Панель владельца</h1>
          <p className="text-muted-foreground" data-testid="text-owner-dashboard-description">
            Управление платформой AI Sales Operator
          </p>
        </div>
        
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card className="hover-elevate cursor-pointer" onClick={() => navigate("/admin/security")} data-testid="card-admin-security">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Мониторинг</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <CardDescription>Нагрузка и безопасность</CardDescription>
            </CardContent>
          </Card>
          
          <Card className="hover-elevate cursor-pointer" onClick={() => navigate("/admin/secrets")} data-testid="card-admin-secrets">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Секреты</CardTitle>
              <Key className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <CardDescription>API ключи и интеграции</CardDescription>
            </CardContent>
          </Card>
          
          <Card className="hover-elevate cursor-pointer" onClick={() => navigate("/admin/billing")} data-testid="card-admin-billing">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Биллинг</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <CardDescription>Подписки и оплаты</CardDescription>
            </CardContent>
          </Card>
          
          <Card className="hover-elevate cursor-pointer" onClick={() => navigate("/admin/users")} data-testid="card-admin-users">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Пользователи</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <CardDescription>Управление аккаунтами</CardDescription>
            </CardContent>
          </Card>
          
          <Card className="hover-elevate cursor-pointer" onClick={() => navigate("/admin/proxies")} data-testid="card-admin-proxies">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Прокси</CardTitle>
              <Network className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <CardDescription>Управление прокси-серверами</CardDescription>
            </CardContent>
          </Card>
          
          <Card className="hover-elevate cursor-pointer" onClick={() => navigate("/owner/updates")} data-testid="card-owner-updates">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Обновления</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <CardDescription>Загрузка и применение патчей</CardDescription>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
