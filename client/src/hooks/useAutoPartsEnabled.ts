import { useQuery } from "@tanstack/react-query";

interface FlagCheckResponse {
  name: string;
  enabled: boolean;
}

export function useAutoPartsEnabled(): boolean {
  const { data } = useQuery<FlagCheckResponse>({
    queryKey: ["/api/feature-flags/AUTO_PARTS_ENABLED/check"],
    // No staleTime: always re-fetch on mount so flag changes made by the
    // platform admin are reflected immediately on next navigation.
    // The endpoint is sub-20 ms so there is no performance concern.
    staleTime: 0,
  });

  return data?.enabled ?? false;
}
