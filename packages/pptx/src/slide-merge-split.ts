import type { BinaryInput } from "./contracts.js";
import { validatePresentation } from "./validation.js";
import { OfficeError } from "./errors.js";
import { writePackageArchive } from "./package-writer.js";
import type { SelectionContext } from "./selectors.js";
import { importSelectedSlides, type ImportSlidesOptions } from "./slide-import.js";
import { SlideTransferBudget } from "./slide-transfer-budget.js";

export interface MergeSlidesOptions {
  readonly sourceSlides?: readonly number[];
  readonly themePolicy: "source" | "destination";
  readonly dimensionPolicy?: "reject" | "destination";
}
export interface SplitSlidesOptions {
  readonly slides: readonly number[];
}
export interface SplitSlideOutput {
  readonly name: string;
  readonly sourceSlide: number;
  readonly bytes: Uint8Array;
}
function fields(value: unknown, allowed: readonly string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new OfficeError("invalid-value", "Invalid slide transfer options.", "usage");
}
function positions(value: readonly number[], maximum: number): number[] {
  if (!Array.isArray(value) || !value.length)
    throw new OfficeError("invalid-value", "Slide selection must be a nonempty array.", "usage");
  if (value.length > maximum)
    throw new OfficeError("resource-limit", "Too many slide selections.", "usage");
  const copy = Array.from(value);
  if (
    copy.some((position) => !Number.isSafeInteger(position) || position < 1) ||
    new Set(copy).size !== copy.length
  )
    throw new OfficeError(
      "invalid-value",
      "Slide positions must be unique positive integers.",
      "usage"
    );
  return copy;
}
function transferContext(context: SelectionContext): void {
  if (
    !context?.limits ||
    !context.archiveLimits ||
    !context.xmlLimits ||
    !context.relationshipLimits
  )
    throw new OfficeError("invalid-value", "Explicit slide transfer limits are required.", "usage");
}
async function presentation(bytes: Uint8Array, budget: SlideTransferBudget) {
  const reader = await budget.open(bytes);
  const limits = {
    ...budget.context.xmlLimits,
    ...budget.context.relationshipLimits,
    maxBytes: Math.min(
      budget.context.xmlLimits.maxBytes,
      budget.context.relationshipLimits.maxBytes
    ),
    maxEntries: budget.context.archiveLimits.maxMembers
  };
  if (!validatePresentation(reader, limits).valid)
    throw new OfficeError(
      "invalid-opc",
      "Slide transfer requires a valid presentation graph.",
      "validate-intent"
    );
  const graph = budget.graph(reader);
  if (graph.dangling.length)
    throw new OfficeError(
      "invalid-opc",
      "Presentation contains missing referenced parts.",
      "validate-intent"
    );
  const main = graph
    .outgoing("/")
    .find((edge) => edge.type.endsWith("/officeDocument"))?.targetPart;
  if (!main)
    throw new OfficeError("invalid-opc", "Presentation part is missing.", "validate-intent");
  const xml = budget.xml(reader.get(main));
  const slides = xml.root.children
    .filter(
      (node) =>
        node.name.namespace === xml.root.name.namespace && node.name.localName === "sldIdLst"
    )
    .flatMap((list) =>
      list.children.filter(
        (node) => node.name.namespace === xml.root.name.namespace && node.name.localName === "sldId"
      )
    );
  return { reader, graph, main, xml, slides };
}

function mergeIntent(
  sources: readonly BinaryInput[],
  options: MergeSlidesOptions,
  context: SelectionContext
) {
  if (
    !Array.isArray(sources) ||
    !sources.length ||
    !["source", "destination"].includes(options.themePolicy) ||
    (options.dimensionPolicy !== undefined &&
      !["reject", "destination"].includes(options.dimensionPolicy))
  )
    throw new OfficeError("invalid-value", "Invalid merge sources or policies.", "usage");
  if (sources.length > context.relationshipLimits.maxParts)
    throw new OfficeError("resource-limit", "Too many merge sources.", "usage");
  if (options.themePolicy === "destination")
    throw new OfficeError(
      "unsupported-edit",
      "Merge currently requires source theme preservation.",
      "validate-intent"
    );
  const selected =
    options.sourceSlides === undefined
      ? undefined
      : positions(options.sourceSlides, context.relationshipLimits.maxParts);
  const inputs = Array.from(sources);
  if (
    inputs.some(
      (input) =>
        !(input instanceof Uint8Array) &&
        (!input ||
          typeof input !== "object" ||
          ("path" in input
            ? typeof input.path !== "string" ||
              !input.path ||
              !input.capability ||
              typeof input.capability.openRead !== "function"
            : typeof input.read !== "function"))
    )
  )
    throw new OfficeError(
      "invalid-type",
      "Merge sources require bytes or explicit input capabilities.",
      "usage"
    );
  const policy = {
    themePolicy: options.themePolicy,
    ...(options.dimensionPolicy === undefined ? {} : { dimensionPolicy: options.dimensionPolicy })
  };
  return { inputs, selected, policy };
}

