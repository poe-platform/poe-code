import { SsconvertError, type CapabilityContext, type RangeSource } from "@poe-code/spreadsheet-engine/contracts";
import type { ImportedValue, UnsupportedRecord } from "@poe-code/spreadsheet-ast";
import { invalidBiff } from "./biff-binary.js";
import { propertyRange, readPropertySectionRanges, withPropertyValueRanges } from "./biff-property-range.js";
import { readBiffPropertyText } from "./biff-property-text.js";

// OLE property-set layout and IDs: LibreOffice oleprops.cxx/.hxx at
// bce0998afefdbc355585ca324285661a2170ba77; source receipts are in the gap ledger.
export const biffPropertyFormats = { summary: "e0859ff2f94f6810ab9108002b27b3d9",
  document: "02d5cdd59c2e1b10939708002b2cf9ae", custom: "05d5cdd59c2e1b10939708002b2cf9ae" };
const { summary, document, custom } = biffPropertyFormats;
export const biffPropertyFields = new Map<string, ReadonlyMap<number, string>>([
  [summary, new Map([[2, "dc:title"], [3, "dc:subject"], [4, "meta:initial-creator"], [5, "dc:keywords"],
    [6, "dc:description"], [7, "meta:template"], [8, "dc:creator"], [9, "meta:editing-cycles"],
    [10, "meta:editing-duration"], [11, "meta:print-date"], [12, "meta:creation-date"], [13, "dc:date"],
    [14, "gsf:page-count"], [15, "gsf:word-count"], [16, "gsf:character-count"], [18, "meta:generator"], [19, "gsf:security"]])],
  [document, new Map([[2, "gsf:category"], [14, "gsf:manager"], [15, "dc:publisher"]])]
]);

// comphelper's comma-separated keywords use o3tl::trim, not ECMAScript trim.
export function isBiffKeywordSpace(code: number): boolean {
  return code > 0 && code <= 32 || code >= 0x2000 && code <= 0x200b || code === 0x2028 || code === 0x2029;
}

/** Property offsets are section-relative; dictionaries have no variant header. */
export async function readBiffProperties(streams: ReadonlyMap<string, Uint8Array | RangeSource>, context: CapabilityContext,
  accountText: (text: string) => string, accountWork: (amount: number) => void,
  retained: UnsupportedRecord[] | undefined, observe?: (property: { stream: string; section: number; id: number; key: string; value: ImportedValue }) => void): Promise<Readonly<Record<string, ImportedValue>>> {
  const properties: Record<string, ImportedValue> = Object.create(null);
  let nodes = 0;
  const admit = (count: number) => {
    accountWork(count); nodes += count;
    if (nodes > (context.limits.workbookNodes ?? context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert BIFF property node limit exceeded");
  };
  for (const target of ["\u0005SummaryInformation", "\u0005DocumentSummaryInformation"]) {
    let streamName = target, bytes = streams.get(target);
    if (!bytes) for (const [name, data] of streams) {
      accountWork(1);
      if (name.toUpperCase() === target.toUpperCase()) { streamName = name; bytes = data; break; }
    }
    if (!bytes) continue;
    const file = propertyRange(bytes, context); accountWork(file.size);
    const sections = readPropertySectionRanges(file, admit, accountWork, context);
    let unknown = false;
    const modeled: [number, number, string][] = [];
    for await (const { guid, offset, end } of sections) {
      if (!biffPropertyFields.has(guid) && guid !== custom) { unknown = true; continue; }
      await withPropertyValueRanges(file.slice(offset, end - offset), admit, accountWork, context, async values => {
        const cp = await values.get(1); let codepage = 1252;
        if (cp) { if ((await cp.u32(0)) !== 2) invalidBiff("invalid property codepage type"); codepage = await cp.u16(4); }
        const names = new Map<number, string>(), dictionary = await values.get(0);
        try {
          if (dictionary && guid === custom) {
            const length = await dictionary.u32(0); dictionary.check(4, length * 9); admit(length);
            let at = 4;
            for (let i = 0; i < length; i++) {
              const id = await dictionary.u32(at), entry = await readBiffPropertyText(dictionary, at + 4, codepage, context, accountText, accountWork);
              if (id < 2 || names.has(id) || !entry.value) invalidBiff("invalid property dictionary entry");
              names.set(id, entry.value); at = entry.end;
            }
          }
        } catch (error) {
          if (!(error instanceof SsconvertError) || error.code !== "unsupported-feature") throw error;
          unknown = true; return;
        }
        for await (const [id, data] of values.entries()) {
          context.signal.throwIfAborted(); if (id < 2) continue;
          const key = guid === custom ? names.get(id) : biffPropertyFields.get(guid)?.get(id);
          if (key === undefined || Object.hasOwn(properties, key)) { unknown = true; continue; }
          let value: ImportedValue | undefined;
          const type = await data.u32(0);
          try {
            if (type === 30 || type === 31) value = (await readBiffPropertyText(data, 4, type === 31 ? 1200 : codepage, context, accountText, accountWork)).value;
            else if (type === 3) value = (await data.u32(4)) | 0;
            else if (type === 5) { value = await data.f64(4); if (!Number.isFinite(value)) invalidBiff("nonfinite property value"); }
            else if (type === 11) value = (await data.u16(4)) !== 0;
            else if (type === 64) {
              const ticks = BigInt(await data.u32(4)) + (BigInt(await data.u32(8)) << 32n);
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
              const days = await data.f64(4);
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
          if (guid === summary && id === 5 && typeof value === "string") {
            let count = 1; for (const character of value) if (character === ",") count++;
            admit(count); accountWork(value.length);
            value = value.split(",").map(keyword => {
              let start = 0, end = keyword.length;
              while (start < end && isBiffKeywordSpace(keyword.charCodeAt(start))) start++;
              while (end > start && isBiffKeywordSpace(keyword.charCodeAt(end - 1))) end--;
              return keyword.slice(start, end);
            }).filter(Boolean);
          }
          accountText(key); properties[key] = value; modeled.push([offset, id, key]);
          observe?.({ stream: streamName, section: offset, id, key, value });
        }
      });
    }
    if (unknown && retained) {
      if (file.size * 2 > (context.limits.workbookTextBytes ?? context.limits.inputBytes * 2))
        throw new SsconvertError("resource-limit", "ssconvert BIFF property retention limit exceeded");
      let encoded = "";
      for (let at = 0; at < file.size;) {
        const chunk = await file.read(at, Math.min(16384, file.size - at));
        encoded += Array.from(chunk, byte => byte.toString(16).padStart(2, "0")).join(""); at += chunk.length;
      }
      const hex = accountText(encoded);
      retained.push({ source: "biff", kind: "ole-properties", disposition: "retained", data: { stream: streamName, bytes: hex, modeled } });
      await context.diagnostic?.({ code: "biff-loss-warning", severity: "warning", message: `BIFF property stream ${streamName.slice(1)} retained with uninterpreted values` });
    }
  }
  return properties;
}
