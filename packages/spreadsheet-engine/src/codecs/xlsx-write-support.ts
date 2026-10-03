import { encodeTextStream } from "../encoding/encode-stream.js";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { ImportedValue, RichTextRun } from "@poe-code/spreadsheet-ast";
import { parseXmlSteps } from "@poe-code/safe-fs/xml";
import { encodeXlsxString } from "./xlsx-strings.js";
import { richTextSegments } from "./rich-text-runs.js";

export type Attributes = Readonly<Record<string, string | number | undefined>>;
export type ElementWriter = (name: string, attributes?: Attributes, content?: string) => string;
export function escapeXlsx(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 32 && !"\t\n\r".includes(character) || code === 65534 || code === 65535 || code >= 0xd800 && code <= 0xdfff)
      throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: non-XML XLSX character");
    result += character === "&" ? "&amp;" : character === "<" ? "&lt;" : character === ">" ? "&gt;" : character === '"' ? "&quot;" : character === "\r" ? "&#13;" : character;
  }
  return result;
}
export function createXlsxXml(context: CapabilityContext) {
  let nodes = 0, work = 0;
  const names = new Set<string>();
  function charge(amount = 1): void {
    context.signal.throwIfAborted();
    if (amount > (context.limits.workbookWork ?? Infinity) - work)
      throw new SsconvertError("resource-limit", "ssconvert XLSX work limit exceeded");
    work += amount;
  }
  function validateName(value: string): void {
    charge(value.length);
    if (names.has(value)) return;
    const parts = value.split(":");
    try {
      if (parts.length > 2) throw new Error("qualified name");
      for (const part of parts) {
        const parser = parseXmlSteps(`<${part}/>`, { maxNodes: 1, maxAttributes: 1 });
        let step = parser.next(); while (!step.done) step = parser.next();
        if (step.value.name !== part || step.value.namespace || step.value.children.length || step.value.attributes.length)
          throw new Error("XML syntax");
      }
    } catch { throw new SsconvertError("invalid-request", "Invalid XLSX XML name"); }
    names.add(value);
  }
  const element: ElementWriter = (name, attributes = {}, content = "") => {
    charge();
    if (++nodes > (context.limits.workbookNodes ?? Infinity)) throw new SsconvertError("resource-limit", "ssconvert XLSX XML nodes limit exceeded");
    validateName(name);
    if (content.length > context.limits.outputBytes)
      throw new SsconvertError("resource-limit", "ssconvert XLSX output bytes limit exceeded");
    let text = "<" + name;
    for (const [key, value] of Object.entries(attributes)) if (value !== undefined) {
      validateName(key); const raw = String(value); charge(raw.length);
      if (raw.length > context.limits.outputBytes - text.length)
        throw new SsconvertError("resource-limit", "ssconvert XLSX output bytes limit exceeded");
      text += ` ${key}="${escapeXlsx(raw).split("\n").join("&#10;").split("\t").join("&#9;")}"`;
    }
    text += content ? ">" + content + "</" + name + ">" : "/>";
    let bytes = 0, characters = 0;
    if (context.limits.outputBytes !== Infinity) for (const character of text) {
      if (++characters % 16384 === 0) context.signal.throwIfAborted();
      const point = character.codePointAt(0)!;
      bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
      if (bytes > context.limits.outputBytes)
        throw new SsconvertError("resource-limit", "ssconvert XLSX output bytes limit exceeded");
    }
    return text;
  };
  /** Serialize a container without retaining its children. Empty fragments do
   * not alter self-closing spelling; the encoder enforces the complete UTF-8 budget. */
  async function* stream(name: string, attributes: Attributes,
    content: AsyncIterable<string | Uint8Array>): AsyncGenerator<Uint8Array> {
    const empty = element(name, attributes);
    async function* parts() {
      let opened = false;
      for await (const part of content) {
        context.signal.throwIfAborted();
        if (!part.length) continue;
        if (!opened) { yield empty.slice(0, -2) + ">"; opened = true; }
        yield part;
      }
      yield opened ? "</" + name + ">" : empty;
    }
    yield* encodeTextStream(parts(), "UTF-8", false, context);
  }
  return { element, stream, charge };
}
export interface MetadataNode { readonly name: string; readonly namespace: string; readonly attributes: Readonly<Record<string, string>>; readonly text: string; readonly children: readonly MetadataNode[]; }
/** The workbook stores both parsed Gnumeric attribute arrays and OOXML attribute maps. */
export function metadataNode(value: ImportedValue | undefined, charge?: (amount?: number) => void): MetadataNode | undefined {
  const active = new Set<object>();
  function visit(value: ImportedValue | undefined): MetadataNode | undefined {
    charge?.();
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    if (active.has(value)) throw new SsconvertError("invalid-request", "Invalid cyclic XLSX metadata");
    const source = value as Readonly<Record<string, ImportedValue>>;
    if (typeof source.name !== "string") return undefined;
    active.add(value);
    try {
      charge?.(source.name.length + (typeof source.namespace === "string" ? source.namespace.length : 0) + (typeof source.text === "string" ? source.text.length : 0));
      const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
      if (Array.isArray(source.attributes)) for (const a of source.attributes) {
        charge?.();
        if (a && typeof a === "object" && !Array.isArray(a)) {
          const attribute = a as Readonly<Record<string, ImportedValue>>;
          if (typeof attribute.name === "string" && typeof attribute.value === "string") {
            charge?.(attribute.name.length + attribute.value.length); attributes[attribute.name] = attribute.value;
          }
        }
      } else if (source.attributes && typeof source.attributes === "object") {
        for (const [name, value] of Object.entries(source.attributes)) {
          charge?.(name.length + (typeof value === "string" ? value.length : 1));
          if (typeof value === "string") attributes[name] = value;
        }
      }
      return { name: source.name, namespace: typeof source.namespace === "string" ? source.namespace : "",
        attributes, text: typeof source.text === "string" ? source.text : "",
        children: Array.isArray(source.children) ? source.children.flatMap(value => { const child = visit(value); return child ? [child] : []; }) : [] };
    } finally { active.delete(value); }
  }
  return visit(value);
}
const richUnderlines: Readonly<Record<string, string>> = {
  none: "none", single: "single", double: "double", low: "singleAccounting", error: "single",
  "single-line": "single", "double-line": "double", "error-line": "single",
  singleAccounting: "singleAccounting", doubleAccounting: "doubleAccounting"
};