export async function mergeSlides(
  destination: BinaryInput,
  sources: readonly BinaryInput[],
  options: MergeSlidesOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  transferContext(context);
  fields(options, ["sourceSlides", "themePolicy", "dimensionPolicy"]);
  const { inputs, selected, policy } = mergeIntent(sources, options, context);
  return mergeSelectedDecks(
    destination,
    inputs,
    { ...policy, ...(selected === undefined ? {} : { sourceSlides: selected }) },
    context,
    new SlideTransferBudget(context)
  );
}

export async function mergeSelectedDecks(
  destination: BinaryInput,
  sources: readonly BinaryInput[],
  options: MergeSlidesOptions,
  context: SelectionContext,
  budget: SlideTransferBudget
): Promise<Uint8Array> {
  transferContext(context);
  fields(options, ["sourceSlides", "themePolicy", "dimensionPolicy"]);
  const { inputs, selected, policy } = mergeIntent(sources, options, context);
  context = budget.context;
  let result = await budget.read(destination);
  await presentation(result, budget);
  for (const source of inputs) {
    const bytes = await budget.read(source);
    const info = await presentation(bytes, budget);
    const sourceSlides = selected ?? info.slides.map((_, index) => index + 1);
    if (sourceSlides.some((position) => position > info.slides.length))
      throw new OfficeError(
        "missing-selection",
        "Slide position is outside a source slide list.",
        "select"
      );
    if (!sourceSlides.length)
      throw new OfficeError("missing-selection", "Source has no selected slides.", "select");
    result = await importSelectedSlides(
      result,
      bytes,
      { sourceSlides, ...policy },
      context,
      budget
    );
  }
  return result;
}

export async function splitSlides(
  input: BinaryInput,
  options: SplitSlidesOptions,
  context: SelectionContext
): Promise<readonly SplitSlideOutput[]> {
  transferContext(context);
  fields(options, ["slides"]);
  const selected = positions(options.slides, context.relationshipLimits.maxParts);
  return splitSelectedDecks(input, { slides: selected }, context, new SlideTransferBudget(context));
}

export async function splitSelectedDecks(
  input: BinaryInput,
  options: SplitSlidesOptions,
  context: SelectionContext,
  budget: SlideTransferBudget
): Promise<readonly SplitSlideOutput[]> {
  transferContext(context);
  fields(options, ["slides"]);
  const selected = positions(options.slides, context.relationshipLimits.maxParts);
  context = budget.context;
  const source = await budget.read(input);
  const info = await presentation(source, budget);
  if (selected.some((position) => position > info.slides.length))
    throw new OfficeError(
      "missing-selection",
      "Slide position is outside the slide list.",
      "select"
    );
  let blank = info.xml;
  for (let index = blank.root.children.length - 1; index >= 0; index--) {
    const node = blank.root.children[index]!;
    if (
      node.name.namespace !== blank.root.name.namespace ||
      !["sldSz", "notesSz", "defaultTextStyle", "kinsoku"].includes(node.name.localName)
    )
      blank = blank.spliceChildren(blank.root, index, 1, []);
  }
  const relationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
  const dialect = info.graph.outgoing("/").find((edge) => edge.targetPart === info.main)!.type;
  const encoder = new TextEncoder();
  const seed = await writePackageArchive(
    [
      {
        name: "[Content_Types].xml",
        bytes: encoder.encode(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>'
        )
      },
      {
        name: "_rels/.rels",
        bytes: encoder.encode(
          `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="deck" Type="${dialect}" Target="ppt/presentation.xml"/></Relationships>`
        )
      },
      { name: "ppt/presentation.xml", bytes: blank.bytes() },
      {
        name: "ppt/_rels/presentation.xml.rels",
        bytes: encoder.encode(`<Relationships xmlns="${relationshipNamespace}"/>`)
      }
    ],
    budget.outputContext(),
    { compression: "auto" }
  );
  budget.output(seed);
  const outputs: SplitSlideOutput[] = [];
  for (const sourceSlide of selected) {
    const importOptions: ImportSlidesOptions = {
      sourceSlides: [sourceSlide],
      themePolicy: "source"
    };
    const bytes = await importSelectedSlides(seed, source, importOptions, context, budget);
    outputs.push({
      name: `slide-${String(outputs.length + 1).padStart(6, "0")}.pptx`,
      sourceSlide,
      bytes
    });
  }
  return outputs;
}
