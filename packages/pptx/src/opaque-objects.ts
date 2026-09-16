import { sha256 } from "@noble/hashes/sha2.js";
import type { BinaryInput } from "./contracts.js";
import { parseContentTypes } from "./content-types.js";
import { OfficeError } from "./errors.js";
import { readPackage, type PackageReader } from "./package-reader.js";
import { partName } from "./package-uri.js";
import {
  readRelationshipGraph,
  type RelationshipEdge,
  type RelationshipGraph
} from "./relationships.js";
import type { SelectionContext } from "./selectors.js";
import { parseXmlPart } from "./xml.js";

export type OpaqueObjectKind =
  | "ole"
  | "package"
  | "control"
  | "web-extension"
  | "font"
  | "model3d"
  | "active-payload";
export interface OpaqueObjectPart {
  readonly part: string;
  readonly kind: OpaqueObjectKind;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly activeContent: boolean;
  readonly activeReasons: readonly string[];
  readonly owners: readonly string[];
  readonly dependencies: readonly string[];
  readonly missing: readonly string[];
  readonly externalRelationships: readonly RelationshipEdge[];
}
export interface OpaqueObjectInventory {
  readonly objects: readonly OpaqueObjectPart[];
  readonly activationPerformed: false;
  readonly recursiveParsingPerformed: false;
}
export interface ExtractedObjectPart {
  readonly part: string;
  readonly name: string;
  readonly bytes: Uint8Array;
}
export interface ExtractedObject extends ExtractedObjectPart {
  readonly dependencies: readonly ExtractedObjectPart[];
  readonly relationships: readonly RelationshipEdge[];
}
const relationships = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships"
];
const relationshipKinds: Readonly<Record<string, OpaqueObjectKind>> = Object.fromEntries([
  ...relationships.flatMap((namespace) =>
    Object.entries({ oleObject: "ole", package: "package", control: "control", font: "font" }).map(
      ([suffix, kind]) => [`${namespace}/${suffix}`, kind]
    )
  ),
  ["http://schemas.microsoft.com/office/2006/relationships/activeXControlBinary", "control"],
  ["http://schemas.microsoft.com/office/2006/relationships/vbaProject", "active-payload"],
  ["http://schemas.microsoft.com/office/2011/relationships/webextension", "web-extension"],
  ["http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes", "web-extension"],
  ["http://schemas.microsoft.com/office/2017/06/relationships/model3d", "model3d"]
]) as Readonly<Record<string, OpaqueObjectKind>>;
const contentKinds: Readonly<Record<string, OpaqueObjectKind>> = {
  "application/vnd.openxmlformats-officedocument.oleobject": "ole",
  "application/vnd.ms-office.activex+xml": "control",
  "application/vnd.ms-office.activex": "control",
  "application/vnd.ms-office.webextension+xml": "web-extension",
  "application/vnd.ms-office.webextensiontaskpanes+xml": "web-extension",
  "application/x-fontdata": "font",
  "application/vnd.openxmlformats-officedocument.obfuscatedfont": "font",
  "application/font-sfnt": "font",
  "application/vnd.ms-opentype": "font",
  "model/gltf-binary": "model3d",
  "model/gltf+json": "model3d",
  "application/vnd.ms-office.model3d": "model3d",
  "application/vnd.ms-office.vbaproject": "active-payload"
};
function digest(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function activeSignatures(bytes: Uint8Array): string[] {
  return [
    { bytes: [77, 90], reason: "executable-header" },
    { bytes: [127, 69, 76, 70], reason: "executable-header" },
    { bytes: [208, 207, 17, 224, 161, 177, 26, 225], reason: "compound-container" }
  ]
    .filter((signature) => signature.bytes.every((byte, index) => bytes[index] === byte))
    .map((signature) => signature.reason);
}
function inspectObjects(
  reader: PackageReader,
  graph: RelationshipGraph,
  context: SelectionContext
): OpaqueObjectInventory {
  const types = parseContentTypes(reader.get("/[Content_Types].xml"), {
    maxBytes: context.xmlLimits.maxBytes,
    maxEntries: context.relationshipLimits.maxParts
  });
  const objects: OpaqueObjectPart[] = [];
  for (const part of [...graph.parts].sort()) {
    context.signal?.throwIfAborted();
    const contentType = types.get(part);
    const mediaType = contentType.split(";", 1)[0]!.trim().toLowerCase();
    const bytes = reader.get(part);
    const activeReasons = activeSignatures(bytes);
    const incoming = graph.incoming(part);
    const kind =
      contentKinds[mediaType] ??
      incoming.map((edge) => relationshipKinds[edge.type]).find((value) => value !== undefined) ??
      (mediaType.startsWith("font/")
        ? "font"
        : activeReasons.length
          ? "active-payload"
          : undefined);
    if (!kind) continue;
    if (["ole", "package", "control", "web-extension", "active-payload"].includes(kind))
      activeReasons.push(`potentially-active-${kind}`);
    const pending = [part];
    const seen = new Set(pending);
    const missing = new Set<string>();
    const external: RelationshipEdge[] = [];
    for (let cursor = 0; cursor < pending.length; cursor++) {
      context.signal?.throwIfAborted();
      for (const edge of graph.outgoing(pending[cursor]!)) {
        if (edge.external) external.push(edge);
        else if (edge.targetPart !== null) {
          if (!reader.has(edge.targetPart)) missing.add(edge.targetPart);
          else if (!seen.has(edge.targetPart)) {
            seen.add(edge.targetPart);
            pending.push(edge.targetPart);
          }
        }
      }
    }
    objects.push(
      Object.freeze({
        part,
        kind,
        contentType,
        bytes: bytes.length,
        sha256: digest(bytes),
        activeContent: activeReasons.length > 0,
        activeReasons: Object.freeze(activeReasons),
        owners: Object.freeze([...new Set(incoming.map((edge) => edge.owner))].sort()),
        dependencies: Object.freeze(pending.slice(1).sort()),
        missing: Object.freeze([...missing].sort()),
        externalRelationships: Object.freeze(external)
      })
    );
  }
  return Object.freeze({
    objects: Object.freeze(objects),
    activationPerformed: false,
    recursiveParsingPerformed: false
  });
}
export async function readObjects(
  input: BinaryInput,
  context: SelectionContext
): Promise<OpaqueObjectInventory> {
  const reader = await readPackage(input, context);
  return inspectObjects(reader, readRelationshipGraph(reader, context.relationshipLimits), context);
}
export async function extractObject(
  input: BinaryInput,
  options: { readonly part: string },
  context: SelectionContext
): Promise<ExtractedObject> {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).length !== 1 ||
    !Object.hasOwn(options, "part") ||
    !("value" in Object.getOwnPropertyDescriptor(options, "part")!) ||
    typeof options.part !== "string"
  )
    throw new OfficeError(
      "invalid-value",
      "Object extraction requires an exact package part.",
      "usage"
    );
  const selected = partName(options.part, false);
  const reader = await readPackage(input, context);
  const graph = readRelationshipGraph(reader, context.relationshipLimits);
  const inventory = inspectObjects(reader, graph, context);
  const object = inventory.objects.find((row) => row.part === selected);
  if (!object) throw new OfficeError("missing-binding", "Opaque object part is absent.", "index");
  if (object.missing.length)
    throw new OfficeError("missing-binding", "Opaque object dependency is absent.", "index");
  const parts = [object.part, ...object.dependencies];
  const dependencies = [...object.dependencies];
  const edges: RelationshipEdge[] = [];
  for (const part of parts) {
    context.signal?.throwIfAborted();
    edges.push(...graph.outgoing(part));
    const slash = part.lastIndexOf("/");
    const rels = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
    if (reader.has(rels)) dependencies.push(rels);
  }
  const extracted = (part: string): ExtractedObjectPart =>
    Object.freeze({
      part,
      name: `opaque-${digest(new TextEncoder().encode(part))}.bin`,
      bytes: reader.get(part)
    });
  return Object.freeze({
    ...extracted(object.part),
    dependencies: Object.freeze(dependencies.sort().map(extracted)),
    relationships: Object.freeze(edges)
  });
}

