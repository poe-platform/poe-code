import type { Chart } from "./chart-model.js";
import { OfficeError, PropertyAccessError } from "./errors.js";
import { Length } from "./length.js";
import { MSO_LANGUAGE_ID } from "./language-enum.js";
import {
  MSO_TEXT_UNDERLINE_TYPE,
  validateTextRunOptions,
  type TextRunFormatting
} from "./text-runs.js";
import { validateDrawingUpdate, type DrawingFill, type DrawingColor } from "./drawing-format.js";
import { drawingColorSchema, drawingUpdateSchema } from "./drawing-schema.js";
import type { Font } from "./text-paragraphs.js";

const owners = [
  "chart",
  "legend",
  "title",
  "categoryAxisTitle",
  "valueAxisTitle",
  "categoryTickLabels",
  "valueTickLabels",
  "dataLabels",
  "dataLabel"
] as const;
type FontOwner = (typeof owners)[number];
export interface ChartFontUpdate {
  readonly owner: FontOwner;
  readonly plot?: number;
  readonly series?: number;
  readonly point?: number;
  readonly bold?: boolean | null;
  readonly italic?: boolean | null;
  readonly name?: string | null;
  readonly size?: {
    readonly value: number;
    readonly unit: "emu" | "in" | "cm" | "mm" | "pt";
  } | null;
  readonly underline?: string | boolean | null;
  readonly languageId?: string | null;
  readonly color?: DrawingColor;
  readonly fill?: DrawingFill;
}
const symbols = (definition: object) =>
  Object.entries(definition)
    .filter(([key, value]) => typeof value === "number" && key !== "MIXED")
    .map(([key]) => key);
