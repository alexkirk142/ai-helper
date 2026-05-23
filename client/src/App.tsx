import { Switch, Route, useLocation } from "wouter";
import { lazy, Suspense, useEffect, useState } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/hooks/use-auth";
import { useNotifications } from "@/hooks/use-notifications";
import { useAiBillingStatus, useBillingStatus } from "@/hooks/use-billing";
import { PaymentSuccessDialog } from "@/components/subscription-paywall";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MessageSquare, Brain, Shield, LogOut } from "lucide-react";
import { BrandLogoIcon, BRAND_NAME } from "@/components/brand-logo";
import { wsClient } from "@/lib/websocket";

// Route-based code splitting: each page is loaded only when the user navigates to it.
// This keeps the initial bundle small and defers heavy pages (Settings ~3000 lines,
// Analytics + recharts chart components) until they are actually needed.
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Conversations = lazy(() => import("@/pages/conversations"));
const KnowledgeBase = lazy(() => import("@/pages/knowledge-base"));
const Products = lazy(() => import("@/pages/products"));
const Escalations = lazy(() => import("@/pages/escalations"));
const FailedLeads = lazy(() => import("@/pages/failed-leads"));
const CrmPage = lazy(() => import("@/pages/crm"));
const Settings = lazy(() => import("@/pages/settings"));
const CustomerProfile = lazy(() => import("@/pages/customer-profile"));
const Onboarding = lazy(() => import("@/pages/onboarding"));
// Analytics is its own chunk so recharts (via ui/chart.tsx) stays out of the main bundle.
const Analytics = lazy(() => import("@/pages/analytics"));
const SecurityStatus = lazy(() => import("@/pages/security-status"));
const Billing = lazy(() => import("@/pages/billing"));
const Extensions = lazy(() => import("@/pages/extensions"));
const AdminSecrets = lazy(() => import("@/pages/admin-secrets"));
const AdminUsers = lazy(() => import("@/pages/admin-users"));
const AdminBilling = lazy(() => import("@/pages/admin-billing"));
const AdminProxies = lazy(() => import("@/pages/admin-proxies"));
const AdminMaxGateway = lazy(() => import("@/pages/admin-max-gateway"));
const AdminTenants = lazy(() => import("@/pages/admin-tenants"));
const AdminBroadcast = lazy(() => import("@/pages/admin-broadcast"));
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
        <Route path="/crm" component={CrmPage} />
        <Route path="/failed-leads" component={FailedLeads} />
        <Route path="/settings" component={Settings} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/extensions" component={Extensions} />
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
        <Route path="/admin/max-gateway">
          {() => <AdminGuard><AdminMaxGateway /></AdminGuard>}
        </Route>
        <Route path="/admin/tenants">
          {() => <AdminGuard><AdminTenants /></AdminGuard>}
        </Route>
        <Route path="/admin/broadcast">
          {() => <AdminGuard><AdminBroadcast /></AdminGuard>}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function LandingPage() {
  return (
    <div className="relative min-h-screen bg-background overflow-x-hidden">
      {/* Background glowing decorations */}
      <div className="absolute top-0 left-1/4 -z-10 h-[600px] w-[600px] rounded-full bg-primary/5 blur-[120px]" />
      <div className="absolute top-1/3 right-1/4 -z-10 h-[500px] w-[500px] rounded-full bg-violet-500/5 blur-[100px]" />
      <div className="absolute bottom-10 left-10 -z-10 h-[400px] w-[400px] rounded-full bg-blue-500/5 blur-[80px]" />

      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center p-1 rounded-xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 border border-primary/10">
              <BrandLogoIcon size={30} />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">
                {BRAND_NAME}
              </span>
              <span className="hidden sm:inline text-[10px] text-muted-foreground font-medium -mt-1 tracking-wider uppercase">
                Умный ассистент
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button variant="ghost" size="sm" asChild data-testid="button-login-email" className="font-medium">
              <a href="/login">Войти</a>
            </Button>
            <Button size="sm" asChild data-testid="button-signup" className="shadow-lg shadow-primary/20 hover:shadow-primary/35 transition-all">
              <a href="/signup">Регистрация</a>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-20 sm:py-28 relative">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1.5 text-xs font-semibold text-primary tracking-wide mb-8">
            <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
            Умная автоматизация продаж 2.0
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl md:text-7xl leading-tight">
            Автоматизация продаж с{" "}
            <span className="bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 dark:from-violet-400 dark:via-indigo-400 dark:to-blue-400 bg-clip-text text-transparent drop-shadow-sm">
              ИИ-интеллектом
            </span>
          </h1>
          <p className="mt-8 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed font-normal">
            Умный оператор для автоматической обработки клиентских обращений в Telegram, WhatsApp и других каналах. 
            ИИ мгновенно генерирует ответы, а вы контролируете качество в одно касание.
          </p>
          <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" asChild data-testid="button-get-started" className="h-12 px-8 text-base font-semibold shadow-xl shadow-primary/25 hover:shadow-primary/40 transition-all rounded-xl w-full sm:w-auto">
              <a href="/signup">Начать работу бесплатно</a>
            </Button>
            <Button size="lg" variant="outline" asChild className="h-12 px-8 text-base font-medium rounded-xl w-full sm:w-auto hover:bg-accent/60">
              <a href="/login">Демонстрация</a>
            </Button>
          </div>
        </div>

        {/* Feature section */}
        <div className="mx-auto mt-28 max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Всё для эффективных продаж</h2>
            <p className="text-sm text-muted-foreground mt-2">Единый инструмент для кратного роста конверсий вашего бизнеса</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="group relative overflow-hidden hover:shadow-2xl hover:shadow-primary/5 hover:border-primary/30 transition-all duration-300 rounded-2xl bg-card border border-card-border">
              <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-violet-500 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardHeader className="space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 group-hover:scale-110 transition-transform">
                  <MessageSquare className="h-6 w-6" />
                </div>
                <CardTitle className="text-xl font-bold tracking-tight">Мультиканальность</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm text-muted-foreground leading-relaxed">
                  Поддержка Telegram, WhatsApp, MAX и других популярных мессенджеров в едином удобном рабочем пространстве.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="group relative overflow-hidden hover:shadow-2xl hover:shadow-primary/5 hover:border-primary/30 transition-all duration-300 rounded-2xl bg-card border border-card-border">
              <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-indigo-500 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardHeader className="space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                  <Brain className="h-6 w-6" />
                </div>
                <CardTitle className="text-xl font-bold tracking-tight">ИИ-подсказки</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm text-muted-foreground leading-relaxed">
                  Автоматическая генерация умных ответов на основе вашей базы знаний и каталога товаров без ошибок и задержек.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="group relative overflow-hidden hover:shadow-2xl hover:shadow-primary/5 hover:border-primary/30 transition-all duration-300 rounded-2xl bg-card border border-card-border">
              <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-blue-500 to-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardHeader className="space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform">
                  <Shield className="h-6 w-6" />
                </div>
                <CardTitle className="text-xl font-bold tracking-tight">Контроль качества</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm text-muted-foreground leading-relaxed">
                  Будьте уверены в каждом слове. Одобряйте, редактируйте или отклоняйте варианты ответов ИИ перед отправкой.
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

interface OnboardingState {
  status: "NOT_STARTED" | "IN_PROGRESS" | "DONE";
  currentStep: string;
}

const SUB_SHOWN_KEY = "sub_activated_shown_period";

export function markSubscriptionDialogShown(periodEnd: string | null | undefined) {
  try {
    localStorage.setItem(SUB_SHOWN_KEY, periodEnd ?? "");
  } catch {/* ignore */}
}

function AuthenticatedApp() {
  const { user, logout, isLoggingOut } = useAuth();
  const [location, setLocation] = useLocation();

  // Platform staff (owner/admin without tenant) → redirect to owner panel
  const isPlatformStaff = (user?.isPlatformAdmin || user?.isPlatformOwner) && !user?.tenantId;

  const { data: onboardingState, isLoading: onboardingLoading } = useQuery<OnboardingState>({
    queryKey: ["/api/onboarding/state"],
    enabled: !isPlatformStaff,
  });

  const { data: aiBilling, isLoading: aiBillingLoading } = useAiBillingStatus();
  const { data: channelsBilling } = useBillingStatus();
  const [showGlobalSuccess, setShowGlobalSuccess] = useState(false);

  // Show success dialog when subscription becomes active and user hasn't seen it yet for this period
  useEffect(() => {
    if (!channelsBilling) return;
    if (channelsBilling.status !== "active" || channelsBilling.isTrial) return;
    const periodEnd = channelsBilling.currentPeriodEnd
      ? String(channelsBilling.currentPeriodEnd)
      : "";
    try {
      const shown = localStorage.getItem(SUB_SHOWN_KEY);
      if (shown === periodEnd) return; // already shown for this billing period
    } catch {/* ignore */}
    // Don't fire on /settings when ?billing=success is still in the URL
    // (settings.tsx handles that case itself and will call markSubscriptionDialogShown)
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") === "success") return;
    markSubscriptionDialogShown(periodEnd);
    setShowGlobalSuccess(true);
  }, [channelsBilling]);

  useNotifications();

  useEffect(() => {
    // Platform staff has no tenant — don't try to connect WebSocket (would loop rejections)
    if (isPlatformStaff) return;
    wsClient.connect();
    return () => {
      wsClient.disconnect();
    };
  }, [isPlatformStaff]);

  // Redirect platform staff to owner panel (but allow /admin/* pages to work)
  useEffect(() => {
    if (isPlatformStaff && !location.startsWith("/owner") && !location.startsWith("/admin")) {
      setLocation("/owner");
    }
  }, [isPlatformStaff, location, setLocation]);
  
  useEffect(() => {
    if (!onboardingLoading && !aiBillingLoading && onboardingState) {
      const needsOnboarding = onboardingState.status === "NOT_STARTED" || onboardingState.status === "IN_PROGRESS";
      const hasAiSubscription = aiBilling?.canAccess === true;
      const isOnOnboardingPage = location === "/onboarding";

      // Only redirect to onboarding after the user has paid for the AI subscription.
      // Skip if billing success is being shown (toast/dialog in progress).
      const billingSuccessShowing = sessionStorage.getItem("ai_billing_success") === "1";
      if (needsOnboarding && hasAiSubscription && !isOnOnboardingPage && !billingSuccessShowing) {
        setLocation("/onboarding");
      }
    }
  }, [onboardingState, onboardingLoading, aiBilling, aiBillingLoading, location, setLocation]);

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <PaymentSuccessDialog open={showGlobalSuccess} onOpenChange={setShowGlobalSuccess} />
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden min-h-screen">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3 sm:px-4">
          <SidebarTrigger data-testid="button-sidebar-toggle" />
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden sm:block text-sm text-muted-foreground truncate max-w-[200px]">
              {user?.email || user?.firstName || "Пользователь"}
            </span>
            <ThemeToggle />
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => logout()}
              disabled={isLoggingOut}
              data-testid="button-logout"
              className="px-2 sm:px-3"
            >
              {isLoggingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <LogOut className="h-4 w-4 sm:hidden" />
                  <span className="hidden sm:inline">Выйти</span>
                </>
              )}
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <Router />
        </main>
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
