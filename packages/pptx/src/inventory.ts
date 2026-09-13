import { inspectDiagrams, type DiagramInventory } from "./diagram-resources.js";
import { resolveTextStyles, type TextStyleRecord } from "./text-style-resolution.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { parseContentTypes } from "./content-types.js";
import { OfficeError } from "./errors.js";
import type { PackageReader } from "./package-reader.js";
import type { RelationshipEdge, RelationshipGraph } from "./relationships.js";
import type { SelectionContext, SelectionRecord } from "./selectors.js";
import type { XmlElement } from "./xml.js";

export interface PartInventory {
  readonly part: string;
  readonly contentType: string | null;
  readonly bytes: number;
  readonly sha256: string;
}
export interface SlideInventory {
  readonly id: string;
  readonly part: string;
  readonly position: number;
  readonly shapeCount: number;
  readonly layout: string | null;
  readonly master: string | null;
  readonly theme: string | null;
  readonly show: { readonly explicit: boolean | null; readonly effective: boolean };
}
export interface PresentationInventory {
  readonly diagrams: readonly DiagramInventory[];
  readonly textStyles: readonly TextStyleRecord[];
  readonly slides: readonly SlideInventory[];
  readonly masters: readonly string[];
  readonly layouts: readonly string[];
  readonly themes: readonly string[];
  readonly parts: readonly PartInventory[];
  readonly media: readonly PartInventory[];
  readonly relationships: readonly RelationshipEdge[];
  readonly unsupported: readonly { readonly part: string; readonly reason: string }[];
  readonly features: {
    readonly structure: true;
    readonly slideVisibility: true;
    readonly effectiveFormatting: false;
    readonly mediaMetadata: false;
    readonly editing: false;
  };
  readonly counts: {
    readonly slides: number;
    readonly masters: number;
    readonly layouts: number;
    readonly themes: number;
    readonly slideShapes: number;
    readonly parts: number;
    readonly media: number;
  };
}

const relationshipNamespaces = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships"
];
function hasType(edge: RelationshipEdge, type: string): boolean {
  return relationshipNamespaces.some((namespace) => edge.type === `${namespace}/${type}`);
}

export function inspectInventory(
  reader: PackageReader,
  graph: RelationshipGraph,
  records: {
    readonly slides: readonly SelectionRecord[];
    readonly objects: readonly SelectionRecord[];
  },
  root: (part: string) => XmlElement,
  context: SelectionContext
): PresentationInventory {
  const names = [...graph.parts].sort();
  const relationships = Object.freeze(
    ["/", ...names].flatMap((owner) =>
      [...graph.outgoing(owner)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    )
  );
  const targets = (type: string) =>
    Object.freeze(
      [
        ...new Set(
          relationships
            .filter(
              (edge) =>
                hasType(edge, type) && edge.targetPart !== null && reader.has(edge.targetPart)
            )
            .map((edge) => edge.targetPart!)
        )
      ].sort()
    );
  const masters = targets("slideMaster");
  const layouts = targets("slideLayout");
  const themes = targets("theme");
  const target = (owner: string | null, type: string): string | null => {
    if (owner === null) return null;
    const edges = graph.outgoing(owner).filter((edge) => hasType(edge, type));
    if (edges.length > 1)
      throw new OfficeError(
        "invalid-opc",
        "Ambiguous presentation inheritance relationship.",
        "index"
      );
    const part = edges[0]?.targetPart;
    return part && reader.has(part) ? part : null;
  };
  const slides = Object.freeze(
    records.slides.map((slide): SlideInventory => {
      const layout = target(slide.part, "slideLayout");
      const master = target(layout, "slideMaster");
      const value = root(slide.part)
        .attributes.find(
          (attribute) => attribute.name.namespace === "" && attribute.name.localName === "show"
        )
        ?.value.trim();
      if (value !== undefined && !["true", "false", "1", "0"].includes(value))
        throw new OfficeError("invalid-xml", "Invalid slide visibility.", "index");
      const explicit = value === undefined ? null : value === "true" || value === "1";
      return Object.freeze({
        id: slide.id,
        part: slide.part,
        position: slide.position,
        shapeCount: records.objects.filter(
          (object) => object.scope === "slides" && object.part === slide.part
        ).length,
        layout,
        master,
        theme: target(master, "theme"),
        show: Object.freeze({ explicit, effective: explicit ?? true })
      });
    })
  );
  const stylePart = (part: string | null) => (part ? { part, root: root(part) } : undefined);
  const presentation = stylePart(target("/", "officeDocument"));
  const textStyles = slides.flatMap((slide) =>
    resolveTextStyles({
      slide: { part: slide.part, root: root(slide.part) },
      layout: stylePart(slide.layout),
      master: stylePart(slide.master),
      theme: stylePart(slide.theme),
      themeOverrides: [slide.part, slide.layout, slide.master]
        .map((part) => stylePart(target(part, "themeOverride")))
        .filter((part) => part !== undefined),
      presentation
    })
  );
  const contentTypes = reader.has("/[Content_Types].xml")
    ? parseContentTypes(reader.get("/[Content_Types].xml"), {
        maxBytes: context.xmlLimits.maxBytes,
        maxEntries: context.relationshipLimits.maxParts
      })
    : null;
  const unsupported: { readonly part: string; readonly reason: string }[] = [];
  const parts = Object.freeze(
    names.map((part): PartInventory => {
      context.signal?.throwIfAborted();
      const bytes = reader.get(part);
      let contentType: string | null = null;
      if (contentTypes) {
        try {
          contentType = contentTypes.get(part);
        } catch (error) {
          if (!(error instanceof OfficeError) || error.code !== "missing-binding") throw error;
        }
      }
      if (contentType === null)
        unsupported.push(Object.freeze({ part, reason: "content-type-unavailable" }));
      unsupported.push(Object.freeze({ part, reason: "semantic-content-not-inspected" }));
      return Object.freeze({
        part,
        contentType,
        bytes: bytes.length,
        sha256: Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
      });
    })
  );
  const mediaTargets = new Set(
    relationships
      .filter((edge) => ["image", "audio", "video", "media"].some((type) => hasType(edge, type)))
      .map((edge) => edge.targetPart)
  );
  const media = Object.freeze(
    parts.filter(
      (part) =>
        mediaTargets.has(part.part) ||
        ["image/", "audio/", "video/"].some((prefix) =>
          part.contentType?.toLowerCase().startsWith(prefix)
        )
    )
  );
  for (const edge of relationships) {
    if (edge.external)
      unsupported.push(
        Object.freeze({ part: edge.owner, reason: `external-relationship:${edge.id}` })
      );
    else if (edge.targetPart !== null && !reader.has(edge.targetPart))
      unsupported.push(
        Object.freeze({ part: edge.owner, reason: `missing-relationship-target:${edge.id}` })
      );
  }
  return Object.freeze({
    slides,
    diagrams: inspectDiagrams(parts, graph),
    textStyles: Object.freeze(textStyles),
    masters,
    layouts,
    themes,
    parts,
    media,
    relationships,
    unsupported: Object.freeze(unsupported),
    features: Object.freeze({
      structure: true,
      slideVisibility: true,
      effectiveFormatting: false,
      mediaMetadata: false,
      editing: false
    }),
    counts: Object.freeze({
      slides: slides.length,
      masters: masters.length,
      layouts: layouts.length,
      themes: themes.length,
      slideShapes: slides.reduce((count, slide) => count + slide.shapeCount, 0),
      parts: parts.length,
      media: media.length
    })
  });
}
