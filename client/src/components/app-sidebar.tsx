import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  LayoutDashboard,
  MessageSquare,
  Book,
  Package,
  Settings,
  AlertTriangle,
  BarChart3,
  Users,
  Puzzle,
  Activity,
  KeyRound,
  CreditCard,
  Server,
  RefreshCw,
  Send,
} from "lucide-react";
import { BrandLogoIcon, BRAND_NAME, BRAND_TAGLINE } from "@/components/brand-logo";
import { useAuth } from "@/hooks/use-auth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";

const ownerItems = [
  { title: "Мониторинг",   url: "/admin/security",  icon: Activity,    testId: "nav-admin-security" },
  { title: "Секреты",      url: "/admin/secrets",   icon: KeyRound,    testId: "nav-admin-secrets" },
  { title: "Биллинг",      url: "/admin/billing",   icon: CreditCard,  testId: "nav-admin-billing" },
  { title: "Пользователи", url: "/admin/users",     icon: Users,       testId: "nav-admin-users" },
  { title: "Прокси",       url: "/admin/proxies",   icon: Server,      testId: "nav-admin-proxies" },
  { title: "MAX Gateway",  url: "/admin/max-gateway", icon: Server,    testId: "nav-admin-max-gateway" },
  { title: "Тенанты",      url: "/admin/tenants",   icon: LayoutDashboard, testId: "nav-admin-tenants" },
  { title: "Рассылки",     url: "/admin/broadcast", icon: Send,        testId: "nav-admin-broadcast" },
  { title: "Обновления",   url: "/owner/updates",   icon: RefreshCw,   testId: "nav-owner-updates" },
];

interface Escalation {
  id: string;
  status: string;
}

const managementItems = [
  {
    title: "База знаний",
    url: "/knowledge-base",
    icon: Book,
  },
  {
    title: "Товары",
    url: "/products",
    icon: Package,
  },
  {
    title: "Аналитика",
    url: "/analytics",
    icon: BarChart3,
  },
  {
    title: "Расширения",
    url: "/extensions",
    icon: Puzzle,
  },
  {
    title: "Настройки",
    url: "/settings",
    icon: Settings,
  },
];