export interface EmbeddedFontDeclaration {
  readonly part: string;
  readonly typeface: string | null;
  readonly charset: string | null;
  readonly pitchFamily: string | null;
  readonly variants: readonly {
    readonly variant: string;
    readonly relationshipId: string | null;
    readonly part: string | null;
    readonly missing: boolean;
  }[];
}
export interface FontInventory {
  readonly declarations: readonly EmbeddedFontDeclaration[];
  readonly fonts: readonly OpaqueObjectPart[];
  readonly installationPerformed: false;
}
export async function readFonts(
  input: BinaryInput,
  context: SelectionContext
): Promise<FontInventory> {
  const reader = await readPackage(input, context);
  const graph = readRelationshipGraph(reader, context.relationshipLimits);
  const inventory = inspectObjects(reader, graph, context);
  const declarations: EmbeddedFontDeclaration[] = [];
  for (const main of graph
    .outgoing("/")
    .filter(
      (edge) =>
        !edge.external &&
        relationships.some((namespace) => edge.type === `${namespace}/officeDocument`)
    )) {
    if (!main.targetPart || !reader.has(main.targetPart))
      throw new OfficeError("missing-binding", "Presentation part is absent.", "index");
    const root = parseXmlPart(reader.get(main.targetPart), context.xmlLimits).root;
    const namespace = root.name.namespace;
    if (
      ![
        "http://schemas.openxmlformats.org/presentationml/2006/main",
        "http://purl.oclc.org/ooxml/presentationml/main"
      ].includes(namespace)
    )
      continue;
    for (const list of root.children.filter(
      (node) => node.name.namespace === namespace && node.name.localName === "embeddedFontLst"
    )) {
      for (const node of list.children.filter(
        (node) => node.name.namespace === namespace && node.name.localName === "embeddedFont"
      )) {
        const font = node.children.find(
          (child) => child.name.namespace === namespace && child.name.localName === "font"
        );
        const attr = (name: string) =>
          font?.attributes.find(
            (attribute) => attribute.name.namespace === "" && attribute.name.localName === name
          )?.value ?? null;
        const variants = node.children
          .filter(
            (child) =>
              child.name.namespace === namespace &&
              ["regular", "bold", "italic", "boldItalic"].includes(child.name.localName)
          )
          .map((child) => {
            const relationshipId =
              child.attributes.find(
                (attribute) =>
                  relationships.includes(attribute.name.namespace) &&
                  attribute.name.localName === "id"
              )?.value ?? null;
            const edge = graph
              .outgoing(main.targetPart!)
              .find(
                (edge) =>
                  edge.id === relationshipId &&
                  !edge.external &&
                  relationshipKinds[edge.type] === "font"
              );
            const part = edge?.targetPart ?? null;
            return Object.freeze({
              variant: child.name.localName,
              relationshipId,
              part,
              missing: part === null || !reader.has(part)
            });
          });
        declarations.push(
          Object.freeze({
            part: main.targetPart,
            typeface: attr("typeface"),
            charset: attr("charset"),
            pitchFamily: attr("pitchFamily"),
            variants: Object.freeze(variants)
          })
        );
      }
    }
  }
  return Object.freeze({
    declarations: Object.freeze(declarations),
    fonts: Object.freeze(inventory.objects.filter((object) => object.kind === "font")),
    installationPerformed: false
  });
}
