import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface ResponseTemplate {
  id: string;
  tenantId: string;
  name: string;
  content: string;
  category: string | null;
  isActive: boolean;
  usageCount: number;
  createdAt: string;
}

export function useResponseTemplates() {
  return useQuery<ResponseTemplate[]>({
    queryKey: ["/api/response-templates"],
    staleTime: 60_000,
  });
}

export function useCreateResponseTemplate() {
  return useMutation({
    mutationFn: async (data: { name: string; content: string }) => {
      const res = await apiRequest("POST", "/api/response-templates", data);
      return res.json() as Promise<ResponseTemplate>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/response-templates"] });
    },
  });
}

export function useDeleteResponseTemplate() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/response-templates/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/response-templates"] });
    },
  });
}
