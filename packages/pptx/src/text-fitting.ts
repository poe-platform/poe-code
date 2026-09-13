import { paragraphPropertiesMerge } from "./text-paragraphs.js";
import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { bestFitText, type FontMetricsHandle } from "./font-metrics.js";
import { loadShared } from "./masters.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import {
  readTextBodies,
  validateTextReadingOptions,
  type ReadPresentationTextOptions
} from "./text-reading.js";
import { TextFrame, applyFrameFormatting, readFrameFormatting } from "./text-frames.js";
import { runPropertiesMerge } from "./text-runs.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";

export interface TextFitOptions {
  readonly metrics: FontMetricsHandle;
  readonly fontFamily?: string;
  readonly maxSize?: number;
  readonly minSize?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly marginLeft?: number;
  readonly marginRight?: number;
  readonly marginTop?: number;
  readonly marginBottom?: number;
  readonly wrap?: boolean;
  readonly lineSpacing?: number;
}
export type ModelTextFitOptions = Omit<
  TextFitOptions,
  "metrics" | "fontFamily" | "maxSize" | "bold" | "italic"
>;
export interface FitTextFramesOptions extends TextFitOptions, ReadPresentationTextOptions {
  readonly all?: boolean;
  readonly allowEmpty?: boolean;
}
function unsupported(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Text fitting requires supplied matching metrics and a supported horizontal single-column frame.",
    "validate-intent"
  );
}
export function validateTextFitOptions(options: FitTextFramesOptions): void {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  )
    throw new OfficeError("invalid-value", "Invalid text fit options.", "usage");
  const allowed = [
    "metrics",
    "fontFamily",
    "maxSize",
    "minSize",
    "bold",
    "italic",
    "marginLeft",
    "marginRight",
    "marginTop",
    "marginBottom",
    "wrap",
    "lineSpacing",
    "scope",
    "select",
    "shape",
    "all",
    "allowEmpty"
  ];
  if (
    Reflect.ownKeys(options).some(
      (k) =>
        typeof k !== "string" ||
        !allowed.includes(k) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(options, k)!, "value")
    )
  )
    throw new OfficeError("invalid-value", "Invalid text fit options.", "usage");
  if (!options.metrics) unsupported();
  if ((options.maxSize ?? 18) > 4000)
    throw new OfficeError("invalid-value", "Text fit sizes must not exceed 4000 points.", "usage");
  for (const key of ["all", "allowEmpty", "wrap"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean")
      throw new OfficeError("invalid-value", "Invalid text fit options.", "usage");
  for (const key of ["marginLeft", "marginRight", "marginTop", "marginBottom"] as const)
    if (
      options[key] !== undefined &&
      (typeof options[key] !== "number" ||
        !Number.isFinite(options[key]) ||
        options[key] < 0 ||
        options[key] > 2147483647 / 12700)
    )
      throw new OfficeError("invalid-value", "Invalid text fit margins.", "usage");
  validateTextReadingOptions({
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.select === undefined ? {} : { select: options.select }),
    ...(options.shape === undefined ? {} : { shape: options.shape })
  });
  bestFitText(options.metrics, "", {
    family: options.fontFamily ?? "Calibri",
    bold: options.bold ?? false,
    italic: options.italic ?? false,
    maxSize: options.maxSize ?? 18,
    minSize: options.minSize ?? 1,
    width: 0,
    height: 0,
    wrap: options.wrap ?? true,
    lineSpacing: options.lineSpacing ?? 1
  });
}
export function fitFrameXml(xml: XmlPart, options: TextFitOptions, width: number, height: number) {
  validateTextFitOptions(options);
  if (
    ![width, height].every(
      (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1000000000
    )
  )
    throw new OfficeError("invalid-value", "Invalid text frame extents.", "usage");
  const formatting = readFrameFormatting(xml.root);
  if (
    (formatting.columns ?? 1) !== 1 ||
    ![null, "horz"].includes(formatting.verticalText) ||
    (formatting.rotation ?? 0) !== 0
  )
    unsupported();
  const ns = xml.root.name.namespace.includes("purl.oclc.org")
    ? "http://purl.oclc.org/ooxml/drawingml/main"
    : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const name = (localName: string) => ({ namespace: ns, localName });
  const check = (node: XmlElement) => {
    if (node.name.namespace !== ns) return;
    if (["buChar", "buAutoNum", "buBlip", "tabLst"].includes(node.name.localName)) unsupported();
    if (
      node.attributes.some(
        (a) =>
          !a.name.namespace &&
          ["marL", "marR", "indent", "lvl", "spc", "baseline"].includes(a.name.localName) &&
          Number(a.value) !== 0
      )
    )
      unsupported();
    if (
      node.attributes.some(
        (a) => !a.name.namespace && a.name.localName === "cap" && a.value !== "none"
      )
    )
      unsupported();
    node.children.forEach(check);
  };
  xml.root.children.forEach(check);
  const margins = {
    marginLeft: options.marginLeft ?? formatting.marginLeft ?? 7.2,
    marginRight: options.marginRight ?? formatting.marginRight ?? 7.2,
    marginTop: options.marginTop ?? formatting.marginTop ?? 3.6,
    marginBottom: options.marginBottom ?? formatting.marginBottom ?? 3.6
  };
  for (const key of Object.keys(margins) as (keyof typeof margins)[])
    margins[key] = Math.round(margins[key] * 12700) / 12700;
  if (Object.values(margins).some((v) => v < 0)) unsupported();
  const family = options.fontFamily ?? "Calibri",
    bold = options.bold ?? false,
    italic = options.italic ?? false;
  const lineSpacing = Math.round((options.lineSpacing ?? 1) * 100000) / 100000;
  if (
    width < margins.marginLeft + margins.marginRight ||
    height < margins.marginTop + margins.marginBottom
  )
    unsupported();
  const size = bestFitText(options.metrics, new TextFrame(xml).text, {
    family,
    bold,
    italic,
    width: width - margins.marginLeft - margins.marginRight,
    height: height - margins.marginTop - margins.marginBottom,
    minSize: options.minSize ?? 1,
    maxSize: options.maxSize ?? 18,
    wrap: options.wrap ?? true,
    lineSpacing,
    preserveBreaks: true,
    preserveSpaces: true
  });
  if (size === null)
    throw new OfficeError(
      "unsupported-edit",
      "Text does not fit within the supplied size bounds.",
      "validate-intent"
    );
  let result = applyFrameFormatting(xml, xml.root, {
    ...margins,
    wrap: options.wrap ?? true,
    autofit: "none"
  });
  const paragraphIndexes = result.root.children.flatMap((p, i) =>
    p.name.namespace === ns && p.name.localName === "p" ? [i] : []
  );
  for (const index of paragraphIndexes) {
    if (
      !result.root.children[index]!.children.some(
        (n) => n.name.namespace === ns && n.name.localName === "pPr"
      )
    )
      result = result.spliceChildren(result.root.children[index]!, 0, 0, [`<pPr xmlns="${ns}"/>`]);
    if (
      !result.root.children[index]!.children.some(
        (n) => n.name.namespace === ns && n.name.localName === "endParaRPr"
      )
    )
      result = result.spliceChildren(
        result.root.children[index]!,
        result.root.children[index]!.children.length,
        0,
        [`<endParaRPr xmlns="${ns}"/>`]
      );
    result = result.merge(result.root.children[index]!, {
      children: {
        sequence: ["pPr", "endParaRPr"].map(name),
        remove: [],
        upsert: [
          {
            name: name("pPr"),
            merge: paragraphPropertiesMerge(
              {
                lineSpacing: { unit: "multiple", value: lineSpacing },
                spaceBefore: 0,
                spaceAfter: 0
              },
              ns
            )
          },
          {
            name: name("endParaRPr"),
            merge: runPropertiesMerge({ font: family, size, bold, italic }, ns)
          }
        ]
      }
    });
    const paragraph = result.root.children[index]!;
    for (const [childIndex, child] of paragraph.children.entries()) {
      if (child.name.namespace !== ns || !["r", "fld", "br"].includes(child.name.localName))
        continue;
      result = result.merge(result.root.children[index]!.children[childIndex]!, {
        children: {
          sequence: ["rPr", "pPr", "t"].map(name),
          remove: [],
          upsert: [
            {
              name: name("rPr"),
              merge: runPropertiesMerge({ font: family, size, bold, italic }, ns)
            }
          ]
        }
      });
    }
  }
  return { xml: result, size };
}

export async function fitTextFrames(
  input: BinaryInput,
  options: FitTextFramesOptions,
  context: SelectionContext
) {
  validateTextFitOptions(options);
  if (!options.all && options.select === undefined && options.shape === undefined)
    throw new SelectionError("missing-selection");
  const state = await loadShared(input, context);
  const bodies = (
    await readTextBodies(
      state.source,
      {
        ...(options.scope === undefined ? {} : { scope: options.scope }),
        ...(options.select === undefined ? {} : { select: options.select }),
        ...(options.shape === undefined ? {} : { shape: options.shape })
      },
      context
    ).catch((error) => {
      if (error instanceof SelectionError && error.code === "missing-selection") return [];
      throw error;
    })
  ).filter((b) => b.segment.cell === undefined);
  if (!bodies.length && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (bodies.length > 1 && !options.all) throw new SelectionError("ambiguous-selection");
  const documents = new Map<string, XmlPart>();
  const sizes: number[] = [];
  for (const body of bodies) {
    context.signal?.throwIfAborted();
    const path: number[] = [];
    function locate(node: XmlElement): boolean {
      if (node === body.node) return true;
      for (const [i, child] of node.children.entries()) {
        path.push(i);
        if (locate(child)) return true;
        path.pop();
      }
      return false;
    }
    if (!locate(body.document.root)) unsupported();
    const parentPath = path.slice(0, -1);
    const parent = parentPath.reduce((n, i) => n.children[i]!, body.document.root);
    const shapeNs = parent.name.namespace;
    const props = parent.children.find(
      (n) => n.name.namespace === shapeNs && n.name.localName === "spPr"
    );
    const transform = props?.children.find(
      (n) =>
        n.name.localName === "xfrm" &&
        n.name.namespace ===
          (shapeNs.includes("purl.oclc.org")
            ? "http://purl.oclc.org/ooxml/drawingml/main"
            : "http://schemas.openxmlformats.org/drawingml/2006/main")
    );
    const extent = transform?.children.find(
      (n) => n.name.namespace === transform.name.namespace && n.name.localName === "ext"
    );
    if (!extent) unsupported();
    const dimension = (key: string) => {
      const raw = extent.attributes.find(
        (a) => !a.name.namespace && a.name.localName === key
      )?.value;
      if (!raw || [...raw].some((c) => c < "0" || c > "9") || !Number.isSafeInteger(Number(raw)))
        unsupported();
      return Number(raw) / 12700;
    };
    let document = documents.get(body.part) ?? body.document;
    const node = path.reduce((n, i) => n.children[i]!, document.root);
    const standalone = parseXmlPart(
      new TextEncoder().encode(document.markup(node, true)),
      context.xmlLimits
    );
    const fitted = fitFrameXml(standalone, options, dimension("cx"), dimension("cy"));
    document = document.spliceChildren(
      parentPath.reduce((n, i) => n.children[i]!, document.root),
      path.at(-1)!,
      1,
      [new TextDecoder().decode(fitted.xml.bytes())]
    );
    documents.set(body.part, document);
    sizes.push(fitted.size);
  }
  for (const [part, document] of documents) state.save(part, document);
  return {
    bytes: bodies.length ? (await state.finish(state.main, [])).bytes : state.source,
    affected: bodies.length,
    locations: bodies.map((b) => b.segment.location),
    sizes
  };
}
