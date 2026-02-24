import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface BillingStatus {
  hasSubscription: boolean;
  status: string | null;
  plan: { id: string; name: string; price: number } | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canAccess: boolean;
  // Trial-specific fields
  isTrial: boolean;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  hadTrial: boolean;
}

export function useBillingStatus() {
  return useQuery<BillingStatus>({
    queryKey: ["/api/billing/me"],
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

export function useCreateCheckout() {
  return useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/billing/checkout");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/me"] });
    },
  });
}

export function useCancelSubscription() {
  return useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/billing/cancel");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/me"] });
    },
  });
}

export function isSubscriptionRequired(error: any): boolean {
  return error?.code === "SUBSCRIPTION_REQUIRED" || 
         error?.error === "SUBSCRIPTION_REQUIRED" ||
         (error?.message && error.message.includes("SUBSCRIPTION_REQUIRED"));
}
