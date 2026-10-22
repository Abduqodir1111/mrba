// Session-local cache. A generation fences requests started before a write/logout.
export class QueryCache {
  private entries = new Map<string, { value: unknown; expires: number }>();
  private flights = new Map<string, Promise<unknown>>();
  revision = 0;

  private ttl: number;
  private now: () => number;
  private limit: number;
  constructor(ttl = 60_000, now = Date.now, limit = 200) {
    this.ttl = ttl;
    this.now = now;
    this.limit = limit;
  }

  peek<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown) {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + this.ttl });
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }

  clear() {
    this.revision++;
    this.entries.clear();
    this.flights.clear();
  }

  async read<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.peek<T>(key);
    if (cached !== undefined) return cached;
    const pending = this.flights.get(key);
    if (pending) return pending as Promise<T>;
    const revision = this.revision;
    const flight = Promise.resolve().then(fetcher).then(value => {
      if (revision === this.revision) this.set(key, value);
      return value;
    }).finally(() => {
      if (this.flights.get(key) === flight) this.flights.delete(key);
    });
    this.flights.set(key, flight);
    return flight;
  }
}

// Authentication, command recovery and mutable drafts must always reach the server.
export function cacheableRead(path: string, options: RequestInit = {}) {
  if ((options.method ?? "GET").toUpperCase() !== "GET" || options.cache === "no-store" || options.headers || options.signal) return false;
  return /^\/(dashboard|stock|items|materials|suppliers|customers|contracts|shipments|equipment|locations|reservations|purchase-lines|batches|reports|inventory)([/?]|$)/.test(path);
}
