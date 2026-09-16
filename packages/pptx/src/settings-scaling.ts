import { OfficeError } from "./errors.js";
import type { XmlElement, XmlPart } from "./xml.js";
function unsupported(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Content scaling requires explicit unrotated shape or group geometry without conditional content or animation.",
    "validate-intent"
  );
}
function child(node: XmlElement, name: string, namespace: string): XmlElement {
  const found = node.children.filter(
    (c) => c.name.localName === name && c.name.namespace === namespace
  );
  if (found.length !== 1) unsupported();
  return found[0]!;
}
export function scaleDrawingCanvas(document: XmlPart, sx: number, sy: number): XmlPart {
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) unsupported();
  const p = document.root.name.namespace;
  const a =
    p === "http://purl.oclc.org/ooxml/presentationml/main"
      ? "http://purl.oclc.org/ooxml/drawingml/main"
      : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const pending = [document.root];
  while (pending.length) {
    const node = pending.pop()!;
    if (
      node.name.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006" ||
      (node.name.namespace === p &&
        ["timing", "transition", "oleObj"].includes(node.name.localName))
    )
      unsupported();
    if (
      node.name.namespace === a &&
      node.name.localName === "xfrm" &&
      node.attributes.some((attr) => attr.name.localName === "rot" && Number(attr.value) !== 0)
    )
      unsupported();
    pending.push(...node.children);
  }
  const tree = child(child(document.root, "cSld", p), "spTree", p);
  const rootGroup = child(tree, "grpSpPr", p);
  const rootTransform = rootGroup.children.find(
    (c) => c.name.namespace === a && c.name.localName === "xfrm"
  );
  if (
    rootTransform &&
    (rootTransform.attributes.some((attr) => Number(attr.value) !== 0) ||
      rootTransform.children.some((node) =>
        node.attributes.some((attr) => Number(attr.value) !== 0)
      ))
  )
    unsupported();
  for (let index = 0; index < tree.children.length; index++) {
    const currentTree = child(child(document.root, "cSld", p), "spTree", p);
    const shape = currentTree.children[index]!;
    if (shape.name.namespace !== p) unsupported();
    if (["nvGrpSpPr", "grpSpPr", "extLst"].includes(shape.name.localName)) continue;
    if (!["sp", "pic", "cxnSp", "grpSp"].includes(shape.name.localName)) unsupported();
    const group = shape.name.localName === "grpSp";
    const transform = child(child(shape, group ? "grpSpPr" : "spPr", p), "xfrm", a);
    if (group) {
      for (const name of ["chOff", "chExt"]) {
        const node = child(transform, name, a);
        for (const axis of name === "chOff" ? ["x", "y"] : ["cx", "cy"]) {
          const value = node.attributes.find(
            (attribute) => attribute.name.namespace === "" && attribute.name.localName === axis
          )?.value;
          if (
            value === undefined ||
            !value.trim() ||
            [...value.trim()].some(
              (character, index) =>
                !(character >= "0" && character <= "9") &&
                !(index === 0 && (character === "-" || character === "+"))
            )
          )
            unsupported();
          const number = Number(value);
          if (
            !Number.isSafeInteger(number) ||
            Math.abs(number) > 27273042316900 ||
            (name === "chExt" && number <= 0)
          )
            unsupported();
        }
      }
    }
    const changes = ["off", "ext"].map((name) => {
      const node = child(transform, name, a);
      const attrs = (name === "off" ? ["x", "y"] : ["cx", "cy"]).map((localName, i) => {
        const value = node.attributes.find(
          (v) => v.name.namespace === "" && v.name.localName === localName
        )?.value;
        if (
          value === undefined ||
          !value.trim() ||
          [...value.trim()].some(
            (c, j) => !(c >= "0" && c <= "9") && !(j === 0 && (c === "-" || c === "+"))
          )
        )
          unsupported();
        const number = Number(value);
        const scaled = Math.sign(number) * Math.round(Math.abs(number) * (i === 0 ? sx : sy));
        if (
          !Number.isSafeInteger(number) ||
          !Number.isSafeInteger(scaled) ||
          Math.abs(scaled) > 27273042316900 ||
          (name === "ext" && scaled < 0)
        )
          unsupported();
        return { namespace: "", localName, value: String(scaled) };
      });
      return { name: { namespace: a, localName: name }, merge: { attributes: attrs } };
    });
    document = document.merge(transform, {
      children: {
        sequence: ["off", "ext", "chOff", "chExt"].map((localName) => ({
          namespace: a,
          localName
        })),
        upsert: changes
      }
    });
  }
  return document;
}
