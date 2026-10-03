import { SsconvertError, type CapabilityContext, type WorkingStorage } from "@poe-code/spreadsheet-engine/contracts";
import type { BiffStrings } from "./biff-strings.js";

type StringValue = ReturnType<BiffStrings["unicode"]>;

/** Sequential UTF-16/rich-run payloads and fixed descriptors, with bounded staging. */
export function createBiffSharedStrings(context: CapabilityContext) {
  const buffers = [new Uint8Array(16384), new Uint8Array(16384)];
  const stores: WorkingStorage[] = [];
  let closed = false, closing: Promise<void> | undefined, pending: Promise<unknown> = Promise.resolve(), count = 0;
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError("invalid-request", "BIFF shared strings are closed"); };
  context.own(() => {
    closed = true;
    return closing ??= pending.then(async () => {
      for (const buffer of buffers) buffer.fill(0);
      const errors: unknown[] = [];
      for (const store of stores) try { await store.close(); } catch (error) { errors.push(error); }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, "BIFF shared string cleanup failed");
    });
  });
  check();
  if (!context.createWorkingStorage) throw new SsconvertError("capability-denied", "BIFF shared strings require caller working storage");
  function output(buffer: Uint8Array) {
    const store = context.createWorkingStorage!(); stores.push(store); check();
    const start = store.allocate(0), cache = new Uint8Array(16384); buffers.push(cache);
    let length = 0, buffered = 0, cacheGroup = -1;
    async function flush() {
      if (buffered) { await store.write(start + length - buffered, buffer.subarray(0, buffered)); check(); buffered = 0; }
    }
    return { start, get length() { return length; }, flush,
      async read(position: number, amount: number): Promise<Uint8Array> {
        check(); const bytes = new Uint8Array(amount);
        for (let at = 0; at < amount;) {
          const relative = position + at - start, group = Math.floor(relative / cache.length);
          if (group !== cacheGroup) {
            const expected = Math.min(cache.length, length - group * cache.length);
            const chunk = await store.read(start + group * cache.length, expected); check();
            if (chunk.length !== expected) throw new SsconvertError("io", "Truncated BIFF shared string storage");
            cache.set(chunk); cacheGroup = group;
          }
          const within = relative % cache.length, take = Math.min(amount - at, cache.length - within);
          bytes.set(cache.subarray(within, within + take), at); at += take;
        }
        return bytes;
      },
      async append(bytes: Uint8Array) {
        check(); store.allocate(bytes.length); cacheGroup = -1;
        for (let offset = 0; offset < bytes.length;) {
          const amount = Math.min(buffer.length - buffered, bytes.length - offset);
          buffer.set(bytes.subarray(offset, offset + amount), buffered); buffered += amount; length += amount; offset += amount;
          if (buffered === buffer.length) await flush();
        }
      }
    };
  }
  const descriptors = output(buffers[0]!), payloads = output(buffers[1]!);
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(() => { check(); return operation(); });
    pending = result.then(() => undefined, () => undefined); return result;
  }
  return {
    append(value: StringValue): Promise<void> { return serial(async () => {
      const scratch = new Uint8Array(4096), view = new DataView(scratch.buffer);
      const address = payloads.start + payloads.length, runs = value.richText ?? [];
      try {
        for (let at = 0; at < value.text.length; at += 2048) {
          check(); const amount = Math.min(2048, value.text.length - at);
          for (let i = 0; i < amount; i++) view.setUint16(i * 2, value.text.charCodeAt(at + i), true);
          await payloads.append(scratch.subarray(0, amount * 2));
        }
        for (let at = 0; at < runs.length; at += 341) {
          check(); const amount = Math.min(341, runs.length - at);
          for (let i = 0; i < amount; i++) {
            const run = runs[at + i]!;
            view.setUint32(i * 12, run.start, true); view.setUint32(i * 12 + 4, run.end, true);
            view.setUint32(i * 12 + 8, Number(run.attributes["biff-font-index"]), true);
          }
          await payloads.append(scratch.subarray(0, amount * 12));
        }
        view.setFloat64(0, address, true); view.setFloat64(8, value.text.length, true); view.setFloat64(16, runs.length, true);
        await descriptors.append(scratch.subarray(0, 24)); check(); count++;
      } catch (error) { closed = true; for (const buffer of buffers) buffer.fill(0); throw error; }
      finally { scratch.fill(0); }
    }); },
    get(index: number): Promise<StringValue | undefined> { return serial(async () => {
      if (!Number.isSafeInteger(index) || index < 0 || index >= count) return undefined;
      await descriptors.flush(); await payloads.flush(); check();
      const header = await descriptors.read(descriptors.start + index * 24, 24); check();
      if (header.length !== 24) throw new SsconvertError("io", "Truncated BIFF shared string descriptor");
      const descriptor = new DataView(header.buffer, header.byteOffset, header.byteLength);
      const address = descriptor.getFloat64(0, true), length = descriptor.getFloat64(8, true), runCount = descriptor.getFloat64(16, true);
      if (![address, length, runCount].every(value => Number.isSafeInteger(value) && value >= 0) || address < payloads.start ||
        !Number.isSafeInteger(length * 2 + runCount * 12) || address + length * 2 + runCount * 12 > payloads.start + payloads.length)
        throw new SsconvertError("io", "Invalid BIFF shared string descriptor");
      let text = "";
      for (let at = 0; at < length; at += 2048) {
        const amount = Math.min(2048, length - at), bytes = await payloads.read(address + at * 2, amount * 2); check();
        if (bytes.length !== amount * 2) throw new SsconvertError("io", "Truncated BIFF shared string text");
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), units: number[] = [];
        for (let i = 0; i < amount; i++) units.push(view.getUint16(i * 2, true));
        text += String.fromCharCode(...units);
      }
      const richText = [];
      for (let at = 0; at < runCount; at += 341) {
        const amount = Math.min(341, runCount - at), bytes = await payloads.read(address + length * 2 + at * 12, amount * 12); check();
        if (bytes.length !== amount * 12) throw new SsconvertError("io", "Truncated BIFF shared string runs");
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < amount; i++) richText.push({ start: view.getUint32(i * 12, true), end: view.getUint32(i * 12 + 4, true),
          attributes: { "biff-font-index": view.getUint32(i * 12 + 8, true) } });
      }
      return { text, ...(richText.length ? { richText } : {}) };
    }); }
  };
}
