/**
 * LRU deduplication cache for message IDs.
 * Replaces the Set<string> + clear() pattern in channel adapters.
 */
export class DedupCache {
  private ids = new Map<string, number>(); // id → timestamp
  private readonly max: number;

  constructor(max = 10_000) {
    this.max = max;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): void {
    if (this.ids.size >= this.max) {
      // Evict oldest entry instead of clearing all
      const oldest = this.ids.keys().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    this.ids.set(id, Date.now());
  }

  get size(): number {
    return this.ids.size;
  }

  clear(): void {
    this.ids.clear();
  }
}
