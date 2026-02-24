import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Shield, Loader2, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

interface AuthResponse {
  message?: string;
  error?: string;
}

interface AuthUser {
  id: string;
  isPlatformOwner?: boolean;
}

async function ownerLogin(email: string, password: string): Promise<AuthUser> {
  const loginRes = await apiRequest("POST", "/auth/login", { email, password });
  const loginJson = await loginRes.json();
  if (!loginJson.success) {
    throw new Error(loginJson.error || loginJson.message || "Ошибка входа");
  }

  const meRes = await fetch("/api/auth/user", { credentials: "include" });
  if (!meRes.ok) {
    throw new Error("Не удалось получить данные пользователя");
  }

  return meRes.json();
}

async function logout(): Promise<void> {
  await apiRequest("POST", "/auth/logout");
}

export default function OwnerLoginPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const { toast } = useToast();

  const loginMutation = useMutation({
    mutationFn: () => ownerLogin(email, password),
    onSuccess: async (user) => {
      if (user.isPlatformOwner) {
        queryClient.setQueryData(["/api/auth/user"], user);
        navigate("/owner");
      } else {
        await logout();
        queryClient.setQueryData(["/api/auth/user"], null);
        setAccessDenied(true);
      }
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Ошибка входа",
        description: error.message,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAccessDenied(false);
    loginMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold" data-testid="text-owner-brand">Owner Console</span>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle data-testid="text-owner-login-title">Вход владельца</CardTitle>
            <CardDescription data-testid="text-owner-login-description">
              Только для владельца платформы
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {accessDenied && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm text-center" data-testid="text-access-denied">
                Доступ запрещён
              </div>
            )}
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="owner-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="owner-email"
                    type="email"
                    placeholder="owner@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                    data-testid="input-owner-email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="owner-password">Пароль</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="owner-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10"
                    required
                    data-testid="input-owner-password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowPassword(!showPassword)}
                    data-testid="button-toggle-owner-password"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button 
                type="submit" 
                className="w-full" 
                disabled={loginMutation.isPending}
                data-testid="button-submit-owner-login"
              >
                {loginMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Войти
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
