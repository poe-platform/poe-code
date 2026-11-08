import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";
import { rtfTextSteps } from "./rtf-text.js";

import type { RetainedTextSnapshot } from "./retained-blocks.js";

/** One shared bounded metadata cache covers every input in an invocation. */
export class RetainedRtfText {
  private readonly groups: IntegerTable;
  private readonly pages: IntegerTable;
  private readonly blocks: IntegerTable;
  private page = 0;
  private count = 0;
  constructor(private readonly storage: PagedStorage, private readonly signal: AbortSignal) {
    this.groups = new IntegerTable(storage); this.pages = new IntegerTable(storage); this.blocks = new IntegerTable(storage);
  }
  async retain(position: number, size: number): Promise<RetainedTextSnapshot> {
    const { storage, signal, groups, pages, blocks } = this;
    const firstPage = this.page, firstBlock = this.count;
    const encoder = new TextEncoder(), buffer = new Uint8Array(4096);
    let sourcePage = -1, sourceBytes = new Uint8Array(), used = 0, length = 0;
    let start: number | undefined, end = 0, work = 0;
    const flush = async () => {
      if (!used) return;
      signal.throwIfAborted();
      const at = storage.allocate(used);
      await storage.write(at, buffer.subarray(0, used));
      await pages.set(BigInt(this.page++), BigInt(at)); used = 0;
    };
    const paragraph = async () => {
      if (start !== undefined) { await blocks.set(BigInt(this.count * 2), BigInt(start)); await blocks.set(BigInt(this.count * 2 + 1), BigInt(end)); this.count++; start = undefined; }
    };
    const steps = rtfTextSteps(size);
    let next = steps.next();
    while (!next.done) {
      signal.throwIfAborted();
      if (++work % 16384 === 0) await yieldTurn(signal);
      const step = next.value;
      if (step.kind === "read") {
        if (step.position >= size) { next = steps.next(undefined); continue; }
        const selected = Math.floor(step.position / 4096);
        if (selected !== sourcePage) {
          sourceBytes = new Uint8Array(await storage.read(position + selected * 4096, Math.min(4096, size - selected * 4096)));
          sourcePage = selected;
        }
        next = steps.next(sourceBytes[step.position % 4096]);
      } else if (step.kind === "group-read") next = steps.next(Number(await groups.get(BigInt(step.index)) ?? 0n));
      else if (step.kind === "group-write") { await groups.set(BigInt(step.index), BigInt(step.value)); next = steps.next(); }
      else {
        if (step.value === "\n") await paragraph();
        else {
          const whitespace = step.value.trim().length === 0;
          if (start !== undefined || !whitespace) {
            start ??= length;
            const bytes = encoder.encode(step.value);
            for (const byte of bytes) { buffer[used++] = byte; length++; if (used === buffer.length) await flush(); }
            if (!whitespace) end = length;
          }
        }
        next = steps.next();
      }
    }
    await paragraph(); await flush();
    return { firstPage, firstBlock, count: this.count - firstBlock };
  }
  async isHeading(_snapshot: RetainedTextSnapshot, index: number): Promise<boolean> { return index === 0; }
  async *stream(snapshot: RetainedTextSnapshot, separator = "\n"): AsyncGenerator<Uint8Array> {
    for (let index = 0; index < snapshot.count; index++) {
      if (index) yield new TextEncoder().encode(separator);
      yield* this.streamBlock(snapshot, index);
    }
  }
  async *streamBlock(snapshot: RetainedTextSnapshot, index: number, range?: { readonly start: number; readonly length: number }): AsyncGenerator<Uint8Array> {
    const { storage, signal, pages, blocks } = this, block = snapshot.firstBlock + index;
    const first = Number(await blocks.get(BigInt(block * 2))) + (range?.start ?? 0);
    const end = Math.min(Number(await blocks.get(BigInt(block * 2 + 1))), first + (range?.length ?? Infinity));
    for (let offset = first; offset < end;) {
      signal.throwIfAborted();
      const at = Number(await pages.get(BigInt(snapshot.firstPage + Math.floor(offset / 4096))));
      const size = Math.min(4096 - offset % 4096, end - offset);
      yield new Uint8Array(await storage.read(at + offset % 4096, size));
      offset += size;
    }
  }
}
