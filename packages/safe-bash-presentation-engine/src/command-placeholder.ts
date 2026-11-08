import { readBinary } from "./bytes.js";
import { admitImage } from "./image-admission.js";
import type { BinaryInput } from "./contracts.js";
import {
  validateChartData,
  chartTypes,
  type ChartData,
  type CreatableChartType
} from "./chart-editing.js";
import { Presentation } from "./presentation-model.js";
import { SlidePlaceholder } from "./slide-model.js";
import { ValueError } from "./errors.js";
import { readSelectionIndex, type SelectionContext } from "./selectors.js";

export type PlaceholderContent =
  | { kind: "picture"; input: BinaryInput; altText?: string; contentType?: string }
  | { kind: "table"; rows: number; columns: number }
  | { kind: "chart"; type: CreatableChartType; data: ChartData };

export async function insertPlaceholder(
  input: BinaryInput,
  options: { slide: number; placeholder: number; content: PlaceholderContent },
  context: SelectionContext
) {
  const data = (value: unknown, keys: readonly string[]) => {
    if (
      !value ||
      typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(
        (key) =>
          typeof key !== "string" ||
          !keys.includes(key) ||
          !("value" in Object.getOwnPropertyDescriptor(value, key)!)
      )
    )
      throw new ValueError("Placeholder options require closed stored data.");
  };
  data(options, ["slide", "placeholder", "content"]);
  data(options.content, [
    "kind",
    "input",
    "altText",
    "contentType",
    "rows",
    "columns",
    "type",
    "data"
  ]);
  const content = options.content;
  if (!["picture", "table", "chart"].includes(content.kind))
    throw new ValueError("Unknown placeholder content kind.");
  data(
    content,
    content.kind === "picture"
      ? ["kind", "input", "altText", "contentType"]
      : content.kind === "table"
        ? ["kind", "rows", "columns"]
        : ["kind", "type", "data"]
  );
  if (
    content.kind === "table" &&
    (!Number.isSafeInteger(content.rows) ||
      !Number.isSafeInteger(content.columns) ||
      content.rows < 1 ||
      content.columns < 1 ||
      content.rows * content.columns > 250000)
  )
    throw new ValueError("Invalid placeholder table dimensions.");
  if (content.kind === "chart") {
    if (!chartTypes.includes(content.type)) throw new ValueError("Unknown placeholder chart type.");
    validateChartData(content.data, content.type);
  }
  if (
    content.kind === "picture" &&
    ((content.altText !== undefined && typeof content.altText !== "string") ||
      (content.contentType !== undefined &&
        !["image/png", "image/jpeg"].includes(content.contentType)))
  )
    throw new ValueError("Invalid picture placeholder metadata.");
  if (
    !Number.isSafeInteger(options.slide) ||
    options.slide < 1 ||
    !Number.isSafeInteger(options.placeholder) ||
    options.placeholder < 0 ||
    options.placeholder > 4294967295
  )
    throw new ValueError("Placeholder insertion requires a slide and nonnegative idx.");
  const pictureBytes =
    content.kind === "picture"
      ? await readBinary(content.input, context, { maxBytes: context.archiveLimits.maxEntryBytes })
      : undefined;
  if (content.kind === "picture" && content.contentType !== undefined)
    admitImage(pictureBytes!, content.contentType);
  const deck = await Presentation(input, context);
  const target = deck.slides.get(options.slide - 1).placeholders.get(options.placeholder);
  if (!(target instanceof SlidePlaceholder))
    throw new ValueError("Placeholder is already populated.");
  const id = target.shape_id;
  if (content.kind === "table") target.insert_table(content.rows, content.columns);
  else if (content.kind === "chart") await target.insert_chart(content.type, content.data);
  else {
    const picture = await target.insert_picture(pictureBytes!);
    if (content.altText !== undefined) picture.description = content.altText;
  }
  const bytes = await deck.save();
  const index = await readSelectionIndex(bytes, context);
  const slide = index.inventory.slides[options.slide - 1]!;
  const records = index.objects.filter(
    (record) => record.part === slide.part && record.id === String(id)
  );
  return {
    bytes,
    part: slide.part,
    affected: 1,
    affectedSlides: [options.slide],
    records,
    shapeId: id
  };
}
