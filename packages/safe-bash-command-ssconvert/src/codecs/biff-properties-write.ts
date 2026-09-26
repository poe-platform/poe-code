import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { ImportedValue, UnsupportedRecord, Workbook } from "../workbook.js";
import { biffPropertyFields, biffPropertyFormats, isBiffKeywordSpace } from "./biff-properties.js";
import { mergeBiffProperties } from "./biff-properties-merge.js";

const fieldByName = new Map([...biffPropertyFields].flatMap(([guid, fields]) => [...fields].map(([id, name]) => [name, { guid, id }] as const)));
const maximumFileTime = 0xffffffffffffffffn;

/** Only discard a generic loss report when every XML field has been handled.
 * Keep the original record on the caller's workbook, including unknown content. */
function handledPropertyRecord(record: UnsupportedRecord, keys: ReadonlySet<string>, charge: (amount: number) => void): boolean {
  if (record.disposition !== "retained" || record.source !== "Gnumeric_XmlIO:sax" || record.kind !== "document-meta") return false;
  const office = "urn:oasis:names:tc:opendocument:xmlns:office:1.0", meta = "urn:oasis:names:tc:opendocument:xmlns:meta:1.0";
  type Node = { name: string; namespace: string; text: string; attributes: ImportedValue[]; children: ImportedValue[] };
  const node = (value: ImportedValue | undefined): Node | undefined => {
    charge(1);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const data = value as Readonly<Record<string, ImportedValue>>;
    for (const key in data) if (Object.hasOwn(data, key)) { charge(1); if (!["name", "namespace", "text", "attributes", "children"].includes(key)) return undefined; }
    if (typeof data.name !== "string" || typeof data.namespace !== "string" || typeof data.text !== "string" ||
      !Array.isArray(data.attributes) || !Array.isArray(data.children)) return undefined;
    charge(data.name.length + data.namespace.length + data.text.length + data.attributes.length + data.children.length);
    return data as Node;
  };
  const attributes = (n: Node, namespace: string, allowed: readonly string[]): Map<string, string> | undefined => {
    const result = new Map<string, string>();
    for (const value of n.attributes) {
      charge(1);
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
      const attr = value as Readonly<Record<string, ImportedValue>>;
      for (const key in attr) if (Object.hasOwn(attr, key)) { charge(1); if (!["name", "namespace", "value"].includes(key)) return undefined; }
      if (typeof attr.name !== "string" || attr.namespace !== namespace || typeof attr.value !== "string" ||
        !allowed.includes(attr.name) || result.has(attr.name)) return undefined;
      charge(attr.name.length + namespace.length + attr.value.length); result.set(attr.name, attr.value);
    }
    return result;
  };
  const whitespace = (text: string) => { for (const char of text) if (![" ", "\t", "\r", "\n"].includes(char)) return false; return true; };
  const root = node(record.data);
  if (!root || root.name !== "document-meta" || root.namespace !== office || !whitespace(root.text) || root.children.length !== 1) return false;
  const rootAttrs = attributes(root, office, ["version"]);
  if (!rootAttrs || rootAttrs.has("version") && !["1.0", "1.1", "1.2", "1.3"].includes(rootAttrs.get("version")!)) return false;
  const content = node(root.children[0]);
  if (!content || content.name !== "meta" || content.namespace !== office || !whitespace(content.text) || content.attributes.length) return false;
  const seen = new Map<string, boolean>();
  for (const value of content.children) {
    const field = node(value); if (!field || field.children.length) return false;
    let key: string | undefined;
    if (field.namespace === meta && field.name === "user-defined") {
      const attrs = attributes(field, meta, ["name", "value-type", "type"]);
      if (!attrs?.has("name") || attrs.has("type") && attrs.has("value-type")) return false;
      const type = attrs.get("value-type") ?? attrs.get("type") ?? "string";
      if (!["string", "float", "boolean"].includes(type) || type === "boolean" && !["true", "false"].includes(field.text) ||
        type === "float" && (!field.text.trim() || !Number.isFinite(Number(field.text)))) return false;
      key = attrs.get("name");
    } else {
      if (field.attributes.length) return false;
      key = field.namespace === meta ? field.name === "keyword" ? "dc:keywords" : "meta:" + field.name :
        field.namespace === "http://purl.org/dc/elements/1.1/" ? "dc:" + field.name : undefined;
      if (key === undefined || !fieldByName.has(key)) return false;
    }
    const keyword = field.namespace === meta && field.name === "keyword";
    if (key === undefined || !keys.has(key) || seen.has(key) && !(keyword && seen.get(key))) return false;
    seen.set(key, keyword);
  }
  return true;
}

