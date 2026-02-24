import { cn } from "@/lib/utils";

export type ChannelFilter = "all" | "telegram" | "max" | "whatsapp";

const CHANNEL_LABELS: Record<ChannelFilter, string> = {
  all: "Все",
  telegram: "Telegram",
  max: "MAX",
  whatsapp: "WhatsApp",
};

const ALL_FILTERS: ChannelFilter[] = ["all", "telegram", "max", "whatsapp"];

interface ChannelTabsProps {
  activeFilter: ChannelFilter;
  onFilterChange: (filter: ChannelFilter) => void;
  counts: {
    all: number;
    telegram?: number;
    max?: number;
    whatsapp?: number;
  };
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function ChannelTabs({ activeFilter, onFilterChange, counts }: ChannelTabsProps) {
  const visibleFilters: ChannelFilter[] = ALL_FILTERS.filter((f) => {
    if (f === "all") return true;
    return counts[f] !== undefined;
  });

  if (visibleFilters.length <= 1) return null;

  return (
    <div className="flex gap-0.5 border-b px-2 pt-1 shrink-0">
      {visibleFilters.map((filter) => {
        const isActive = activeFilter === filter;
        const count = filter === "all" ? counts.all : (counts[filter] ?? 0);
        return (
          <button
            key={filter}
            onClick={() => onFilterChange(filter)}
            className={cn(
              "flex items-center gap-0.5 rounded-t px-2.5 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {CHANNEL_LABELS[filter]}
            <UnreadBadge count={count} />
          </button>
        );
      })}
    </div>
  );
}
