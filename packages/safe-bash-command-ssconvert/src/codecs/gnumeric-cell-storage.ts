import type { XmlElement, XmlName, XmlStreamLimits } from "@poe-code/safe-fs/xml";
import { SsconvertError, type CapabilityContext, type WorkingStorage } from "../contracts.js";
import { GnumericSourceFailure } from "./gnumeric-input.js";

export type GnumericNode = { key: XmlElement | number; node: XmlElement };
export type GnumericChildren = (parent: XmlElement | undefined) => Iterable<GnumericNode> | AsyncIterable<GnumericNode>;

/** Each Cells container owns a contiguous sequence of length-prefixed XML
 * records. Only the current subtree and two fixed transfer windows are held. */
export function createGnumericCellStorage(context: CapabilityContext, acceptsNamespace: (name: string) => boolean) {
  let storage: WorkingStorage | undefined = undefined;
  let closed = false, closing: Promise<void> | undefined;
  let pending: Promise<unknown> = Promise.resolve(), length = 0, buffered = 0, windowStart = -1, windowLength = 0;
  const output = new Uint8Array(16384), window = new Uint8Array(16384);
  const groups = new WeakMap<XmlElement, { start: number; end: number }>(), path: XmlName[] = [];
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError("invalid-request", "Gnumeric XML storage is closed"); };
  context.own(() => {
    closed = true;
    return closing ??= pending.then(async () => { output.fill(0); window.fill(0); await storage?.close(); });
  });
  check();
  if (!context.createWorkingStorage) throw new SsconvertError("capability-denied", "Gnumeric XML requires caller storage");
  storage = context.createWorkingStorage(); check();
  const start = storage.allocate(0);
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(() => { check(); return operation(); });
    pending = result.then(() => undefined, () => undefined); return result;
  }
  async function flush() {
    if (buffered) { await storage!.write(start + length - buffered, output.subarray(0, buffered)); check(); buffered = 0; }
  }
  async function append(bytes: Uint8Array) {
    for (let at = 0; at < bytes.length;) {
      const count = Math.min(output.length - buffered, bytes.length - at);
      output.set(bytes.subarray(at, at + count), buffered); buffered += count; length += count; at += count;
      if (buffered === output.length) await flush();
    }
  }
  async function read(position: number, amount: number) {
    const result = new Uint8Array(amount);
    for (let at = 0; at < amount;) {
      check();
      const relative = position + at - start, group = Math.floor(relative / window.length) * window.length;
      if (group !== windowStart) {
        const expected = Math.min(window.length, length - group), bytes = await storage!.read(start + group, expected); check();
        if (bytes.length !== expected) throw new SsconvertError("io", "Truncated Gnumeric XML storage");
        window.set(bytes); windowStart = group; windowLength = expected;
      }
      const within = relative - windowStart, count = Math.min(amount - at, windowLength - within);
      if (count <= 0) throw new SsconvertError("io", "Invalid Gnumeric XML storage range");
      result.set(window.subarray(within, within + count), at); at += count;
    }
    return result;
  }
  const streamElements: NonNullable<XmlStreamLimits["streamElements"]> = {
    matches(_element, _parent, depth) {
      return depth === 5 && ["Workbook", "Sheets", "Sheet", "Cells"].every((name, i) => path[i]?.localName === name && acceptsNamespace(path[i]!.namespace));
    },
    async consume(element, parent) {
      try {
        await serial(async () => {
          // Ordered content is canonical; serializing children too would duplicate
          // every descendant at each level. Namespace maps are restored on replay.
          const text = JSON.stringify(element, function(key, value: unknown) {
            if (key === "children" || key === "text" && this.kind === "element") return undefined;
            return value instanceof Map ? [...value] : value;
          });
          const address = storage!.allocate(8 + text.length * 2), scratch = new Uint8Array(4096), view = new DataView(scratch.buffer);
          if (address !== start + length) throw new SsconvertError("io", "Noncontiguous Gnumeric XML storage");
          windowStart = -1;
          try {
            view.setFloat64(0, text.length, true); await append(scratch.subarray(0, 8));
            for (let at = 0; at < text.length; at += 2048) {
              check(); const count = Math.min(2048, text.length - at);
              for (let i = 0; i < count; i++) view.setUint16(i * 2, text.charCodeAt(at + i), true);
              await append(scratch.subarray(0, count * 2));
            }
            check(); const group = groups.get(parent);
            if (group) group.end = start + length; else groups.set(parent, { start: address, end: start + length });
            // Cells containers do not interpret their own mixed content. Bound
            // inter-cell whitespace/comments while retaining each child's content.
            parent.text = ""; (parent.content as unknown[]).length = 0;
          } finally { scratch.fill(0); }
        });
      } catch (error) { closed = true; output.fill(0); window.fill(0); throw new GnumericSourceFailure(error); }
    }
  };
  const children: GnumericChildren = async function* (parent) {
    check(); if (!parent) return;
    const group = groups.get(parent);
    if (!group) { for (const node of parent.children) yield { key: node, node }; return; }
    await serial(flush);
    for (let address = group.start; address < group.end;) {
      const key = address;
      const node = await serial(async () => {
        const header = await read(address, 8), count = new DataView(header.buffer).getFloat64(0, true);
        if (!Number.isSafeInteger(count) || count < 0 || count > (group.end - address - 8) / 2)
          throw new SsconvertError("io", "Invalid Gnumeric XML record");
        let text = "";
        for (let at = 0; at < count; at += 2048) {
          const take = Math.min(2048, count - at), bytes = await read(address + 8 + at * 2, take * 2), view = new DataView(bytes.buffer);
          const units: number[] = []; for (let i = 0; i < take; i++) units.push(view.getUint16(i * 2, true));
          text += String.fromCharCode(...units);
        }
        address += 8 + count * 2; check();
        return JSON.parse(text, (_key, value: unknown) => {
          if (value && typeof value === "object" && "kind" in value && value.kind === "element") {
            const element = value as XmlElement;
            return { ...element, namespaces: new Map(element.namespaces as unknown as [string, string][]),
              children: element.content.filter(item => item.kind === "element"),
              text: element.content.filter(item => item.kind === "text" || item.kind === "cdata").map(item => item.text).join("") };
          }
          return value;
        }) as XmlElement;
      });
      yield { key, node };
    }
    check();
  };
  return { children, streamElements, onElement(element: XmlName, _parent: XmlName | undefined, depth: number) { path.length = depth - 1; path.push(element); } };
}
