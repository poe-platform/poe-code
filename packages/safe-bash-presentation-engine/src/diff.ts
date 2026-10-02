import { sha256 } from "@noble/hashes/sha2.js";
import { readBinary } from "./bytes.js";
import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { readPackage } from "./package-reader.js";
import { readProperties } from "./properties.js";
import { readSelectionIndex, type SelectionContext } from "./selectors.js";
import { nodeFor } from "./shape-operations.js";
import { readPresentationText } from "./text-reading.js";
import { parseXmlPart, type XmlElement } from "./xml.js";

export type DiffMode =
  | "structural"
  | "text"
  | "media"
  | "relationships"
  | "effective-formatting"
  | "raw";
export interface DiffOptions {
  readonly mode?: DiffMode;
}
export type DiffCategory =
  | "slides"
  | "text"
  | "properties"
  | "geometry"
  | "media"
  | "relationships"
  | "opaque"
  | "raw";
export interface DiffChange {
  readonly id: string;
  readonly category: DiffCategory;
  readonly kind: "added" | "removed" | "changed";
  readonly before: unknown;
  readonly after: unknown;
  readonly left: Location | null;
  readonly right: Location | null;
}
export interface PresentationDiff {
  readonly equal: boolean;
  readonly mode: DiffMode;
  readonly formatting: "raw" | "effective";
  readonly changes: readonly DiffChange[];
  readonly limitations: readonly string[];
}
interface Entry {
  readonly value: unknown;
  readonly location: Location | null;
}
type Entries = Map<string, Entry>;
const categories: readonly DiffCategory[] = [
  "slides",
  "text",
  "properties",
  "geometry",
  "media",
  "relationships",
  "opaque",
  "raw"
];
function hash(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function geometry(node: XmlElement): unknown {
  return {
    name: node.name,
    attributes: [...node.attributes].sort((a, b) => {
      const left = `${a.name.namespace}/${a.name.localName}`,
        right = `${b.name.namespace}/${b.name.localName}`;
      return left < right ? -1 : left > right ? 1 : 0;
    }),
    children: node.children.map(geometry)
  };
}
async function snapshot(input: BinaryInput, mode: DiffMode, context: SelectionContext) {
  const bytes = await readBinary(input, context, {
    maxBytes: Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
  });
  const reader = await readPackage(bytes, context);
  const index = await readSelectionIndex(bytes, context);
  const result = new Map(categories.map((category) => [category, new Map<string, Entry>()]));
  const put = (
    category: DiffCategory,
    id: string,
    value: unknown,
    location: Location | null = null
  ) => {
    result.get(category)!.set(id, { value, location });
  };
  const slideIds = new Map(
    index.slides.map((slide) => [slide.part, `slide/${encodeURIComponent(slide.id)}`])
  );
  const ownerId = (part: string) => slideIds.get(part) ?? `part/${encodeURIComponent(part)}`;
  const partLocation = (part: string): Location => ({
    fingerprint: index.fingerprint,
    scope: "shared",
    owner: part,
    objectId: part,
    coordinateSystem: "identity"
  });
  if (mode === "raw") {
    for (const part of [...reader.names].sort()) {
      const payload = reader.get(part);
      put(
        "raw",
        `part/${encodeURIComponent(part)}`,
        { sha256: hash(payload), bytes: payload.length },
        partLocation(part)
      );
    }
    return result;
  }
  if (mode === "structural") {
    for (const slide of index.slides) {
      const id = ownerId(slide.part);
      put("slides", id, { name: slide.name }, slide.location);
      put("slides", `${id}/position`, slide.position, slide.location);
      const detail = index.inventory.slides.find((item) => item.id === slide.id)!;
      put("slides", `${id}/visibility`, detail.show.explicit, slide.location);
    }
    const properties = await readProperties(bytes, {}, context);
    for (const property of [...properties].sort((a, b) => {
      const left = `${a.kind}/${a.namespace}/${a.name}`,
        right = `${b.kind}/${b.namespace}/${b.name}`;
      return left < right ? -1 : left > right ? 1 : 0;
    })) {
      put(
        "properties",
        `property/${property.kind}/${encodeURIComponent(property.namespace)}/${encodeURIComponent(property.name)}`,
        { type: property.type, value: property.value },
        partLocation(property.part)
      );
    }
    const roots = new Map<string, XmlElement>();
    for (const object of index.objects.filter((item) => item.scope === "slides")) {
      let root = roots.get(object.part);
      if (!root) {
        root = parseXmlPart(reader.get(object.part), context.xmlLimits).root;
        roots.set(object.part, root);
      }
      const node = nodeFor(root, object.id);
      const owner =
        node.children.find(
          (child) =>
            child.name.namespace === node.name.namespace &&
            ["spPr", "grpSpPr"].includes(child.name.localName)
        ) ?? node;
      const drawingNamespace =
        node.name.namespace === "http://purl.oclc.org/ooxml/presentationml/main"
          ? "http://purl.oclc.org/ooxml/drawingml/main"
          : "http://schemas.openxmlformats.org/drawingml/2006/main";
      const transforms = owner.children.filter(
        (child) =>
          ["xfrm", "prstGeom", "custGeom"].includes(child.name.localName) &&
          child.name.namespace ===
            (node.name.localName === "graphicFrame" ? node.name.namespace : drawingNamespace)
      );
      put(
        "geometry",
        `${ownerId(object.part)}/shape/${encodeURIComponent(object.id)}/geometry`,
        transforms.map(geometry),
        object.location
      );
    }
  }
  if (mode === "structural" || mode === "text") {
    const text = await readPresentationText(bytes, {}, context);
    for (const segment of text.segments) {
      const cell = segment.cell ? `/cell/${segment.cell.row}/${segment.cell.column}` : "";
      put(
        "text",
        `${ownerId(segment.location.owner)}/shape/${encodeURIComponent(segment.location.objectId)}${cell}/text`,
        segment.text,
        segment.location
      );
    }
    put("text", "text/order", [...result.get("text")!.keys()]);
  }
  const media = new Map(index.inventory.media.map((part) => [part.part, part]));
  if (mode === "structural" || mode === "media") {
    const counts = new Map<string, { sha256: string; bytes: number; count: number }>();
    for (const part of media.values()) {
      const entry = counts.get(part.sha256) ?? { sha256: part.sha256, bytes: part.bytes, count: 0 };
      entry.count++;
      counts.set(part.sha256, entry);
    }
    for (const [digest, value] of [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      put("media", `media/${digest}`, value);
  }
  if (mode === "structural" || mode === "relationships") {
    for (const edge of index.inventory.relationships) {
      const targetMedia = edge.targetPart === null ? undefined : media.get(edge.targetPart);
      const target = edge.external
        ? edge.target
        : targetMedia
          ? `media/${targetMedia.sha256}`
          : ownerId(edge.targetPart!);
      put(
        "relationships",
        `${ownerId(edge.owner)}/relationship/${encodeURIComponent(edge.id)}`,
        { type: edge.type, external: edge.external, target },
        partLocation(edge.owner)
      );
    }
  }
  if (mode === "structural") {
    for (const part of index.inventory.parts.filter((part) => !media.has(part.part))) {
      put(
        "opaque",
        `part/${encodeURIComponent(part.part)}`,
        { sha256: part.sha256, bytes: part.bytes, contentType: part.contentType },
        partLocation(part.part)
      );
    }
  }
  return result;
}

export async function comparePresentations(
  left: BinaryInput,
  right: BinaryInput,
  options: DiffOptions,
  context: SelectionContext
): Promise<PresentationDiff> {
  const modes: readonly string[] = [
    "structural",
    "text",
    "media",
    "relationships",
    "effective-formatting",
    "raw"
  ];
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some((key) => key !== "mode") ||
    (options.mode !== undefined && !modes.includes(options.mode))
  )
    throw new OfficeError("invalid-value", "Invalid comparison options.", "usage");
  const mode = options.mode ?? "structural";
  if (mode === "effective-formatting")
    throw new OfficeError(
      "unsupported-profile",
      "Complete effective formatting comparison is unavailable; select a raw formatting mode.",
      "usage"
    );
  const before = await snapshot(left, mode, context);
  const after = await snapshot(right, mode, context);
  const changes: DiffChange[] = [];
  for (const category of categories) {
    const a: Entries = before.get(category)!,
      b: Entries = after.get(category)!;
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      const first = a.get(id),
        second = b.get(id);
      if (JSON.stringify(first?.value) === JSON.stringify(second?.value)) continue;
      if (category === "slides" && (id.endsWith("/position") || id.endsWith("/visibility"))) {
        const root = id.slice(0, id.lastIndexOf("/"));
        if (!a.has(root) || !b.has(root)) continue;
      }
      changes.push(
        Object.freeze({
          id,
          category,
          kind: !first ? "added" : !second ? "removed" : "changed",
          before: first?.value ?? null,
          after: second?.value ?? null,
          left: first?.location ?? null,
          right: second?.location ?? null
        })
      );
    }
  }
  return Object.freeze({
    equal: changes.length === 0,
    mode,
    formatting: "raw",
    changes: Object.freeze(changes),
    limitations: Object.freeze([
      "No rendering or effective formatting comparison is performed.",
      ...(mode === "structural"
        ? [
            "Nonmedia part byte hashes conservatively report raw and unsupported content changes, including parts also inspected semantically."
          ]
        : []),
      ...(mode === "text" || mode === "structural"
        ? [
            "Semantic text comparison covers slide text in structural order; other text scopes are not included."
          ]
        : []),
      ...(mode === "raw"
        ? [
            "Raw comparison covers uncompressed package members; ZIP container metadata is excluded."
          ]
        : [])
    ])
  });
}
