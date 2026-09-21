import type { DocumentBudget } from "./budget.js";
import { storedBooleanValue } from "./stored-lexical.js";
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

/** Inline insertion must stay outside enclosing fields, including empty intervening paragraphs. */
export function assertOutsideFields(fields: readonly ParsedField[], caret: readonly number[]): void {
  const compare = (a: readonly number[], b: readonly number[]): number => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return a.length - b.length;
  };
  if (fields.some(f => f.endPath && compare(f.path, caret) < 0 && compare(caret, f.endPath) < 0))
    throw new UnsupportedEditError("Cannot insert within an enclosing field.");
}

/** Each story owns a stack; cached nested values never become instruction text. */
export function parseFields(root: XmlElement, path: readonly number[], budget: DocumentBudget, content: readonly CompatibilityContent[]): ParsedField[] {
  const fields: ParsedField[] = [], stack: ParsedField[] = [];
  const active = new Set<XmlElement>(), reachable = new Set<XmlElement>();
  budget.charge("retainedBytes", 24);
  const projection = [{ content, position: 0 }];
  while (projection.length) {
    const frame = projection.at(-1)!;
    if (frame.position === frame.content.length) { projection.pop(); continue; }
    const item = frame.content[frame.position++]!;
    if (!("source" in item)) continue;
    budget.charge("work", 1);
    budget.charge("retainedBytes", 56);
    active.add(item.source);
    projection.push({ content: item.content, position: 0 });
  }
  budget.charge("retainedBytes", 32);
  const ancestry = [{ node: root, position: -1, reachable: false }];
  while (ancestry.length) {
    const frame = ancestry.at(-1)!;
    if (frame.position === -1) { budget.charge("work", 1); frame.position = 0; }
    if (frame.position < frame.node.children.length) {
      budget.charge("retainedBytes", 32);
      ancestry.push({ node: frame.node.children[frame.position++]!, position: -1, reachable: false });
    } else {
      const found = active.has(frame.node) || frame.reachable;
      if (found) reachable.add(frame.node);
      ancestry.pop();
      if (found && ancestry.length) ancestry.at(-1)!.reachable = true;
    }
  }
  const fail = () => { throw new UnsupportedEditError("Malformed field boundaries or instruction text."); };
  const begin = (node: XmlElement, path: readonly number[], simple: boolean, unsafe: boolean) => {
    const field: ParsedField = { node, path, form: simple ? "simple" : "complex", instruction: simple ? fieldAttribute(node, "instr") ?? "" : "", result: "", kind: "", update: storedBooleanValue(fieldAttribute(node, "dirty") ?? "0") === true, locked: storedBooleanValue(fieldAttribute(node, "fldLock") ?? "0") === true, nested: [], text: [], instructions: [], unsafe, separated: simple, unsupported: unsafe };
    if (simple && fieldAttribute(node, "instr") === undefined) fail();
    for (const name of ["dirty", "fldLock"]) {
      const value = fieldAttribute(node, name);
      if (value !== undefined && storedBooleanValue(value) === null) field.unsupported = field.unsafe = true;
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
  budget.charge("retainedBytes", 48 + path.length * 8);
  const currentPath = [...path];
  const traversal: { node: XmlElement; position: number; unsafe: boolean; simple?: ParsedField }[] = [{ node: root, position: -1, unsafe: false }];
  while (traversal.length) {
    const frame = traversal.at(-1)!, node = frame.node;
    if (frame.position === -1) {
      budget.charge("work", 1);
      frame.position = 0;
      const dialect = dialectForNamespace(node.namespace);
      const word = dialect !== undefined && node.namespace === documentDialects[dialect].w;
      if (!reachable.has(node) || active.has(node) &&
        (node !== root && dialect !== undefined && ["txbxContent", "footnote", "endnote", "comment", "hdr", "ftr", "body"].includes(node.localName) ||
          word && ["rPr", "pPr"].includes(node.localName))) {
        traversal.pop();
        if (traversal.length) currentPath.pop();
        continue;
      }
      // Reachable physical carriers contain only descendants admitted by the
      // compatibility projection. Their unselected branches were pruned above.
      if (active.has(node)) {
        const name = word ? node.localName : "opaque";
        const prohibited = !word || ["sdt", "ins", "del", "moveFrom", "moveTo", "hyperlink", "customXml"].includes(name);
        frame.unsafe ||= prohibited;
        if (stack.length && !["fldSimple", "fldChar", "instrText", "t", "r", "tab", "br", "cr"].includes(name))
          for (const field of stack) if (name !== "p" || field.form !== "complex") field.unsupported = true;
        if (prohibited || name === "br" && ![undefined, "textWrapping"].includes(fieldAttribute(node, "type"))) for (const field of stack) field.unsupported = true;
        if (name === "fldSimple") frame.simple = begin(node, [...currentPath], true, frame.unsafe);
        else if (name === "fldChar") {
          const type = fieldAttribute(node, "fldCharType");
          if (type === "begin") begin(node, [...currentPath], false, frame.unsafe);
          else {
            const field = stack.at(-1);
            if (!field || field.form !== "complex") fail();
            if (type === "separate") { if (field!.separated) fail(); field!.separated = true; field!.separator = node; }
            else if (type === "end") { budget.charge("retainedBytes", currentPath.length * 8); field!.endPath = [...currentPath]; finish(stack.pop()!); }
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
            if (frame.unsafe || node.children.length) field.unsupported = true;
          }
        }
      }
    }
    if (frame.position < node.children.length) {
      budget.charge("retainedBytes", 56);
      const index = frame.position++;
      currentPath.push(index);
      traversal.push({ node: node.children[index]!, position: -1, unsafe: frame.unsafe });
    } else {
      if (frame.simple) { if (stack.pop() !== frame.simple) fail(); finish(frame.simple); }
      traversal.pop();
      if (traversal.length) currentPath.pop();
    }
  }
  if (stack.length) fail();
  return fields;
}
