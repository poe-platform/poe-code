import { SaxesParser } from "saxes";
import { readBinary } from "./bytes.js";
import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { readPackage } from "./package-reader.js";
import {
  readSelectionIndex,
  SelectionError,
  type SelectionContext,
  type SelectionQuery
} from "./selectors.js";
import { interpretCompatibility } from "./compatibility.js";
import { parseXmlPart, type XmlElement } from "./xml.js";

export type TextScope =
  | "slides"
  | "notes"
  | "layouts"
  | "masters"
  | "notes-master"
  | "handout-master";
export interface ReadPresentationTextOptions {
  readonly scope?: TextScope;
  readonly select?: SelectionQuery;
  readonly shape?: string;
}
export type TextInline =
  | { readonly kind: "run"; readonly text: string }
  | { readonly kind: "break"; readonly text: "\v" }
  | {
      readonly kind: "field";
      readonly cachedText: string;
      readonly fieldId: string | null;
      readonly fieldType: string | null;
    };
export interface TextParagraph {
  readonly index: number;
  readonly coordinateSystem: "zero-based";
  readonly text: string;
  readonly inlines: readonly TextInline[];
}
export interface TextSegment {
  readonly location: Location;
  readonly text: string;
  readonly paragraphs: readonly TextParagraph[];
  readonly cell?: {
    readonly coordinateSystem: "zero-based";
    readonly row: number;
    readonly column: number;
  };
}
export interface PresentationText {
  readonly text: string;
  readonly order: "structural";
  readonly segments: readonly TextSegment[];
}
const presentationNamespaces = [
  "http://schemas.openxmlformats.org/presentationml/2006/main",
  "http://purl.oclc.org/ooxml/presentationml/main"
];
const drawingNamespaces = [
  "http://schemas.openxmlformats.org/drawingml/2006/main",
  "http://purl.oclc.org/ooxml/drawingml/main"
];
const relationshipNamespaces = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships"
];
const scopes: readonly TextScope[] = [
  "slides",
  "notes",
  "layouts",
  "masters",
  "notes-master",
  "handout-master"
];
function attr(element: XmlElement, name: string): string | null {
  return (
    element.attributes.find((a) => a.name.namespace === "" && a.name.localName === name)?.value ??
    null
  );
}
export async function readPresentationText(
  input: BinaryInput,
  options: ReadPresentationTextOptions,
  context: SelectionContext
): Promise<PresentationText> {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !["scope", "select", "shape"].includes(key)) ||
    (options.scope !== undefined && !scopes.includes(options.scope)) ||
    (options.shape !== undefined && typeof options.shape !== "string")
  )
    throw new OfficeError("invalid-value", "Invalid text reading options.", "usage");
  if (
    options.shape !== undefined &&
    (!options.shape ||
      options.select?.kind !== "slide" ||
      options.select.token !== undefined ||
      options.select.all)
  )
    throw new SelectionError("invalid-selection");
  const scope = options.scope ?? "slides";
  const bytes = await readBinary(input, context, {
    maxBytes: Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
  });
  const index = await readSelectionIndex(bytes, context);
  const reader = await readPackage(bytes, context);
  const selected = options.select === undefined ? undefined : index.select(options.select);
  if (
    selected?.some((item) => item.kind === "slide") &&
    ["notes-master", "handout-master"].includes(scope)
  )
    throw new SelectionError("invalid-selection");
  if (options.shape !== undefined && selected?.length !== 1)
    throw new SelectionError("invalid-selection");
  const selectedSlides = selected?.filter((item) => item.kind === "slide") ?? index.slides;
  if (selected?.some((item) => item.kind !== "slide" && item.scope !== scope))
    throw new SelectionError("invalid-selection");
  const target = (owner: string, type: string): string | undefined => {
    const matches = index.inventory.relationships.filter(
      (edge) =>
        edge.owner === owner && relationshipNamespaces.some((ns) => edge.type === `${ns}/${type}`)
    );
    if (matches.length > 1)
      throw new OfficeError("invalid-opc", "Ambiguous text scope relationship.", "select");
    return matches[0]?.targetPart ?? undefined;
  };
  const owners = new Set<string>();
  for (const slide of selectedSlides) {
    const layout = target(slide.part, "slideLayout");
    const owner =
      scope === "slides"
        ? slide.part
        : scope === "notes"
          ? target(slide.part, "notesSlide")
          : scope === "layouts"
            ? layout
            : scope === "masters" && layout
              ? target(layout, "slideMaster")
              : undefined;
    if (owner) owners.add(owner);
  }
  if (!selected && scope !== "slides" && scope !== "notes")
    for (const part of index.parts.filter((part) => part.scope === scope)) owners.add(part.part);
  if (selected) for (const item of selected) if (item.kind !== "slide") owners.add(item.part);
  const named =
    options.shape === undefined
      ? undefined
      : index.objects.filter(
          (item) => owners.has(item.part) && item.scope === scope && item.name === options.shape
        );
  if (named && named.length !== 1)
    throw new SelectionError(
      named.length ? "ambiguous-selection" : "missing-selection",
      named.slice(0, 20).map((item) => item.location)
    );
  const segments: TextSegment[] = [];
  for (const owner of owners) {
    const part = parseXmlPart(reader.get(owner), context.xmlLimits);
    const view = interpretCompatibility(
      part,
      [...presentationNamespaces, ...drawingNamespaces, ...relationshipNamespaces],
      [
        ...presentationNamespaces.map((namespace) => ({ namespace, localName: "ext" })),
        ...drawingNamespaces.flatMap((namespace) =>
          ["ext", "graphicData"].map((localName) => ({ namespace, localName }))
        )
      ],
      (element) =>
        drawingNamespaces.includes(element.name.namespace) &&
        element.name.localName === "graphicData" &&
        (drawingNamespaces.some((ns) => attr(element, "uri") === `${ns}/table`) ||
          element.children.some(
            (child) =>
              drawingNamespaces.includes(child.name.namespace) && child.name.localName === "tbl"
          ))
    );
    const is = (node: XmlElement, local: string, namespaces = presentationNamespaces) =>
      node.name.localName === local && namespaces.includes(node.name.namespace);
    const children = (node: XmlElement, local: string, namespaces = presentationNamespaces) =>
      view.children(node).filter((child) => is(child, local, namespaces));
    const characters = (node: XmlElement): string => {
      let value = "";
      const parser = new SaxesParser();
      parser.on("text", (text) => {
        value += text;
      });
      parser.on("cdata", (text) => {
        value += text;
      });
      parser.write(part.markup(node)).close();
      return value;
    };
    const body = (node: XmlElement, location: Location, cell?: TextSegment["cell"]) => {
      const bodyChildren = (node: XmlElement, local: string) =>
        view.children(node).filter((child) => is(child, local, drawingNamespaces));
      const paragraphs = bodyChildren(node, "p").map((paragraph, index): TextParagraph => {
        const inlines: TextInline[] = [];
        for (const inline of view.children(paragraph)) {
          if (is(inline, "br", drawingNamespaces)) inlines.push({ kind: "break", text: "\v" });
          else if (is(inline, "r", drawingNamespaces) || is(inline, "fld", drawingNamespaces)) {
            const text = bodyChildren(inline, "t").map(characters).join("");
            inlines.push(
              is(inline, "fld", drawingNamespaces)
                ? {
                    kind: "field",
                    cachedText: text,
                    fieldId: attr(inline, "id"),
                    fieldType: attr(inline, "type")
                  }
                : { kind: "run", text }
            );
          }
        }
        return {
          index,
          coordinateSystem: "zero-based",
          text: inlines
            .map((inline) => (inline.kind === "field" ? inline.cachedText : inline.text))
            .join(""),
          inlines
        };
      });
      segments.push({
        location,
        text: paragraphs.map((paragraph) => paragraph.text).join("\n"),
        paragraphs,
        ...(cell ? { cell } : {})
      });
    };
    const visit = (parent: XmlElement, inheritedSelection = false): void => {
      for (const shape of view.children(parent)) {
        if (
          !presentationNamespaces.includes(shape.name.namespace) ||
          !["sp", "cxnSp", "graphicFrame", "grpSp", "pic"].includes(shape.name.localName)
        )
          continue;
        const nonVisual = view
          .children(shape)
          .find(
            (node) =>
              presentationNamespaces.includes(node.name.namespace) &&
              ["nvSpPr", "nvCxnSpPr", "nvGraphicFramePr", "nvGrpSpPr", "nvPicPr"].includes(
                node.name.localName
              )
          );
        const identity = nonVisual && children(nonVisual, "cNvPr")[0];
        const object =
          identity &&
          index.objects.find(
            (item) => item.part === owner && Number(item.id) === Number(attr(identity, "id"))
          );
        if (!object)
          throw new OfficeError("invalid-opc", "Missing text object identity.", "select");
        const included =
          inheritedSelection ||
          (named
            ? named[0]!.token === object.token
            : !selected ||
              selected.some(
                (item) =>
                  item.kind === "slide" ||
                  (item.part === owner && (item.kind === "part" || item.id === object.id))
              ));
        if (is(shape, "grpSp")) {
          visit(shape, included);
          continue;
        }
        if (!included) continue;
        for (const textBody of children(shape, "txBody")) body(textBody, object.location);
        for (const graphic of children(shape, "graphic", drawingNamespaces))
          for (const data of children(graphic, "graphicData", drawingNamespaces)) {
            if (
              !data.children.some((node) => is(node, "tbl", drawingNamespaces)) &&
              !drawingNamespaces.some((ns) => attr(data, "uri") === `${ns}/table`)
            )
              continue;
            for (const table of children(data, "tbl", drawingNamespaces))
              children(table, "tr", drawingNamespaces).forEach((row, rowIndex) => {
                children(row, "tc", drawingNamespaces).forEach((cell, column) => {
                  for (const textBody of children(cell, "txBody", drawingNamespaces))
                    body(textBody, object.location, {
                      coordinateSystem: "zero-based",
                      row: rowIndex,
                      column
                    });
                });
              });
          }
      }
    };
    for (const common of children(part.root, "cSld"))
      for (const tree of children(common, "spTree")) visit(tree);
  }
  return {
    text: segments.map((segment) => segment.text).join("\n"),
    order: "structural",
    segments
  };
}
