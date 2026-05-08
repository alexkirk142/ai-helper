/**
 * Lightweight metrics facade.
 *
 * When `METRICS_ENABLED=true`, counter and timing events are logged to the
 * console in a structured line format. Otherwise this module is effectively
 * no-op — no external dependencies required.
 *
 * Example wiring (StatsD):
 *   import StatsD from "hot-shots";
 *   const statsd = new StatsD({ host: process.env.STATSD_HOST });
 *   // then in incr(): statsd.increment(name, 1, 1, flattenTags(tags));
 *
 * Tag cardinality rules (enforced by convention, not code):
 *   - Use only low-cardinality, enum-like values (type, kind, bucket, result).
 *   - Never pass raw VINs, full model names, or user-supplied strings as tags.
 */

export type MetricTags = Record<string, string | number | boolean | null | undefined>;

/**
 * Increment a counter metric by 1.
 * @param name   Dot-namespaced metric name, e.g. "detector.candidates_total"
 * @param tags   Optional low-cardinality key/value dimensions
 */
export function incr(name: string, tags?: MetricTags): void {
  if (process.env.METRICS_ENABLED !== "true") return;
  const tagStr = tags
    ? " " + Object.entries(tags)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")
    : "";
  console.log(`[METRIC] incr ${name}${tagStr}`);
}

/**
 * Record a timing / duration metric in milliseconds.
 * @param name   Dot-namespaced metric name, e.g. "identity_cache.lookup_ms"
 * @param ms     Duration in milliseconds
 * @param tags   Optional low-cardinality key/value dimensions
 */
export function timing(name: string, ms: number, tags?: MetricTags): void {
  if (process.env.METRICS_ENABLED !== "true") return;
  const tagStr = tags
    ? " " + Object.entries(tags)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")
    : "";
  console.log(`[METRIC] timing ${name} ${ms}ms${tagStr}`);
}
