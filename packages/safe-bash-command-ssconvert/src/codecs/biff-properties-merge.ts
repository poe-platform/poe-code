import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { ImportedValue, UnsupportedRecord, Workbook } from "../workbook.js";
import { singleByteTables } from "../encoding/tables.js";
import { biffDbcsTables } from "../encoding/biff-dbcs-tables.js";
import { Binary, invalidBiff } from "./biff-binary.js";
import { biffDecode } from "./biff-strings.js";
import { biffPropertyFields, biffPropertyFormats, readBiffProperties } from "./biff-properties.js";
import { readBiffPropertySections, readBiffPropertyValues } from "./biff-properties-layout.js";

interface Section { guid: string; offset: number; bytes: Uint8Array; values?: Map<number, Binary>; }
interface Property { stream: string; section: number; id: number; key: string; value: ImportedValue; }
interface Snapshot { record: UnsupportedRecord; bytes: Uint8Array; modeled: ImportedValue[] | undefined; }

/** Rebuild offsets around original opaque spans. Never transcode their codepage. */
export async function mergeBiffProperties(book: Workbook, streams: Map<string, Uint8Array>, handled: Set<UnsupportedRecord>,
  context: CapabilityContext, charge: (amount: number) => void, allocate: (length: number) => Uint8Array): Promise<ReadonlySet<string>> {
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
    const bytes = allocate(object.bytes.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      const high = "0123456789abcdef".indexOf(object.bytes[i * 2]!.toLowerCase()), low = "0123456789abcdef".indexOf(object.bytes[i * 2 + 1]!.toLowerCase());
      if (high < 0 || low < 0) invalidBiff("invalid retained property bytes");
      bytes[i] = high * 16 + low;
    }
    snapshots.set(name, { record, bytes, modeled: object.modeled });
  }
  for (const name of duplicates) snapshots.delete(name);
  if (!snapshots.size) return preserved;
  const parse = (bytes: Uint8Array): Section[] => readBiffPropertySections(bytes, admit, charge).map(section => {
    const data = bytes.subarray(section.offset, section.end);
    return { ...section, bytes: data, ...(biffPropertyFields.has(section.guid) || section.guid === biffPropertyFormats.custom ?
      { values: readBiffPropertyValues(new Binary(data), admit, charge) } : {}) };
  });
  const old = new Map([...snapshots].map(([name, snapshot]) => [name, parse(snapshot.bytes)]));
  const fresh = new Map([...streams].map(([name, bytes]) => [name, parse(bytes)]));
  const original = new Map<string, Property>(), pending = new Map<string, Property>();
  const identity = (property: Pick<Property, "stream" | "section" | "id">) => `${property.stream}:${property.section}:${property.id}`;
  const readContext = { ...context, limits: { ...context.limits, inputBytes: context.limits.outputBytes } };
  // Reuse scalar decoding, but do not create another retained hexadecimal copy.
  await readBiffProperties(new Map([...snapshots].map(([name, value]) => [name, value.bytes])), readContext, accountText, charge,
    undefined, property => { admit(1); original.set(identity(property), property); });
  await readBiffProperties(streams, readContext, accountText, charge, undefined, property => { admit(1); pending.set(property.key, property); });

  const dictionary = (section: Section): { id: number; bytes: Uint8Array; name: string }[] => {
    const data = section.values?.get(0); if (!data) return [];
    const cp = section.values?.get(1)?.u16(4) ?? 1252, width = cp === 1200 ? 2 : 1, count = data.u32(0);
    data.check(4, count * 9); admit(count);
    let at = 4;
    const entries = [];
    for (let i = 0; i < count; i++) {
      const start = at, id = data.u32(at), length = data.u32(at + 4); at += 8;
      if (!length) invalidBiff("empty property dictionary name");
      const bytes = data.slice(at, (length - 1) * width);
      const name = cp === 1200 || cp === 65001 ? new TextDecoder(cp === 1200 ? "utf-16le" : "utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) : biffDecode(bytes, cp);
      accountText(name); at += length * width;
      if (width === 2) at = Math.ceil(at / 4) * 4;
      entries.push({ id, name, bytes: data.slice(start, at - start) });
    }
    return entries;
  };
  const writeDictionary = (section: Section, entries: { bytes: Uint8Array }[]) => {
    const bytes = allocate(4 + entries.reduce((sum, entry) => sum + entry.bytes.length, 0));
    new DataView(bytes.buffer).setUint32(0, entries.length, true); let at = 4;
    for (const entry of entries) { charge(entry.bytes.length); bytes.set(entry.bytes, at); at += entry.bytes.length; }
    section.values!.set(0, new Binary(bytes));
  };
  const remove = (section: Section, id: number) => {
    section.values!.delete(id);
    if (section.guid === biffPropertyFormats.custom) writeDictionary(section, dictionary(section).filter(entry => entry.id !== id));
  };
  const take = (property: Property): Binary => {
    charge(fresh.get(property.stream)!.length);
    const section = fresh.get(property.stream)!.find(section => section.offset === property.section)!;
    const value = section.values!.get(property.id)!; remove(section, property.id); pending.delete(property.key); return value;
  };
  const wide = (data: Binary, section: Section): Binary => {
    if (data.u32(0) !== 30 || (section.values!.get(1)?.u16(4) ?? 1252) === 65001) return data;
    const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data.slice(8, data.u32(4) - 1));
    charge(value.length); const bytes = allocate(8 + (value.length + 1) * 2), view = new DataView(bytes.buffer);
    view.setUint32(0, 31, true); view.setUint32(4, value.length + 1, true);
    for (let i = 0; i < value.length; i++) view.setUint16(8 + i * 2, value.charCodeAt(i), true);
    return new Binary(bytes);
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
      if (!Object.hasOwn(book.properties ?? {}, key)) remove(section, id);
      else if (same(property.value, value)) { preserved.add(key); if (replacement) take(replacement); }
      else if (replacement) section.values!.set(id, wide(take(replacement), section));
    }
  }

  // Reverse the same tables as the importer; no transliteration or escape fallback.
  const encodings = new Map<number, Map<string, number[]>>();
  const encodeName = (name: string, cp: number): Uint8Array | undefined => {
    accountText(name);
    if (cp === 65001) return new TextEncoder().encode(name + "\0");
    if (cp === 1200) {
      const bytes = allocate((name.length + 1) * 2), view = new DataView(bytes.buffer);
      for (let i = 0; i < name.length; i++) view.setUint16(i * 2, name.charCodeAt(i), true);
      return bytes;
    }
    let reverse = encodings.get(cp);
    if (!reverse) {
      reverse = new Map(); encodings.set(cp, reverse);
      const dbcs = biffDbcsTables[cp], table = dbcs?.single ?? singleByteTables[cp === 1201 ? "iso-8859-1" : cp === 10000 ? "macintosh" : cp >= 1250 && cp <= 1258 ? `windows-${cp}` : `cp${cp}`];
      if (!table) return undefined;
      for (let i = 0; i < table.length; i++) { charge(1); if (table[i] !== "\uffff" && !reverse.has(table[i]!)) reverse.set(table[i]!, [i]); }
      if (dbcs) for (const [lead, row] of Object.entries(dbcs.double)) for (let trail = 0; trail < row.length; trail++) {
        charge(1); if (row[trail] !== "\uffff" && !reverse.has(row[trail]!)) reverse.set(row[trail]!, [Number(lead), trail]);
      }
    }
    const result: number[] = [];
    for (const character of name + "\0") {
      charge(1); const value = reverse.get(character); if (!value) return undefined;
      result.push(...value); if (result.length > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert BIFF property output bytes limit exceeded");
    }
    const bytes = Uint8Array.from(result); return biffDecode(bytes, cp) === name + "\0" ? bytes : undefined;
  };
  const warn = async (key: string, reason: string) => context.diagnostic?.({ code: "biff-loss-warning", severity: "warning",
    message: `Unsupported Excel BIFF document property: ${key} (${reason}; original property bytes retained)` });
  for (const property of [...pending.values()]) {
    charge(fresh.get(property.stream)!.length + (old.get(property.stream)?.length ?? 0));
    const source = fresh.get(property.stream)!.find(section => section.offset === property.section)!;
    const target = old.get(property.stream)?.find(section => section.guid === source.guid);
    if (!target) continue;
    const value = take(property), values = target.values!;
    let id = property.id;
    if (target.guid === biffPropertyFormats.custom) {
      let entries;
      try { entries = dictionary(target); }
      catch (error) { if (!(error instanceof SsconvertError) || error.code !== "unsupported-feature") throw error;
        await warn(property.key, "unknown dictionary encoding"); continue; }
      charge(entries.length + values.size);
      if (entries.some(entry => entry.name === property.key)) { await warn(property.key, "opaque name collision"); continue; }
      const cp = values.get(1)?.u16(4) ?? 1252, text = encodeName(property.key, cp);
      if (!text) { await warn(property.key, "name cannot be encoded in the original codepage"); continue; }
      id = 1; for (const key of values.keys()) id = Math.max(id, key); for (const entry of entries) id = Math.max(id, entry.id); id++;
      if (id > 0xffffffff) { await warn(property.key, "no free property ID"); continue; }
      const length = 8 + text.length, bytes = allocate(cp === 1200 ? Math.ceil(length / 4) * 4 : length), view = new DataView(bytes.buffer);
      view.setUint32(0, id, true); view.setUint32(4, text.length / (cp === 1200 ? 2 : 1), true); bytes.set(text, 8);
      writeDictionary(target, [...entries, { id, name: property.key, bytes }]);
    } else if (values.has(id)) { await warn(property.key, "opaque property ID collision"); continue; }
    values.set(id, wide(value, target));
  }

  const encodeSection = (section: Section) => {
    if (!section.values) return section.bytes;
    const entries = [...section.values], bytes = allocate(8 + entries.length * 8 + entries.reduce((sum, [, value]) => sum + Math.ceil(value.bytes.length / 4) * 4, 0));
    const view = new DataView(bytes.buffer); view.setUint32(0, bytes.length, true); view.setUint32(4, entries.length, true);
    let at = 8 + entries.length * 8;
    entries.forEach(([id, value], i) => { charge(value.bytes.length); view.setUint32(8 + i * 8, id, true); view.setUint32(12 + i * 8, at, true);
      bytes.set(value.bytes, at); at += Math.ceil(value.bytes.length / 4) * 4; });
    return bytes;
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
    const bodies = sections.map(encodeSection), bytes = allocate(28 + sections.length * 20 + bodies.reduce((sum, body) => sum + body.length, 0));
    bytes.set((snapshots.get(name)?.bytes ?? streams.get(name)!).subarray(0, 28));
    const view = new DataView(bytes.buffer); view.setUint32(24, sections.length, true); let at = 28 + sections.length * 20;
    sections.forEach((section, i) => {
      charge(1); for (let j = 0; j < 16; j++) bytes[28 + i * 20 + j] = parseInt(section.guid.slice(j * 2, j * 2 + 2), 16);
      view.setUint32(44 + i * 20, at, true); bytes.set(bodies[i]!, at); at += bodies[i]!.length;
    });
    streams.set(name, bytes);
    const snapshot = snapshots.get(name); if (snapshot) handled.add(snapshot.record);
  }
  const exposed = new Set<string>();
  await readBiffProperties(streams, readContext, accountText, charge, undefined, property => {
    admit(1); if (!Object.hasOwn(book.properties ?? {}, property.key)) exposed.add(property.key);
  });
  for (const key of exposed) await warn(key, "opaque property exposes a field absent from the model");
  return preserved;
}
