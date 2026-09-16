import { DocumentBudget } from "./budget.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import type { XmlContent, XmlElement } from "./package-xml.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";

interface Operand { start: number; end: number }
interface Field { nodes: XmlContent[]; separated: boolean; nested: boolean }

function unsafe(message: string): never {
  throw new UnsupportedEditError(message);
}

function referenceOperand(instruction: string, name: string): Operand | undefined {
  let position = 0;
  const tokens: { value: string; start: number; end: number }[] = [];
  while (position < instruction.length) {
    while (position < instruction.length && " \t\r\n".includes(instruction[position]!)) position++;
    if (position === instruction.length) break;
    const quoted = instruction[position] === '"';
    if (quoted) position++;
    const start = position;
    while (position < instruction.length && (quoted ? instruction[position] !== '"' : !" \t\r\n".includes(instruction[position]!))) position++;
    const end = position;
    if (quoted && position === instruction.length) unsafe("Cannot safely update a malformed field instruction.");
    if (quoted) position++;
    tokens.push({ value: instruction.slice(start, end), start, end });
  }
  const command = tokens[0]?.value.toUpperCase();
  if ((command === "PAGE" || command === "NUMPAGES") &&
    !instruction.slice(tokens[0]!.end).includes(name)) return undefined;
  if (command !== "REF" && command !== "PAGEREF") {
    if (instruction.includes(name)) unsafe("An unsupported field may reference the bookmark.");
    return undefined;
  }
  const operand = tokens[1];
  if (!operand || operand.value.startsWith("\\")) unsafe("A reference field is missing its bookmark operand.");
  if (tokens.slice(2).some(token => token.value === name)) unsafe("A field has an ambiguous bookmark dependency.");
  return operand.value === name ? operand : undefined;
}

