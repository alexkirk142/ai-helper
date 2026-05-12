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

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
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
    <div className="flex gap-0.5 border-b px-2 pt-1 shrink-0">
      {visibleFilters.map((filter) => {
        const isActive = activeFilter === filter;
        const unread = filter === "all" ? badge.all : (badge[filter] ?? 0);
        return (
          <button
            key={filter}
            onClick={() => onFilterChange(filter)}
            className={cn(
              "flex items-center gap-0.5 rounded-t px-2.5 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground",
              filter === "marquiz" && !isActive && "text-orange-500/70 hover:text-orange-500",
              filter === "marquiz" && isActive && "border-orange-500 text-orange-500",
            )}
          >
            {CHANNEL_LABELS[filter]}
            <UnreadBadge count={unread} />
          </button>
        );
      })}
    </div>
  );
}
