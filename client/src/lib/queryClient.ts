import { QueryClient, QueryFunction } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// CSRF token management
// ---------------------------------------------------------------------------

/**
 * In-memory cache for the CSRF token.  Fetched lazily on the first mutating
 * request and reused for the lifetime of the page / session.
 *
 * The server stores a matching signed value in an httpOnly cookie.  We send
 * the raw token as the `X-Csrf-Token` header; the server compares the two.
 */
let csrfToken: string | null = null;

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch("/api/csrf-token", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch CSRF token");
  const data = (await res.json()) as { token: string };
  csrfToken = data.token;
  return data.token;
}

/** Forces a fresh token to be fetched on the next mutating request. */
export function invalidateCsrfToken(): void {
  csrfToken = null;
}

async function getCsrfToken(): Promise<string> {
  return csrfToken ?? fetchCsrfToken();
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function doRequest(
  method: string,
  url: string,
  data?: unknown,
  csrfHeaderValue?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data && !(data instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (csrfHeaderValue) {
    headers["X-Csrf-Token"] = csrfHeaderValue;
  }
  return fetch(url, {
    method,
    headers,
    body: data instanceof FormData ? data : data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown,
): Promise<Response> {
  const isMutating = !SAFE_METHODS.has(method.toUpperCase());

  let token: string | undefined;
  if (isMutating) {
    try {
      token = await getCsrfToken();
    } catch {
      // If the token cannot be fetched, send without it; the server will
      // return 403 which surfaces as an error to the caller.
    }
  }

  const res = await doRequest(method, url, data, token);

  // Stale CSRF token: clear the cache, fetch a fresh token, and retry once.
  if (!res.ok && res.status === 403 && isMutating) {
    try {
      const body = (await res.clone().json()) as { code?: string };
      if (body.code === "INVALID_CSRF_TOKEN") {
        invalidateCsrfToken();
        const freshToken = await fetchCsrfToken();
        const retryRes = await doRequest(method, url, data, freshToken);
        await throwIfResNotOk(retryRes);
        return retryRes;
      }
    } catch {
      // Body may not be JSON or retry itself failed — fall through to original error.
    }
  }

  await throwIfResNotOk(res);
  return res;
}

// ---------------------------------------------------------------------------
// TanStack Query setup
// ---------------------------------------------------------------------------

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