/** Edits only admitted internal links and literal REF/PAGEREF bookmark operands. */
export function updateBookmarkReferences(
  editors: ReadonlyMap<string, DocumentXmlEditor>, oldName: string, newName: string | null,
  policy: "update" | "remove" | "reject", budget: DocumentBudget
): void {
  const changes: (() => void)[] = [];
  const dependency = (): void => {
    if (policy === "reject") unsafe("The bookmark still has references; an explicit update or removal policy is required.");
    if ((newName === null) !== (policy === "remove")) unsafe("The bookmark reference policy does not match the operation.");
  };
  for (const editor of editors.values()) {
    const remove = new Set<XmlElement>();
    let fields: Field[] = [];
    let deletedTail = "";
    const attribute = (node: XmlElement, localName: string) => node.attributes.find(item => item.namespace === node.namespace && item.localName === localName);
    const visit = (node: XmlElement): void => {
      budget.charge("work", 1);
      const dialect = dialectForNamespace(node.namespace);
      const word = dialect !== undefined && node.namespace === documentDialects[dialect].w;
      const story = word && ["body", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent"].includes(node.localName);
      const outerFields = fields;
      const outerDeletedTail = deletedTail;
      if (story) { fields = []; deletedTail = ""; }
      for (const item of node.attributes) {
        budget.charge("work", item.value.length);
        if (item.namespace === "http://www.w3.org/2000/xmlns/") continue;
        const knownWordAttribute = word && (item.namespace === node.namespace ||
          item.namespace === documentDialects[dialect!].r || item.namespace === "http://www.w3.org/XML/1998/namespace");
        if (!knownWordAttribute && item.value.includes(oldName))
          unsafe("An opaque XML attribute may reference the bookmark.");
      }
      if (!word) {
        const text = node.content.map(part => part.kind === "text" || part.kind === "cdata" ? part.text : "").join("");
        budget.charge("work", text.length);
        if (text.includes(oldName)) unsafe("Opaque XML text may reference the bookmark.");
      }
      if (word) {
        const { r } = documentDialects[dialect!];
        if (node.localName === "hyperlink") {
          const anchor = attribute(node, "anchor");
          const external = node.attributes.some(item => item.namespace === r && item.localName === "id");
          if (!external && attribute(node, "docLocation")?.value.includes(oldName))
            unsafe("An internal document-location reference cannot be safely updated.");
          if (anchor?.value === oldName && !external) {
            dependency();
            if (policy === "remove") remove.add(node);
            else changes.push(() => editor.setAttribute(node, anchor.name, newName!));
          }
        } else if (node.localName === "fldSimple") {
          const instruction = attribute(node, "instr");
          if (!instruction) unsafe("A simple field is missing its instruction.");
          budget.charge("work", instruction.value.length);
          const operand = referenceOperand(instruction.value, oldName);
          if (operand) {
            dependency();
            if (policy === "remove") remove.add(node);
            else changes.push(() => editor.setAttribute(node, instruction.name,
              instruction.value.slice(0, operand.start) + newName + instruction.value.slice(operand.end)));
          }
        } else if (node.localName === "fldChar") {
          const type = attribute(node, "fldCharType")?.value;
          if (type === "begin") {
            if (fields.length) fields[fields.length - 1]!.nested = true;
            fields.push({ nodes: [], separated: false, nested: false });
          } else if (type === "separate") {
            const field = fields[fields.length - 1];
            if (!field || field.separated) unsafe("A complex field has an unmatched separator.");
            field.separated = true;
          } else if (type === "end") {
            const field = fields.pop();
            if (!field) unsafe("A complex field has an unmatched end.");
            const instruction = field.nodes.map(part => part.kind === "element" ? "" : part.text).join("");
            budget.charge("work", instruction.length);
            const operand = referenceOperand(instruction, oldName);
            if (operand) {
              dependency();
              if (field.nested) unsafe("Nested dependent fields cannot be safely updated.");
              if (policy === "remove") unsafe("Complex bookmark reference removal is not supported safely.");
              let offset = 0;
              let inserted = false;
              for (const part of field.nodes) {
                if (part.kind === "element") continue;
                const start = Math.max(operand.start - offset, 0);
                const end = Math.min(operand.end - offset, part.text.length);
                if (start < end) {
                  const replacement = part.text.slice(0, start) + (inserted ? "" : newName) + part.text.slice(end);
                  changes.push(() => editor.setText(part, replacement));
                  inserted = true;
                }
                offset += part.text.length;
              }
            }
          } else unsafe("A complex field has an unsupported delimiter.");
        } else if (node.localName === "delInstrText") {
          const instruction = node.content.map(part => part.kind === "text" || part.kind === "cdata" ? part.text : "").join("");
          budget.charge("work", instruction.length);
          const candidate = deletedTail + instruction;
          budget.charge("work", candidate.length);
          if (candidate.includes(oldName)) unsafe("A deleted field instruction may reference the bookmark.");
          deletedTail = candidate.slice(-Math.max(oldName.length - 1, 1));
        } else if (node.localName === "instrText") {
          const field = fields[fields.length - 1];
          if (!field || field.separated || node.children.length) unsafe("Field instruction text has no safe instruction boundary.");
          for (const part of node.content) {
            if (part.kind === "text" || part.kind === "cdata") field.nodes.push(part);
          }
        }
      }
      for (const child of node.children) visit(child);
      if (story) {
        if (fields.length) unsafe("A complex field crosses a story boundary or is missing its end.");
        fields = outerFields;
        deletedTail = outerDeletedTail;
      }
    };
    visit(editor.root);
    if (fields.length) unsafe("A complex field is missing its end.");
    if (remove.size) {
      const rebuild = (node: XmlElement, insideRemoval: boolean): string | undefined => {
        budget.charge("work", 1);
        const unwrap = remove.has(node);
        if (unwrap && node.attributes.some(item => item.namespace === "http://www.w3.org/2000/xmlns/" ||
          item.namespace === "http://www.w3.org/XML/1998/namespace"))
          unsafe("Reference removal cannot discard namespace bindings or inherited XML attributes.");
        const replacements = new Map<XmlElement, string>();
        for (const child of node.children) {
          const replacement = rebuild(child, insideRemoval || unwrap);
          if (replacement !== undefined) replacements.set(child, replacement);
        }
        if (!unwrap && !replacements.size) return undefined;
        const xml = editor.sourceXml(node, replacements, unwrap);
        if (insideRemoval) return xml;
        changes.push(() => editor.replaceElement(node, xml));
        return undefined;
      };
      rebuild(editor.root, false);
    }
  }
  for (const change of changes) change();
}
