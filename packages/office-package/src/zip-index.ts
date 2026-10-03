/** Caller-owned scratch bytes. Implementations bound their own resident cache;
 * the codec never acquires a filesystem or closes the caller's storage. */
export interface ZipMetadataStorage {
  /** Reserve a non-overlapping range at a positive safe-integer address. */
  allocate(length: number): number;
  /** Return exactly length bytes; the response may be reused by the next read. */
  read(position: number, length: number): Promise<Uint8Array>;
  write(position: number, bytes: Uint8Array): Promise<void>;
}

/** A crit-bit tree with records in caller storage. A fixed 128-header cache and the
 * current caller key/record are resident. Prefixes and embedded NULs remain distinct. */
export class ZipDirectoryIndex {
  private root = 0;
  private readonly headers = new Map<number, Uint8Array>();
  constructor(private readonly storage: ZipMetadataStorage,
    private readonly options: { readonly maximumKeyLength?: number; readonly signal?: AbortSignal } = {}) {}

  private allocate(length: number): number {
    this.options.signal?.throwIfAborted();
    const position = this.storage.allocate(length);
    if (!Number.isSafeInteger(position) || position < 1 || position > Number.MAX_SAFE_INTEGER - length) throw new RangeError("Invalid ZIP index address");
    return position;
  }

  private bit(key: string, position: number): number {
    const unit = Math.floor(position / 17), within = position % 17;
    if (unit >= key.length) return 0;
    return within === 0 ? 1 : (key.charCodeAt(unit) >>> (16 - within)) & 1;
  }

  private remember(position: number, bytes: Uint8Array): void {
    this.headers.delete(position);
    this.headers.set(position, bytes.slice());
    if (this.headers.size > 128) this.headers.delete(this.headers.keys().next().value!);
  }

  private async writeHeader(position: number, bytes: Uint8Array): Promise<void> {
    this.options.signal?.throwIfAborted();
    await this.storage.write(position, bytes);
    this.options.signal?.throwIfAborted();
    this.remember(position, bytes);
  }

  private async header(position: number): Promise<DataView> {
    this.options.signal?.throwIfAborted();
    const cached = this.headers.get(position);
    if (cached) { this.remember(position, cached); return new DataView(cached.slice().buffer); }
    const bytes = new Uint8Array(await this.storage.read(position, 32));
    this.options.signal?.throwIfAborted();
    if (bytes.length !== 32) throw new RangeError("Truncated ZIP index record");
    this.remember(position, bytes);
    return new DataView(bytes.buffer);
  }

  /** Compare caller text with bounded UTF-16 storage windows. The first
   * differing crit-bit is enough; no stored key string needs reconstruction. */
  private async difference(position: number, length: number, key: string): Promise<number | undefined> {
    const common = Math.min(length, key.length);
    for (let offset = 0; offset < common; offset += 2048) {
      this.options.signal?.throwIfAborted();
      const size = Math.min(2048, common - offset) * 2;
      const bytes = await this.storage.read(position + 32 + offset * 2, size);
      this.options.signal?.throwIfAborted();
      if (bytes.length !== size) throw new RangeError("Truncated ZIP index key");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < size / 2; i++) {
        const difference = view.getUint16(i * 2, true) ^ key.charCodeAt(offset + i);
        if (difference) return (offset + i) * 17 + Math.clz32(difference) - 15;
      }
    }
    return length === key.length ? undefined : common * 17;
  }

  private async leaf(key: string): Promise<{position: number; header: DataView} | undefined> {
    this.options.signal?.throwIfAborted();
    let position = this.root;
    while (position) {
      const header = await this.header(position);
      const bit = header.getFloat64(24, true);
      if (header.getInt32(0, true) < 0) return {position, header};
      position = header.getFloat64(this.bit(key, bit) ? 16 : 8, true);
    }
    return undefined;
  }

  async get(key: string): Promise<number | undefined> {
    const leaf = await this.leaf(key);
    if (!leaf || leaf.header.getUint32(4, true) !== key.length || (await this.difference(leaf.position, key.length, key)) !== undefined) return undefined;
    return leaf.header.getFloat64(8, true);
  }

  async set(key: string, value: number): Promise<void> {
    this.options.signal?.throwIfAborted();
    if (key.length > (this.options.maximumKeyLength ?? 65536) || !Number.isSafeInteger(value) || value < 0) throw new RangeError("Invalid ZIP index record");
    const existing = await this.leaf(key);
    let different = 0;
    if (existing) {
      const bit = await this.difference(existing.position, existing.header.getUint32(4, true), key);
      if (bit === undefined) {
        existing.header.setFloat64(8, value, true);
        await this.writeHeader(existing.position, new Uint8Array(existing.header.buffer, existing.header.byteOffset, 32));
        this.options.signal?.throwIfAborted();
        return;
      }
      different = bit;
    }
    const position = this.allocate(32 + key.length * 2);
    const header = new DataView(new ArrayBuffer(32));
    header.setInt32(0, -1, true);
    header.setUint32(4, key.length, true);
    header.setFloat64(8, value, true);
    await this.writeHeader(position, new Uint8Array(header.buffer));
    for (let offset = 0; offset < key.length; offset += 2048) {
      this.options.signal?.throwIfAborted();
      const bytes = new Uint8Array(Math.min(2048, key.length - offset) * 2);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < bytes.length / 2; i++) view.setUint16(i * 2, key.charCodeAt(offset + i), true);
      await this.storage.write(position + 32 + offset * 2, bytes);
    }
    this.options.signal?.throwIfAborted();
    if (!existing) {this.root = position; return;}
    let child = this.root, parent = 0, slot = 0;
    while (child) {
      const node = await this.header(child);
      const bit = node.getFloat64(24, true);
      if (node.getInt32(0, true) < 0 || bit >= different) break;
      parent = child;
      slot = this.bit(key, bit) ? 16 : 8;
      child = node.getFloat64(slot, true);
    }
    const branch = this.allocate(32);
    const node = new DataView(new ArrayBuffer(32));
    node.setFloat64(24, different, true);
    node.setFloat64(this.bit(key, different) ? 16 : 8, position, true);
    node.setFloat64(this.bit(key, different) ? 8 : 16, child, true);
    await this.writeHeader(branch, new Uint8Array(node.buffer));
    if (!parent) this.root = branch;
    else {
      const node = await this.header(parent);
      node.setFloat64(slot, branch, true);
      await this.writeHeader(parent, new Uint8Array(node.buffer, node.byteOffset, 32));
    }
  }
}
