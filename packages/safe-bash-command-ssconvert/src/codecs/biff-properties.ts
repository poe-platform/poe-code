import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { ImportedValue, UnsupportedRecord } from "../workbook.js";
import { Binary, invalidBiff } from "./biff-binary.js";
import { biffDecode } from "./biff-strings.js";

// OLE property-set layout and IDs: LibreOffice oleprops.cxx/.hxx at
// bce0998afefdbc355585ca324285661a2170ba77; source receipts are in the gap ledger.
const summary = "e0859ff2f94f6810ab9108002b27b3d9";
const document = "02d5cdd59c2e1b10939708002b2cf9ae";
const custom = "05d5cdd59c2e1b10939708002b2cf9ae";
const fields = new Map<string, ReadonlyMap<number, string>>([
  [summary, new Map([[2, "dc:title"], [3, "dc:subject"], [4, "meta:initial-creator"], [5, "dc:keywords"],
    [6, "dc:description"], [7, "meta:template"], [8, "dc:creator"], [9, "meta:editing-cycles"],
    [10, "meta:editing-duration"], [11, "meta:print-date"], [12, "meta:creation-date"], [13, "dc:date"],
    [14, "gsf:page-count"], [15, "gsf:word-count"], [16, "gsf:character-count"], [18, "meta:generator"], [19, "gsf:security"]])],
  [document, new Map([[2, "gsf:category"], [14, "gsf:manager"], [15, "dc:publisher"]])]
]);

