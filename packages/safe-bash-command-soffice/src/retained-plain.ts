import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { RetainedTextSnapshot } from "./retained-blocks.js";

/** Decoded text and line spans use caller backing; no line length affects memory. */
export class RetainedPlainText {
  private readonly pages: IntegerTable;
  private readonly blocks: IntegerTable;
  private page = 0;
  private count = 0;
  constructor(private readonly storage: PagedStorage, private readonly signal: AbortSignal) {
    this.pages = new IntegerTable(storage); this.blocks = new IntegerTable(storage);
  }
  async retain(position: number, size: number): Promise<RetainedTextSnapshot> {
    const { storage, signal, pages, blocks } = this, firstPage = this.page, firstBlock = this.count;
    const decoder = new TextDecoder(), encoder = new TextEncoder(), buffer = new Uint8Array(4096);
    let used = 0, length = 0, start = 0, prefix = "", visible = false, trimStart = -1, trimEnd = 0, pendingCr = false;
    const flush = async () => {
      if (!used) return;
      const at = storage.allocate(used); await storage.write(at, buffer.subarray(0, used));
      await pages.set(BigInt(this.page++), BigInt(at)); used = 0;
    };
    const character = async (value: string) => {
      const before = length, bytes = encoder.encode(value);
      if (prefix.length < 2) prefix += value;
      for (const byte of bytes) { buffer[used++] = byte; length++; if (used === buffer.length) await flush(); }
      if (value.trim().length) {
        visible = true;
        if (before >= start + 2) { if (trimStart < 0) trimStart = before; trimEnd = length; }
      }
    };
    const line = async () => {
      if (visible) {
        const heading = prefix === "# ";
        await blocks.set(BigInt(this.count * 3), BigInt(heading ? trimStart < 0 ? length : trimStart : start));
        await blocks.set(BigInt(this.count * 3 + 1), BigInt(heading ? trimStart < 0 ? length : trimEnd : length));
        await blocks.set(BigInt(this.count * 3 + 2), heading ? 1n : 0n); this.count++;
      }
      start = length; prefix = ""; visible = false; trimStart = -1; trimEnd = length;
    };
    const consume = async (text: string) => {
      for (const value of text) {
        signal.throwIfAborted();
        if (value === "\n") { pendingCr = false; await line(); }
        else {
          if (pendingCr) await character("\r");
          pendingCr = value === "\r";
          if (!pendingCr) await character(value);
        }
      }
    };
    for (let offset = 0; offset < size; offset += 4096) {
      signal.throwIfAborted();
      await consume(decoder.decode(await storage.read(position + offset, Math.min(4096, size - offset)), { stream: true }));
      await yieldTurn(signal);
    }
    await consume(decoder.decode()); if (pendingCr) await character("\r");
    await line(); await flush();
    return { firstPage, firstBlock, count: this.count - firstBlock };
  }
  async isHeading(snapshot: RetainedTextSnapshot, index: number): Promise<boolean> {
    return await this.blocks.get(BigInt((snapshot.firstBlock + index) * 3 + 2)) === 1n;
  }
  async *stream(snapshot: RetainedTextSnapshot, separator = "\n"): AsyncGenerator<Uint8Array> {
    for (let index = 0; index < snapshot.count; index++) {
      if (index) yield new TextEncoder().encode(separator);
      yield* this.streamBlock(snapshot, index);
    }
  }
  async *streamBlock(snapshot: RetainedTextSnapshot, index: number): AsyncGenerator<Uint8Array> {
    const { storage, signal, pages, blocks } = this, block = snapshot.firstBlock + index;
    const end = Number(await blocks.get(BigInt(block * 3 + 1)));
    for (let offset = Number(await blocks.get(BigInt(block * 3))); offset < end;) {
      signal.throwIfAborted();
      const at = Number(await pages.get(BigInt(snapshot.firstPage + Math.floor(offset / 4096))));
      const size = Math.min(4096 - offset % 4096, end - offset);
      yield new Uint8Array(await storage.read(at + offset % 4096, size)); offset += size;
    }
  }
}
