import { sha1 } from "@noble/hashes/legacy.js";
import { interpretCompatibility } from "./compatibility.js";
import { equationOpaqueElements } from "./equations-compatibility.js";
import { readBinary } from "./bytes.js";
import type { BinaryInput, Location, Scope } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { attr } from "./masters.js";
import { readPackage } from "./package-reader.js";
import { readSelectionIndex, SelectionError, type SelectionContext } from "./selectors.js";
import { parseXmlPart, type XmlElement } from "./xml.js";

export interface ReadMediaOptions {
  readonly scope?: Scope;
  readonly slide?: number;
  readonly shape?: string;
  readonly select?: string;
}
export interface MediaRelationship {
  readonly relationshipId: string;
  readonly relationshipType: string;
  readonly target: string;
  readonly external: boolean;
  readonly mediaPart: string | null;
  readonly contentType: string | null;
  readonly bytes: number | null;
  readonly sha256: string | null;
}
export interface MediaMetadata {
  readonly namespace: string;
  readonly name: string;
  readonly xml: string;
  readonly relationships: readonly MediaRelationship[];
}
export interface MediaOccurrence {
  readonly id: string;
  readonly location: Location;
  readonly sourcePart: string;
  readonly shapeId: string | null;
  readonly shapeName: string | null;
  readonly kind: "audio" | "video" | "unknown";
  readonly relationships: readonly MediaRelationship[];
  readonly posters: readonly MediaRelationship[];
  readonly playback: readonly MediaMetadata[];
  readonly captions: readonly MediaMetadata[];
  readonly timing: readonly MediaMetadata[];
}
export interface MediaPart {
  readonly part: string;
  readonly contentType: string | null;
  readonly bytes: number;
  readonly sha256: string;
  readonly sha1: string;
  readonly occurrenceIds: readonly string[];
}
export interface MediaInventory {
  readonly occurrences: readonly MediaOccurrence[];
  readonly media: readonly MediaPart[];
  readonly playbackVerified: false;
}
const presentation = [
  "http://schemas.openxmlformats.org/presentationml/2006/main",
  "http://purl.oclc.org/ooxml/presentationml/main"
];
const drawing = [
  "http://schemas.openxmlformats.org/drawingml/2006/main",
  "http://purl.oclc.org/ooxml/drawingml/main"
];
const relationships = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships"
];
const mediaNamespace = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const mediaRelationship = "http://schemas.microsoft.com/office/2007/relationships/media";
function walk(node: XmlElement): XmlElement[] {
  return [node, ...node.children.flatMap(walk)];
}
function relationshipKind(type: string): MediaOccurrence["kind"] | null {
  if (relationships.some((ns) => type === `${ns}/video`)) return "video";
  if (relationships.some((ns) => type === `${ns}/audio`)) return "audio";
  return type === mediaRelationship ? "unknown" : null;
}
export async function readMedia(
  input: BinaryInput,
  options: ReadMediaOptions,
  context: SelectionContext
): Promise<MediaInventory> {
  const scopes = [
    "slides",
    "layouts",
    "masters",
    "notes",
    "notes-master",
    "handout-master",
    "shared"
  ];
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (key) =>
        typeof key !== "string" ||
        !["scope", "slide", "shape", "select"].includes(key) ||
        !("value" in Object.getOwnPropertyDescriptor(options, key)!)
    ) ||
    (options.scope !== undefined && !scopes.includes(options.scope)) ||
    (options.select !== undefined && (typeof options.select !== "string" || !options.select.length))
  )
    throw new OfficeError("invalid-value", "Invalid media selection options.", "usage");
  for (const key of ["slide"] as const)
    if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key]! < 1))
      throw new OfficeError(
        "invalid-value",
        "Media positions require positive safe integers.",
        "usage"
      );
  if (
    options.shape !== undefined &&
    (typeof options.shape !== "string" || !options.shape.length || options.slide === undefined)
  )
    throw new SelectionError("invalid-selection");
  if (
    options.select !== undefined &&
    [options.scope, options.slide, options.shape].some((value) => value !== undefined)
  )
    throw new SelectionError("invalid-selection");
  const source = await readBinary(input, context);
  const reader = await readPackage(source, context);
  const index = await readSelectionIndex(source, context);
  const selected = options.select ? index.select({ token: options.select }) : undefined;
  const occurrences: MediaOccurrence[] = [];
  const related = (owner: string, type: string) =>
    index.inventory.relationships
      .filter(
        (edge) =>
          edge.owner === owner &&
          !edge.external &&
          relationships.some((ns) => edge.type === `${ns}/${type}`)
      )
      .flatMap((edge) => (edge.targetPart ? [edge.targetPart] : []));
  const owners = index.parts.filter(
    (owner) =>
      owner.scope !== "shared" &&
      (selected
        ? selected.some((record) => record.part === owner.part)
        : options.scope === "shared" || owner.scope === (options.scope ?? "slides")) &&
      (options.slide === undefined ||
        index.inventory.slides.some(
          (slide) =>
            slide.position === options.slide &&
            ([slide.part, slide.layout, slide.master].includes(owner.part) ||
              related(slide.part, "notesSlide").some(
                (notes) =>
                  notes === owner.part || related(notes, "notesMaster").includes(owner.part)
              ))
        ))
  );
  if (options.shape !== undefined) {
    const matches = index.objects.filter(
      (record) =>
        owners.some((owner) => owner.part === record.part) && record.name === options.shape
    );
    if (matches.length !== 1)
      throw new SelectionError(
        matches.length ? "ambiguous-selection" : "missing-selection",
        matches.map((record) => record.location)
      );
  }
  owners.sort((left, right) => {
    const a = index.slides.findIndex((slide) => slide.part === left.part);
    const b = index.slides.findIndex((slide) => slide.part === right.part);
    return (
      (a < 0 ? Number.MAX_SAFE_INTEGER : a) - (b < 0 ? Number.MAX_SAFE_INTEGER : b) ||
      (left.part < right.part ? -1 : left.part > right.part ? 1 : 0)
    );
  });
  for (const owner of owners) {
    context.signal?.throwIfAborted();
    const document = parseXmlPart(reader.get(owner.part), context.xmlLimits);
    const view = interpretCompatibility(
      document,
      [...presentation, ...drawing, ...relationships],
      [
        ...equationOpaqueElements,
        ...presentation.map((namespace) => ({ namespace, localName: "ext" })),
        ...drawing.flatMap((namespace) =>
          ["ext", "graphicData"].map((localName) => ({ namespace, localName }))
        )
      ]
    );
    const activeWalk = (node: XmlElement): XmlElement[] => [
      node,
      ...(node.name.localName === "ext" &&
      [...presentation, ...drawing].includes(node.name.namespace)
        ? node.children.flatMap(walk)
        : view.children(node).flatMap(activeWalk))
    ];
    const nodes = activeWalk(document.root);
    const edges = index.inventory.relationships.filter((edge) => edge.owner === owner.part);
    const consumed = new Set<string>();
    const reference = (id: string): MediaRelationship => {
      const edge = edges.find((edge) => edge.id === id);
      if (!edge) throw new OfficeError("missing-binding", "Media relationship is absent.", "index");
      const part =
        edge.targetPart === null
          ? undefined
          : index.inventory.parts.find((part) => part.part === edge.targetPart);
      if (!edge.external && !part)
        throw new OfficeError("missing-binding", "Media part is absent.", "index");
      return {
        relationshipId: edge.id,
        relationshipType: edge.type,
        target: edge.target,
        external: edge.external,
        mediaPart: edge.targetPart,
        contentType: part?.contentType ?? null,
        bytes: part?.bytes ?? null,
        sha256: part?.sha256 ?? null
      };
    };
    const bindings = (node: XmlElement) =>
      node.attributes.filter(
        (attribute) =>
          relationships.includes(attribute.name.namespace) &&
          ["embed", "link", "id"].includes(attribute.name.localName)
      );
    const metadata = (node: XmlElement): MediaMetadata => ({
      namespace: node.name.namespace,
      name: node.name.localName,
      xml: document.markup(node, true),
      relationships: [
        ...new Set(
          walk(node).flatMap((element) => bindings(element).map((binding) => binding.value))
        )
      ].map(reference)
    });
    for (const record of index.objects.filter((record) => record.part === owner.part)) {
      if (options.shape !== undefined && options.shape !== record.name) continue;
      if (
        selected &&
        !selected.some(
          (item) => item.part === owner.part && (item.kind !== "object" || item.id === record.id)
        )
      )
        continue;
      const shape = nodes.find(
        (node) =>
          presentation.includes(node.name.namespace) &&
          ["pic", "sp", "graphicFrame"].includes(node.name.localName) &&
          node.children.some((nv) =>
            nv.children.some(
              (identity) =>
                presentation.includes(identity.name.namespace) &&
                identity.name.localName === "cNvPr" &&
                attr(identity, "id") === record.id
            )
          )
      );
      if (!shape) continue;
      const children = activeWalk(shape);
      const mediaNodes = children.filter(
        (node) =>
          (drawing.includes(node.name.namespace) &&
            ["videoFile", "audioFile", "wavAudioFile"].includes(node.name.localName)) ||
          (node.name.namespace === mediaNamespace && node.name.localName === "media")
      );
      if (!mediaNodes.length) continue;
      const refs: MediaRelationship[] = [];
      for (const node of mediaNodes) {
        const nodeBindings = bindings(node);
        if (!nodeBindings.length)
          throw new OfficeError(
            "missing-binding",
            "Media reference has no relationship binding.",
            "index"
          );
        for (const binding of nodeBindings) {
          const ref = reference(binding.value);
          const expected =
            node.name.localName === "videoFile"
              ? "video"
              : node.name.localName === "media"
                ? "unknown"
                : "audio";
          if (relationshipKind(ref.relationshipType) !== expected)
            throw new OfficeError(
              "missing-binding",
              "Media relationship has the wrong type.",
              "index"
            );
          consumed.add(ref.relationshipId);
          if (!refs.some((existing) => existing.relationshipId === ref.relationshipId))
            refs.push(ref);
        }
      }
      const posters = children
        .filter((node) => drawing.includes(node.name.namespace) && node.name.localName === "blip")
        .flatMap((node) =>
          bindings(node).map((binding) => {
            const ref = reference(binding.value);
            if (!relationships.some((ns) => ref.relationshipType === `${ns}/image`))
              throw new OfficeError(
                "missing-binding",
                "Poster relationship has the wrong type.",
                "index"
              );
            return ref;
          })
        );
      const extensionNodes = children.filter(
        (node) => node.name.namespace === mediaNamespace && node.name.localName === "media"
      );
      const captions = children
        .filter(
          (node) =>
            node.name.namespace === "http://schemas.microsoft.com/office/powerpoint/2017/3/main" &&
            node.name.localName === "tracksInfo"
        )
        .map(metadata);
      const timing = nodes
        .filter(
          (node) =>
            presentation.includes(node.name.namespace) &&
            [
              "audio",
              "video",
              "anim",
              "animEffect",
              "animMotion",
              "animRot",
              "animScale",
              "cmd",
              "set"
            ].includes(node.name.localName) &&
            walk(node).some(
              (target) =>
                presentation.includes(target.name.namespace) &&
                target.name.localName === "spTgt" &&
                attr(target, "spid") === record.id
            )
        )
        .map(metadata);
      const kinds = [
        ...new Set(
          refs
            .map((ref) => {
              const kind = relationshipKind(ref.relationshipType);
              return kind === "unknown"
                ? ref.contentType?.startsWith("video/")
                  ? "video"
                  : ref.contentType?.startsWith("audio/")
                    ? "audio"
                    : "unknown"
                : kind;
            })
            .filter((kind): kind is "audio" | "video" => kind === "audio" || kind === "video")
        )
      ];
      occurrences.push({
        id: `${owner.part}#media-${record.id}`,
        location: record.location,
        sourcePart: owner.part,
        shapeId: record.id,
        shapeName: record.name,
        kind: kinds.length === 1 ? kinds[0]! : "unknown",
        relationships: refs,
        posters,
        playback: extensionNodes.map(metadata),
        captions,
        timing
      });
    }
    if (options.shape === undefined && !selected?.some((record) => record.kind === "object")) {
      for (const edge of edges.filter(
        (edge) => relationshipKind(edge.type) !== null && !consumed.has(edge.id)
      )) {
        occurrences.push({
          id: `${owner.part}#media-relationship-${edge.id}`,
          location: owner.location,
          sourcePart: owner.part,
          shapeId: null,
          shapeName: null,
          kind: relationshipKind(edge.type)!,
          relationships: [reference(edge.id)],
          posters: [],
          playback: [],
          captions: [],
          timing: []
        });
      }
    }
  }
  const media: MediaPart[] = [];
  for (const part of [
    ...new Set(
      occurrences.flatMap((occurrence) =>
        occurrence.relationships.flatMap((ref) => (ref.mediaPart ? [ref.mediaPart] : []))
      )
    )
  ].sort()) {
    const info = index.inventory.parts.find((info) => info.part === part)!;
    media.push({
      part,
      contentType: info.contentType,
      bytes: info.bytes,
      sha256: info.sha256,
      sha1: Array.from(sha1(reader.get(part)), (byte) => byte.toString(16).padStart(2, "0")).join(
        ""
      ),
      occurrenceIds: occurrences
        .filter((occurrence) => occurrence.relationships.some((ref) => ref.mediaPart === part))
        .map((occurrence) => occurrence.id)
    });
  }
  return { occurrences, media, playbackVerified: false };
}