/** Property offsets are section-relative; dictionaries have no variant header. */
export async function readBiffProperties(streams: ReadonlyMap<string, Uint8Array>, context: CapabilityContext,
  accountText: (text: string) => string, accountWork: (amount: number) => void,
  retained: UnsupportedRecord[]): Promise<Readonly<Record<string, ImportedValue>>> {
  const properties: Record<string, ImportedValue> = Object.create(null);
  let nodes = 0;
  const admit = (count: number) => {
    accountWork(count); nodes += count;
    if (nodes > (context.limits.workbookNodes ?? context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert BIFF property node limit exceeded");
  };
  const text = (data: Binary, offset: number, codepage: number): { value: string; end: number } => {
    const count = data.u32(offset), width = codepage === 1200 ? 2 : 1, size = count * width;
    if (!count) invalidBiff("empty property string buffer");
    data.check(offset + 4, size);
    // Admit the maximum UTF-8 expansion before allocating a decoded string.
    if ((count - 1) * 3 > (context.limits.workbookTextBytes ?? context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert BIFF property text limit exceeded");
    accountWork(size);
    const end = offset + 4 + size;
    for (let i = end - width; i < end; i++) if (data.u8(i)) invalidBiff("unterminated property string");
    const bytes = data.slice(offset + 4, size - width);
    let value: string;
    if (codepage === 1200 || codepage === 65001) {
      try { value = new TextDecoder(codepage === 1200 ? "utf-16le" : "utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { invalidBiff("invalid property string encoding"); }
    } else value = biffDecode(bytes, codepage);
    return { value: accountText(value), end: width === 2 ? Math.ceil(end / 4) * 4 : end };
  };
  for (const target of ["\u0005SummaryInformation", "\u0005DocumentSummaryInformation"]) {
    let streamName = target, bytes = streams.get(target);
    if (!bytes) for (const [name, data] of streams) {
      accountWork(1);
      if (name.toUpperCase() === target.toUpperCase()) { streamName = name; bytes = data; break; }
    }
    if (!bytes) continue;
    accountWork(bytes.length);
    const file = new Binary(bytes); file.check(0, 28);
    if (file.u16(0) !== 0xfffe || file.u16(2) > 1) invalidBiff("invalid property-set header");
    const count = file.u32(24), tableEnd = 28 + count * 20;
    file.check(28, count * 20); admit(count);
    let unknown = false;
    const sections: { guid: string; offset: number; end: number }[] = [];
    for (let i = 0; i < count; i++) {
      const at = 28 + i * 20, offset = file.u32(at + 16);
      if (offset < tableEnd || offset % 4) invalidBiff("invalid property section offset");
      const size = file.u32(offset); if (size < 8 || size % 4) invalidBiff("invalid property section size");
      file.check(offset, size);
      const guid = Array.from(file.slice(at, 16), byte => byte.toString(16).padStart(2, "0")).join("");
      sections.push({ guid, offset, end: offset + size });
    }
    accountWork(count * Math.ceil(Math.log2(count + 1)));
    sections.sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < sections.length; i++) if (sections[i]!.offset < sections[i - 1]!.end) invalidBiff("overlapping property sections");
    for (const { guid, offset, end } of sections) {
      if (!fields.has(guid) && guid !== custom) { unknown = true; continue; }
      const section = new Binary(file.slice(offset, end - offset)), propertyCount = section.u32(4);
      section.check(8, propertyCount * 8); admit(propertyCount);
      const pointers: { id: number; at: number }[] = [], ids = new Set<number>();
      for (let i = 0; i < propertyCount; i++) {
        const id = section.u32(8 + i * 8), at = section.u32(12 + i * 8);
        if (at < 8 + propertyCount * 8 || at % 4 || at > section.bytes.length - 4) invalidBiff("invalid property offset");
        if (ids.has(id)) invalidBiff("duplicate property ID");
        ids.add(id); pointers.push({ id, at });
      }
      accountWork(propertyCount * Math.ceil(Math.log2(propertyCount + 1)));
      pointers.sort((a, b) => a.at - b.at);
      const values = new Map<number, Binary>();
      for (let i = 0; i < pointers.length; i++) {
        const { id, at } = pointers[i]!, next = pointers[i + 1]?.at ?? section.bytes.length;
        if (next === at) invalidBiff("overlapping property values");
        values.set(id, new Binary(section.slice(at, next - at)));
      }
      const cp = values.get(1); let codepage = 1252;
      if (cp) { if (cp.u32(0) !== 2) invalidBiff("invalid property codepage type"); codepage = cp.u16(4); }
      const names = new Map<number, string>(), dictionary = values.get(0);
      try {
        if (dictionary && guid === custom) {
          const length = dictionary.u32(0); dictionary.check(4, length * 9); admit(length);
          let at = 4;
          for (let i = 0; i < length; i++) {
            const id = dictionary.u32(at), entry = text(dictionary, at + 4, codepage);
            if (id < 2 || names.has(id) || !entry.value) invalidBiff("invalid property dictionary entry");
            names.set(id, entry.value); at = entry.end;
          }
        }
      } catch (error) {
        if (!(error instanceof SsconvertError) || error.code !== "unsupported-feature") throw error;
        unknown = true; continue;
      }
      for (const [id, data] of values) {
        context.signal.throwIfAborted(); if (id < 2) continue;
        const key = guid === custom ? names.get(id) : fields.get(guid)?.get(id);
        if (key === undefined || Object.hasOwn(properties, key)) { unknown = true; continue; }
        let value: ImportedValue | undefined;
        const type = data.u32(0);
        try {
          if (type === 30 || type === 31) value = text(data, 4, type === 31 ? 1200 : codepage).value;
          else if (type === 3) value = data.u32(4) | 0;
          else if (type === 5) { value = data.f64(4); if (!Number.isFinite(value)) invalidBiff("nonfinite property value"); }
          else if (type === 11) { const raw = data.u16(4); if (raw !== 0 && raw !== 0xffff) invalidBiff("invalid property boolean"); value = raw !== 0; }
          else if (type === 64) {
            const ticks = BigInt(data.u32(4)) + (BigInt(data.u32(8)) << 32n);
            if (guid === summary && id === 10) {
              const fraction = (ticks % 10000000n).toString().padStart(7, "0");
              let end = fraction.length; while (end && fraction[end - 1] === "0") end--;
              value = `PT${ticks / 600000000n}M${ticks / 10000000n % 60n}${end ? "." + fraction.slice(0, end) : ""}S`;
            } else {
              value = new Date(Number(ticks / 10000n) - 11644473600000).toISOString();
              // The workbook model stores timestamps as strings; retain the
              // original property bytes when Date's millisecond precision loses ticks.
              if (ticks % 10000n) unknown = true;
            }
            accountText(value);
          } else if (type === 7) {
            const days = data.f64(4);
            if (!Number.isFinite(days) || days <= -657435 || days >= 2958466) invalidBiff("invalid OLE property date");
            // OLE Automation uses 1899-12-30 and the absolute fractional day.
            // LibreOffice's oleprops DATE path truncates it and uses 1899-12-31;
            // the documented Automation representation governs the stored value.
            value = new Date(-2209161600000 + Math.round((Math.trunc(days) + Math.abs(days % 1)) * 86400000)).toISOString();
            accountText(value);
          }
        } catch (error) {
          if (!(error instanceof SsconvertError) || error.code !== "unsupported-feature") throw error;
        }
        if (value === undefined) { unknown = true; continue; }
        accountText(key); properties[key] = value;
      }
    }
    if (unknown) {
      if (bytes.length * 2 > (context.limits.workbookTextBytes ?? context.limits.inputBytes * 2))
        throw new SsconvertError("resource-limit", "ssconvert BIFF property retention limit exceeded");
      const hex = accountText(Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""));
      retained.push({ source: "biff", kind: "ole-properties", disposition: "retained", data: { stream: streamName, bytes: hex } });
      await context.diagnostic?.({ code: "biff-loss-warning", severity: "warning", message: `BIFF property stream ${streamName.slice(1)} retained with uninterpreted values` });
    }
  }
  return properties;
}
