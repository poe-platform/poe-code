import type { DocumentBudget } from "./budget.js";
import type { CompatibilityContent } from "./compatibility.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import type { XmlElement } from "./package-xml.js";
import { UnsupportedEditError } from "./xml-write.js";

export interface ParsedField {
  node: XmlElement;
  path: readonly number[];
  form: "simple" | "complex";
  instruction: string;
  result: string;
  kind: string;
  update: boolean;
  locked: boolean;
  nested: ParsedField[];
  text: XmlElement[];
  separated: boolean;
  unsupported: boolean;
  separator?: XmlElement;
  instructions: XmlElement[];
  unsafe: boolean;
  endPath?: readonly number[];
  instructionNested?: boolean;
}
export const fieldAttribute = (node: XmlElement, name: string) => node.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value;

/** Each story owns a stack; cached nested values never become instruction text. */
export function parseFields(root: XmlElement, path: readonly number[], budget: DocumentBudget, content: readonly CompatibilityContent[]): ParsedField[] {
  const fields: ParsedField[] = [], stack: ParsedField[] = [];
  const active = new Set<XmlElement>(), reachable = new Set<XmlElement>();
  const collect = (content: readonly CompatibilityContent[]) => {
    for (const item of content) if ("source" in item) {
      budget.charge("work", 1);
      active.add(item.source);
      collect(item.content);
    }
  };
  collect(content);
  const mark = (node: XmlElement): boolean => {
    budget.charge("work", 1);
    const children = node.children.map(mark);
    if (active.has(node) || children.some(Boolean)) { reachable.add(node); return true; }
    return false;
  };
  mark(root);
  const fail = () => { throw new UnsupportedEditError("Malformed field boundaries or instruction text."); };
  const begin = (node: XmlElement, path: readonly number[], simple: boolean, unsafe: boolean) => {
    const field: ParsedField = { node, path, form: simple ? "simple" : "complex", instruction: simple ? fieldAttribute(node, "instr") ?? "" : "", result: "", kind: "", update: ["1", "true", "on"].includes(fieldAttribute(node, "dirty") ?? ""), locked: ["1", "true", "on"].includes(fieldAttribute(node, "fldLock") ?? ""), nested: [], text: [], instructions: [], unsafe, separated: simple, unsupported: unsafe };
    if (simple && fieldAttribute(node, "instr") === undefined) fail();
    for (const name of ["dirty", "fldLock"]) {
      const value = fieldAttribute(node, name);
      if (value !== undefined && !["0", "1", "true", "false", "on", "off"].includes(value)) field.unsupported = field.unsafe = true;
    }
    for (const parent of stack) if (parent.separated) parent.unsupported = true;
    if (stack.at(-1) && !stack.at(-1)!.separated) stack.at(-1)!.instructionNested = true;
    stack.at(-1)?.nested.push(field);
    fields.push(field); stack.push(field);
    budget.charge("retainedBytes", 256 + path.length * 8);
    return field;
  };
  const finish = (field: ParsedField) => {
    const trimmed = field.instruction.trimStart();
    let end = 0;
    while (end < trimmed.length && !" \t\r\n".includes(trimmed[end]!)) end++;
    field.kind = trimmed.slice(0, end).toUpperCase();
    if (!field.kind) fail();
    let quoted = false;
    for (let i = 0; i < field.instruction.length; i++) {
      budget.charge("work", 1);
      if (field.instruction[i] === "\\" && field.instruction[i + 1] === '"') i++;
      else if (field.instruction[i] === '"') quoted = !quoted;
    }
    if (quoted) field.unsupported = true;
    if (["MERGEFIELD", "REF", "PAGEREF", "SEQ"].includes(field.kind) && !field.nested.length && (!trimmed.slice(end).trim() || trimmed.slice(end).trimStart().startsWith("\\"))) field.unsupported = true;
  };
  const visit = (node: XmlElement, path: readonly number[], unsafe: boolean): void => {
    budget.charge("work", 1);
    if (!reachable.has(node)) return;
    if (!active.has(node)) {
      node.children.forEach((child, i) => visit(child, [...path, i], true));
      return;
    }
    if (node !== root && dialectForNamespace(node.namespace) && ["txbxContent", "footnote", "endnote", "comment", "hdr", "ftr", "body"].includes(node.localName)) return;
    const dialect = dialectForNamespace(node.namespace);
    const word = dialect !== undefined && node.namespace === documentDialects[dialect].w;
    const name = word ? node.localName : "opaque";
    if (name === "rPr" || name === "pPr") return;
    const prohibited = !word || ["sdt", "ins", "del", "moveFrom", "moveTo", "hyperlink", "customXml"].includes(name);
    unsafe ||= prohibited;
    if (stack.length && !["fldSimple", "fldChar", "instrText", "t", "r", "tab", "br", "cr"].includes(name)) for (const field of stack) field.unsupported = true;
    if (prohibited || name === "br" && ![undefined, "textWrapping"].includes(fieldAttribute(node, "type"))) for (const field of stack) field.unsupported = true;
    let simple: ParsedField | undefined;
    if (name === "fldSimple") simple = begin(node, path, true, unsafe);
    else if (name === "fldChar") {
      const type = fieldAttribute(node, "fldCharType");
      if (type === "begin") begin(node, path, false, unsafe);
      else {
        const field = stack.at(-1);
        if (!field || field.form !== "complex") fail();
        if (type === "separate") { if (field!.separated) fail(); field!.separated = true; field!.separator = node; }
        else if (type === "end") { field!.endPath = path; finish(stack.pop()!); }
        else fail();
      }
    } else if (name === "instrText") {
      const field = stack.at(-1);
      if (!field || field.form !== "complex" || field.separated || node.children.length) fail();
      field!.instruction += node.text;
      field!.instructions.push(node);
      budget.charge("retainedBytes", node.text.length * 2);
    } else if (["t", "tab", "br", "cr"].includes(name)) {
      const value = name === "t" ? node.text : name === "tab" ? "\t" : "\n";
      for (let i = stack.length - 1; i >= 0; i--) {
        const field = stack[i]!;
        if (!field.separated) break;
        field.result += value;
        budget.charge("retainedBytes", value.length * 2);
        field.text.push(node);
        if (unsafe || node.children.length) field.unsupported = true;
      }
    }
    for (let i = 0; i < node.children.length; i++) visit(node.children[i]!, [...path, i], unsafe);
    if (simple) { if (stack.pop() !== simple) fail(); finish(simple); }
  };
  visit(root, path, false);
  if (stack.length) fail();
  return fields;
}
