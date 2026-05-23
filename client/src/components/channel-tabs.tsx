import { cn } from "@/lib/utils";

export type ChannelFilter = "all" | "telegram" | "max" | "whatsapp" | "marquiz";

const CHANNEL_LABELS: Record<ChannelFilter, string> = {
  all: "Все",
  telegram: "Telegram",
  max: "MAX",
  whatsapp: "WhatsApp",
  marquiz: "Заявки",
};

const ALL_FILTERS: ChannelFilter[] = ["all", "telegram", "max", "whatsapp", "marquiz"];

interface ChannelCounts {
  all: number;
  telegram?: number;
  max?: number;
  whatsapp?: number;
  marquiz?: number;
}

interface ChannelTabsProps {
  activeFilter: ChannelFilter;
  onFilterChange: (filter: ChannelFilter) => void;
  /** Which tabs to show — key presence means the tab is visible (value ignored for visibility). */
  counts: ChannelCounts;
  /** Unread counts shown as badges. Falls back to counts when omitted. */
  unreadCounts?: ChannelCounts;
}

function UnreadBadge({ count, isActive }: { count: number; isActive: boolean }) {
  if (count <= 0) return null;
  return (
    <span className={cn(
      "ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1.5 text-[9px] font-bold leading-none shadow-sm transition-all",
      isActive
        ? "bg-primary text-primary-foreground"
        : "bg-destructive/15 text-destructive border border-destructive/25"
    )}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function ChannelTabs({ activeFilter, onFilterChange, counts, unreadCounts }: ChannelTabsProps) {
  const badge = unreadCounts ?? counts;

  // Show a tab when the key exists in counts, regardless of value.
  const visibleFilters: ChannelFilter[] = ALL_FILTERS.filter((f) => {
    if (f === "all") return true;
    return counts[f] !== undefined;
  });

  if (visibleFilters.length <= 1) return null;

  return (
    <div className="px-3 pt-3 pb-2 shrink-0">
      <div className="flex p-1 bg-muted/65 border border-border/30 rounded-xl">
        {visibleFilters.map((filter) => {
          const isActive = activeFilter === filter;
          const unread = filter === "all" ? badge.all : (badge[filter] ?? 0);
          return (
            <button
              key={filter}
              onClick={() => onFilterChange(filter)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 px-2.5 text-[11px] font-bold tracking-tight transition-all duration-200",
                isActive
                  ? "bg-card text-foreground shadow-sm border border-border/30"
                  : "text-muted-foreground/90 hover:text-foreground hover:bg-card/40",
                filter === "marquiz" && !isActive && "text-orange-500/80 hover:text-orange-500",
                filter === "marquiz" && isActive && "bg-orange-500/5 text-orange-500 border-orange-500/20",
              )}
            >
              <span>{CHANNEL_LABELS[filter]}</span>
              <UnreadBadge count={unread} isActive={isActive} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
