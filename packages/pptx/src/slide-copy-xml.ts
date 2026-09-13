import { OfficeError } from "./errors.js";
import type { RelationshipEdge } from "./relationships.js";
import { parseXmlPart, type XmlElement, type XmlPart, type XmlLimits } from "./xml.js";

function attr(node: XmlElement, name: string, namespace = "") {
  return node.attributes.find((x) => x.name.localName === name && x.name.namespace === namespace)
    ?.value;
}
function unsupported(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Slide copying cannot safely remap this structure or dependency.",
    "validate-intent"
  );
}
function elements(xml: XmlPart) {
  const result: { node: XmlElement; path: number[] }[] = [];
  const visit = (node: XmlElement, path: number[]) => {
    result.push({ node, path });
    node.children.forEach((child, i) => visit(child, [...path, i]));
  };
  visit(xml.root, []);
  return result;
}

export function remapCopiedXml(
  bytes: Uint8Array,
  edges: readonly RelationshipEdge[],
  ids: ReadonlyMap<string, string>,
  options: {
    readonly xmlLimits: XmlLimits;
    readonly dialect: {
      readonly p: string;
      readonly a: string;
      readonly c: string;
      readonly r: string;
    };
    readonly allocateLayoutId?: () => string;
  }
): Uint8Array {
  let xml = parseXmlPart(bytes, options.xmlLimits);
  const nodes = elements(xml);
  const shapeIds = new Map<string, string>();
  let maximum = 0;
  for (const { node } of nodes)
    if (node.name.namespace === options.dialect.p && node.name.localName === "cNvPr") {
      const id = attr(node, "id")!;
      if (!Number.isSafeInteger(Number(id)) || Number(id) < 1 || shapeIds.has(id)) unsupported();
      maximum = Math.max(maximum, Number(id));
      shapeIds.set(id, "");
    }
  for (const id of shapeIds.keys()) {
    if (++maximum > 4294967295)
      throw new OfficeError("resource-limit", "Shape IDs exhausted.", "validate-intent");
    shapeIds.set(id, String(maximum));
  }
  for (const { node, path } of nodes) {
    if (
      (![options.dialect.p, options.dialect.a, options.dialect.c].includes(node.name.namespace) &&
        !(
          node.name.namespace === "http://schemas.microsoft.com/office/drawing/2014/chartex" &&
          node.name.localName === "chart"
        )) ||
      ["extLst", "oleObj", "control", "contentPart"].includes(node.name.localName)
    )
      unsupported();
    if (
      node.name.namespace === options.dialect.a &&
      ["hlinkClick", "hlinkHover"].includes(node.name.localName)
    ) {
      const action = attr(node, "action");
      if (action && action !== "ppaction://hlinksldjump") unsupported();
      const relationship = attr(node, "id", options.dialect.r);
      if (
        action &&
        !edges.some(
          (edge) =>
            edge.id === relationship && edge.type === `${options.dialect.r}/slide` && !edge.external
        )
      )
        unsupported();
    }
    const attributes: { namespace: string; localName: string; value: string }[] = [];
    for (const attribute of node.attributes) {
      const { namespace, localName } = attribute.name;
      let value: string | undefined;
      if (namespace === options.dialect.r) {
        if (!["id", "embed", "link"].includes(localName)) unsupported();
        value = ids.get(attribute.value);
        if (!value) unsupported();
      } else if (
        !namespace &&
        node.name.namespace === options.dialect.p &&
        node.name.localName === "sldLayoutId" &&
        localName === "id" &&
        options.allocateLayoutId
      ) {
        value = options.allocateLayoutId();
      } else if (
        namespace &&
        !["http://www.w3.org/2000/xmlns/", "http://www.w3.org/XML/1998/namespace"].includes(
          namespace
        )
      )
        unsupported();
      else if (
        !namespace &&
        ((node.name.namespace === options.dialect.p &&
          node.name.localName === "cNvPr" &&
          localName === "id") ||
          (node.name.namespace === options.dialect.a &&
            ["stCxn", "endCxn"].includes(node.name.localName) &&
            localName === "id") ||
          (node.name.namespace === options.dialect.p && localName === "spid"))
      ) {
        if (
          localName === "spid" &&
          !["spTgt", "subSp", "bldP", "bldDgm", "bldOleChart", "bldGraphic"].includes(
            node.name.localName
          )
        )
          unsupported();
        value = shapeIds.get(attribute.value);
        if (!value) unsupported();
      }
      if (value !== undefined) attributes.push({ namespace, localName, value });
    }
    if (attributes.length) {
      let current = xml.root;
      for (const i of path) current = current.children[i]!;
      xml = xml.merge(current, { attributes });
    }
  }
  return xml.bytes();
}
