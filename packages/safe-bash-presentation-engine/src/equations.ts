import { SaxesParser } from "saxes";
import { readBinary } from "./bytes.js";
import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { loadShared } from "./masters.js";
import { readPackage } from "./package-reader.js";
import { readSelectionIndex, SelectionError, type SelectionContext } from "./selectors.js";
import {
  readTextBodies,
  validateTextReadingOptions,
  type ReadPresentationTextOptions
} from "./text-reading.js";
import { parseXmlPart, type XmlElement, type XmlLimits, type XmlPart } from "./xml.js";

const mathNamespaces = [
  "http://schemas.openxmlformats.org/officeDocument/2006/math",
  "http://purl.oclc.org/ooxml/officeDocument/math"
];
const drawingNamespaces = [
  "http://schemas.openxmlformats.org/drawingml/2006/main",
  "http://purl.oclc.org/ooxml/drawingml/main"
];
export interface EquationContent {
  readonly omml: string;
  readonly text: string;
  readonly supported: boolean;
}
export interface EquationRecord extends EquationContent {
  readonly location: Location;
  readonly paragraph: number;
  readonly equation: number;
  readonly coordinateSystem: "zero-based";
}
export interface AddEquationOptions extends ReadPresentationTextOptions {
  readonly file: BinaryInput;
}
function unsupported(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Only bounded presentation OMML with literal drawing text, fractions and scripts is supported for insertion.",
    "validate-intent"
  );
}
function validateStructure(document: XmlPart, root: XmlElement): void {
  const math = root.name.namespace;
  if (!mathNamespaces.includes(math) || !["oMath", "oMathPara"].includes(root.name.localName))
    unsupported();
  const drawing = drawingNamespaces[mathNamespaces.indexOf(math)]!;
  const expressions = ["r", "f", "sSup", "sSub", "sSubSup"];
  const ordered: Record<string, readonly string[]> = {
    f: ["num", "den"],
    sSup: ["e", "sup"],
    sSub: ["e", "sub"],
    sSubSup: ["e", "sub", "sup"]
  };
  function visit(node: XmlElement): void {
    const drawingText =
      [math, drawing].includes(node.name.namespace) && node.name.localName === "t";
    if (
      node.attributes.some(
        (a) =>
          !(
            drawingText &&
            a.name.namespace === "http://www.w3.org/XML/1998/namespace" &&
            a.name.localName === "space" &&
            ["preserve", "default"].includes(a.value)
          )
      )
    )
      unsupported();
    if (drawingText) {
      if (node.children.length) unsupported();
      return;
    }
    if (node.name.namespace !== math) unsupported();
    const name = node.name.localName;
    if (name === "r") {
      if (
        node.children.length !== 1 ||
        ![math, drawing].includes(node.children[0]!.name.namespace) ||
        node.children[0]!.name.localName !== "t"
      )
        unsupported();
    } else if (ordered[name]) {
      if (
        node.children.length !== ordered[name]!.length ||
        node.children.some(
          (child, i) => child.name.namespace !== math || child.name.localName !== ordered[name]![i]
        )
      )
        unsupported();
    } else if (["oMath", "oMathPara", "e", "sub", "sup", "num", "den"].includes(name)) {
      const allowed = name === "oMathPara" ? ["oMath"] : expressions;
      if (
        !node.children.length ||
        node.children.some(
          (child) => child.name.namespace !== math || !allowed.includes(child.name.localName)
        )
      )
        unsupported();
    } else unsupported();
    node.children.forEach(visit);
  }
  visit(root);
  const parser = new SaxesParser({ xmlns: true });
  let textElement = false;
  parser.on("opentag", (tag) => {
    textElement = [math, drawing].includes(tag.uri) && tag.local === "t";
  });
  parser.on("closetag", () => {
    textElement = false;
  });
  for (const event of ["text", "cdata"] as const)
    parser.on(event, (value) => {
      if (!textElement && value.trim()) unsupported();
    });
  parser.on("processinginstruction", unsupported);
  parser.on("comment", unsupported);
  parser.write(document.markup(root, true)).close();
}
export function validateAuthoredEquation(input: Uint8Array, limits: XmlLimits): string {
  const document = parseXmlPart(input, limits);
  validateStructure(document, document.root);
  return document.markup(document.root, true);
}
export function inventoryEquations(
  document: XmlPart,
  root: XmlElement = document.root
): readonly EquationContent[] {
  const records: EquationContent[] = [];
  function visit(node: XmlElement): void {
    if (
      mathNamespaces.includes(node.name.namespace) &&
      ["oMath", "oMathPara"].includes(node.name.localName)
    ) {
      let supported = true;
      try {
        validateStructure(document, node);
      } catch (error) {
        if (!(error instanceof OfficeError)) throw error;
        supported = false;
      }
      const omml = document.markup(node, true);
      let text = "";
      let inText = false;
      const parser = new SaxesParser({ xmlns: true });
      parser.on("opentag", (tag) => {
        inText = [...mathNamespaces, ...drawingNamespaces].includes(tag.uri) && tag.local === "t";
      });
      parser.on("closetag", () => {
        inText = false;
      });
      for (const event of ["text", "cdata"] as const)
        parser.on(event, (value) => {
          if (inText) text += value;
        });
      parser.write(omml).close();
      records.push({ omml, text, supported });
      return;
    }
    node.children.forEach(visit);
  }
  visit(root);
  return records;
}
export async function readEquations(
  input: BinaryInput,
  options: ReadPresentationTextOptions,
  context: SelectionContext
): Promise<readonly EquationRecord[]> {
  validateTextReadingOptions(options);
  if (options.scope !== undefined && options.scope !== "slides")
    throw new SelectionError("invalid-selection");
  const source = await readBinary(input, context, {
    maxBytes: Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
  });
  const index = await readSelectionIndex(source, context);
  const reader = await readPackage(source, context);
  const selected = options.select === undefined ? undefined : index.select(options.select);
  if (selected?.some((record) => record.scope !== "slides"))
    throw new SelectionError("invalid-selection");
  if (options.shape !== undefined && (selected?.length !== 1 || selected[0]!.kind !== "slide"))
    throw new SelectionError("invalid-selection");
  const slides = index.slides.filter(
    (slide) => !selected || selected.some((record) => record.part === slide.part)
  );
  const result: EquationRecord[] = [];
  const presentation = [
    "http://schemas.openxmlformats.org/presentationml/2006/main",
    "http://purl.oclc.org/ooxml/presentationml/main"
  ];
  for (const slide of slides) {
    context.signal?.throwIfAborted();
    const document = parseXmlPart(reader.get(slide.part), context.xmlLimits);
    const attribute = (node: XmlElement, name: string) =>
      node.attributes.find((attr) => !attr.name.namespace && attr.name.localName === name)?.value;
    function visit(
      node: XmlElement,
      location: Location = slide.location,
      included = options.shape === undefined,
      paragraph = { value: 0 }
    ): void {
      if (
        presentation.includes(node.name.namespace) &&
        ["sp", "pic", "graphicFrame", "cxnSp", "grpSp"].includes(node.name.localName)
      ) {
        const nonVisual = node.children.find(
          (child) =>
            presentation.includes(child.name.namespace) &&
            ["nvSpPr", "nvPicPr", "nvGraphicFramePr", "nvCxnSpPr", "nvGrpSpPr"].includes(
              child.name.localName
            )
        );
        const identity = nonVisual?.children.find(
          (child) => presentation.includes(child.name.namespace) && child.name.localName === "cNvPr"
        );
        const id = identity && attribute(identity, "id");
        if (id) {
          location = {
            fingerprint: index.fingerprint,
            scope: "slides",
            owner: slide.part,
            objectId: id,
            coordinateSystem: "identity"
          };
          included =
            options.shape !== undefined
              ? attribute(identity!, "name") === options.shape
              : !selected ||
                selected.some((record) => record.kind !== "object" || record.id === id);
        }
        paragraph = { value: 0 };
      }
      if (drawingNamespaces.includes(node.name.namespace) && node.name.localName === "p") {
        const paragraphIndex = paragraph.value++;
        if (included)
          result.push(
            ...inventoryEquations(document, node).map((content, equation) => ({
              ...content,
              location,
              paragraph: paragraphIndex,
              equation,
              coordinateSystem: "zero-based" as const
            }))
          );
        return;
      }
      if (
        included &&
        mathNamespaces.includes(node.name.namespace) &&
        ["oMath", "oMathPara"].includes(node.name.localName)
      ) {
        result.push(
          ...inventoryEquations(document, node).map((content, equation) => ({
            ...content,
            location,
            paragraph: paragraph.value,
            equation,
            coordinateSystem: "zero-based" as const
          }))
        );
        return;
      }
      node.children.forEach((child) => visit(child, location, included, paragraph));
    }
    visit(document.root);
  }
  return result;
}
export async function mutateEquations(
  input: BinaryInput,
  action: "add",
  options: AddEquationOptions,
  context: SelectionContext
): Promise<{ bytes: Uint8Array; affected: number; locations: readonly Location[] }> {
  if (action !== "add") unsupported();
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !["file", "scope", "select", "shape"].includes(key))
  )
    throw new OfficeError("invalid-value", "Invalid equation insertion options.", "usage");
  const { file, ...selection } = options;
  validateTextReadingOptions(selection);
  if (selection.scope !== undefined && selection.scope !== "slides")
    throw new SelectionError("invalid-selection");
  if (
    selection.shape === undefined &&
    selection.select?.token === undefined &&
    selection.select?.kind !== "object"
  )
    throw new SelectionError("missing-selection");
  const authored = await readBinary(file, context, {
    maxBytes: Math.min(context.limits.maxBytes, context.xmlLimits.maxBytes)
  });
  const omml = validateAuthoredEquation(authored, context.xmlLimits);
  const state = await loadShared(input, context);
  const authoredNamespace = parseXmlPart(authored, context.xmlLimits).root.name.namespace;
  if (mathNamespaces.indexOf(authoredNamespace) !== drawingNamespaces.indexOf(state.a))
    throw new OfficeError(
      "unsupported-edit",
      "Authored equation dialect must match the selected presentation.",
      "validate-intent"
    );
  const bodies = await readTextBodies(state.source, selection, context);
  if (!bodies.length) throw new SelectionError("missing-selection");
  if (bodies.length !== 1) throw new SelectionError("ambiguous-selection");
  const body = bodies[0]!;
  const branchPaths: XmlElement[][] = [];
  function locate(node: XmlElement, ancestors: XmlElement[]): void {
    if (node === body.node) branchPaths.push(ancestors);
    node.children.forEach((child) => locate(child, [...ancestors, node]));
  }
  locate(body.document.root, []);
  if (
    branchPaths.some((path) =>
      path.some(
        (node) =>
          node.name.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006" &&
          node.name.localName === "AlternateContent"
      )
    )
  )
    unsupported();
  const paragraph = body.paragraphs.at(-1)?.node;
  if (!paragraph || body.segment.cell || paragraph.name.namespace !== state.a) unsupported();
  const end = paragraph.children.findIndex(
    (node) =>
      node.name.namespace === paragraph.name.namespace && node.name.localName === "endParaRPr"
  );
  const next = body.document.spliceChildren(
    paragraph,
    end < 0 ? paragraph.children.length : end,
    0,
    [
      `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns=""><mc:Choice Requires="a14"><a14:m>${omml}</a14:m></mc:Choice><mc:Fallback/></mc:AlternateContent>`
    ]
  );
  state.save(body.part, next);
  return {
    bytes: (await state.finish(state.main, [])).bytes,
    affected: 1,
    locations: [body.segment.location]
  };
}
