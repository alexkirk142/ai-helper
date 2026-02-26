/**
 * Lightweight metrics facade.
 *
 * Default implementation is a no-op so the application ships with zero
 * external dependencies.  To wire a real backend, replace the bodies of
 * `incr` and `timing` — the call-sites throughout the codebase stay
 * unchanged.
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function incr(name: string, tags?: MetricTags): void {
  // no-op — wire real backend here
}

/**
 * Record a timing / duration metric in milliseconds.
 * @param name   Dot-namespaced metric name, e.g. "identity_cache.lookup_ms"
 * @param ms     Duration in milliseconds
 * @param tags   Optional low-cardinality key/value dimensions
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function timing(name: string, ms: number, tags?: MetricTags): void {
  // no-op — wire real backend here
}