function durationTicks(text: string): bigint | undefined {
  if (!text.startsWith("P")) return undefined;
  let at = 1, time = false, previous = -1, total = 0n;
  while (at < text.length) {
    if (text[at] === "T" && !time) { time = true; at++; if (at === text.length) return undefined; }
    let whole = 0n, digits = 0, fraction = 0n, decimal = false, fractionDigits = 0;
    while (at < text.length) {
      const code = text.charCodeAt(at) - 48;
      if (code >= 0 && code <= 9) {
        if (decimal) {
          if (fractionDigits < 7) fraction = fraction * 10n + BigInt(code);
          else if (code) return undefined;
          fractionDigits++;
        } else { whole = whole * 10n + BigInt(code); digits++; if (whole > maximumFileTime) return undefined; }
        at++;
      } else if (text[at] === "." && !decimal) { decimal = true; at++; }
      else break;
    }
    const unit = text[at++], rank = unit === "D" && !time ? 0 : time ? ["H", "M", "S"].indexOf(unit ?? "") + 1 : -1;
    if (!digits || rank <= previous || rank < 0 || time && rank === 0 || decimal && (unit !== "S" || !fractionDigits)) return undefined;
    previous = rank;
    const scales = [864000000000n, 36000000000n, 600000000n, 10000000n];
    total += whole * scales[rank]! + fraction * 10n ** BigInt(Math.max(0, 7 - fractionDigits));
    if (total > maximumFileTime) return undefined;
  }
  return previous < 0 ? undefined : total;
}

