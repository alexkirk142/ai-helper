import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricsCardProps {
  title: string;
  value: string | number;
  description?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function MetricsCard({
  title,
  value,
  description,
  trend,
  trendValue,
  icon,
  className,
}: MetricsCardProps) {
  return (
    <Card className={cn("hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20 transition-all duration-300 rounded-2xl border border-card-border bg-card", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground tracking-tight">
          {title}
        </CardTitle>
        {icon && (
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/5 text-primary border border-primary/10">
            {icon}
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-3xl font-extrabold tracking-tight">{value}</div>
        {(description || trendValue) && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            {trend && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-bold",
                  trend === "up" && "bg-success/10 text-success border border-success/10",
                  trend === "down" && "bg-destructive/10 text-destructive border border-destructive/10",
                  trend === "neutral" && "bg-muted text-muted-foreground"
                )}
              >
                {trend === "up" && <TrendingUp className="h-3 w-3" />}
                {trend === "down" && <TrendingDown className="h-3 w-3" />}
                {trend === "neutral" && <Minus className="h-3 w-3" />}
                {trendValue && <span className="text-[10px]">{trendValue}</span>}
              </span>
            )}
            {description && <span className="text-muted-foreground/90">{description}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
