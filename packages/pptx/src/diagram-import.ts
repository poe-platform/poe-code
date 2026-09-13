import { OfficeError } from "./errors.js";
import { diagramContentTypes, diagramRelationshipKinds } from "./diagram-resources.js";
import type { RelationshipEdge } from "./relationships.js";
import type { XmlPart } from "./xml.js";

export function validatePreservedDiagram(
  xml: XmlPart,
  type: string,
  edges: readonly RelationshipEdge[],
  dialect: { readonly a: string; readonly r: string }
): void {
  const fail = (): never => {
    throw new OfficeError(
      "unsupported-edit",
      "Import cannot preserve these diagram references safely.",
      "validate-intent"
    );
  };
  const diagram = `${dialect.a.slice(0, dialect.a.lastIndexOf("/"))}/diagram`;
  const drawing = "http://schemas.microsoft.com/office/drawing/2008/diagram";
  const roots: Record<string, readonly [string, string]> = {
    [diagramContentTypes.data]: [diagram, "dataModel"],
    [diagramContentTypes.layout]: [diagram, "layoutDef"],
    [diagramContentTypes.style]: [diagram, "styleDef"],
    [diagramContentTypes.colors]: [diagram, "colorsDef"],
    [diagramContentTypes.drawing]: [drawing, "drawing"]
  };
  const root = roots[type];
  if (!root || xml.root.name.namespace !== root[0] || xml.root.name.localName !== root[1]) fail();
  const pending = [xml.root];
  while (pending.length) {
    const node = pending.pop()!;
    for (const attribute of node.attributes) {
      if (attribute.name.namespace === dialect.r) {
        if (
          !["id", "embed", "link", "dm", "lo", "qs", "cs"].includes(attribute.name.localName) ||
          !edges.some((edge) => edge.id === attribute.value)
        )
          fail();
      } else if (
        node.name.namespace === drawing &&
        node.name.localName === "dataModelExt" &&
        attribute.name.namespace === "" &&
        attribute.name.localName === "relId"
      ) {
        if (
          !edges.some(
            (edge) =>
              edge.id === attribute.value &&
              diagramRelationshipKinds[edge.type] === "drawing" &&
              !edge.external
          )
        )
          fail();
      }
    }
    pending.push(...node.children);
  }
}
