import { documentPartRole } from "./document-part-roles.js";
import { parseMediaType } from "./media-type.js";
import { corePropertyKeys, customPropertyType, extendedPropertyKeys, propertyDeclaration, propertyGroupDefinition, readPropertyNodes } from "./property-values.js";
import type { DocumentPackage } from "./package.js";
import { DocumentBudget } from "./budget.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import type { XmlAttribute, XmlContent, XmlElement } from "./package-xml.js";
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
  policy: "update" | "remove" | "reject", budget: DocumentBudget, graph: DocumentPackage
): void {
  const changes: (() => void)[] = [];
  const dependency = (): void => {
    if (policy === "reject") unsafe("The bookmark still has references; an explicit update or removal policy is required.");
    if ((newName === null) !== (policy === "remove")) unsafe("The bookmark reference policy does not match the operation.");
  };
  for (const [part, editor] of editors) {
    const type = parseMediaType(graph.getPart(part).content_type), root = editor.root;
    const rootDialect = dialectForNamespace(root.namespace) ?? "transitional";
    const math = documentDialects[rootDialect].m, role = documentPartRole(type, root);
    const literalProperties = new Set<XmlElement>(), literalPropertyAttributes = new Set<XmlAttribute>(), literalPropertyContent = new Set<XmlContent>();
    const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
    for (const group of ["core", "extended", "custom"] as const) {
      const definition = propertyGroupDefinition(group, rootDialect);
      if (type !== definition.contentType || root.namespace !== definition.namespace || root.localName !== definition.root) continue;
      for (const property of readPropertyNodes(root, group, rootDialect, budget)) {
        budget.charge("work", 1);
        if (property.valueNode && property.value !== null && property.value.value !== null) {
          budget.charge("retainedBytes", 8 + (property.valueContent?.length ?? 0) * 8); literalProperties.add(property.valueNode);
          for (const content of property.valueContent ?? []) literalPropertyContent.add(content);
        }
      }
      const opaque = new Set<XmlElement>(), projected = [...editor.compatibility.content];
      while (projected.length) {
        const item = projected.pop()!;
        budget.charge("work", 1);
        if (!("source" in item)) continue;
        budget.charge("retainedBytes", 16 + item.content.length * 8);
        if (item.disposition !== "understood") opaque.add(item.source);
        else projected.push(...item.content);
      }
      const declarations = group === "custom" ? [] : Object.keys(group === "core" ? corePropertyKeys : extendedPropertyKeys).map(key => propertyDeclaration(group, key, rootDialect)!);
      const pending: {node: XmlElement; parent?: XmlElement; scalar: boolean}[] = [{node: root, scalar: false}];
      while (pending.length) {
        const {node, parent, scalar} = pending.pop()!;
        budget.charge("work", 1 + node.attributes.length + declarations.length);
        if (opaque.has(node)) continue;
        const custom = group === "custom" && node.namespace === documentDialects[rootDialect].cus && node.localName === "property";
        if (custom) for (const attribute of node.attributes) if (!attribute.namespace && ["name", "pid", "fmtid"].includes(attribute.localName)) {
          budget.charge("retainedBytes", 8); literalPropertyAttributes.add(attribute);
        }
        const nativeScalar = group === "custom"
          ? node.namespace === documentDialects[rootDialect].vt && parent?.namespace === documentDialects[rootDialect].cus && parent.localName === "property" && customPropertyType(node.localName) !== null
          : declarations.some(entry => entry.namespace === node.namespace && entry.localName === node.localName);
        const literal = nativeScalar || scalar && node.namespace === mc && ["AlternateContent", "Choice", "Fallback"].includes(node.localName);
        budget.charge("retainedBytes", 8 + node.children.length * 32);
        if (literal) literalProperties.add(node);
        for (const child of node.children) pending.push({node: child, parent: node, scalar: literal});
      }
    }
    const remove = new Set<XmlElement>();
    let fields: Field[] = [];
    let deletedTail = "";
    const attribute = (node: XmlElement, localName: string) => node.attributes.find(item => item.namespace === node.namespace && item.localName === localName);
    const visit = (node: XmlElement, parent?: XmlElement, mathContext: "outside" | "unit" | "opaque" = "outside"): void => {
      budget.charge("work", 1);
      const dialect = dialectForNamespace(node.namespace);
      const word = dialect !== undefined && node.namespace === documentDialects[dialect].w;
      if (!word && node.namespace !== math && node.namespace !== "http://schemas.openxmlformats.org/markup-compatibility/2006") mathContext = "opaque";
      if (mathContext === "outside" && (role === "story" || role === "glossary") && node.namespace === math && ["oMath", "oMathPara"].includes(node.localName)) mathContext = "unit";
      const literalMathText = mathContext === "unit" && node.namespace === math && node.localName === "t" && parent?.namespace === math && parent.localName === "r" && node.children.length === 0;
      const story = word && ["body", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent"].includes(node.localName);
      const outerFields = fields;
      const outerDeletedTail = deletedTail;
      if (story) { fields = []; deletedTail = ""; }
      for (const item of node.attributes) {
        budget.charge("work", item.value.length);
        if (item.namespace === "http://www.w3.org/2000/xmlns/") continue;
        const knownWordAttribute = word && (item.namespace === node.namespace ||
          item.namespace === documentDialects[dialect!].r || item.namespace === "http://www.w3.org/XML/1998/namespace");
        const knownMathFont = role === "settings" && parent?.namespace === math && parent.localName === "mathPr" && root.children.includes(parent) && node.namespace === math && node.localName === "mathFont" && item.namespace === math && item.localName === "val";
        const compatibilityAttribute = item.namespace === mc || node.namespace === mc && node.localName === "Choice" && !item.namespace && item.localName === "Requires";
        if (!knownWordAttribute && !knownMathFont && !compatibilityAttribute && !literalPropertyAttributes.has(item) && item.value.includes(oldName))
          unsafe("An opaque XML attribute may reference the bookmark.");
      }
      if (!word && !literalMathText && !literalProperties.has(node)) {
        const text = node.content.map(part => !literalPropertyContent.has(part) && (part.kind === "text" || part.kind === "cdata") ? part.text : "").join("");
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
      for (const child of node.children) visit(child, node, mathContext);
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
