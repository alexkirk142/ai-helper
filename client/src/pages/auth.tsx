import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Bot, Loader2, Mail, Lock, Eye, EyeOff, ArrowLeft, CheckCircle2 } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { apiRequest } from "@/lib/queryClient";

interface AuthResponse {
  message?: string;
  error?: string;
  requiresVerification?: boolean;
}

async function authRequest(endpoint: string, data: Record<string, string>): Promise<AuthResponse> {
  const res = await apiRequest("POST", `/auth${endpoint}`, data);
  return res.json();
}

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          <a href="/" className="flex items-center gap-2" data-testid="link-home">
            <Bot className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold" data-testid="text-brand">AI Sales Operator</span>
          </a>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-4">
        {children}
      </main>
    </div>
  );
}

export function LoginPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const returnTo = params.get("return") || "/";
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  const loginMutation = useMutation({
    mutationFn: () => authRequest("/login", { email, password }),
    onSuccess: () => {
      window.location.href = returnTo;
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
    loginMutation.mutate();
  };

  return (
    <AuthLayout>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle data-testid="text-login-title">Вход в систему</CardTitle>
          <CardDescription data-testid="text-login-description">
            Войдите в свой аккаунт
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" className="w-full" asChild data-testid="button-go-to-signup">
            <a href="/signup">
              Нет аккаунта? Зарегистрируйтесь
            </a>
          </Button>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">или войдите</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                  data-testid="input-email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Пароль</Label>
                <a 
                  href="/forgot-password" 
                  className="text-sm text-primary"
                  data-testid="link-forgot-password"
                >
                  Забыли пароль?
                </a>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                  required
                  data-testid="input-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full" 
              disabled={loginMutation.isPending}
              data-testid="button-submit-login"
            >
              {loginMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Войти
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Нет аккаунта?{" "}
            <a href="/signup" className="text-primary" data-testid="link-signup">
              Зарегистрироваться
            </a>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export function SignupPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const inviteToken = params.get("invite") || "";
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);
  const { toast } = useToast();

  const signupMutation = useMutation({
    mutationFn: () => authRequest("/signup", { 
      email,
      password,
      ...(inviteToken ? { inviteToken } : {})
    }),
    onSuccess: (data) => {
      if (data.requiresVerification) {
        setSuccess(true);
      } else {
        window.location.href = "/";
      }
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Ошибка регистрации",
        description: error.message,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Пароли не совпадают",
      });
      return;
    }

    if (password.length < 8) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Пароль должен быть не менее 8 символов",
      });
      return;
    }

    signupMutation.mutate();
  };

  if (success) {
    return (
      <AuthLayout>
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <CardTitle data-testid="text-signup-success-title">Проверьте почту</CardTitle>
            <CardDescription data-testid="text-signup-success-description">
              Мы отправили письмо на <strong>{email}</strong> со ссылкой для подтверждения
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-sm text-muted-foreground" data-testid="text-signup-success-hint">
              Не получили письмо? Проверьте папку "Спам" или{" "}
              <button 
                onClick={() => setSuccess(false)} 
                className="text-primary"
                data-testid="button-resend"
              >
                попробуйте снова
              </button>
            </p>
            <Button variant="outline" className="w-full" asChild data-testid="button-signup-back-to-login">
              <a href="/login">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Вернуться к входу
              </a>
            </Button>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle data-testid="text-signup-title">Создать аккаунт</CardTitle>
          <CardDescription data-testid="text-signup-description">
            {inviteToken 
              ? "Вас пригласили присоединиться к команде"
              : "Зарегистрируйтесь для начала работы"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="signup-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                  data-testid="input-signup-email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-password">Пароль</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Минимум 8 символов"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                  required
                  minLength={8}
                  data-testid="input-signup-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-signup-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Заглавная буква, строчная буква, цифра
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Подтвердите пароль</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Повторите пароль"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10"
                  required
                  data-testid="input-confirm-password"
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full" 
              disabled={signupMutation.isPending}
              data-testid="button-submit-signup"
            >
              {signupMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Создать аккаунт
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Уже есть аккаунт?{" "}
            <a href="/login" className="text-primary" data-testid="link-login">
              Войти
            </a>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token") || "";
  
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [hasTriggered, setHasTriggered] = useState(false);

  const verifyMutation = useMutation({
    mutationFn: () => authRequest("/verify-email", { token }),
    onSuccess: () => {
      setStatus("success");
      setMessage("Email успешно подтверждён");
    },
    onError: (error: Error) => {
      setStatus("error");
      setMessage(error.message);
    },
  });

  useEffect(() => {
    if (token && !hasTriggered) {
      setHasTriggered(true);
      verifyMutation.mutate();
    }
  }, [token, hasTriggered]);

  if (!token) {
    return (
      <AuthLayout>
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle data-testid="text-verify-error-title">Ошибка</CardTitle>
            <CardDescription data-testid="text-verify-error-description">
              Ссылка недействительна или повреждена
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" asChild data-testid="button-verify-back-to-login">
              <a href="/login">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Вернуться к входу
              </a>
            </Button>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {verifyMutation.isPending ? (
            <>
              <div className="mx-auto mb-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
              </div>
              <CardTitle data-testid="text-verify-loading-title">Проверка...</CardTitle>
              <CardDescription data-testid="text-verify-loading-description">Подтверждаем ваш email</CardDescription>
            </>
          ) : status === "success" ? (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle data-testid="text-verify-success-title">Готово!</CardTitle>
              <CardDescription data-testid="text-verify-success-description">{message}</CardDescription>
            </>
          ) : (
            <>
              <CardTitle data-testid="text-verify-fail-title">Ошибка</CardTitle>
              <CardDescription data-testid="text-verify-fail-description">{message}</CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent>
          <Button className="w-full" asChild data-testid="button-goto-login">
            <a href="/login">
              {status === "success" ? "Войти в систему" : "Вернуться к входу"}
            </a>
          </Button>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const forgotMutation = useMutation({
    mutationFn: () => authRequest("/forgot-password", { email }),
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: () => {
      setSubmitted(true);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    forgotMutation.mutate();
  };

  if (submitted) {
    return (
      <AuthLayout>
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <CardTitle data-testid="text-forgot-success-title">Проверьте почту</CardTitle>
            <CardDescription data-testid="text-forgot-success-description">
              Если аккаунт с таким email существует, мы отправили инструкции по восстановлению пароля
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" asChild data-testid="button-forgot-back-to-login">
              <a href="/login">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Вернуться к входу
              </a>
            </Button>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle data-testid="text-forgot-title">Восстановление пароля</CardTitle>
          <CardDescription data-testid="text-forgot-description">
            Введите email, и мы отправим ссылку для сброса пароля
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                  data-testid="input-forgot-email"
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full" 
              disabled={forgotMutation.isPending}
              data-testid="button-submit-forgot"
            >
              {forgotMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Отправить ссылку
            </Button>
          </form>

          <Button variant="outline" className="w-full" asChild data-testid="button-forgot-form-back-to-login">
            <a href="/login">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Вернуться к входу
            </a>
          </Button>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token") || "";
  
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);
  const { toast } = useToast();

  const resetMutation = useMutation({
    mutationFn: () => authRequest("/reset-password", { token, password }),
    onSuccess: () => {
      setSuccess(true);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: error.message,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Пароли не совпадают",
      });
      return;
    }

    if (password.length < 8) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Пароль должен быть не менее 8 символов",
      });
      return;
    }

    resetMutation.mutate();
  };

  if (!token) {
    return (
      <AuthLayout>
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle data-testid="text-reset-error-title">Ошибка</CardTitle>
            <CardDescription data-testid="text-reset-error-description">
              Ссылка недействительна или повреждена
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" asChild data-testid="button-reset-request-new">
              <a href="/forgot-password">Запросить новую ссылку</a>
            </Button>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout>
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle data-testid="text-reset-success-title">Пароль изменён</CardTitle>
            <CardDescription data-testid="text-reset-success-description">
              Теперь вы можете войти с новым паролем
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" asChild data-testid="button-goto-login-after-reset">
              <a href="/login">Войти в систему</a>
            </Button>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle data-testid="text-reset-title">Новый пароль</CardTitle>
          <CardDescription data-testid="text-reset-description">
            Введите новый пароль для вашего аккаунта
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">Новый пароль</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Минимум 8 символов"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                  required
                  minLength={8}
                  data-testid="input-new-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-new-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Заглавная буква, строчная буква, цифра
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-new-password">Подтвердите пароль</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirm-new-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Повторите пароль"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10"
                  required
                  data-testid="input-confirm-new-password"
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full" 
              disabled={resetMutation.isPending}
              data-testid="button-submit-reset"
            >
              {resetMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Сохранить пароль
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
