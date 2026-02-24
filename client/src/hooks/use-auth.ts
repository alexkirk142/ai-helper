import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";

interface AuthUser {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  tenantId?: string;
  authProvider?: string;
  isPlatformAdmin?: boolean;
  isPlatformOwner?: boolean;
  profileImageUrl?: string;
}

async function fetchUser(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function logout(): Promise<void> {
  await apiRequest("POST", "/auth/logout");
}

export function useAuth() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // Synchronously mark user as null so isAuthenticated flips to false
      // immediately, without triggering a background refetch (avoids the
      // re-authentication race where the query re-fires before the session
      // cookie is cleared on the server).
      queryClient.setQueryData(["/api/auth/user"], null);
      // Purge all other cached data so stale authenticated responses cannot
      // leak to the next session.
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== "/api/auth/user",
      });
      navigate("/login");
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}
