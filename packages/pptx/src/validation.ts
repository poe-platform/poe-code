import { parseContentTypes, type ContentTypeLimits } from "./content-types.js";
import { interpretCompatibility, type CompatibilityView } from "./compatibility.js";
import { OfficeError } from "./errors.js";
import type { PackageReader } from "./package-reader.js";
import {
  readRelationshipGraph,
  type RelationshipLimits,
  type RelationshipEdge
} from "./relationships.js";
import { parseXmlPart, type XmlElement, type XmlLimits } from "./xml.js";

export interface ValidationLimits extends XmlLimits, ContentTypeLimits, RelationshipLimits {}
const rules = [
  "main-part",
  "content-types",
  "relationship-targets",
  "required-structure",
  "slide-ids",
  "shape-ids",
  "master-layouts",
  "note-associations",
  "timing-references",
  "connector-references"
] as const;
type Rule = (typeof rules)[number];
export interface SemanticValidation {
  readonly valid: boolean;
  readonly schema: "not-checked";
  readonly rules: readonly Rule[];
  readonly issues: readonly { readonly rule: Rule; readonly part: string }[];
}
const dialects = [
  {
    p: "http://schemas.openxmlformats.org/presentationml/2006/main",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  },
  {
    p: "http://purl.oclc.org/ooxml/presentationml/main",
    a: "http://purl.oclc.org/ooxml/drawingml/main",
    r: "http://purl.oclc.org/ooxml/officeDocument/relationships"
  }
];
const types = new Map(
  [
    ["presentation.main", "presentation"],
    ["template.main", "presentation"],
    ["slideshow.main", "presentation"],
    ["slide", "sld"],
    ["slideMaster", "sldMaster"],
    ["slideLayout", "sldLayout"],
    ["notesSlide", "notes"],
    ["notesMaster", "notesMaster"],
    ["handoutMaster", "handoutMaster"]
  ].map(([type, root]) => [
    `application/vnd.openxmlformats-officedocument.presentationml.${type}+xml`.toLowerCase(),
    root!
  ])
);
function attribute(element: XmlElement, name: string, namespace = ""): string | undefined {
  return element.attributes.find(
    (item) => item.name.namespace === namespace && item.name.localName === name
  )?.value;
}
function integer(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || !value.length) return null;
  const text = value.trim();
  const digits = text.startsWith("+") ? text.slice(1) : text;
  if (!digits || [...digits].some((character) => character < "0" || character > "9")) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

