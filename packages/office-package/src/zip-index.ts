/** Caller-owned scratch bytes. Implementations bound their own resident cache;
 * the codec never acquires a filesystem or closes the caller's storage. */
export interface ZipMetadataStorage {
  /** Reserve a non-overlapping range at a positive safe-integer address. */
  allocate(length: number): number;
  /** Return exactly length bytes; the response may be reused by the next read. */
  read(position: number, length: number): Promise<Uint8Array>;
  write(position: number, bytes: Uint8Array): Promise<void>;
}

/** A crit-bit tree with records in caller storage. Only a root pointer and the
 * current key/record are resident. Prefixes and embedded NULs remain distinct. */
export class ZipDirectoryIndex {
  private root = 0;
  constructor(private readonly storage: ZipMetadataStorage) {}

  private allocate(length: number): number {
    const position = this.storage.allocate(length);
    if (!Number.isSafeInteger(position) || position < 1 || position > Number.MAX_SAFE_INTEGER - length) throw new RangeError("Invalid ZIP index address");
    return position;
  }

  private bit(key: string, position: number): number {
    const unit = Math.floor(position / 17), within = position % 17;
    if (unit >= key.length) return 0;
    return within === 0 ? 1 : (key.charCodeAt(unit) >>> (16 - within)) & 1;
  }

  private async header(position: number): Promise<DataView> {
    const bytes = new Uint8Array(await this.storage.read(position, 32));
    if (bytes.length !== 32) throw new RangeError("Truncated ZIP index record");
    return new DataView(bytes.buffer);
  }

  private async key(position: number, length: number): Promise<string> {
    let key = "";
    for (let offset = 0; offset < length; offset += 2048) {
      const bytes = await this.storage.read(position + 32 + offset * 2, Math.min(2048, length - offset) * 2);
      if (bytes.length !== Math.min(2048, length - offset) * 2) throw new RangeError("Truncated ZIP index key");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < bytes.length; i += 2) key += String.fromCharCode(view.getUint16(i, true));
    }
    return key;
  }

  private async leaf(key: string): Promise<{position: number; header: DataView} | undefined> {
    let position = this.root;
    while (position) {
      const header = await this.header(position);
      const bit = header.getInt32(0, true);
      if (bit < 0) return {position, header};
      position = header.getFloat64(this.bit(key, bit) ? 16 : 8, true);
    }
    return undefined;
  }

  async get(key: string): Promise<number | undefined> {
    const leaf = await this.leaf(key);
    if (!leaf || leaf.header.getUint32(4, true) !== key.length || await this.key(leaf.position, key.length) !== key) return undefined;
    return leaf.header.getFloat64(8, true);
  }

  async set(key: string, value: number): Promise<void> {
    if (key.length > 65536 || !Number.isSafeInteger(value) || value < 0) throw new RangeError("Invalid ZIP index record");
    const existing = await this.leaf(key);
    let different = 0;
    if (existing) {
      const previous = await this.key(existing.position, existing.header.getUint32(4, true));
      if (previous === key) {
        existing.header.setFloat64(8, value, true);
        await this.storage.write(existing.position, new Uint8Array(existing.header.buffer, existing.header.byteOffset, 32));
        return;
      }
      while (different < Math.min(previous.length, key.length) && previous.charCodeAt(different) === key.charCodeAt(different)) different++;
      different *= 17;
      while (this.bit(previous, different) === this.bit(key, different)) different++;
    }
    const position = this.allocate(32 + key.length * 2);
    const header = new DataView(new ArrayBuffer(32));
    header.setInt32(0, -1, true);
    header.setUint32(4, key.length, true);
    header.setFloat64(8, value, true);
    await this.storage.write(position, new Uint8Array(header.buffer));
    for (let offset = 0; offset < key.length; offset += 2048) {
      const bytes = new Uint8Array(Math.min(2048, key.length - offset) * 2);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < bytes.length / 2; i++) view.setUint16(i * 2, key.charCodeAt(offset + i), true);
      await this.storage.write(position + 32 + offset * 2, bytes);
    }
    if (!existing) {this.root = position; return;}
    let child = this.root, parent = 0, slot = 0;
    while (child) {
      const node = await this.header(child);
      const bit = node.getInt32(0, true);
      if (bit < 0 || bit >= different) break;
      parent = child;
      slot = this.bit(key, bit) ? 16 : 8;
      child = node.getFloat64(slot, true);
    }
    const branch = this.allocate(32);
    const node = new DataView(new ArrayBuffer(32));
    node.setInt32(0, different, true);
    node.setFloat64(this.bit(key, different) ? 16 : 8, position, true);
    node.setFloat64(this.bit(key, different) ? 8 : 16, child, true);
    await this.storage.write(branch, new Uint8Array(node.buffer));
    if (!parent) this.root = branch;
    else {
      const node = await this.header(parent);
      node.setFloat64(slot, branch, true);
      await this.storage.write(parent, new Uint8Array(node.buffer, node.byteOffset, 32));
    }
  }
}
