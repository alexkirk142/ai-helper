import { useState, ComponentType } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { X, Plus, User, ExternalLink, MessageSquare, Phone, Mail, Tag, LucideProps } from "lucide-react";
import { SiTelegram, SiWhatsapp } from "react-icons/si";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Customer } from "@shared/schema";

interface CustomerCardProps {
  customerId: string | null | undefined;
  compact?: boolean;
}

type IconComponent = ComponentType<{ className?: string }>;

const channelIcons: Record<string, { icon: IconComponent; label: string; color: string }> = {
  telegram: { icon: SiTelegram, label: "Telegram", color: "text-blue-500" },
  whatsapp: { icon: SiWhatsapp, label: "WhatsApp", color: "text-green-500" },
  whatsapp_personal: { icon: SiWhatsapp, label: "WhatsApp Personal", color: "text-green-600" },
  max: { icon: MessageSquare as IconComponent, label: "MAX", color: "text-purple-500" },
};

export function CustomerCard({ customerId, compact = false }: CustomerCardProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [newTag, setNewTag] = useState("");

  const { data: customer, isLoading } = useQuery<Customer>({
    queryKey: ["/api/customers", customerId],
    enabled: !!customerId,
  });

  const updateMutation = useMutation({
    mutationFn: async (tags: string[]) => {
      return apiRequest("PATCH", `/api/customers/${customerId}`, { tags });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId] });
      toast({ title: "Теги обновлены" });
    },
    onError: () => {
      toast({ title: "Ошибка обновления тегов", variant: "destructive" });
    },
  });

  const getTags = (c: Customer): string[] => {
    if (Array.isArray(c.tags)) return c.tags;
    return [];
  };

  const handleAddTag = () => {
    if (!newTag.trim() || !customer) return;
    const currentTags = getTags(customer);
    if (!currentTags.includes(newTag.trim())) {
      updateMutation.mutate([...currentTags, newTag.trim()]);
    }
    setNewTag("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (!customer) return;
    const currentTags = getTags(customer);
    updateMutation.mutate(currentTags.filter((t: string) => t !== tagToRemove));
  };

  if (!customerId) {
    return null;
  }

  if (isLoading) {
    return (
      <Card className="w-64 shrink-0" data-testid="customer-card-skeleton">
        <CardHeader className="pb-2">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="mt-2 h-4 w-24" />
          <Skeleton className="mt-1 h-3 w-16" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (!customer) {
    return (
      <Card className="w-64 shrink-0">
        <CardContent className="flex h-32 items-center justify-center text-muted-foreground">
          <User className="mr-2 h-4 w-4" />
          Клиент не найден
        </CardContent>
      </Card>
    );
  }

  const ChannelIcon = customer.channel && channelIcons[customer.channel]
    ? channelIcons[customer.channel].icon
    : MessageSquare;
  const channelColor = customer.channel && channelIcons[customer.channel]
    ? channelIcons[customer.channel].color
    : "text-muted-foreground";
  const channelLabel = customer.channel && channelIcons[customer.channel]
    ? channelIcons[customer.channel].label
    : customer.channel || "Неизвестно";

  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-3" data-testid="customer-card-compact">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="text-xs">
            {customer.name?.slice(0, 2).toUpperCase() || "КЛ"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate" data-testid="text-customer-name">
              {customer.name || "Неизвестный клиент"}
            </span>
            <ChannelIcon className={`h-4 w-4 shrink-0 ${channelColor}`} />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {customer.phone && <span>{customer.phone}</span>}
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => navigate(`/customers/${customerId}`)}
          data-testid="button-open-customer-profile"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Card className="w-64 shrink-0" data-testid="customer-card">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <Avatar className="h-12 w-12">
            <AvatarFallback>
              {customer.name?.slice(0, 2).toUpperCase() || "КЛ"}
            </AvatarFallback>
          </Avatar>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/customers/${customerId}`)}
            data-testid="button-open-customer-profile"
          >
            <ExternalLink className="mr-1 h-3 w-3" />
            Профиль
          </Button>
        </div>
        <CardTitle className="mt-2 text-base" data-testid="text-customer-name">
          {customer.name || "Неизвестный клиент"}
        </CardTitle>
        <div className="flex items-center gap-1.5">
          <ChannelIcon className={`h-4 w-4 ${channelColor}`} />
          <span className="text-xs text-muted-foreground">{channelLabel}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {customer.phone && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Phone className="h-3.5 w-3.5" />
            <span>{customer.phone}</span>
          </div>
        )}
        {customer.email && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            <span className="truncate">{customer.email}</span>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Tag className="h-3 w-3" />
            Теги
          </div>
          <div className="flex flex-wrap gap-1">
            {getTags(customer).map((tag: string) => (
              <Badge
                key={tag}
                variant="secondary"
                className="gap-1 text-xs"
                data-testid={`tag-${tag}`}
              >
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20"
                  data-testid={`button-remove-tag-${tag}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
            {getTags(customer).length === 0 && (
              <span className="text-xs text-muted-foreground">Нет тегов</span>
            )}
          </div>
          <div className="flex gap-1">
            <Input
              placeholder="Новый тег..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              className="text-xs"
              data-testid="input-new-tag"
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={handleAddTag}
              disabled={!newTag.trim()}
              data-testid="button-add-tag"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
