/**
 * Returns the public base URL of this deployment.
 *
 * Priority:
 * 1. APP_URL env var (explicit, recommended for all environments)
 * 2. RAILWAY_PUBLIC_DOMAIN (auto-injected by Railway, e.g. "myapp.up.railway.app")
 *
 * Throws if neither is set — an empty/localhost URL would cause webhook registration
 * to send GREEN-API a relative path, which resolves to 127.0.0.1 and fails with ECONNREFUSED.
 */
export function getAppUrl(): string {
  const explicit = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim().replace(/\/$/, "");
  if (railwayDomain) {
    return railwayDomain.startsWith("http") ? railwayDomain : `https://${railwayDomain}`;
  }

  throw new Error(
    "APP_URL is not configured. Set APP_URL environment variable to the public HTTPS URL of this deployment " +
    "(e.g. https://myapp.up.railway.app). Without it, webhook URLs will be invalid."
  );
}