export function writeRichString(value: string, runs: readonly RichTextRun[] | undefined, xml: ElementWriter, charge?: (amount?: number) => void,
  target: "cell" | "comment" = "cell"): string {
  const t = (text: string) => xml("t", text.trim() !== text ? { "xml:space": "preserve" } : {}, escapeXlsx(encodeXlsxString(text)));
  if (!runs?.length) { charge?.(value.length); return t(value); }
  // Calc's XText comment path applies the first portion to the whole shape.
  // Keep it empty so every visible portion receives its own range formatting.
  let result = target === "comment" ? xml("r", {}, t("")) : "";
  for (const { text, attributes: attrs } of richTextSegments(value, runs, charge)) {
    let properties = "";
    for (const [key, name] of [["bold", "b"], ["italic", "i"], ["strikethrough", "strike"]] as const)
      if (attrs[key] !== undefined) properties += xml(name, { val: Number(attrs[key]) ? 1 : 0 });
    if (attrs.size !== undefined) properties += xml("sz", { val: Number(attrs.size) / 1024 });
    if (typeof attrs.family === "string") properties += xml("rFont", { val: encodeXlsxString(attrs.family) });
    if (typeof attrs.color === "string") properties += xml("color", { rgb: "FF" + attrs.color.split("x").join("").toUpperCase() });
    if (typeof attrs.underline === "string") properties += xml("u", {
      val: Object.hasOwn(richUnderlines, attrs.underline) ? richUnderlines[attrs.underline] : "none"
    });
    if (attrs.subscript || attrs.superscript) properties += xml("vertAlign", { val: attrs.subscript ? "subscript" : "superscript" });
    // An empty rPr creates the default font in Calc instead of inheriting the
    // preceding comment portion. It adds no attributes to our canonical spans.
    result += xml("r", {}, (properties || target === "comment" ? xml("rPr", {}, properties) : "") + t(text));
  }
  return result;
}
