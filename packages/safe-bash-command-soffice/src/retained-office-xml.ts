import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { RetainedXml, XmlRange } from "@poe-code/office-xml";
import type { SofficeSnapshot } from "./retained-input.js";

export type OfficeElement = { name: XmlRange; first: number; open: number; end: number; body: XmlRange };
const kinds = ["text", "start-name", "attribute-name", "attribute-value", "start-end", "end-name", "comment", "cdata", "instruction"];

/** A replayable lexical index preserves the permissive legacy element selection. */
export class OfficeXml {
  private readonly index: IntegerTable;
  count = 0;
  private work = 0;
  constructor(readonly xml: RetainedXml, storage: PagedStorage, private readonly signal: AbortSignal) { this.index = new IntegerTable(storage); }
  async retain(): Promise<void> {
    for await (const token of this.xml.tokens()) {
      for (const [field, value] of [kinds.indexOf(token.kind), token.range.start, token.range.length, token.empty ? 1 : 0].entries())
        await this.index.set(BigInt(this.count * 4 + field), BigInt(value));
      this.count++; if (this.count % 256 === 0) await yieldTurn(this.signal);
    }
  }
  async token(index: number) {
    this.signal.throwIfAborted(); if (++this.work % 256 === 0) await yieldTurn(this.signal);
    return { kind: kinds[Number(await this.index.get(BigInt(index * 4)))], range: { start: Number(await this.index.get(BigInt(index * 4 + 1))), length: Number(await this.index.get(BigInt(index * 4 + 2))) }, empty: await this.index.get(BigInt(index * 4 + 3)) === 1n };
  }
  async name(range: XmlRange): Promise<string> {
    let local = "", colon = false;
    for await (const bytes of this.xml.read(range)) for (const byte of bytes) {
      if (byte === 58) { if (colon) return ""; colon = true; local = ""; }
      else if (byte === 95 || byte === 45 || byte >= 48 && byte <= 57 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122) {
        if (local.length <= 32) local += String.fromCharCode(byte);
      } else return "";
    }
    return local.length <= 32 ? local : "";
  }
  async equal(a: XmlRange, b: XmlRange): Promise<boolean> {
    if (a.length !== b.length) return false;
    for (let at = 0; at < a.length; at += 16384) {
      let left = new Uint8Array();
      for await (const bytes of this.xml.read({ start: a.start + at, length: Math.min(16384, a.length - at) })) left = new Uint8Array(bytes);
      for await (const bytes of this.xml.read({ start: b.start + at, length: left.length })) if (bytes.some((byte, index) => byte !== left[index])) return false;
    }
    return true;
  }
  async *elements(first: number, end: number, names: readonly string[], empty = false, openOnly = false, insensitive = false): AsyncGenerator<OfficeElement> {
    for (let index = first; index < end; index++) {
      const token = await this.token(index);
      if (token.kind !== "start-name") continue;
      const local = await this.name(token.range);
      if (!names.includes(insensitive ? local.toLowerCase() : local)) continue;
      const start = index;
      while (++index < end && (await this.token(index)).kind !== "start-end") { /* Attributes belong to this opening tag. */ }
      if (index >= end) return;
      const open = index, opening = await this.token(open);
      if (opening.empty || openOnly) {
        if (empty) yield { name: token.range, first: start, open, end: open, body: { start: opening.range.start, length: 0 } };
        continue;
      }
      let close = open + 1;
      for (; close < end; close++) {
        const candidate = await this.token(close);
        if (candidate.kind === "end-name" && await this.equal(token.range, candidate.range)) break;
      }
      if (close < end) {
        const closing = await this.token(close);
        yield { name: token.range, first: start, open, end: close, body: { start: opening.range.start, length: closing.range.start - 2 - opening.range.start } };
        index = close;
      }
    }
  }
  async attribute(element: OfficeElement, wanted: string, insensitive = false): Promise<XmlRange | undefined> {
    let name = "";
    for (let index = element.first + 1; index < element.open; index++) {
      const token = await this.token(index);
      if (token.kind === "attribute-name") name = await this.name(token.range);
      else if (token.kind === "attribute-value" && (insensitive ? name.toLowerCase() : name) === wanted) {
        for await (const bytes of this.xml.read({ start: token.range.start - 1, length: 1 })) if (bytes[0] === 34) return token.range;
      }
    }
    return undefined;
  }
}

/** Hash collision chains retain full keys in caller storage, never in a JS map. */
export class SpanMap {
  private readonly buckets: IntegerTable;
  private readonly records: IntegerTable;
  private count = 0;
  constructor(private readonly storage: PagedStorage, private readonly signal: AbortSignal) { this.buckets = new IntegerTable(storage); this.records = new IntegerTable(storage); }
  private async hash(key: SofficeSnapshot): Promise<bigint> {
    let hash = 2166136261;
    for (let at = 0; at < key.size; at += 16384) {
      this.signal.throwIfAborted();
      for (const byte of await this.storage.read(key.position + at, Math.min(16384, key.size - at))) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    }
    return BigInt(hash);
  }
  async set(key: SofficeSnapshot, value: SofficeSnapshot): Promise<void> {
    const hash = await this.hash(key), next = await this.buckets.get(hash) ?? 0n, row = this.count++;
    for (const [field, number] of [key.position, key.size, value.position, value.size].entries()) await this.records.set(BigInt(row * 5 + field), BigInt(number));
    await this.records.set(BigInt(row * 5 + 4), next); await this.buckets.set(hash, BigInt(row + 1));
  }
  async get(key: SofficeSnapshot): Promise<SofficeSnapshot | undefined> {
    let next = await this.buckets.get(await this.hash(key)) ?? 0n;
    while (next) {
      const row = (next - 1n) * 5n, position = Number(await this.records.get(row)), size = Number(await this.records.get(row + 1n));
      let equal = size === key.size;
      for (let at = 0; equal && at < size; at += 16384) {
        this.signal.throwIfAborted();
        const left = new Uint8Array(await this.storage.read(position + at, Math.min(16384, size - at)));
        const right = await this.storage.read(key.position + at, left.length);
        equal = left.every((byte, index) => byte === right[index]);
      }
      if (equal) return { position: Number(await this.records.get(row + 2n)), size: Number(await this.records.get(row + 3n)) };
      next = await this.records.get(row + 4n) ?? 0n;
    }
    return undefined;
  }
}

