import {ZipDirectoryIndex} from "@poe-code/office-package/zip";
import type {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText} from "./backed-text.js";

export interface ManifestItem {
  ordinal: number;
  id: string;
  part: string;
  media: string;
  properties: string[];
  fallback: string;
  overlay: string;
}

/** Two identity indexes share one ordered record chain. With working storage,
 * only the current item's strings are decoded; no manifest-sized cache is kept. */
export class EpubManifest {
  size = 0;
  private first = 0;
  private last = 0;
  private readonly ids: ZipDirectoryIndex | Map<string, ManifestItem>;
  private readonly parts: ZipDirectoryIndex | Map<string, ManifestItem>;
  private readonly text: BackedText | undefined;
  constructor(private readonly storage: PagedStorage | undefined, cooperate: () => Promise<void>) {
    this.ids = storage ? new ZipDirectoryIndex(storage, {maximumKeyLength: Number.MAX_SAFE_INTEGER}) : new Map();
    this.parts = storage ? new ZipDirectoryIndex(storage, {maximumKeyLength: Number.MAX_SAFE_INTEGER}) : new Map();
    this.text = storage ? new BackedText(storage, cooperate) : undefined;
  }
  async has(id: string): Promise<boolean> {return await this.ids.get(id) !== undefined;}
  async hasPart(part: string): Promise<boolean> {return await this.parts.get(part) !== undefined;}
  async get(id: string): Promise<ManifestItem | undefined> {
    const value = await this.ids.get(id);
    return typeof value === "number" ? this.read(value) : value;
  }
  async getPart(part: string): Promise<ManifestItem | undefined> {
    const value = await this.parts.get(part);
    return typeof value === "number" ? this.read(value) : value;
  }
  /** Caller validates both identities before admission. */
  async add(item: ManifestItem): Promise<void> {
    if (!this.storage) {
      (this.ids as Map<string, ManifestItem>).set(item.id, item);
      (this.parts as Map<string, ManifestItem>).set(item.part, item);
    } else {
      // next pointer, ordinal, then six linked UTF-16 text ranges.
      const bytes = new Uint8Array(160), header = new DataView(bytes.buffer);
      header.setFloat64(8, item.ordinal, true);
      const fields = [item.id, item.part, item.media, item.properties.join(" "), item.fallback, item.overlay];
      for (let i = 0; i < fields.length; i++) {
        const range = await this.text!.from([fields[i]!]), offset = 16 + i * 24;
        header.setFloat64(offset, range.first, true);
        header.setFloat64(offset + 8, range.last, true);
        header.setFloat64(offset + 16, range.units, true);
      }
      const pointer = await this.storage.append(bytes);
      await (this.ids as ZipDirectoryIndex).set(item.id, pointer);
      await (this.parts as ZipDirectoryIndex).set(item.part, pointer);
      if (this.last) {
        const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, pointer, true);
        await this.storage.write(this.last, link);
      } else this.first = pointer;
      this.last = pointer;
    }
    this.size++;
  }
  private async read(pointer: number): Promise<ManifestItem> {
    const bytes = await this.storage!.read(pointer, 160), header = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const fields: string[] = [];
    for (let i = 0; i < 6; i++) {
      const offset = 16 + i * 24;
      const range = {first: header.getFloat64(offset, true), last: header.getFloat64(offset + 8, true), units: header.getFloat64(offset + 16, true)};
      let value = "";
      for await (const chunk of this.text!.chunks(range)) value += chunk;
      fields.push(value);
    }
    return {ordinal: header.getFloat64(8, true), id: fields[0]!, part: fields[1]!, media: fields[2]!, properties: fields[3]!.split(" ").filter(Boolean), fallback: fields[4]!, overlay: fields[5]!};
  }
  async *values(): AsyncGenerator<ManifestItem> {
    if (this.ids instanceof Map) {yield* this.ids.values(); return;}
    let pointer = this.first;
    while (pointer) {
      yield await this.read(pointer);
      const bytes = await this.storage!.read(pointer, 8);
      pointer = new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getFloat64(0, true);
    }
  }
}