export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const isPlatformStaff = user?.isPlatformAdmin || user?.isPlatformOwner;

  const { data: channelCounts } = useQuery<{ all: number }>({
    queryKey: ["/api/conversations/channel-counts"],
    refetchInterval: 30000,
    enabled: !isPlatformStaff,
  });

  const { data: escalations } = useQuery<Escalation[]>({
    queryKey: ["/api/escalations", "pending"],
    refetchInterval: 30000,
    enabled: !isPlatformStaff,
  });

  const { data: crmStats } = useQuery<{ new: number; failed: number; total: number }>({
    queryKey: ["/api/crm/stats"],
    queryFn: async () => {
      const res = await fetch("/api/crm/stats", { credentials: "include" });
      if (!res.ok) return { new: 0, failed: 0, total: 0 };
      return res.json();
    },
    refetchInterval: 60000,
    enabled: !isPlatformStaff,
  });

  const unreadCount = channelCounts?.all || 0;
  const pendingEscalationsCount = escalations?.filter(e => e.status === "pending").length || 0;
  const newLeadsCount = (crmStats?.new || 0);

  const headerHref = isPlatformStaff ? "/owner" : "/";

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="p-5 pb-2">
        <Link href={headerHref} className="flex items-center gap-3 group">
          <div className="relative flex items-center justify-center p-1.5 rounded-xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 border border-primary/10 group-hover:scale-105 transition-transform">
            <BrandLogoIcon size={30} />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight bg-gradient-to-r from-sidebar-foreground to-sidebar-foreground/80 bg-clip-text">
              {BRAND_NAME}
            </span>
            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider -mt-0.5">
              {isPlatformStaff ? "Owner Console" : BRAND_TAGLINE}
            </span>
          </div>
        </Link>

        {/* Rent Flow inspired Profile Card */}
        <div className="mt-5 flex items-center justify-between p-3 rounded-2xl bg-sidebar-accent/20 border border-sidebar-border/30">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar className="h-9 w-9 border border-sidebar-border/40 shadow-sm shrink-0">
              {user?.profileImageUrl ? (
                <AvatarImage src={user.profileImageUrl} />
              ) : null}
              <AvatarFallback className="text-xs font-bold bg-sidebar-accent text-sidebar-foreground">
                {user?.firstName?.slice(0, 2).toUpperCase() || user?.email?.slice(0, 2).toUpperCase() || "ОП"}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider leading-none">С возвращением!</span>
              <span className="text-xs font-bold text-sidebar-foreground truncate mt-0.5 leading-tight">
                {user?.firstName || user?.username || "Оператор"}
              </span>
              <span className="text-[9px] text-muted-foreground/50 font-semibold capitalize mt-0.5 leading-none">
                {new Date().toLocaleDateString("ru-RU", { weekday: 'long', month: 'short', day: 'numeric' })}
              </span>
            </div>
          </div>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-sidebar-accent/50 text-muted-foreground hover:text-sidebar-foreground cursor-pointer transition-colors shrink-0">
            <span className="font-bold text-base leading-none mb-2">...</span>
          </div>
        </div>
      </SidebarHeader>

      {isPlatformStaff ? (
        /* ── Owner / Admin sidebar ── */
        <SidebarContent className="px-3 py-4">
          <SidebarGroup>
            <SidebarGroupLabel className="px-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
              Платформа
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-1">
                {ownerItems.map((item) => {
                  const isActive = location.startsWith(item.url);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        data-testid={item.testId}
                        className={cn(
                          "transition-all duration-200 rounded-xl px-3 py-2.5 hover:bg-sidebar-accent/50 text-sidebar-foreground/85 hover:text-sidebar-foreground",
                          isActive && "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary hover:text-primary-foreground font-semibold"
                        )}
                      >
                        <Link href={item.url}>
                          <item.icon className="h-4 w-4 mr-2" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      ) : (
        /* ── Regular user sidebar ── */
        <SidebarContent className="px-3 py-4 space-y-4">
          <SidebarGroup>
            <SidebarGroupLabel className="px-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
              Основное
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-1">
                <SidebarMenuItem>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === "/"} 
                    data-testid="nav-dashboard"
                    className={cn(
                      "transition-all duration-200 rounded-xl px-3 py-2.5 text-sidebar-foreground/85 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                      location === "/" && "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary hover:text-primary-foreground font-semibold"
                    )}
                  >
                    <Link href="/">
                      <LayoutDashboard className="h-4 w-4 mr-2" />
                      <span>Панель управления</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === "/conversations"} 
                    data-testid="nav-conversations"
                    className={cn(
                      "transition-all duration-200 rounded-xl px-3 py-2.5 text-sidebar-foreground/85 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                      location === "/conversations" && "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary hover:text-primary-foreground font-semibold"
                    )}
                  >
                    <Link href="/conversations">
                      <MessageSquare className="h-4 w-4 mr-2" />
                      <span>Разговоры</span>
                      {unreadCount > 0 && (
                        <Badge className="ml-auto rounded-full bg-primary/10 text-primary border border-primary/10 hover:bg-primary/10 font-bold px-2.5 py-0.5 text-[10px]">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === "/escalations"} 
                    data-testid="nav-escalations"
                    className={cn(
                      "transition-all duration-200 rounded-xl px-3 py-2.5 text-sidebar-foreground/85 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                      location === "/escalations" && "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary hover:text-primary-foreground font-semibold"
                    )}
                  >
                    <Link href="/escalations">
                      <AlertTriangle className="h-4 w-4 mr-2" />
                      <span>Эскалации</span>
                      {pendingEscalationsCount > 0 && (
                        <Badge className="ml-auto rounded-full bg-warning/15 text-warning border border-warning/25 hover:bg-warning/15 font-bold px-2.5 py-0.5 text-[10px]">
                          {pendingEscalationsCount}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === "/crm"} 
                    data-testid="nav-failed-leads"
                    className={cn(
                      "transition-all duration-200 rounded-xl px-3 py-2.5 text-sidebar-foreground/85 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                      location === "/crm" && "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary hover:text-primary-foreground font-semibold"
                    )}
                  >
                    <Link href="/crm">
                      <Users className="h-4 w-4 mr-2" />
                      <span>Заявки (CRM)</span>
                      {newLeadsCount > 0 && (
                        <Badge className="ml-auto rounded-full bg-blue-500/15 text-blue-600 border border-blue-500/25 hover:bg-blue-500/15 font-bold px-2.5 py-0.5 text-[10px]">
                          {newLeadsCount}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel className="px-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
              Управление
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-1">
                {managementItems.map((item) => {
                  const isActive = location === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        data-testid={`nav-${item.url.replace("/", "")}`}
                        className={cn(
                          "transition-all duration-200 rounded-xl px-3 py-2.5 text-sidebar-foreground/85 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                          isActive && "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary hover:text-primary-foreground font-semibold"
                        )}
                      >
                        <Link href={item.url}>
                          <item.icon className="h-4 w-4 mr-2" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      )}

      <SidebarFooter className="p-4 border-t border-sidebar-border/50">
        {isPlatformStaff ? (
          <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/30 border border-sidebar-border/30 p-3.5 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
            </span>
            <span className="text-xs font-semibold text-sidebar-foreground/80">Платформа активна</span>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/30 border border-sidebar-border/30 p-3.5 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
            </span>
            <span className="text-xs font-semibold text-sidebar-foreground/80">AI-агент активен</span>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
