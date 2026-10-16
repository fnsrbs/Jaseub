// Memory only: callers include the authenticated identity in every cache key.
export class ReadCache {
  private entries = new Map<
    string,
    { expires: number; promise: Promise<unknown> }
  >();
  constructor(
    private ttl = 10000,
    private now = () => Date.now(),
  ) {}
  clear() {
    this.entries.clear();
  }
  read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.expires > this.now())
      return existing.promise as Promise<T>;
    const entry = {
      expires: Infinity,
      promise: Promise.resolve().then(load) as Promise<unknown>,
    };
    this.entries.set(key, entry);
    while (this.entries.size > 20)
      this.entries.delete(this.entries.keys().next().value!);
    entry.promise.then(
      () => {
        if (this.entries.get(key) === entry)
          entry.expires = this.now() + this.ttl;
      },
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      },
    );
    return entry.promise as Promise<T>;
  }
}
