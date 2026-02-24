# New React Component

## Before creating

1. Read `client/src/components/` for the component pattern
2. Read `client/src/pages/` to understand page structure
3. Search for a similar component — avoid duplication
4. Read `shared/schema.ts` for types of the entity you're working with
5. Check `client/src/components/ui/` for available shadcn/ui primitives

## Steps

1. **Create file**: `client/src/components/[name].tsx` (kebab-case filename)
2. **Import types** from `@shared/schema` (e.g., `import type { Customer } from "@shared/schema"`)
3. **Use shadcn/ui** for base components (Button, Card, Input, Dialog, Select, Badge, etc.)
4. **Style with Tailwind CSS** using the `cn()` utility from `@/lib/utils` for conditional classes
5. **Fetch data** with `useQuery` from `@tanstack/react-query` (key = API path)
6. **Mutate data** with `useMutation` + `apiRequest` from `@/lib/queryClient`
7. **Add to parent** component or page

## Template — data-fetching component

```tsx
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { MyEntity } from "@shared/schema";

interface MyComponentProps {
  entityId: string;
  compact?: boolean;
}

export function MyComponent({ entityId, compact = false }: MyComponentProps) {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<MyEntity>({
    queryKey: ["/api/my-entity", entityId],
    enabled: !!entityId,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<MyEntity>) => {
      return apiRequest("PATCH", `/api/my-entity/${entityId}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-entity", entityId] });
      toast({ title: "Updated successfully" });
    },
    onError: () => {
      toast({ title: "Update failed", variant: "destructive" });
    },
  });

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  if (!data) {
    return <div className="text-muted-foreground">Not found</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{data.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Component content */}
      </CardContent>
    </Card>
  );
}
```

## Template — form component with React Hook Form + Zod

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface MyFormProps {
  onSuccess?: () => void;
}

export function MyForm({ onSuccess }: MyFormProps) {
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "" },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      return apiRequest("POST", "/api/my-entity", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-entity"] });
      form.reset();
      toast({ title: "Created successfully" });
      onSuccess?.();
    },
    onError: () => {
      toast({ title: "Creation failed", variant: "destructive" });
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? "Creating..." : "Create"}
        </Button>
      </form>
    </Form>
  );
}
```

## Available shadcn/ui components (in `client/src/components/ui/`)

`accordion`, `alert-dialog`, `avatar`, `badge`, `button`, `card`, `checkbox`,
`dialog`, `dropdown-menu`, `form`, `input`, `label`, `popover`, `select`,
`skeleton`, `tabs`, `textarea`, `toast`, `tooltip`, `sidebar`, `separator`,
`switch`, `chart`, `scroll-area`, `collapsible`, `sheet`, `table`

## Available hooks

- `useAuth()` — from `@/hooks/use-auth` — user, isAuthenticated, logout
- `useToast()` — from `@/hooks/use-toast` — toast notifications
- `useBillingStatus()` — from `@/hooks/use-billing` — subscription state
- `useIsMobile()` — from `@/hooks/use-mobile` — responsive breakpoint
- `useTheme()` — from `@/lib/theme-provider` — dark/light mode

## Import conventions

```tsx
// Path aliases
import { ... } from "@/components/ui/button";   // client/src/components/ui/
import { ... } from "@/lib/queryClient";          // client/src/lib/
import { ... } from "@/hooks/use-toast";          // client/src/hooks/
import type { ... } from "@shared/schema";        // shared/schema.ts

// Icons
import { Search, Plus, X, Settings } from "lucide-react";
import { SiTelegram, SiWhatsapp } from "react-icons/si";

// Routing
import { useLocation, Link } from "wouter";

// Conditional classNames
import { cn } from "@/lib/utils";
```