export function validatePresentation(
  reader: PackageReader,
  limits: ValidationLimits
): SemanticValidation {
  const issues: { rule: Rule; part: string }[] = [];
  const fail = (rule: Rule, part: string) => {
    if (!issues.some((issue) => issue.rule === rule && issue.part === part))
      issues.push({ rule, part });
  };
  const contentTypes = parseContentTypes(reader.get("/[Content_Types].xml"), limits);
  const graph = readRelationshipGraph(reader, limits);
  for (const edge of graph.dangling) fail("relationship-targets", edge.owner);
  const mainEdges = graph
    .outgoing("/")
    .filter((edge) => dialects.some((d) => edge.type === `${d.r}/officeDocument`));
  const mainParts: string[] = [];
  const roots = new Map<string, string>();
  for (const name of reader.names) {
    if (name.toLowerCase() === "/[content_types].xml") continue;
    try {
      const type = contentTypes.get(name).split(";", 1)[0]!.trim().toLowerCase();
      const root = types.get(type);
      if (root) roots.set(name, root);
      if (root === "presentation") mainParts.push(name);
      if (
        !graph.parts.includes(name) &&
        type !== "application/vnd.openxmlformats-package.relationships+xml"
      )
        fail("content-types", name);
    } catch (error) {
      if (!(error instanceof OfficeError) || error.code !== "missing-binding") throw error;
      fail("content-types", name);
    }
  }
  if (
    mainEdges.length !== 1 ||
    mainEdges[0]!.external ||
    mainParts.length !== 1 ||
    mainEdges[0]!.targetPart !== mainParts[0]
  )
    fail("main-part", "/");
  const documents = new Map<
    string,
    { root: XmlElement; view: CompatibilityView; dialect: (typeof dialects)[number] }
  >();
  let bytes = 0;
  let nodes = 0;
  for (const [name, expected] of roots) {
    const data = reader.get(name);
    bytes += data.length;
    if (bytes > limits.maxBytes)
      throw new OfficeError("resource-limit", "Validation XML byte limit exceeded.", "index");
    if (nodes >= limits.maxNodes)
      throw new OfficeError("resource-limit", "Validation XML node limit exceeded.", "index");
    const part = parseXmlPart(data, { ...limits, maxNodes: limits.maxNodes - nodes });
    nodes += part.nodeCount;
    const dialect = dialects.find((d) => d.p === part.root.name.namespace);
    if (!dialect || part.root.name.localName !== expected) {
      fail("required-structure", name);
      continue;
    }
    const view = interpretCompatibility(
      part,
      [dialect.p, dialect.a, dialect.r],
      [
        { namespace: dialect.a, localName: "graphicData" },
        { namespace: dialect.a, localName: "ext" },
        { namespace: dialect.p, localName: "ext" }
      ]
    );
    documents.set(name, { root: part.root, view, dialect });
  }
  for (const [name, { root, view, dialect: d }] of documents) {
    const children = (node: XmlElement, local: string) =>
      view
        .children(node)
        .filter((child) => child.name.namespace === d.p && child.name.localName === local);
    const outgoing = (kind: string) =>
      graph.outgoing(name).filter((edge) => edge.type === `${d.r}/${kind}`);
    const target = (edge: RelationshipEdge | undefined, expected: string): string | null => {
      if (
        !edge ||
        edge.external ||
        edge.targetPart === null ||
        roots.get(edge.targetPart) !== expected ||
        !documents.has(edge.targetPart)
      )
        return null;
      return edge.targetPart;
    };
    const required = (node: XmlElement, local: string) => {
      const found = children(node, local);
      if (found.length !== 1) fail("required-structure", name);
      return found[0];
    };
    const listed = (
      listName: string,
      childName: string,
      kind: string,
      expected: string,
      rule: Rule,
      min: number,
      max: number
    ) => {
      const lists = children(root, listName);
      if (lists.length > 1) fail("required-structure", name);
      const ids = new Set<number>();
      const targets = new Set<string>();
      for (const list of lists)
        for (const entry of children(list, childName)) {
          const id = integer(attribute(entry, "id"), min, max);
          const dest = target(
            outgoing(kind).find((edge) => edge.id === attribute(entry, "id", d.r)),
            expected
          );
          if (id === null || ids.has(id) || dest === null || targets.has(dest)) fail(rule, name);
          if (id !== null) ids.add(id);
          if (dest !== null) targets.add(dest);
        }
      return targets;
    };
    if (root.name.localName === "presentation") {
      required(root, "notesSz");
      listed("sldIdLst", "sldId", "slide", "sld", "slide-ids", 256, 2147483647);
      listed(
        "sldMasterIdLst",
        "sldMasterId",
        "slideMaster",
        "sldMaster",
        "master-layouts",
        2147483648,
        4294967295
      );
      for (const kind of ["notesMaster", "handoutMaster"]) {
        const lists = children(root, `${kind}IdLst`);
        if (lists.length > 1) fail("note-associations", name);
        for (const list of lists) {
          const entries = children(list, `${kind}Id`);
          if (
            entries.length !== 1 ||
            target(
              outgoing(kind).find((edge) => edge.id === attribute(entries[0]!, "id", d.r)),
              kind
            ) === null
          )
            fail("note-associations", name);
        }
      }
      continue;
    }
    const common = required(root, "cSld");
    const tree = common && required(common, "spTree");
    const shapeIds = new Set<number>();
    const drawingNodes: XmlElement[] = [];
    if (tree) {
      required(tree, "nvGrpSpPr");
      required(tree, "grpSpPr");
      const stack = [tree];
      while (stack.length) {
        const node = stack.pop()!;
        drawingNodes.push(node);
        if (node.name.namespace === d.p && node.name.localName === "cNvPr") {
          const id = integer(attribute(node, "id"), 0, 4294967295);
          if (id === null || shapeIds.has(id)) fail("shape-ids", name);
          if (id !== null) shapeIds.add(id);
        }
        if (node.name.namespace === d.p) stack.push(...view.children(node));
      }
      const nonvisual = new Map([
        ["sp", "nvSpPr"],
        ["pic", "nvPicPr"],
        ["grpSp", "nvGrpSpPr"],
        ["graphicFrame", "nvGraphicFramePr"],
        ["cxnSp", "nvCxnSpPr"],
        ["spTree", "nvGrpSpPr"]
      ]);
      for (const node of drawingNodes) {
        const nv = node.name.namespace === d.p ? nonvisual.get(node.name.localName) : undefined;
        if (nv) {
          const container = required(node, nv);
          if (container) required(container, "cNvPr");
        }
      }
    }
    const all: XmlElement[] = [];
    const stack = [root];
    while (stack.length) {
      const node = stack.pop()!;
      all.push(node);
      if (node.name.namespace === d.p || node.name.namespace === d.a)
        stack.push(...view.children(node));
    }
    for (const node of all)
      if (node.name.namespace === d.a && ["stCxn", "endCxn"].includes(node.name.localName)) {
        const id = integer(attribute(node, "id"), 0, 4294967295);
        if (
          id === null ||
          !shapeIds.has(id) ||
          integer(attribute(node, "idx"), 0, 4294967295) === null
        )
          fail("connector-references", name);
      }
    const timingNodes: XmlElement[] = [];
    const timingStack = [...children(root, "timing")];
    while (timingStack.length) {
      const node = timingStack.pop()!;
      if (node.name.namespace !== d.p) continue;
      timingNodes.push(node);
      timingStack.push(...view.children(node));
    }
    const timingIds = new Set<number>();
    for (const node of timingNodes)
      if (node.name.localName === "cTn") {
        const id = integer(attribute(node, "id"), 0, 4294967295);
        if (id === null || timingIds.has(id)) fail("timing-references", name);
        if (id !== null) timingIds.add(id);
      }
    for (const node of timingNodes) {
      const shape = attribute(node, "spid");
      if (
        shape !== undefined ||
        ["spTgt", "bldP", "bldDgm", "bldOleChart", "bldGraphic"].includes(node.name.localName)
      ) {
        const id = integer(shape, 0, 4294967295);
        if (id === null || !shapeIds.has(id)) fail("timing-references", name);
      }
      if (node.name.localName === "tn") {
        const id = integer(attribute(node, "val"), 0, 4294967295);
        if (id === null || !timingIds.has(id)) fail("timing-references", name);
      }
    }
    if (root.name.localName === "sld" || root.name.localName === "sldLayout") {
      const kind = root.name.localName === "sld" ? "slideLayout" : "slideMaster";
      const expected = root.name.localName === "sld" ? "sldLayout" : "sldMaster";
      const edges = outgoing(kind);
      if (edges.length !== 1 || target(edges[0], expected) === null) fail("master-layouts", name);
      if (
        root.name.localName === "sldLayout" &&
        target(edges[0], expected) !== null &&
        edges[0]?.targetPart
      ) {
        if (
          !graph
            .outgoing(edges[0].targetPart)
            .some((edge) => edge.type === `${d.r}/slideLayout` && edge.targetPart === name)
        )
          fail("master-layouts", name);
      }
    }
    if (root.name.localName === "sldMaster") {
      required(root, "clrMap");
      const layouts = listed(
        "sldLayoutIdLst",
        "sldLayoutId",
        "slideLayout",
        "sldLayout",
        "master-layouts",
        2147483648,
        4294967295
      );
      for (const edge of outgoing("slideLayout")) {
        if (edge.targetPart === null || !layouts.has(edge.targetPart)) fail("master-layouts", name);
      }
      for (const layout of layouts)
        if (
          !graph
            .outgoing(layout)
            .some((edge) => edge.type === `${d.r}/slideMaster` && edge.targetPart === name)
        )
          fail("master-layouts", name);
    }
    if (["notesMaster", "handoutMaster"].includes(root.name.localName)) required(root, "clrMap");
    if (root.name.localName === "sld" || root.name.localName === "notes") {
      const isNotes = root.name.localName === "notes";
      const kind = isNotes ? "slide" : "notesSlide";
      const edges = outgoing(kind);
      if (edges.length > 1 || (isNotes && edges.length !== 1)) fail("note-associations", name);
      for (const edge of edges) {
        const dest = target(edge, isNotes ? "sld" : "notes");
        const inverse = isNotes ? "notesSlide" : "slide";
        if (
          dest === null ||
          graph
            .outgoing(dest)
            .filter((back) => back.type === `${d.r}/${inverse}` && back.targetPart === name)
            .length !== 1
        )
          fail("note-associations", name);
      }
      if (isNotes) {
        const masters = outgoing("notesMaster");
        if (masters.length !== 1 || target(masters[0], "notesMaster") === null)
          fail("note-associations", name);
      }
    }
  }
  return Object.freeze({
    valid: issues.length === 0,
    schema: "not-checked",
    rules: Object.freeze([...rules]),
    issues: Object.freeze(issues.map((issue) => Object.freeze(issue)))
  });
}