/** Matches oleprops.cxx's UTF-8 codepage, untyped dictionary and aligned values. */
export async function writeBiffProperties(book: Workbook, context: CapabilityContext): Promise<{
  streams: ReadonlyMap<string, Uint8Array>; handledMetadata: ReadonlySet<UnsupportedRecord>;
}> {
  const streams = new Map<string, Uint8Array>(), sections = new Map<string, Map<number, Uint8Array>>();
  const handledKeys = new Set<string>();
  const unsupportedKeys: string[] = [];
  let work = 0, textBytes = 0, nodes = 0, payloadBytes = 0;
  const charge = (amount: number) => {
    context.signal.throwIfAborted(); work += amount;
    if (work > (context.limits.workbookWork ?? context.limits.outputBytes * 8))
      throw new SsconvertError("resource-limit", "ssconvert BIFF property work limit exceeded");
  };
  const allocate = (length: number): Uint8Array => {
    charge(length);
    if (length > 0xffffffff || length > context.limits.outputBytes)
      throw new SsconvertError("resource-limit", "ssconvert BIFF property output bytes limit exceeded");
    return new Uint8Array(length);
  };
  const string = (value: string): Uint8Array => {
    let size = 0;
    for (let at = 0; at < value.length; at++) {
      charge(1); const point = value.codePointAt(at)!;
      if (point >= 0xd800 && point <= 0xdfff) throw new SsconvertError("unsupported-feature", "Excel BIFF property text contains an unpaired surrogate");
      size += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
      if (point >= 0x10000) at++;
    }
    textBytes += size;
    if (textBytes > (context.limits.workbookTextBytes ?? context.limits.outputBytes))
      throw new SsconvertError("resource-limit", "ssconvert BIFF property text limit exceeded");
    const bytes = allocate(5 + size); new DataView(bytes.buffer).setUint32(0, size + 1, true);
    new TextEncoder().encodeInto(value, bytes.subarray(4, 4 + size)); return bytes;
  };
  const typed = (value: ImportedValue, key: string): Uint8Array | undefined => {
    const timestamp = ["meta:creation-date", "meta:print-date", "dc:date"].includes(key);
    if (timestamp || key === "meta:editing-duration") {
      if (typeof value !== "string") return undefined;
      charge(value.length);
      let ticks: bigint | undefined;
      if (timestamp) {
        const zone = value.slice(-6), zoned = value.endsWith("Z") || (zone[0] === "+" || zone[0] === "-") && zone[3] === ":";
        const milliseconds = zoned ? Date.parse(value) + 11644473600000 : NaN;
        if (Number.isSafeInteger(milliseconds) && milliseconds >= 0) {
          ticks = BigInt(milliseconds) * 10000n;
          const dot = value.indexOf(".", value.indexOf("T"));
          if (dot >= 0) {
            let at = dot + 1; while (at < value.length && value[at]! >= "0" && value[at]! <= "9") at++;
            const fraction = value.slice(dot + 1, at);
            if ([...fraction.slice(7)].some(digit => digit !== "0")) return undefined;
            ticks += BigInt(fraction.slice(3, 7).padEnd(4, "0"));
          }
        }
      } else ticks = durationTicks(value);
      if (ticks === undefined || ticks > maximumFileTime) return undefined;
      const bytes = allocate(12), view = new DataView(bytes.buffer);
      view.setUint32(0, 64, true); view.setBigUint64(4, ticks, true); return bytes;
    }
    const field = fieldByName.get(key);
    if (field) {
      if (field.guid === biffPropertyFormats.summary && [14, 15, 16, 19].includes(field.id)) {
        if (typeof value !== "number" || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) return undefined;
        if (Object.is(value, -0)) value = 0;
      } else {
        if (typeof value === "number" && Number.isFinite(value)) value = String(value);
        if (typeof value !== "string") return undefined;
      }
    }
    if (typeof value === "string") {
      const text = string(value), bytes = allocate(4 + text.length);
      new DataView(bytes.buffer).setUint32(0, 30, true); bytes.set(text, 4); return bytes;
    }
    if (typeof value === "boolean") {
      const bytes = allocate(8), view = new DataView(bytes.buffer);
      view.setUint32(0, 11, true); view.setUint16(4, value ? 0xffff : 0, true); return bytes;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const integer = Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 && !Object.is(value, -0);
      const bytes = allocate(integer ? 8 : 12), view = new DataView(bytes.buffer);
      view.setUint32(0, integer ? 3 : 5, true);
      if (integer) view.setInt32(4, value, true); else view.setFloat64(4, value, true);
      return bytes;
    }
    return undefined;
  };
  const names: { id: number; bytes: Uint8Array }[] = [];
  for (const key in book.properties) if (Object.hasOwn(book.properties, key)) {
    charge(1); if (++nodes > (context.limits.workbookNodes ?? context.limits.outputBytes))
      throw new SsconvertError("resource-limit", "ssconvert BIFF property node limit exceeded");
    const field = fieldByName.get(key);
    handledKeys.add(key);
    let source = book.properties[key]!;
    if (key === "dc:keywords" && Array.isArray(source)) {
      charge(source.length);
      nodes += source.length;
      if (nodes > (context.limits.workbookNodes ?? context.limits.outputBytes))
        throw new SsconvertError("resource-limit", "ssconvert BIFF property node limit exceeded");
      let valid = true, units = Math.max(0, source.length - 1) * 2;
      for (const value of source) {
        if (typeof value !== "string" || value.includes(",") || !value.length ||
          isBiffKeywordSpace(value.charCodeAt(0)) || isBiffKeywordSpace(value.charCodeAt(value.length - 1))) { valid = false; break; }
        units += value.length;
        if (units > (context.limits.workbookTextBytes ?? context.limits.outputBytes) - textBytes)
          throw new SsconvertError("resource-limit", "ssconvert BIFF property text limit exceeded");
      }
      if (valid) source = source.join(", ");
    }
    const value = key ? typed(source, key) : undefined;
    if (!value) { unsupportedKeys.push(key); continue; }
    const guid = field?.guid ?? biffPropertyFormats.custom, id = field?.id ?? names.length + 2;
    let nameBytes = 0;
    if (!field) { const bytes = string(key); nameBytes = bytes.length; names.push({ id, bytes }); }
    payloadBytes += value.length + nameBytes;
    if (payloadBytes > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert BIFF property output bytes limit exceeded");
    const properties = sections.get(guid) ?? new Map<number, Uint8Array>(); properties.set(id, value); sections.set(guid, properties);
  }
  const handledMetadata = new Set<UnsupportedRecord>();
  for (const record of book.unsupportedRecords ?? []) {
    charge(1); if (handledPropertyRecord(record, handledKeys, charge)) handledMetadata.add(record);
  }
  if (names.length) {
    const dictionary = allocate(4 + names.reduce((size, name) => size + 4 + name.bytes.length, 0)), view = new DataView(dictionary.buffer);
    view.setUint32(0, names.length, true); let at = 4;
    for (const name of names) { charge(1); view.setUint32(at, name.id, true); dictionary.set(name.bytes, at + 4); at += 4 + name.bytes.length; }
    sections.get(biffPropertyFormats.custom)!.set(0, dictionary);
    if (!sections.has(biffPropertyFormats.document)) sections.set(biffPropertyFormats.document, new Map());
  }
  const encoded = new Map<string, Uint8Array>();
  for (const [guid, properties] of sections) {
    const codepage = allocate(8), cp = new DataView(codepage.buffer); cp.setUint32(0, 2, true); cp.setUint16(4, 65001, true);
    properties.set(1, codepage);
    const entries = [...properties].sort(([a], [b]) => a - b); charge(entries.length * Math.ceil(Math.log2(entries.length + 1)));
    const size = 8 + entries.length * 8 + entries.reduce((size, [, value]) => size + Math.ceil(value.length / 4) * 4, 0);
    const bytes = allocate(size), view = new DataView(bytes.buffer); view.setUint32(0, size, true); view.setUint32(4, entries.length, true);
    let at = 8 + entries.length * 8;
    for (let i = 0; i < entries.length; i++) {
      charge(1); const [id, value] = entries[i]!; view.setUint32(8 + i * 8, id, true); view.setUint32(12 + i * 8, at, true);
      bytes.set(value, at); at += Math.ceil(value.length / 4) * 4;
    }
    encoded.set(guid, bytes);
  }
  for (const [name, formats] of [["\u0005SummaryInformation", [biffPropertyFormats.summary]],
    ["\u0005DocumentSummaryInformation", [biffPropertyFormats.document, biffPropertyFormats.custom]]] as const) {
    const present = formats.filter(guid => encoded.has(guid)); if (!present.length) continue;
    const bytes = allocate(28 + present.length * 20 + present.reduce((size, guid) => size + encoded.get(guid)!.length, 0)), view = new DataView(bytes.buffer);
    view.setUint16(0, 0xfffe, true); view.setUint32(4, 0x20001, true); view.setUint32(24, present.length, true);
    let at = 28 + present.length * 20;
    for (let i = 0; i < present.length; i++) {
      charge(1); const guid = present[i]!, section = encoded.get(guid)!;
      for (let j = 0; j < 16; j++) bytes[28 + i * 20 + j] = parseInt(guid.slice(j * 2, j * 2 + 2), 16);
      view.setUint32(44 + i * 20, at, true); bytes.set(section, at); at += section.length;
    }
    streams.set(name, bytes);
  }
  const preserved = await mergeBiffProperties(book, streams, handledMetadata, context, charge, allocate);
  for (const key of unsupportedKeys) if (!preserved.has(key))
    await context.diagnostic?.({ code: "biff-loss-warning", severity: "warning", message: `Unsupported Excel BIFF document property: ${key}` });
  return { streams, handledMetadata };
}
