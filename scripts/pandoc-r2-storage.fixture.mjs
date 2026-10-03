/** Test adapter: only tiny namespace receipts stay in MemoryFileSystem. Payload
 * pages live in the injected R2 bucket, with deterministic keys and no resident
 * page index. It deliberately supports retained scratch handles only. */
export function createR2PagedFixture(namespace, bucket) {
  const pageBytes = 16384;
  const events = {opened: 0, closed: 0, reads: 0, writes: 0, largestTransfer: 0};
  function check(value, message) {if (!value) throw new Error(message);}
  const fs = new Proxy(namespace, {get(target, key) {
    if (key === "readFile" || key === "writeFile" || key === "readStream")
      return () => {throw new Error("Payload must use remote retained pages");};
    if (key === "open") return async (path, options) => {
      check(path.startsWith("/spill/.storage-") && options.creation === "exclusive", "Unexpected scratch acquisition");
      const receipt = await target.open(path, options);
      const prefix = crypto.randomUUID() + "/";
      events.opened++;
      let size = 0, closing;
      const checkOpen = options => {
        options?.signal?.throwIfAborted();
        check(!closing, "Descriptor is closed");
      };
      const readPage = async index => {
        const object = await bucket.get(prefix + index);
        if (!object) return new Uint8Array(pageBytes);
        const bytes = new Uint8Array(await object.arrayBuffer());
        check(bytes.length === pageBytes, "Invalid remote page");
        events.reads++;
        events.largestTransfer = Math.max(events.largestTransfer, bytes.length);
        return bytes;
      };
      return {
        capabilities: {...receipt.capabilities, positionedRead: true, positionedWrite: true, truncate: false},
        async stat(options) {checkOpen(options); return {...await receipt.stat(options), size};},
        async read(buffer, position, options) {
          checkOpen(options);
          check(Number.isSafeInteger(position) && position >= 0, "Expected positioned read");
          const count = Math.min(buffer.length, pageBytes - position % pageBytes, Math.max(0, size - position));
          if (!count) return 0;
          const bytes = await readPage(Math.floor(position / pageBytes));
          checkOpen(options);
          buffer.set(bytes.subarray(position % pageBytes, position % pageBytes + count));
          return count;
        },
        async write(buffer, position, options) {
          checkOpen(options);
          check(Number.isSafeInteger(position) && position >= 0, "Expected positioned write");
          const stat = await receipt.stat();
          check(stat.nlink === 0 && stat.size === 0, "Scratch must detach and retain no payload in memory");
          const count = Math.min(buffer.length, pageBytes - position % pageBytes);
          if (!count) return 0;
          const index = Math.floor(position / pageBytes);
          const bytes = count === pageBytes ? buffer : await readPage(index);
          if (count !== pageBytes) bytes.set(buffer.subarray(0, count), position % pageBytes);
          await bucket.put(prefix + index, bytes);
          events.writes++;
          events.largestTransfer = Math.max(events.largestTransfer, bytes.length);
          size = Math.max(size, position + count);
          checkOpen(options);
          return count;
        },
        async truncate() {throw new Error("Unexpected truncation");},
        async sync() {},
        close() {
          return closing ??= (async () => {
            try {
              // Repeat a bounded first-page listing: no growing key collection
              // and no cursor invalidation while deleting objects.
              for (;;) {
                const page = await bucket.list({prefix, limit: 100});
                if (!page.objects.length) break;
                await bucket.delete(page.objects.map(object => object.key));
              }
            } finally {await receipt.close(); events.closed++;}
          })();
        }
      };
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  }});
  return {fs, events};
}
