import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { IndexedDocument } from "safe-bash-diff-engine/document";
import type { ChangeLine, ParsedHunk, PatchCollections, StoredItems } from "./parser.js";
import type { StoredText } from "./stored-text.js";
import type { Work } from "./shared.js";

interface Codec<T> {
  readonly size: number;
  encode(view: DataView, value: T): void;
  decode(view: DataView): T;
}

/** Linked records share one bounded page cache across all patch collections. */
class MetadataList<T> implements StoredItems<T> {
  private tail = 0;
  constructor(private readonly storage: PagedStorage, private readonly work: Work, private readonly codec: Codec<T>, public head = 0, public length = 0) {}

  async push(value: T): Promise<void> {
    this.work.step(); await this.work.checkpoint();
    if (this.length && !this.tail) throw new Error("Cannot append to a retained patch collection");
    const bytes = new Uint8Array(8 + this.codec.size);
    this.codec.encode(new DataView(bytes.buffer, 8), value);
    const address = this.storage.allocate(bytes.length);
    await this.storage.write(address, bytes);
    if (this.tail) {
      const link = new Uint8Array(8);
      new DataView(link.buffer).setFloat64(0, address, true);
      await this.storage.write(this.tail, link);
    } else this.head = address;
    this.tail = address;
    this.length++;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    let address = this.head;
    for (let index = 0; index < this.length; index++) {
      this.work.step(); await this.work.checkpoint();
      const bytes = await this.storage.read(address, 8 + this.codec.size);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      address = view.getFloat64(0, true);
      yield this.codec.decode(new DataView(bytes.buffer, bytes.byteOffset + 8, this.codec.size));
    }
  }
}

export class PatchMetadata implements PatchCollections<StoredText> {
  private readonly storage: PagedStorage;
  readonly close: () => Promise<void>;
  private readonly textCodec: Codec<StoredText>;
  private readonly lineCodec: Codec<ChangeLine<StoredText>>;
  private readonly hunkCodec: Codec<ParsedHunk<StoredText>>;

  constructor(document: IndexedDocument, private readonly work: Work) {
    this.storage = new PagedStorage(work.context, 8);
    this.close = this.storage.close.bind(this.storage);
    work.context.registerCleanup?.(this.close);
    this.textCodec = {
      size: 16,
      encode(view, value) { view.setFloat64(0, value.start, true); view.setFloat64(8, value.end, true); },
      decode(view) { return { document, start: view.getFloat64(0, true), end: view.getFloat64(8, true) }; },
    };
    this.lineCodec = {
      size: 24,
      encode: (view, value) => {
        view.setUint8(0, value.kind.charCodeAt(0));
        this.textCodec.encode(new DataView(view.buffer, view.byteOffset + 8, 16), value.text);
      },
      decode: view => ({ kind: String.fromCharCode(view.getUint8(0)) as ChangeLine["kind"],
        text: this.textCodec.decode(new DataView(view.buffer, view.byteOffset + 8, 16)) }),
    };
    this.hunkCodec = {
      size: 40,
      encode(view, value) {
        if (!(value.anchors instanceof MetadataList) || !(value.lines instanceof MetadataList)) throw new Error("Patch metadata must share caller storage");
        view.setFloat64(0, value.anchors.head, true); view.setFloat64(8, value.anchors.length, true);
        view.setFloat64(16, value.lines.head, true); view.setFloat64(24, value.lines.length, true);
        view.setUint8(32, Number(value.eof));
      },
      decode: view => ({
        anchors: new MetadataList(this.storage, work, this.textCodec, view.getFloat64(0, true), view.getFloat64(8, true)),
        lines: new MetadataList(this.storage, work, this.lineCodec, view.getFloat64(16, true), view.getFloat64(24, true)),
        eof: !!view.getUint8(32),
      }),
    };
  }

  texts(): StoredItems<StoredText> { return new MetadataList(this.storage, this.work, this.textCodec); }
  lines(): StoredItems<ChangeLine<StoredText>> { return new MetadataList(this.storage, this.work, this.lineCodec); }
  hunks(): StoredItems<ParsedHunk<StoredText>> { return new MetadataList(this.storage, this.work, this.hunkCodec); }
}
