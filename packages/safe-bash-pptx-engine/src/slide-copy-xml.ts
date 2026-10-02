import { equationNamespaces } from "./equations-compatibility.js";
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
    readonly preserveShapeIds?: boolean;
  }
): Uint8Array {
  let xml = parseXmlPart(bytes, options.xmlLimits);
  const diagramNamespace = `${options.dialect.a.slice(0, options.dialect.a.lastIndexOf("/"))}/diagram`;
  const original = xml;
  const nodes = elements(xml);
  const compatibilityNamespace = "http://schemas.openxmlformats.org/markup-compatibility/2006";
  const mathWrappers = new Set<XmlElement>();
  for (const { node, path } of nodes) {
    if (!equationNamespaces.includes(node.name.namespace)) continue;
    let ancestor = xml.root;
    for (const index of path) {
      if (ancestor.name.namespace === compatibilityNamespace) {
        mathWrappers.add(ancestor);
        if (ancestor.name.localName === "AlternateContent")
          for (const branch of ancestor.children) mathWrappers.add(branch);
      }
      ancestor = ancestor.children[index]!;
    }
  }
  const diagramPresent = nodes.some(
    ({ node }) => node.name.namespace === diagramNamespace && node.name.localName === "relIds"
  );
  const shapeIds = new Map<string, string>();
  const shapePaths = new Map<string, number[][]>();
  let maximum = 0;
  for (const { node, path } of nodes)
    if (node.name.namespace === options.dialect.p && node.name.localName === "cNvPr") {
      const id = attr(node, "id")!;
      if (!Number.isSafeInteger(Number(id)) || Number(id) < 1 || Number(id) > 4294967295)
        unsupported();
      const previousPaths = shapePaths.get(id) ?? [];
      for (const previous of previousPaths) {
        if (!options.preserveShapeIds || !diagramPresent) unsupported();
        let ancestor = xml.root;
        let depth = 0;
        while (depth < Math.min(previous.length, path.length) && previous[depth] === path[depth]) {
          ancestor = ancestor.children[path[depth]!]!;
          depth++;
        }
        if (
          ancestor.name.namespace !==
            "http://schemas.openxmlformats.org/markup-compatibility/2006" ||
          ancestor.name.localName !== "AlternateContent" ||
          ![previous[depth], path[depth]].every(
            (index) =>
              index !== undefined &&
              ancestor.children[index]?.name.namespace === ancestor.name.namespace &&
              ["Choice", "Fallback"].includes(ancestor.children[index]!.name.localName)
          )
        )
          unsupported();
      }
      shapePaths.set(id, [...previousPaths, path]);
      maximum = Math.max(maximum, Number(id));
      shapeIds.set(id, id);
    }
  if (!options.preserveShapeIds)
    for (const id of shapeIds.keys()) {
      if (++maximum > 4294967295)
        throw new OfficeError("resource-limit", "Shape IDs exhausted.", "validate-intent");
      shapeIds.set(id, String(maximum));
    }
  for (const { node, path } of nodes) {
    if (
      (![options.dialect.p, options.dialect.a, options.dialect.c].includes(node.name.namespace) &&
        !(
          (diagramPresent || mathWrappers.has(node)) &&
          node.name.namespace === compatibilityNamespace &&
          ["AlternateContent", "Choice", "Fallback"].includes(node.name.localName)
        ) &&
        !equationNamespaces.includes(node.name.namespace) &&
        !(
          node.name.namespace === "http://schemas.microsoft.com/office/drawing/2010/main" &&
          node.name.localName === "m"
        ) &&
        !(node.name.namespace === diagramNamespace && node.name.localName === "relIds") &&
        !(
          node.name.namespace === "http://schemas.microsoft.com/office/drawing/2014/chartex" &&
          node.name.localName === "chart"
        )) ||
      ["extLst", "oleObj", "control", "contentPart"].includes(node.name.localName)
    )
      unsupported();
    if (
      node.name.namespace === options.dialect.a &&
      ["hlinkClick", "hlinkHover", "hlinkMouseOver"].includes(node.name.localName)
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
    if (
      node.name.namespace === diagramNamespace &&
      node.name.localName === "relIds" &&
      ["dm", "lo", "qs", "cs"].some((name) => !attr(node, name, options.dialect.r))
    )
      unsupported();
    const attributes: { namespace: string; localName: string; value: string }[] = [];
    for (const attribute of node.attributes) {
      const { namespace, localName } = attribute.name;
      let value: string | undefined;
      if (namespace === options.dialect.r) {
        const diagramReference =
          node.name.namespace === diagramNamespace && node.name.localName === "relIds";
        if (
          !(diagramReference ? ["dm", "lo", "qs", "cs"] : ["id", "embed", "link"]).includes(
            localName
          )
        )
          unsupported();
        if (diagramReference) {
          const kind = {
            dm: "diagramData",
            lo: "diagramLayout",
            qs: "diagramQuickStyle",
            cs: "diagramColors"
          }[localName];
          if (
            !edges.some(
              (edge) =>
                edge.id === attribute.value &&
                edge.type === `${options.dialect.r}/${kind}` &&
                !edge.external
            )
          )
            unsupported();
        }
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
      } else if (namespace === compatibilityNamespace && localName === "Ignorable") {
        const prefixes = attribute.value
          .split(" ")
          .flatMap((value) => value.split("\t"))
          .flatMap((value) => value.split("\n"))
          .flatMap((value) => value.split("\r"))
          .filter(Boolean);
        if (
          !prefixes.length ||
          prefixes.some(
            (prefix) =>
              ![
                ...equationNamespaces,
                "http://schemas.microsoft.com/office/drawing/2010/main"
              ].includes(original.resolveNamespace(node, prefix) ?? "")
          )
        )
          unsupported();
      } else if (
        namespace &&
        !(equationNamespaces.includes(node.name.namespace) && namespace === node.name.namespace) &&
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
