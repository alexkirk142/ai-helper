import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  MessageSquare,
  Book,
  Package,
  Settings,
  AlertTriangle,
  Bot,
  BarChart3,
  Building2,
} from "lucide-react";
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

interface Conversation {
  id: string;
  status: string;
}

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
    title: "Настройки",
    url: "/settings",
    icon: Settings,
  },
];


export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const isPlatformStaff = user?.isPlatformAdmin || user?.isPlatformOwner;
  
  const { data: conversations } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    refetchInterval: 30000,
  });
  
  const { data: escalations } = useQuery<Escalation[]>({
    queryKey: ["/api/escalations", "pending"],
    refetchInterval: 30000,
  });
  
  const activeConversationsCount = conversations?.filter(c => c.status === "active").length || 0;
  const pendingEscalationsCount = escalations?.filter(e => e.status === "pending").length || 0;

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <Bot className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">AI Sales Operator</span>
            <span className="text-xs text-muted-foreground">Умная автоматизация</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Основное</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location === "/"}
                  data-testid="nav-dashboard"
                >
                  <Link href="/">
                    <LayoutDashboard className="h-4 w-4" />
                    <span>Панель управления</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location === "/conversations"}
                  data-testid="nav-conversations"
                >
                  <Link href="/conversations">
                    <MessageSquare className="h-4 w-4" />
                    <span>Разговоры</span>
                    {activeConversationsCount > 0 && (
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {activeConversationsCount}
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
                >
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
        {isPlatformStaff && (
          <SidebarGroup>
            <SidebarGroupLabel>Платформа</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/admin/tenants"}
                    data-testid="nav-admin-tenants"
                  >
                    <Link href="/admin/tenants">
                      <Building2 className="h-4 w-4" />
                      <span>Тенанты</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="flex items-center gap-2 rounded-md bg-muted p-3">
          <div className="h-2 w-2 rounded-full bg-status-online" />
          <span className="text-xs text-muted-foreground">AI-агент активен</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
