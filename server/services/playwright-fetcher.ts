const PLAYWRIGHT_SERVICE_PORT =
  process.env.PODZAMENU_SERVICE_PORT ??
  process.env.PORT ??
  "8200";

const PLAYWRIGHT_SERVICE_URL = `http://localhost:${PLAYWRIGHT_SERVICE_PORT}`;

export async function fetchPageViaPlaywright(
  url: string,
  timeoutMs = 10000
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs + 2000);

    const res = await fetch(`${PLAYWRIGHT_SERVICE_URL}/fetch-page`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, timeout: timeoutMs }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.warn(
        `[PlaywrightFetcher] Service returned ${res.status} for ${url}`
      );
      return await fetchPageFallback(url);
    }

    const data = (await res.json()) as { html: string };
    return data.html;
  } catch (err) {
    console.warn(
      `[PlaywrightFetcher] Service unavailable, using fetch fallback for ${url}:`,
      err
    );
    return await fetchPageFallback(url);
  }
}

async function fetchPageFallback(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
