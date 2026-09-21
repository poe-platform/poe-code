import { parseXmlSteps } from "@poe-code/safe-fs/xml";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { ImportedValue } from "../workbook.js";

const urn = "urn:oasis:names:tc:opendocument:xmlns:";
export const odfNamespaces: Readonly<Record<string, string>> = {
  xml: "http://www.w3.org/XML/1998/namespace",
  office: urn + "office:1.0", style: urn + "style:1.0", text: urn + "text:1.0", table: urn + "table:1.0",
  draw: urn + "drawing:1.0", fo: urn + "xsl-fo-compatible:1.0", xlink: "http://www.w3.org/1999/xlink",
  dc: "http://purl.org/dc/elements/1.1/", meta: urn + "meta:1.0", number: urn + "datastyle:1.0",
  svg: urn + "svg-compatible:1.0", chart: urn + "chart:1.0", config: urn + "config:1.0",
  form: urn + "form:1.0", script: urn + "script:1.0", of: urn + "of:1.2",
  manifest: urn + "manifest:1.0", gnm: "http://www.gnumeric.org/odf-extension/1.0",
  calcext: "urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0"
};
export type OdfAttributes = Readonly<Record<string, string | number | undefined>>;
export function odfObject(value: ImportedValue | undefined): Readonly<Record<string, ImportedValue>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, ImportedValue>> : undefined;
}
export function odfAttributes(value: ImportedValue | undefined, namespace?: string): Record<string, string> {
  const source = odfObject(value)?.attributes;
  if (Array.isArray(source)) return Object.fromEntries(source.flatMap(a => {
    const v = odfObject(a); return typeof v?.name === "string" && typeof v.value === "string" && (namespace === undefined || v.namespace === namespace) ? [[v.name, v.value]] : [];
  }));
  if (namespace !== undefined) return {};
  return Object.fromEntries(Object.entries(odfObject(source) ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
export function odfChildren(value: ImportedValue | undefined): readonly ImportedValue[] {
  const source = odfObject(value)?.children; return Array.isArray(source) ? source : [];
}

export function createOdfXml(context: CapabilityContext, extended: boolean) {
  let work = 0, nodes = 0;
  const encoder = new TextEncoder(), names = new Set<string>();
  const declarations = Object.fromEntries(Object.entries(odfNamespaces).map(([prefix, uri]) => ["xmlns:" + prefix, uri]));
  function charge(amount = 1) {
    context.signal.throwIfAborted();
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > (context.limits.workbookWork ?? 10000000) - work)
      throw new SsconvertError("resource-limit", "ssconvert OpenDocument work limit exceeded");
    work += amount;
  }
  function name(value: string) {
    charge(value.length); if (names.has(value)) return;
    try {
      const parser = parseXmlSteps(`<${value} ${Object.entries(declarations).map(([k,v]) => `${k}="${v}"`).join(" ")}/>`, { maxNodes: 1, maxAttributes: 100 });
      let step = parser.next(); while (!step.done) step = parser.next();
      if (step.value.name !== value || step.value.children.length) throw new Error("name");
    } catch { throw new SsconvertError("invalid-request", "Invalid OpenDocument XML name"); }
    names.add(value);
  }
  function escape(value: string) {
    charge(value.length); let result = "";
    for (const c of value) {
      const code = c.codePointAt(0)!;
      if (code < 32 && !"\t\n\r".includes(c) || code === 65534 || code === 65535 || code >= 0xd800 && code <= 0xdfff)
        throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: non-XML OpenDocument character");
      result += c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : c === "\r" ? "&#13;" : c === "\n" ? "&#10;" : c === "\t" ? "&#9;" : c;
    }
    return result;
  }
  function element(tag: string, attributes: OdfAttributes = {}, content = "") {
    charge(); if (++nodes > (context.limits.workbookNodes ?? 100000))
      throw new SsconvertError("resource-limit", "ssconvert OpenDocument XML nodes limit exceeded");
    name(tag); let result = "<" + tag;
    for (const [key, value] of Object.entries(attributes)) if (value !== undefined) {
      // XML namespace declaration names are validated by the final parser.
      if (!key.startsWith("xmlns:")) name(key);
      result += ` ${key}="${escape(String(value))}"`;
    }
    result += content ? ">" + content + "</" + tag + ">" : "/>";
    if (result.length > context.limits.outputBytes || encoder.encode(result).length > context.limits.outputBytes)
      throw new SsconvertError("resource-limit", "ssconvert OpenDocument output bytes limit exceeded");
    return result;
  }
  function text(value: string): string {
    charge(value.length); let result = "", plain = "";
    function flush() { result += escape(plain); plain = ""; }
    for (let i = 0; i < value.length; i++) {
      const c = value[i]!;
      if (c === " ") {
        flush(); let count = 1; while (value[i + 1] === " ") { i++; count++; }
        result += element("text:s", count > 1 ? { "text:c": count } : {});
      } else if (c === "\t" || c === "\n") { flush(); result += element(c === "\t" ? "text:tab" : "text:line-break"); }
      else plain += c;
    }
    flush(); return result;
  }
  const active = new Set<object>();
  function retained(value: ImportedValue | undefined, depth = 0): string {
    charge(); const v = odfObject(value); if (!v || typeof v.name !== "string" || typeof v.namespace !== "string") return "";
    if (depth > 128) throw new SsconvertError("resource-limit", "ssconvert OpenDocument metadata depth limit exceeded");
    if (active.has(v)) throw new SsconvertError("invalid-request", "Invalid cyclic OpenDocument metadata");
    const prefix = Object.entries(odfNamespaces).find(([, uri]) => uri === v.namespace)?.[0];
    if (!prefix || !extended && ["gnm", "calcext"].includes(prefix)) return "";
    active.add(v);
    try {
      const attributes: Record<string, string> = {};
      if (Array.isArray(v.attributes)) for (const a of v.attributes) {
        charge(); const attribute = odfObject(a);
        if (typeof attribute?.name !== "string" || typeof attribute.value !== "string" || typeof attribute.namespace !== "string") continue;
        const p = Object.entries(odfNamespaces).find(([, uri]) => uri === attribute.namespace)?.[0];
        if (attribute.namespace && (!p || !extended && ["gnm", "calcext"].includes(p))) continue;
        attributes[(p ? p + ":" : "") + attribute.name] = attribute.value;
      }
      const children = odfChildren(v);
      const content = Array.isArray(v.content) ? v.content.map(c => {
        charge(); const item = odfObject(c);
        if (item?.kind === "text" && typeof item.text === "string") return escape(item.text);
        if (item?.kind !== "element") return "";
        if (item.index === undefined) return retained(item.value, depth + 1);
        if (typeof item.index !== "number" || !Number.isSafeInteger(item.index) || item.index < 0 || item.index >= children.length)
          throw new SsconvertError("invalid-request", "Invalid OpenDocument metadata child index");
        return retained(children[item.index], depth + 1);
      }).join("") : (typeof v.text === "string" ? escape(v.text) : "") + children.map(c => retained(c, depth + 1)).join("");
      return element(prefix + ":" + v.name, attributes, content);
    } finally { active.delete(v); }
  }
  function document(tag: string, body: string) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + element(tag, { ...declarations, "office:version": "1.2" }, body);
  }
  return { element, escape, text, retained, document, charge };
}
