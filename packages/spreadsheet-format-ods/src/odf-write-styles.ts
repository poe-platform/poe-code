import { ZipDirectoryIndex, ZipWriteChain } from "@poe-code/office-package";
import { encodeTextStream } from "@poe-code/spreadsheet-engine/encoding/encode-stream";
import type { Cell, ImportedValue, Workbook } from "@poe-code/spreadsheet-ast";
import type { CapabilityContext, WorkingStorage } from "@poe-code/spreadsheet-engine/contracts";
import { SsconvertError } from "@poe-code/spreadsheet-engine/contracts";
import { parseFormatSections } from "@poe-code/spreadsheet-engine/formatting/sections";
import { scanFormat } from "@poe-code/spreadsheet-engine/formatting/numeric";
import { createOdfXml, odfObject, odfAttributes, odfChildren, odfNamespaces } from "@poe-code/spreadsheet-engine/codecs/odf-write-support";

export async function createOdfStyles(xml: ReturnType<typeof createOdfXml>, extended: boolean, book: Workbook, context: CapabilityContext,
  storage?: WorkingStorage, admitContentBytes?: (bytes: number) => void) {
  const e = xml.element, styles: string[] = [];
  const keys = storage ? new ZipDirectoryIndex(storage, { maximumKeyLength: Infinity, signal: context.signal }) : new Map<string, number>();
  const reservedNames = storage ? new ZipDirectoryIndex(storage, { maximumKeyLength: Infinity, signal: context.signal }) : new Map<string, number>();
  const tape = storage ? new ZipWriteChain(storage, 16384, context.signal, async signal => { signal.throwIfAborted(); }) : undefined;
  const buffer = tape ? new Uint8Array(16384) : undefined;
  let used = 0, total = 0, nextName = 0;
  function dispose() { buffer?.fill(0); }
  context.own(dispose);
  async function append(...fragments: string[]): Promise<void> {
    if (!tape) { styles.push(...fragments); return; }
    async function* content() { yield* fragments; }
    for await (const bytes of encodeTextStream(content(), "UTF-8", false, context)) {
      if (bytes.length > context.limits.outputBytes - total)
        throw new SsconvertError("resource-limit", "ssconvert OpenDocument output bytes limit exceeded");
      admitContentBytes?.(bytes.length); total += bytes.length;
      for (let offset = 0; offset < bytes.length;) {
        const take = Math.min(buffer!.length - used, bytes.length - offset);
        buffer!.set(bytes.subarray(offset, offset + take), used); used += take; offset += take;
        if (used === buffer!.length) { await tape.append([buffer!], used); used = 0; }
      }
    }
  }
  async function* render(): AsyncGenerator<string | Uint8Array> {
    if (!tape) { yield* styles; return; }
    if (used) { await tape.append([buffer!.subarray(0, used)], used); used = 0; }
    buffer!.fill(0);
    yield* tape.read();
  }
  function admitMetadata(value: ImportedValue | undefined, active = new Set<object>(), depth = 0) {
    xml.charge(typeof value === "string" ? value.length : 1);
    if (value === null || typeof value !== "object") return;
    if (active.has(value)) throw new SsconvertError("invalid-request", "Invalid cyclic OpenDocument style metadata");
    if (depth > (context.limits.xmlDepth ?? Infinity)) throw new SsconvertError("resource-limit", "ssconvert OpenDocument style metadata depth limit exceeded");
    active.add(value);
    try {
      if (Array.isArray(value)) for (const child of value) admitMetadata(child, active, depth + 1);
      else for (const [key, child] of Object.entries(value)) { xml.charge(key.length); admitMetadata(child, active, depth + 1); }
    } finally { active.delete(value); }
  }
  async function reserveNames(value: ImportedValue | undefined) {
    xml.charge(); const name = odfAttributes(value, odfNamespaces.style).name;
    if (name) await reservedNames.set(name, 0);
    for (const child of odfChildren(value)) await reserveNames(child);
  }
  for (const record of book.unsupportedRecords ?? []) if (["styles", "automatic-styles"].includes(record.kind)) {
    const node = odfObject(record.data)?.xml; admitMetadata(node); await reserveNames(node);
  }
  async function reserve(cell: Pick<Cell, "style">) {
    const node = cell.style?.odf;
    if (node) { admitMetadata(node); await reserveNames(node); }
  }
  for (const sheet of book.sheets) for (const cell of sheet.cells) await reserve(cell);
  function color(value: string | undefined) {
    if (!value) return undefined;
    const parts = value.split(":");
    if (parts.length !== 3 || parts.some(c => !c || [...c].some(d => !"0123456789abcdefABCDEF".includes(d))))
      throw new SsconvertError("invalid-request", "Invalid OpenDocument style color");
    return "#" + parts.map(c => Math.round(parseInt(c, 16) / 257).toString(16).padStart(2, "0")).join("");
  }
  function numberStyle(format: string, name: string): { xml: string; kind: "date" | "time" | "float" | "string" } {
    const host = { book, context, tick: xml.charge };
    const sections = parseFormatSections(format, host);
    if (sections.length !== 1) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: multi-section ODF number format");
    const tokens = scanFormat(sections[0]!.pattern, host), raw = tokens.filter(t => !t.literal).map(t => t.text).join("").toLowerCase();
    if (format === "General") return { xml: "", kind: "float" };
    const kind = raw.includes("y") || raw.includes("d") ? "date" : raw.includes("h") || raw.includes("s") ? "time" : raw.includes("@") ? "string" : "float";
    let body = "";
    if (kind === "date" || kind === "time") {
      let elapsed = false;
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]!, c = t.text.toLowerCase();
        if (t.literal) { body += e("number:text", {}, xml.escape(t.text)); continue; }
        if (c === "[" && tokens[i+2]?.text === "]") { elapsed = true; i++; }
        const token = tokens[i]!, field = token.text.toLowerCase();
        if (field === "]") continue;
        let n = 1; while (tokens[i+1]?.text.toLowerCase() === field && !tokens[i+1]?.literal) { i++; n++; }
        const minute = field === "m" && (kind === "time" || tokens.slice(0,i).some(t => !t.literal && t.text.toLowerCase() === "h") && tokens.slice(i+1).some(t => !t.literal && t.text.toLowerCase() === "s"));
        const tag = field === "y" ? "year" : field === "d" ? n > 2 ? "day-of-week" : "day" : field === "m" ? minute ? "minutes" : "month" : field === "h" ? "hours" : field === "s" ? "seconds" : undefined;
        if (tag) body += e("number:" + tag, { "number:style": n > 1 ? "long" : "short", "number:textual": field === "m" && !minute && n > 2 ? "true" : undefined });
        else body += e("number:text", {}, xml.escape(token.text.repeat(n)));
      }
      return { kind, xml: e("number:" + kind + "-style", { "style:name": name, "number:truncate-on-overflow": elapsed ? "false" : undefined }, body) };
    }
    if (kind === "string") return { kind, xml: e("number:text-style", { "style:name": name }, e("number:text-content")) };
    const digit = (i: number) => tokens[i] && !tokens[i]!.literal && "0#".includes(tokens[i]!.text);
    const first = tokens.findIndex((t,i) => digit(i)), dot = tokens.findIndex(t => !t.literal && t.text === ".");
    let last = -1; for (let i = 0; i < tokens.length; i++) if (digit(i)) last = i;
    if (first < 0 || raw.includes("?") || raw.includes("e") || raw.includes("/"))
      throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: ODF numeric format " + format);
    const decimals = dot < 0 ? 0 : tokens.slice(dot+1,last+1).filter(t => !t.literal && "0#".includes(t.text)).length;
    const min = tokens.slice(first,dot < 0 ? last+1 : dot).filter(t => !t.literal && t.text === "0").length;
    body = tokens.slice(0,first).map(t => e("number:text", {}, xml.escape(t.text))).join("") +
      e("number:number", { "number:decimal-places": decimals, "number:min-integer-digits": min, "number:grouping": raw.includes(",") ? "true" : "false" }) +
      tokens.slice(last+1).map(t => e("number:text", {}, xml.escape(t.text))).join("");
    return { kind, xml: e(raw.includes("%") ? "number:percentage-style" : "number:number-style", { "style:name": name }, body) };
  }
  async function register(cell: Pick<Cell, "style" | "format">): Promise<{ name?: string | undefined; kind: "date" | "time" | "float" | "string" }> {
    xml.charge();
    const original = odfObject(cell.style?.odf), node = cell.style?.gnumeric, a = odfAttributes(node);
    const format = cell.format ?? a.Format ?? "General";
    if (original) return { name: odfAttributes(original, odfNamespaces.style).name, kind: format.toLowerCase().includes("y") || format.toLowerCase().includes("d") ? "date" : format.toLowerCase().includes("h") ? "time" : "float" };
    if (!node && format === "General") return { kind: "float" };
    admitMetadata(node); xml.charge(format.length);
    const key = JSON.stringify([node,format]); xml.charge(key.length);
    const existing = await keys.get(key);
    let index = existing ?? nextName, name = "ce" + index;
    if (existing === undefined) {
      while (await reservedNames.get(name) !== undefined || await reservedNames.get("N" + name) !== undefined) { xml.charge(); name = "ce" + ++index; }
      nextName = index + 1;
      await reservedNames.set(name, 0); await reservedNames.set("N" + name, 0);
    }
    const number = numberStyle(format, "N" + name);
    if (existing !== undefined) return { name, kind: number.kind };
    await keys.set(key, index);
    const p: Record<string,string|number|undefined> = {}, text: Record<string,string|number|undefined> = {}, paragraph: Record<string,string|number|undefined> = {};
    p["fo:background-color"] = Number(a.Shade ?? 0) ? color(a.Back) : undefined;
    if (extended && a.Shade !== undefined) { p["gnm:pattern"] = a.Shade; p["gnm:background-colour"] = color(a.Back); p["gnm:pattern-colour"] = color(a.PatternColor); }
    if (a.WrapText !== undefined) p["fo:wrap-option"] = Number(a.WrapText) ? "wrap" : "no-wrap";
    if (a.ShrinkToFit !== undefined) p["style:shrink-to-fit"] = String(Boolean(Number(a.ShrinkToFit)));
    if (a.Rotation !== undefined) p["style:rotation-angle"] = a.Rotation;
    if (a.Locked !== undefined || a.Hidden !== undefined) p["style:cell-protect"] = Number(a.Hidden) ? "formula-hidden" + (Number(a.Locked) ? " protected" : "") : Number(a.Locked) ? "protected" : "none";
    const horizontal: Readonly<Record<string,string>> = { "GNM_HALIGN_LEFT": "start", "GNM_HALIGN_RIGHT": "end", "GNM_HALIGN_CENTER": "center", "GNM_HALIGN_JUSTIFY": "justify", "2": "start", "4": "end", "8": "center" };
    const vertical: Readonly<Record<string,string>> = { "GNM_VALIGN_TOP": "top", "GNM_VALIGN_BOTTOM": "bottom", "GNM_VALIGN_CENTER": "middle", "1": "top", "2": "bottom", "4": "middle" };
    paragraph["fo:text-align"] = horizontal[a.HAlign ?? ""]; p["style:vertical-align"] = vertical[a.VAlign ?? ""];
    text["fo:color"] = color(a.Fore);
    const font = odfChildren(node).find(n => odfObject(n)?.name === "Font"), f = odfAttributes(font);
    if (font) {
      text["fo:font-family"] = typeof odfObject(font)?.text === "string" ? odfObject(font)!.text as string : undefined;
      text["fo:font-size"] = f.Unit ? f.Unit + "pt" : undefined;
      if (f.Bold !== undefined) text["fo:font-weight"] = Number(f.Bold) ? "bold" : "normal";
      if (f.Italic !== undefined) text["fo:font-style"] = Number(f.Italic) ? "italic" : "normal";
      if (f.Underline !== undefined) {
        const underline = Number(f.Underline), low = underline === 3 || underline === 4;
        text["style:text-underline-style"] = underline ? "solid" : "none";
        text["style:text-underline-type"] = underline === 2 || underline === 4 ? "double" : underline ? "single" : "none";
        text["style:text-underline-width"] = "auto";
        text["style:text-underline-color"] = "font-color";
        text["style:text-underline-mode"] = "continuous";
        if (extended && low) text["gnm:text-underline-placement"] = "low";
      }
      if (f.StrikeThrough !== undefined) text["style:text-line-through-style"] = Number(f.StrikeThrough) ? "solid" : "none";
      if (f.Script !== undefined) text["style:text-position"] = Number(f.Script) < 0 ? "sub 80%" : Number(f.Script) > 0 ? "super 80%" : "0% 100%";
    }
    const borders = odfChildren(odfChildren(node).find(n => odfObject(n)?.name === "StyleBorder"));
    const sides: Readonly<Record<string,string>> = { Top: "top", Bottom: "bottom", Left: "left", Right: "right" };
    const lines = ["none", "solid", "solid", "dashed", "dotted", "solid", "double", "solid", "dashed", "dash-dot", "dash-dot", "dash-dot-dot", "dash-dot-dot"];
    for (const border of borders) {
      xml.charge(); const b = odfAttributes(border), side = sides[String(odfObject(border)?.name)];
      if (side) p["fo:border-" + side] = `${[0,1,2,1,1,3,1,0.5,2,1,2,1,2][Number(b.Style)] ?? 1}pt ${lines[Number(b.Style)] ?? "solid"} ${color(b.Color) ?? "#000000"}`;
    }
    await append(number.xml, e("style:style", { "style:name": name, "style:family": "table-cell", "style:data-style-name": number.xml ? "N" + name : undefined },
      e("style:table-cell-properties", p) + e("style:paragraph-properties", paragraph) + e("style:text-properties", text)));
    return { name, kind: number.kind };
  }
  return { register, reserve, styles, render, dispose };
}

