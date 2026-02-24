import { Switch, Route, useLocation } from "wouter";
import { lazy, Suspense, useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Bot, MessageSquare, Brain, Shield } from "lucide-react";
import { wsClient } from "@/lib/websocket";

// Route-based code splitting: each page is loaded only when the user navigates to it.
// This keeps the initial bundle small and defers heavy pages (Settings ~3000 lines,
// Analytics + recharts chart components) until they are actually needed.
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Conversations = lazy(() => import("@/pages/conversations"));
const KnowledgeBase = lazy(() => import("@/pages/knowledge-base"));
const Products = lazy(() => import("@/pages/products"));
const Escalations = lazy(() => import("@/pages/escalations"));
const Settings = lazy(() => import("@/pages/settings"));
const CustomerProfile = lazy(() => import("@/pages/customer-profile"));
const Onboarding = lazy(() => import("@/pages/onboarding"));
// Analytics is its own chunk so recharts (via ui/chart.tsx) stays out of the main bundle.
const Analytics = lazy(() => import("@/pages/analytics"));
const SecurityStatus = lazy(() => import("@/pages/security-status"));
const Billing = lazy(() => import("@/pages/billing"));
const AdminSecrets = lazy(() => import("@/pages/admin-secrets"));
const AdminUsers = lazy(() => import("@/pages/admin-users"));
const AdminBilling = lazy(() => import("@/pages/admin-billing"));
const AdminProxies = lazy(() => import("@/pages/admin-proxies"));
const AdminTenants = lazy(() => import("@/pages/admin-tenants"));
const NotFound = lazy(() => import("@/pages/not-found"));
const OwnerLoginPage = lazy(() => import("@/pages/owner-login"));
const OwnerDashboard = lazy(() => import("@/pages/owner-dashboard"));
const OwnerUpdates = lazy(() => import("@/pages/owner-updates"));
// Auth pages share one module chunk; each named export is wrapped to satisfy lazy()'s
// requirement for a module with a default export.
const LoginPage = lazy(() => import("@/pages/auth").then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import("@/pages/auth").then((m) => ({ default: m.SignupPage })));
const VerifyEmailPage = lazy(() => import("@/pages/auth").then((m) => ({ default: m.VerifyEmailPage })));
const ForgotPasswordPage = lazy(() => import("@/pages/auth").then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("@/pages/auth").then((m) => ({ default: m.ResetPasswordPage })));

function PageLoader() {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();
  
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (!user?.isPlatformAdmin && !user?.isPlatformOwner) {
    navigate("/");
    return null;
  }
  
  return <>{children}</>;
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/conversations" component={Conversations} />
        <Route path="/customers/:id" component={CustomerProfile} />
        <Route path="/knowledge-base" component={KnowledgeBase} />
        <Route path="/products" component={Products} />
        <Route path="/escalations" component={Escalations} />
        <Route path="/settings" component={Settings} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/admin/security">
          {() => <AdminGuard><SecurityStatus /></AdminGuard>}
        </Route>
        <Route path="/admin/billing">
          {() => <AdminGuard><AdminBilling /></AdminGuard>}
        </Route>
        <Route path="/admin/secrets">
          {() => <AdminGuard><AdminSecrets /></AdminGuard>}
        </Route>
        <Route path="/admin/users">
          {() => <AdminGuard><AdminUsers /></AdminGuard>}
        </Route>
        <Route path="/admin/proxies">
          {() => <AdminGuard><AdminProxies /></AdminGuard>}
        </Route>
        <Route path="/admin/tenants">
          {() => <AdminGuard><AdminTenants /></AdminGuard>}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold">AI Sales Operator</span>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Button variant="outline" asChild data-testid="button-login-email">
              <a href="/login">Войти</a>
            </Button>
            <Button asChild data-testid="button-signup">
              <a href="/signup">Регистрация</a>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Автоматизация продаж с ИИ
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            Умный оператор для обработки клиентских обращений через Telegram, WhatsApp и другие мессенджеры. 
            ИИ генерирует ответы, а вы контролируете качество.
          </p>
          <div className="mt-10">
            <Button size="lg" asChild data-testid="button-get-started">
              <a href="/signup">Начать работу</a>
            </Button>
          </div>
        </div>

        <div className="mx-auto mt-20 grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <MessageSquare className="h-8 w-8 text-primary" />
              <CardTitle className="mt-4">Мультиканальность</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Поддержка Telegram, WhatsApp, MAX и других мессенджеров в едином интерфейсе
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Brain className="h-8 w-8 text-primary" />
              <CardTitle className="mt-4">ИИ-подсказки</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Автоматическая генерация ответов на основе базы знаний и каталога товаров
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Shield className="h-8 w-8 text-primary" />
              <CardTitle className="mt-4">Контроль качества</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Одобряйте, редактируйте или отклоняйте ответы ИИ перед отправкой клиенту
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

interface OnboardingState {
  status: "NOT_STARTED" | "IN_PROGRESS" | "DONE";
  currentStep: string;
}

function AuthenticatedApp() {
  const { user, logout, isLoggingOut } = useAuth();
  const [location, setLocation] = useLocation();
  
  const { data: onboardingState, isLoading: onboardingLoading } = useQuery<OnboardingState>({
    queryKey: ["/api/onboarding/state"],
  });

  useEffect(() => {
    wsClient.connect();
    return () => {
      wsClient.disconnect();
    };
  }, []);
  
  useEffect(() => {
    if (!onboardingLoading && onboardingState) {
      const needsOnboarding = onboardingState.status === "NOT_STARTED" || onboardingState.status === "IN_PROGRESS";
      const isOnOnboardingPage = location === "/onboarding";
      
      if (needsOnboarding && !isOnOnboardingPage) {
        setLocation("/onboarding");
      }
    }
  }, [onboardingState, onboardingLoading, location, setLocation]);

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {user?.email || user?.firstName || "Пользователь"}
              </span>
              <ThemeToggle />
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => logout()}
                disabled={isLoggingOut}
                data-testid="button-logout"
              >
                {isLoggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : "Выйти"}
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AuthRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/signup" component={SignupPage} />
        <Route path="/verify-email" component={VerifyEmailPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route component={LandingPage} />
      </Switch>
    </Suspense>
  );
}

function OwnerRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/owner/login" component={OwnerLoginPage} />
        <Route path="/owner/updates" component={OwnerUpdates} />
        <Route path="/owner" component={OwnerDashboard} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  const [location] = useLocation();
  const { isLoading, isAuthenticated } = useAuth();
  
  const authRoutes = ["/login", "/signup", "/verify-email", "/forgot-password", "/reset-password"];
  const isAuthRoute = authRoutes.some(route => location.startsWith(route));
  const isOwnerRoute = location.startsWith("/owner");

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isOwnerRoute) {
    return <OwnerRouter />;
  }

  if (isAuthRoute) {
    return <AuthRouter />;
  }

  if (!isAuthenticated) {
    return <LandingPage />;
  }

  return <AuthenticatedApp />;
}

function AppWrapper() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="ai-sales-operator-theme">
        <TooltipProvider>
          <App />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default AppWrapper;
