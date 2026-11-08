import type { XmlElement } from "./xml.js";

export const equationNamespaces = [
  "http://schemas.openxmlformats.org/officeDocument/2006/math",
  "http://purl.oclc.org/ooxml/officeDocument/math"
];
export const equationOpaqueElements = [
  ...equationNamespaces.flatMap((namespace) =>
    ["oMath", "oMathPara"].map((localName) => ({ namespace, localName }))
  ),
  { namespace: "http://schemas.microsoft.com/office/drawing/2010/main", localName: "m" }
] as const;

export function protectedEquationNodes(root: XmlElement): ReadonlySet<XmlElement> {
  const nodes = [root];
  for (let index = 0; index < nodes.length; index++) nodes.push(...nodes[index]!.children);
  const containsMath = new Set<XmlElement>();
  const pending: XmlElement[] = [];
  for (const node of nodes.reverse()) {
    const math =
      equationNamespaces.includes(node.name.namespace) ||
      equationOpaqueElements.some(
        (name) => name.namespace === node.name.namespace && name.localName === node.name.localName
      );
    if (!math && !node.children.some((child) => containsMath.has(child))) continue;
    containsMath.add(node);
    if (
      math ||
      (node.name.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006" &&
        node.name.localName === "AlternateContent") ||
      ([
        "http://schemas.openxmlformats.org/drawingml/2006/main",
        "http://purl.oclc.org/ooxml/drawingml/main"
      ].includes(node.name.namespace) &&
        node.name.localName === "r")
    )
      pending.push(node);
  }
  const result = new Set<XmlElement>();
  while (pending.length) {
    const node = pending.pop()!;
    if (result.has(node)) continue;
    result.add(node);
    pending.push(...node.children);
  }
  return result;
}