export function odfPrintProperties(records: readonly ImportedValue[], xml: ReturnType<typeof createOdfXml>, extended: boolean) {
  const properties: Record<string,string|number|undefined> = { "style:print": "charts drawings objects" };
  for (const source of records) for (const n of odfChildren(source)) {
    xml.charge(); const v = odfObject(n), a = odfAttributes(n);
    if (v?.name === "orientation" && typeof v.text === "string") properties["style:print-orientation"] = v.text;
    if (v?.name === "Margins") for (const margin of odfChildren(n)) {
      const side = odfObject(margin)?.name, a = odfAttributes(margin);
      if (typeof side === "string" && ["top", "bottom", "left", "right"].includes(side) && a.Points) properties["fo:margin-" + side] = a.Points + "pt";
    }
    if (v?.name === "Scale") {
      if (a.type === "fit") {
        if (extended) { if (Number(a.cols) > 0) properties["gnm:scale-to-X"] = a.cols; if (Number(a.rows) > 0) properties["gnm:scale-to-Y"] = a.rows; }
        else if (Number(a.cols) > 0 && Number(a.rows) > 0) properties["style:scale-to-pages"] = Number(a.cols) * Number(a.rows);
      } else if (a.percentage) properties["style:scale-to"] = a.percentage + "%";
    }
  }
  return properties;
}
