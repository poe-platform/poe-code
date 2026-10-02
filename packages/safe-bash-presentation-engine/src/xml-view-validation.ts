import { OfficeError } from "./errors.js";
import type { PackageReader } from "./package-reader.js";
import type { XmlPartContext } from "./xml-parts.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";

function reject(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Structured XML change exceeds the validated child-operation subset.",
    "validate-intent"
  );
}
function shell(document: XmlPart, element: XmlElement): string {
  const subtree = document.subtree(element);
  const empty = subtree.spliceChildren(subtree.root, 0, subtree.root.children.length, []);
  return empty.markup(empty.root, true);
}
function movable(element: XmlElement, presentation: string, drawing: string): boolean {
  const pending = [element];
  while (pending.length) {
    const node = pending.pop()!;
    const extent =
      node.name.namespace === drawing &&
      node.name.localName === "ext" &&
      node.attributes.length === 2 &&
      node.attributes.every(
        (attribute) => !attribute.name.namespace && ["cx", "cy"].includes(attribute.name.localName)
      );
    if (
      ![presentation, drawing].includes(node.name.namespace) ||
      node.name.localName === "graphicData" ||
      (node.name.localName === "ext" && !extent)
    )
      return false;
    if (
      node.attributes.some(
        (attribute) =>
          attribute.name.namespace &&
          ![
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            "http://purl.oclc.org/ooxml/officeDocument/relationships",
            "http://www.w3.org/XML/1998/namespace"
          ].includes(attribute.name.namespace)
      )
    )
      return false;
    pending.push(...node.children);
  }
  return true;
}

export function validateXmlViewReplacement(
  reader: PackageReader,
  part: string,
  bytes: Uint8Array,
  context: XmlPartContext,
  validate: (
    reader: PackageReader,
    part: string,
    bytes: Uint8Array,
    context: XmlPartContext
  ) => PackageReader
): PackageReader {
  try {
    return validate(reader, part, bytes, context);
  } catch (error) {
    if (!(error instanceof OfficeError) || error.code !== "unsupported-edit") throw error;
  }
  validate(reader, part, reader.get(part), context);
  const before = parseXmlPart(reader.get(part), context.validationLimits);
  const after = parseXmlPart(bytes, context.validationLimits);
  const presentation = before.root.name.namespace;
  const drawing =
    presentation === "http://schemas.openxmlformats.org/presentationml/2006/main"
      ? "http://schemas.openxmlformats.org/drawingml/2006/main"
      : "http://purl.oclc.org/ooxml/drawingml/main";
  const pending = [{ left: before.root, right: after.root }];
  while (pending.length) {
    const { left, right } = pending.pop()!;
    if (before.markup(left, true) === after.markup(right, true)) continue;
    if (
      left.name.namespace !== right.name.namespace ||
      left.name.localName !== right.name.localName ||
      shell(before, left) !== shell(after, right)
    )
      reject();
    if (
      ![presentation, drawing].includes(left.name.namespace) ||
      ["graphicData", "ext"].includes(left.name.localName)
    )
      reject();
    const structuralContainer =
      left.name.namespace === presentation && left.name.localName === "spTree"
        ? "drawing"
        : left.name.namespace === drawing && left.name.localName === "p"
          ? "paragraph"
          : null;
    if (structuralContainer) {
      const eligible = (node: XmlElement) =>
        structuralContainer === "drawing"
          ? node.name.namespace === presentation &&
            ["sp", "pic", "cxnSp", "grpSp"].includes(node.name.localName)
          : node.name.namespace === drawing && ["r", "br"].includes(node.name.localName);
      const leftFixed = left.children.filter((child) => !eligible(child));
      const rightFixed = right.children.filter((child) => !eligible(child));
      if (leftFixed.length !== rightFixed.length) reject();
      leftFixed.forEach((child, index) => {
        if (before.markup(child, true) !== after.markup(rightFixed[index]!, true)) reject();
      });
      const candidates = left.children
        .map((child, index) => ({ child, index, markup: before.markup(child, true) }))
        .filter((candidate) => eligible(candidate.child));
      const moved: XmlElement[] = [];
      let matched = true;
      for (const [destination, child] of right.children.entries()) {
        if (!eligible(child)) continue;
        const index = candidates.findIndex(
          (candidate) => candidate.markup === after.markup(child, true)
        );
        if (index < 0) {
          matched = false;
          break;
        }
        const [candidate] = candidates.splice(index, 1);
        if (candidate!.index !== destination) moved.push(candidate!.child);
      }
      if (!matched) {
        if (
          left.children.length !== right.children.length ||
          left.children.some(
            (child, index) =>
              child.name.namespace !== right.children[index]!.name.namespace ||
              child.name.localName !== right.children[index]!.name.localName
          )
        )
          reject();
        left.children.forEach((child, index) =>
          pending.push({ left: child, right: right.children[index]! })
        );
        continue;
      }
      for (const child of [...moved, ...candidates.map((candidate) => candidate.child)])
        if (!movable(child, presentation, drawing)) reject();
      if (structuralContainer === "drawing") {
        if (
          right.children[0]?.name.localName !== "nvGrpSpPr" ||
          right.children[1]?.name.localName !== "grpSpPr" ||
          right.children
            .slice(2)
            .some((child) => ["nvGrpSpPr", "grpSpPr"].includes(child.name.localName))
        )
          reject();
        const extension = right.children.findIndex((child) => child.name.localName === "extLst");
        if (extension !== -1 && extension !== right.children.length - 1) reject();
      } else {
        for (const [index, child] of right.children.entries()) {
          if (
            child.name.namespace !== drawing ||
            !["pPr", "r", "br", "endParaRPr"].includes(child.name.localName)
          )
            reject();
          if (
            (child.name.localName === "pPr" && index !== 0) ||
            (child.name.localName === "endParaRPr" && index !== right.children.length - 1)
          )
            reject();
        }
      }
      continue;
    }
    if (left.children.length !== right.children.length) reject();
    left.children.forEach((child, index) =>
      pending.push({ left: child, right: right.children[index]! })
    );
  }
  const candidate: PackageReader = {
    ...reader,
    get: (name) => (name === part ? new Uint8Array(bytes) : reader.get(name))
  };
  return validate(candidate, part, bytes, context);
}
