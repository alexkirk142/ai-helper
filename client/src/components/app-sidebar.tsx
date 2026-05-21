import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  MessageSquare,
  Book,
  Package,
  Settings,
  AlertTriangle,
  BarChart3,
  XCircle,
  Puzzle,
  Activity,
  KeyRound,
  CreditCard,
  Users,
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

  const { data: failedLeads } = useQuery<{ id: string }[]>({
    queryKey: ["/api/failed-leads"],
    queryFn: async () => {
      const res = await fetch("/api/failed-leads", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60000,
    enabled: !isPlatformStaff,
  });

  const unreadCount = channelCounts?.all || 0;
  const pendingEscalationsCount = escalations?.filter(e => e.status === "pending").length || 0;
  const failedLeadsCount = failedLeads?.length || 0;

  const headerHref = isPlatformStaff ? "/owner" : "/";

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href={headerHref} className="flex items-center gap-2">
          <BrandLogoIcon size={32} />
          <div className="flex flex-col">
            <span className="text-sm font-semibold">{BRAND_NAME}</span>
            <span className="text-xs text-muted-foreground">
              {isPlatformStaff ? "Owner Console" : BRAND_TAGLINE}
            </span>
          </div>
        </Link>
      </SidebarHeader>

      {isPlatformStaff ? (
        /* ── Owner / Admin sidebar ── */
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Платформа</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {ownerItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.startsWith(item.url)}
                      data-testid={item.testId}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      ) : (
        /* ── Regular user sidebar ── */
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Основное</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/"} data-testid="nav-dashboard">
                    <Link href="/">
                      <LayoutDashboard className="h-4 w-4" />
                      <span>Панель управления</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/conversations"} data-testid="nav-conversations">
                    <Link href="/conversations">
                      <MessageSquare className="h-4 w-4" />
                      <span>Разговоры</span>
                      {unreadCount > 0 && (
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/escalations"} data-testid="nav-escalations">
                    <Link href="/escalations">
                      <AlertTriangle className="h-4 w-4" />
                      <span>Эскалации</span>
                      {pendingEscalationsCount > 0 && (
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {pendingEscalationsCount}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/failed-leads"} data-testid="nav-failed-leads">
                    <Link href="/failed-leads">
                      <XCircle className="h-4 w-4" />
                      <span>Неудачные заявки</span>
                      {failedLeadsCount > 0 && (
                        <Badge variant="destructive" className="ml-auto text-xs">
                          {failedLeadsCount}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Управление</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {managementItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                      data-testid={`nav-${item.url.replace("/", "")}`}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      )}

      <SidebarFooter className="p-4">
        {isPlatformStaff ? (
          <div className="flex items-center gap-2 rounded-md bg-muted p-3">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs text-muted-foreground">Платформа активна</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md bg-muted p-3">
            <div className="h-2 w-2 rounded-full bg-status-online" />
            <span className="text-xs text-muted-foreground">AI-агент активен</span>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
