import { createBiffPropertyNameEncoder } from "./biff-property-name.js";
import { readBiffPropertyText } from "./biff-property-text.js";
import { stageWideBiffProperty } from './biff-property-transcode.js';
import { stagePropertyBytes, propertyChunks } from './biff-property-bytes.js';
import type { BiffPropertySource } from './biff-encrypted-properties-write.js';
import { SsconvertError, type CapabilityContext, type RangeSource } from "@poe-code/spreadsheet-engine/contracts";
import type { ImportedValue, UnsupportedRecord, Workbook } from "@poe-code/spreadsheet-ast";
import { Binary, invalidBiff } from "./biff-binary.js";
import { biffPropertyFields, biffPropertyFormats, readBiffProperties } from "./biff-properties.js";
import { propertyRange, readPropertySectionRanges, readPropertyValueRanges, type BiffPropertyRange } from "./biff-property-range.js";

interface Section { guid: string; offset: number; bytes: BiffPropertyRange; values?: Map<number, BiffPropertyRange>; }
interface Property { stream: string; section: number; id: number; key: string; value: ImportedValue; }
interface Snapshot { record: UnsupportedRecord; bytes: BiffPropertyRange; modeled: ImportedValue[] | undefined; }

/** Rebuild offsets around original opaque spans. Never transcode their codepage. */
export async function mergeBiffProperties(book: Workbook, streams: Map<string, Uint8Array | RangeSource>, handled: Set<UnsupportedRecord>,
  context: CapabilityContext, charge: (amount: number) => void, allocate: (length: number) => Uint8Array,
  staged?: { sources: Map<string, BiffPropertySource>; reserve: (length: number) => number }): Promise<ReadonlySet<string>> {
  const canonical = (name: string) => ["\u0005SummaryInformation", "\u0005DocumentSummaryInformation"].find(target => target.toUpperCase() === name.toUpperCase());
  const snapshots = new Map<string, Snapshot>(), duplicates = new Set<string>();
  const preserved = new Set<string>();
  let nodes = 0, textBytes = 0;
  const admit = (amount: number) => {
    charge(amount); nodes += amount;
    if (nodes > (context.limits.workbookNodes ?? context.limits.outputBytes))
      throw new SsconvertError("resource-limit", "ssconvert BIFF property node limit exceeded");
  };
  const accountText = (text: string) => {
    charge(text.length);
    for (const point of text) { const code = point.codePointAt(0)!; textBytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; }
    if (textBytes > (context.limits.workbookTextBytes ?? context.limits.outputBytes))
      throw new SsconvertError("resource-limit", "ssconvert BIFF property text limit exceeded");
    return text;
  };
  const temporarySources: BiffPropertySource[] = [];
  const closeTemporary = async () => {
    const outcomes = await Promise.allSettled(temporarySources.map(source => source.close()));
    const errors = outcomes.filter((value): value is PromiseRejectedResult => value.status === "rejected").map(value => value.reason);
    if (errors.length) throw new AggregateError(errors, "BIFF property merge storage cleanup failed");
  };
  try {
  for (const record of book.unsupportedRecords ?? []) {
    admit(1);
    if (record.source !== "biff" || record.kind !== "ole-properties" || record.disposition !== "retained") continue;
    const data = record.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const object = data as Readonly<Record<string, ImportedValue>>;
    charge(Object.keys(object).length);
    if (Object.keys(object).some(key => !["stream", "bytes", "modeled"].includes(key)) || typeof object.stream !== "string" ||
      typeof object.bytes !== "string" || object.modeled !== undefined && !Array.isArray(object.modeled)) continue;
    charge(object.stream.length + object.bytes.length);
    const name = canonical(object.stream); if (!name) continue;
    if (snapshots.has(name)) { duplicates.add(name); continue; }
    if (object.bytes.length % 2) invalidBiff("invalid retained property bytes");
    const hex = object.bytes, size = hex.length / 2;
    if (size > context.limits.outputBytes || size > 0xffffffff)
      throw new SsconvertError("resource-limit", "ssconvert BIFF property output bytes limit exceeded");
    charge(size);
    const byte = (at: number) => {
      const high = "0123456789abcdef".indexOf(hex[at * 2]!.toLowerCase()), low = "0123456789abcdef".indexOf(hex[at * 2 + 1]!.toLowerCase());
      if (high < 0 || low < 0) invalidBiff("invalid retained property bytes");
      return high * 16 + low;
    };
    for (let at = 0; at < size; at++) { if (at % 16384 === 0) context.signal.throwIfAborted(); byte(at); }
    const bytes = propertyRange({ size, async read(at, count) {
      const bytes = new Uint8Array(Math.min(16384, count, size - at));
      for (let i = 0; i < bytes.length; i++) bytes[i] = byte(at + i);
      return bytes;
    } }, context);
    snapshots.set(name, { record, bytes, modeled: object.modeled });
  }
  for (const name of duplicates) snapshots.delete(name);
  if (!snapshots.size) return preserved;
  const parse = async (input: Uint8Array | RangeSource): Promise<Section[]> => {
    const file = propertyRange(input, context), sections: Section[] = [];
    for await (const section of readPropertySectionRanges(file, admit, charge, context)) {
      const bytes = file.slice(section.offset, section.end - section.offset);
      sections.push({ ...section, bytes, ...(biffPropertyFields.has(section.guid) || section.guid === biffPropertyFormats.custom ?
        { values: await readPropertyValueRanges(bytes, admit, charge, context) } : {}) });
    }
    return sections;
  };
  const old = new Map<string, Section[]>(), fresh = new Map<string, Section[]>();
  for (const [name, snapshot] of snapshots) old.set(name, await parse(snapshot.bytes));
  for (const [name, bytes] of streams) fresh.set(name, await parse(bytes));
  const materialize = async (source: BiffPropertyRange): Promise<Binary> => {
    const bytes = allocate(source.size);
    for (let at = 0; at < bytes.length;) { const part = await source.read(at, bytes.length - at); bytes.set(part, at); at += part.length; }
    return new Binary(bytes);
  };
  const original = new Map<string, Property>(), pending = new Map<string, Property>();
  const identity = (property: Pick<Property, "stream" | "section" | "id">) => `${property.stream}:${property.section}:${property.id}`;
  const readContext = { ...context, limits: { ...context.limits, inputBytes: context.limits.outputBytes } };
  // Reuse scalar decoding, but do not create another retained hexadecimal copy.
  await readBiffProperties(new Map([...snapshots].map(([name, value]) => [name, value.bytes])), readContext, accountText, charge,
    undefined, property => { admit(1); original.set(identity(property), property); });
  await readBiffProperties(streams, readContext, accountText, charge, undefined, property => { admit(1); pending.set(property.key, property); });

  const chunks = async function* (source: BiffPropertyRange): AsyncIterable<Uint8Array> {
    for (let at = 0; at < source.size;) { const bytes = await source.read(at, source.size - at); at += bytes.length; yield bytes; }
  };
  const dictionary = async function* (section: Section, names = true): AsyncIterable<{ id: number; bytes: BiffPropertyRange; name: string }> {
    const data = section.values?.get(0); if (!data) return;
    const cp = await section.values?.get(1)?.u16(4) ?? 1252, count = await data.u32(0);
    data.check(4, count * 9);
    if (names) { charge(data.size); admit(count); }
    let at = 4;
    for (let i = 0; i < count; i++) {
      const start = at, id = await data.u32(at); let name = '';
      if (names) {
        const entry = await readBiffPropertyText(data, at + 4, cp, readContext, accountText, charge);
        at = entry.end; name = entry.value;
      } else {
        // Replay already validated spans without retaining or decoding their names again.
        const length = await data.u32(at + 4), width = cp === 1200 ? 2 : 1;
        if (!length) invalidBiff("empty property dictionary name");
        at += 8 + length * width; if (width === 2) at = Math.ceil(at / 4) * 4;
      }
      yield { id, name, bytes: data.slice(start, at - start) };
    }
  };
  const writeDictionary = async (section: Section, plan: { length: number; count: number; remove?: number; append?: BiffPropertyRange }) => {
    const output = { length: plan.length, async *chunks() {
      const header = new Uint8Array(4); new DataView(header.buffer).setUint32(0, plan.count, true); yield header;
      for await (const entry of dictionary(section, false)) if (entry.id !== plan.remove) { charge(entry.bytes.size); yield* chunks(entry.bytes); }
      if (plan.append) { charge(plan.append.size); yield* chunks(plan.append); }
    } };
    if (staged) {
      staged.reserve(plan.length); const source = await stagePropertyBytes(output, context); temporarySources.push(source);
      section.values!.set(0, propertyRange(source, context));
    } else {
      const bytes = allocate(plan.length); let at = 0;
      for await (const part of output.chunks()) { bytes.set(part, at); at += part.length; }
      section.values!.set(0, propertyRange(bytes, context));
    }
  };
  const remove = async (section: Section, id: number) => {
    section.values!.delete(id);
    if (section.guid === biffPropertyFormats.custom) {
      let length = 4, count = 0;
      for await (const entry of dictionary(section)) if (entry.id !== id) { length += entry.bytes.size; count++; }
      await writeDictionary(section, { length, count, remove: id });
    }
  };
  const take = async (property: Property): Promise<BiffPropertyRange> => {
    charge(fresh.get(property.stream)!.length);
    const section = fresh.get(property.stream)!.find(section => section.offset === property.section)!;
    const value = section.values!.get(property.id)!; await remove(section, property.id); pending.delete(property.key); return value;
  };
  const wide = async (source: BiffPropertyRange, section: Section): Promise<BiffPropertyRange> => {
    if (await source.u32(0) !== 30 || (await section.values!.get(1)?.u16(4) ?? 1252) === 65001) return source;
    if (staged) {
      const output = await stageWideBiffProperty(source, context, charge, staged.reserve);
      temporarySources.push(output); return propertyRange(output, context);
    }
    const data = await materialize(source);
    const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data.slice(8, data.u32(4) - 1));
    charge(value.length); const bytes = allocate(8 + (value.length + 1) * 2), view = new DataView(bytes.buffer);
    view.setUint32(0, 31, true); view.setUint32(4, value.length + 1, true);
    for (let i = 0; i < value.length; i++) view.setUint16(8 + i * 2, value.charCodeAt(i), true);
    return propertyRange(bytes, context);
  };
  const same = (a: ImportedValue, b: ImportedValue | undefined) => {
    if (!Array.isArray(a) || !Array.isArray(b)) return Object.is(a, b);
    charge(a.length + b.length); return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  };
  for (const [name, snapshot] of snapshots) {
    const seen = new Set<string>();
    let modeled = snapshot.modeled;
    if (!modeled) {
      modeled = [];
      // SummaryInformation is read first. A legacy document-only snapshot lacks
      // that earlier stream's ownership decisions: infer only unchanged values.
      for (const property of original.values()) {
        charge(1); if (property.stream !== name) continue;
        if (name === "\u0005SummaryInformation" || snapshots.has("\u0005SummaryInformation") ||
          Object.hasOwn(book.properties ?? {}, property.key) && same(property.value, book.properties?.[property.key])) {
          admit(1); modeled.push([property.section, property.id, property.key]);
        }
      }
    }
    for (const entry of modeled) {
      admit(1);
      if (!Array.isArray(entry) || entry.length !== 3 || typeof entry[0] !== "number" || typeof entry[1] !== "number" || typeof entry[2] !== "string")
        invalidBiff("invalid retained property identity");
      const [offset, id, key] = entry as [number, number, string];
      const property = original.get(identity({ stream: name, section: offset, id }));
      if (!property || property.key !== key || seen.has(key)) invalidBiff("invalid retained property identity");
      seen.add(key);
      charge(old.get(name)!.length);
      const section = old.get(name)!.find(section => section.offset === offset)!;
      const value = book.properties?.[key], replacement = pending.get(key);
      if (!Object.hasOwn(book.properties ?? {}, key)) await remove(section, id);
      else if (same(property.value, value)) { preserved.add(key); if (replacement) await take(replacement); }
      else if (replacement) section.values!.set(id, await wide(await take(replacement), section));
    }
  }

  const encodeName = createBiffPropertyNameEncoder(context, charge, accountText);
  const warn = async (key: string, reason: string) => context.diagnostic?.({ code: "biff-loss-warning", severity: "warning",
    message: `Unsupported Excel BIFF document property: ${key} (${reason}; original property bytes retained)` });
  for (const property of [...pending.values()]) {
    charge(fresh.get(property.stream)!.length + (old.get(property.stream)?.length ?? 0));
    const source = fresh.get(property.stream)!.find(section => section.offset === property.section)!;
    const target = old.get(property.stream)?.find(section => section.guid === source.guid);
    if (!target) continue;
    const value = await take(property), values = target.values!;
    let id = property.id;
    if (target.guid === biffPropertyFormats.custom) {
      let count = 0, dictionaryLength = 4, maximumId = 1, collision = false;
      try {
        for await (const entry of dictionary(target)) {
          count++; dictionaryLength += entry.bytes.size; maximumId = Math.max(maximumId, entry.id);
          if (entry.name === property.key) collision = true;
        }
      } catch (error) { if (!(error instanceof SsconvertError) || error.code !== "unsupported-feature") throw error;
        await warn(property.key, "unknown dictionary encoding"); continue; }
      charge(count + values.size);
      if (collision) { await warn(property.key, "opaque name collision"); continue; }
      const cp = await values.get(1)?.u16(4) ?? 1252, text = encodeName(property.key, cp);
      if (!text) { await warn(property.key, "name cannot be encoded in the original codepage"); continue; }
      id = maximumId; for (const key of values.keys()) id = Math.max(id, key); id++;
      if (id > 0xffffffff) { await warn(property.key, "no free property ID"); continue; }
      const size = 8 + text.length, length = cp === 1200 ? Math.ceil(size / 4) * 4 : size;
      const entry = { length, *chunks() {
        const header = new Uint8Array(8), view = new DataView(header.buffer);
        view.setUint32(0, id, true); view.setUint32(4, text.length / (cp === 1200 ? 2 : 1), true); yield header;
        yield* propertyChunks(text); if (length > size) yield new Uint8Array(length - size);
      } };
      let bytes: BiffPropertyRange;
      if (staged) {
        staged.reserve(length); const source = await stagePropertyBytes(entry, context); temporarySources.push(source);
        bytes = propertyRange(source, context);
      } else {
        const data = allocate(length); let at = 0;
        for (const part of entry.chunks()) { data.set(part, at); at += part.length; }
        bytes = propertyRange(data, context);
      }
      await writeDictionary(target, { length: dictionaryLength + bytes.size, count: count + 1, append: bytes });
    } else if (values.has(id)) { await warn(property.key, "opaque property ID collision"); continue; }
    values.set(id, await wide(value, target));
  }

  const reserve = staged?.reserve ?? ((length: number) => {
    charge(length);
    if (length > 0xffffffff || length > context.limits.outputBytes)
      throw new SsconvertError("resource-limit", "ssconvert BIFF property output bytes limit exceeded");
    return length;
  });
  type Output = { length: number; chunks(): AsyncIterable<Uint8Array> };
  const encodeSection = (section: Section): Output => {
    if (!section.values) return { length: section.bytes.size, chunks: () => chunks(section.bytes) };
    const values = section.values;
    let length = 8 + values.size * 8;
    for (const value of values.values()) length += Math.ceil(value.size / 4) * 4;
    // Buffered output charges the section size here, as the old allocation did.
    reserve(length);
    return { length, async *chunks() {
      const header = new Uint8Array(8), view = new DataView(header.buffer);
      view.setUint32(0, length, true); view.setUint32(4, values.size, true); yield header;
      let at = 8 + values.size * 8;
      for (const [id, value] of values) {
        charge(value.size);
        const entry = new Uint8Array(8), view = new DataView(entry.buffer);
        view.setUint32(0, id, true); view.setUint32(4, at, true); yield entry;
        at += Math.ceil(value.size / 4) * 4;
      }
      for (const value of values.values()) {
        yield* chunks(value);
        const padding = (4 - value.size % 4) % 4; if (padding) yield new Uint8Array(padding);
      }
    } };
  };
  for (const name of new Set([...streams.keys(), ...snapshots.keys()])) {
    for (const section of fresh.get(name) ?? []) charge(1 + section.values!.size);
    const remaining = fresh.get(name)?.filter(section => [...section.values!.keys()].some(id => id >= 2)) ?? [];
    if (!old.has(name) && remaining.some(section => section.guid === biffPropertyFormats.custom) &&
      !remaining.some(section => section.guid === biffPropertyFormats.document)) {
      const builtin = fresh.get(name)?.find(section => section.guid === biffPropertyFormats.document);
      if (builtin) remaining.unshift(builtin);
    }
    const sections = [...old.get(name) ?? [], ...remaining];
    if (!sections.length) { streams.delete(name); continue; }
    const bodies = sections.map(encodeSection), length = 28 + sections.length * 20 + bodies.reduce((sum, body) => sum + body.length, 0);
    const originalHeader = await (snapshots.get(name)?.bytes ?? propertyRange(streams.get(name)!, context)).read(0, 28);
    const output: Output = { length, async *chunks() {
      const header = new Uint8Array(originalHeader); new DataView(header.buffer).setUint32(24, sections.length, true); yield header;
      let at = 28 + sections.length * 20;
      for (let i = 0; i < sections.length; i++) {
        charge(1); const entry = new Uint8Array(20), view = new DataView(entry.buffer);
        for (let j = 0; j < 16; j++) entry[j] = parseInt(sections[i]!.guid.slice(j * 2, j * 2 + 2), 16);
        view.setUint32(16, at, true); yield entry; at += bodies[i]!.length;
      }
      for (const body of bodies) yield* body.chunks();
    } };
    if (staged) {
      reserve(length); staged.sources.set(name, await stagePropertyBytes(output, context));
    } else {
      const bytes = allocate(length); let at = 0;
      for await (const part of output.chunks()) { bytes.set(part, at); at += part.length; }
      streams.set(name, bytes);
    }
    const snapshot = snapshots.get(name); if (snapshot) handled.add(snapshot.record);
  }
  const exposed = new Set<string>();
  await readBiffProperties(staged?.sources ?? streams, readContext, accountText, charge, undefined, property => {
    admit(1); if (!Object.hasOwn(book.properties ?? {}, property.key)) exposed.add(property.key);
  });
  for (const key of exposed) await warn(key, "opaque property exposes a field absent from the model");
  } catch (error) {
    try { await closeTemporary(); } catch (cleanup) { throw new AggregateError([error, cleanup], "BIFF property merge and cleanup failed"); }
    throw error;
  }
  await closeTemporary(); return preserved;
}