const fields = {
  bold: { type: ["boolean", "null"] },
  italic: { type: ["boolean", "null"] },
  name: { type: ["string", "null"], minLength: 1 },
  size: {
    anyOf: [
      { type: "null" },
      ...Object.entries({ emu: 12700, in: 1 / 72, cm: 2.54 / 72, mm: 25.4 / 72, pt: 1 }).map(
        ([unit, perPoint]) => ({
          type: "object",
          additionalProperties: false,
          required: ["value", "unit"],
          properties: {
            value: { type: "number", minimum: perPoint, maximum: 4000 * perPoint },
            unit: { const: unit }
          }
        })
      )
    ]
  },
  underline: { anyOf: [{ type: ["boolean", "null"] }, { enum: symbols(MSO_TEXT_UNDERLINE_TYPE) }] },
  languageId: { enum: [...symbols(MSO_LANGUAGE_ID), null] },
  color: drawingColorSchema,
  fill: drawingUpdateSchema.properties.fill
};
export const chartFontUpdateSchema = {
  oneOf: owners.map((owner) => ({
    type: "object",
    additionalProperties: false,
    required: [
      "owner",
      ...(owner === "dataLabels" ? ["plot"] : owner === "dataLabel" ? ["series", "point"] : [])
    ],
    properties: {
      owner: { const: owner },
      ...fields,
      ...(owner === "dataLabels"
        ? { plot: { type: "integer", minimum: 0 } }
        : owner === "dataLabel"
          ? { series: { type: "integer", minimum: 0 }, point: { type: "integer", minimum: 0 } }
          : {})
    },
    anyOf: Object.keys(fields).map((key) => ({ required: [key] })),
    not: { required: ["color", "fill"] }
  }))
};
function invalid(): never {
  throw new OfficeError("invalid-value", "Invalid chart font update.", "usage");
}
function plain(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (ancestors.has(value) || ancestors.size >= 64) invalid();
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 10000) invalid();
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (
        typeof key !== "string" ||
        !Number.isSafeInteger(Number(key)) ||
        String(Number(key)) !== key ||
        Number(key) < 0 ||
        Number(key) >= value.length ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      )
        invalid();
      plain(descriptor.value, ancestors);
    }
    for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, String(i))) invalid();
  } else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (
        typeof key !== "string" ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        descriptor.value === undefined
      )
        invalid();
      plain(descriptor.value, ancestors);
    }
  }
  ancestors.delete(value);
}
function size(value: NonNullable<ChartFontUpdate["size"]>): Length {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).some((key) => !["value", "unit"].includes(key)) ||
    typeof value.value !== "number" ||
    !Number.isFinite(value.value)
  )
    invalid();
  const factors = { emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700 };
  if (!Object.hasOwn(factors, value.unit)) invalid();
  return new Length(value.value * factors[value.unit]);
}
function enumValue(definition: object, name: string): number {
  if (typeof name !== "string" || !Object.hasOwn(definition, name) || name === "MIXED") invalid();
  const result = (definition as Record<string, unknown>)[name];
  if (typeof result !== "number") invalid();
  return result;
}
export function validateChartFontUpdate(value: unknown): asserts value is ChartFontUpdate {
  plain(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const update = value as ChartFontUpdate;
  if (!owners.includes(update.owner)) invalid();
  const selectors =
    update.owner === "dataLabels"
      ? ["plot"]
      : update.owner === "dataLabel"
        ? ["series", "point"]
        : [];
  if (
    Object.keys(update).some(
      (key) => !["owner", ...Object.keys(fields), ...selectors].includes(key)
    ) ||
    !Object.keys(fields).some((key) => Object.hasOwn(update, key))
  )
    invalid();
  for (const key of selectors) {
    const v = (update as unknown as Record<string, unknown>)[key];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) invalid();
  }
  if (update.color !== undefined && update.fill !== undefined) invalid();
  const formatting: TextRunFormatting = {
    ...(update.bold === undefined ? {} : { bold: update.bold }),
    ...(update.italic === undefined ? {} : { italic: update.italic }),
    ...(update.name === undefined ? {} : { font: update.name }),
    ...(update.size === undefined
      ? {}
      : { size: update.size === null ? null : size(update.size).pt }),
    ...(update.underline === undefined
      ? {}
      : {
          underline:
            typeof update.underline === "string"
              ? (enumValue(MSO_TEXT_UNDERLINE_TYPE, update.underline) as MSO_TEXT_UNDERLINE_TYPE)
              : update.underline
        }),
    ...(update.languageId === undefined
      ? {}
      : {
          language:
            update.languageId === null || update.languageId === "NONE"
              ? null
              : MSO_LANGUAGE_ID.to_xml(
                  enumValue(MSO_LANGUAGE_ID, update.languageId) as MSO_LANGUAGE_ID
                )
        })
  };
  if (Object.keys(formatting).length) validateTextRunOptions(formatting);
  if (update.color !== undefined)
    validateDrawingUpdate({ fill: { kind: "solid", color: update.color } });
  if (update.fill !== undefined) validateDrawingUpdate({ fill: update.fill });
}
function fontFor(chart: Chart, update: ChartFontUpdate): Font {
  switch (update.owner) {
    case "chart":
      return chart.font;
    case "legend": {
      const legend = chart.legend;
      if (!legend) throw new PropertyAccessError("Chart has no legend.");
      return legend.font;
    }
    case "title":
      return chart.chart_title.text_frame.paragraphs[0]!.font;
    case "categoryAxisTitle":
      return chart.category_axis.axis_title.text_frame.paragraphs[0]!.font;
    case "valueAxisTitle":
      return chart.value_axis.axis_title.text_frame.paragraphs[0]!.font;
    case "categoryTickLabels":
      return chart.category_axis.tick_labels.font;
    case "valueTickLabels":
      return chart.value_axis.tick_labels.font;
    case "dataLabels":
      return chart.plots.at(update.plot!).data_labels.font;
    case "dataLabel":
      return chart.series.at(update.series!).points.at(update.point!).data_label.font;
  }
}
export function applyChartFontUpdate(chart: Chart, update: ChartFontUpdate): void {
  validateChartFontUpdate(update);
  const font = fontFor(chart, update);
  if (update.bold !== undefined) font.bold = update.bold;
  if (update.italic !== undefined) font.italic = update.italic;
  if (update.name !== undefined) font.name = update.name;
  if (update.size !== undefined) font.size = update.size === null ? null : size(update.size);
  if (update.underline !== undefined)
    font.underline =
      typeof update.underline === "string"
        ? (enumValue(MSO_TEXT_UNDERLINE_TYPE, update.underline) as MSO_TEXT_UNDERLINE_TYPE)
        : update.underline;
  if (update.languageId !== undefined)
    font.language_id =
      update.languageId === null
        ? null
        : (enumValue(MSO_LANGUAGE_ID, update.languageId) as MSO_LANGUAGE_ID);
  if (update.color !== undefined) font.fill.apply({ kind: "solid", color: update.color });
  if (update.fill !== undefined) font.fill.apply(update.fill);
}
