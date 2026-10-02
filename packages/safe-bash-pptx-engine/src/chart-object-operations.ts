import {
  chartFontUpdateSchema,
  validateChartFontUpdate,
  type ChartFontUpdate
} from "./chart-font-operations.js";
import { drawingUpdateSchema } from "./drawing-schema.js";
import { validateDrawingUpdate, type DrawingUpdate } from "./drawing-format.js";
import { OfficeError } from "./errors.js";
import {
  XL_AXIS_CROSSES,
  XL_DATA_LABEL_POSITION,
  XL_LEGEND_POSITION,
  XL_MARKER_STYLE,
  XL_TICK_LABEL_POSITION,
  XL_TICK_MARK
} from "./chart-enums.js";

type Field = {
  type?: string | string[];
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
};
const boolean = { type: "boolean" };
const number = { type: ["number", "null"] };
const text = { type: "string" };
const index = { type: "integer", minimum: 0 };
const symbols = (values: object, excluded: readonly string[] = []): Field => ({
  enum: Object.entries(values)
    .filter(([key, value]) => typeof value === "number" && !excluded.includes(key))
    .map(([key]) => key)
});
const axis = {
  hasTitle: boolean,
  hasMajorGridlines: boolean,
  hasMinorGridlines: boolean,
  majorTickMark: symbols(XL_TICK_MARK),
  minorTickMark: symbols(XL_TICK_MARK),
  maximumScale: number,
  minimumScale: number,
  reverseOrder: boolean,
  tickLabelPosition: symbols(XL_TICK_LABEL_POSITION),
  visible: boolean
};
const formatOwners = [
  "title",
  "legend",
  "categoryAxis",
  "valueAxis",
  "categoryAxisTitle",
  "valueAxisTitle",
  "categoryMajorGridlines",
  "valueMajorGridlines",
  "series",
  "point",
  "marker"
] as const;
const definitions: Record<
  string,
  { selectors?: readonly string[]; required?: readonly string[]; fields: Record<string, Field> }
> = {
  format: {
    selectors: ["owner", "series", "point"],
    required: ["owner", "drawing"],
    fields: {
      owner: { enum: formatOwners },
      series: index,
      point: index,
      drawing: { type: "object" }
    }
  },
  chart: {
    fields: {
      hasTitle: boolean,
      hasLegend: boolean,
      style: { type: ["integer", "null"], minimum: 1, maximum: 48 }
    }
  },
  title: { fields: { hasTextFrame: boolean, text } },
  legend: {
    fields: {
      position: symbols(XL_LEGEND_POSITION, ["CUSTOM"]),
      includeInLayout: { type: ["boolean", "null"] },
      horzOffset: { type: ["number", "null"], minimum: -1, maximum: 1 }
    }
  },
  categoryAxis: { fields: axis },
  valueAxis: {
    fields: {
      ...axis,
      crosses: symbols(XL_AXIS_CROSSES),
      crossesAt: number,
      majorUnit: { ...number, exclusiveMinimum: 0 },
      minorUnit: { ...number, exclusiveMinimum: 0 }
    }
  },
  axisTitle: {
    selectors: ["axis"],
    required: ["axis"],
    fields: { axis: { enum: ["category", "value"] }, hasTextFrame: boolean, text }
  },
  tickLabels: {
    selectors: ["axis"],
    required: ["axis"],
    fields: {
      axis: { enum: ["category", "value"] },
      numberFormat: text,
      numberFormatIsLinked: boolean,
      offset: { type: "integer", minimum: 0, maximum: 1000 }
    }
  },
  plot: {
    selectors: ["plot"],
    required: ["plot"],
    fields: {
      plot: index,
      hasDataLabels: boolean,
      varyByCategories: boolean,
      gapWidth: { type: "integer", minimum: 0, maximum: 500 },
      overlap: { type: "integer", minimum: -100, maximum: 100 },
      bubbleScale: { type: ["integer", "null"], minimum: 0, maximum: 300 }
    }
  },
  series: {
    selectors: ["series"],
    required: ["series"],
    fields: { series: index, invertIfNegative: boolean, smooth: boolean }
  },
  marker: {
    selectors: ["series", "point"],
    required: ["series"],
    fields: {
      series: index,
      point: index,
      style: { enum: [...symbols(XL_MARKER_STYLE).enum!, null] },
      size: { type: ["integer", "null"], minimum: 2, maximum: 72 }
    }
  },
  dataLabels: {
    selectors: ["plot"],
    required: ["plot"],
    fields: {
      plot: index,
      position: { enum: [...symbols(XL_DATA_LABEL_POSITION, ["MIXED"]).enum!, null] },
      numberFormat: text,
      numberFormatIsLinked: boolean,
      showCategoryName: boolean,
      showLegendKey: boolean,
      showPercentage: boolean,
      showSeriesName: boolean,
      showValue: boolean
    }
  },
  dataLabel: {
    selectors: ["series", "point"],
    required: ["series", "point"],
    fields: {
      series: index,
      point: index,
      position: { enum: [...symbols(XL_DATA_LABEL_POSITION, ["MIXED"]).enum!, null] },
      hasTextFrame: boolean,
      text
    }
  }
};
type AxisFields = {
  readonly hasTitle?: boolean;
  readonly hasMajorGridlines?: boolean;
  readonly hasMinorGridlines?: boolean;
  readonly majorTickMark?: string;
  readonly minorTickMark?: string;
  readonly maximumScale?: number | null;
  readonly minimumScale?: number | null;
  readonly reverseOrder?: boolean;
  readonly tickLabelPosition?: string;
  readonly visible?: boolean;
};
type TitleFields = { readonly hasTextFrame?: boolean; readonly text?: string };
export type ChartObjectUpdate =
  | ({ readonly target: "font" } & ChartFontUpdate)
  | {
      readonly target: "format";
      readonly owner: (typeof formatOwners)[number];
      readonly series?: number;
      readonly point?: number;
      readonly drawing: DrawingUpdate;
    }
  | {
      readonly target: "chart";
      readonly hasTitle?: boolean;
      readonly hasLegend?: boolean;
      readonly style?: number | null;
    }
  | ({ readonly target: "title" } & TitleFields)
  | {
      readonly target: "legend";
      readonly position?: string;
      readonly includeInLayout?: boolean | null;
      readonly horzOffset?: number | null;
    }
  | ({ readonly target: "categoryAxis" } & AxisFields)
  | ({
      readonly target: "valueAxis";
      readonly crosses?: string;
      readonly crossesAt?: number | null;
      readonly majorUnit?: number | null;
      readonly minorUnit?: number | null;
    } & AxisFields)
  | ({ readonly target: "axisTitle"; readonly axis: "category" | "value" } & TitleFields)
  | {
      readonly target: "tickLabels";
      readonly axis: "category" | "value";
      readonly numberFormat?: string;
      readonly numberFormatIsLinked?: boolean;
      readonly offset?: number;
    }
  | {
      readonly target: "plot";
      readonly plot: number;
      readonly hasDataLabels?: boolean;
      readonly varyByCategories?: boolean;
      readonly gapWidth?: number;
      readonly overlap?: number;
      readonly bubbleScale?: number | null;
    }
  | {
      readonly target: "series";
      readonly series: number;
      readonly invertIfNegative?: boolean;
      readonly smooth?: boolean;
    }
  | {
      readonly target: "marker";
      readonly series: number;
      readonly point?: number;
      readonly style?: string | null;
      readonly size?: number | null;
    }
  | {
      readonly target: "dataLabels";
      readonly plot: number;
      readonly position?: string | null;
      readonly numberFormat?: string;
      readonly numberFormatIsLinked?: boolean;
      readonly showCategoryName?: boolean;
      readonly showLegendKey?: boolean;
      readonly showPercentage?: boolean;
      readonly showSeriesName?: boolean;
      readonly showValue?: boolean;
    }
  | ({
      readonly target: "dataLabel";
      readonly series: number;
      readonly point: number;
      readonly position?: string | null;
    } & TitleFields);
export const chartObjectSchema = {
  type: "array",
  minItems: 1,
  maxItems: 10000,
  items: {
    oneOf: [
      ...chartFontUpdateSchema.oneOf.map((schema) => ({
        ...schema,
        required: ["target", ...schema.required],
        properties: { target: { const: "font" }, ...schema.properties }
      })),
      ...Object.entries(definitions).map(([target, definition]) => ({
        type: "object",
        additionalProperties: false,
        required: ["target", ...(definition.required ?? [])],
        properties: {
          target: { const: target },
          ...definition.fields,
          ...(target === "format" ? { drawing: drawingUpdateSchema } : {})
        },
        ...(target === "format"
          ? {
              allOf: [
                {
                  if: { properties: { owner: { enum: ["series", "point", "marker"] } } },
                  then: { required: ["series"] },
                  else: { not: { anyOf: [{ required: ["series"] }, { required: ["point"] }] } }
                },
                {
                  if: { properties: { owner: { const: "point" } } },
                  then: { required: ["point"] }
                },
                {
                  if: { properties: { owner: { const: "series" } } },
                  then: { not: { required: ["point"] } }
                }
              ]
            }
          : {}),
        anyOf: Object.keys(definition.fields)
          .filter((key) => !definition.selectors?.includes(key))
          .map((key) => ({ required: [key] }))
      }))
    ]
  }
};
function invalid(): never {
  throw new OfficeError("invalid-value", "Invalid chart object update.", "usage");
}
export function validateChartObjectUpdates(
  value: unknown
): asserts value is readonly ChartObjectUpdate[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 10000 ||
    Object.getPrototypeOf(value) !== Array.prototype
  )
    invalid();
  if (Reflect.ownKeys(value).length !== value.length + 1) invalid();
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !("value" in descriptor)) invalid();
  }
  for (const edit of value) {
    if (
      !edit ||
      typeof edit !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(edit))
    )
      invalid();
    for (const key of Reflect.ownKeys(edit))
      if (
        typeof key !== "string" ||
        !("value" in Object.getOwnPropertyDescriptor(edit, key)!) ||
        !Object.getOwnPropertyDescriptor(edit, key)!.enumerable
      )
        invalid();
    if (edit.target === "font") {
      const { target: ignoredTarget, ...font } = edit;
      validateChartFontUpdate(font);
      continue;
    }
    const definition =
      typeof edit.target === "string" && Object.hasOwn(definitions, edit.target)
        ? definitions[edit.target]
        : undefined;
    if (!definition || definition.required?.some((key) => !Object.hasOwn(edit, key))) invalid();
    if (!Object.keys(edit).some((key) => key !== "target" && !definition.selectors?.includes(key)))
      invalid();
    if (edit.target === "format") {
      const seriesOwner = ["series", "point", "marker"].includes(edit.owner);
      if (
        seriesOwner
          ? !Object.hasOwn(edit, "series")
          : Object.hasOwn(edit, "series") || Object.hasOwn(edit, "point")
      )
        invalid();
      if (
        (edit.owner === "point" && !Object.hasOwn(edit, "point")) ||
        (edit.owner === "series" && Object.hasOwn(edit, "point"))
      )
        invalid();
    }
    for (const [key, item] of Object.entries(edit)) {
      if (key === "target") continue;
      if (key === "drawing" && edit.target === "format") {
        plainDrawing(item);
        validateDrawingUpdate(item as DrawingUpdate);
        continue;
      }
      const field = Object.hasOwn(definition.fields, key) ? definition.fields[key] : undefined;
      if (!field) invalid();
      if (field.enum) {
        if (!field.enum.includes(item)) invalid();
        continue;
      }
      const types = Array.isArray(field.type) ? field.type : [field.type];
      if (
        item === null
          ? !types.includes("null")
          : typeof item === "number"
            ? !Number.isFinite(item) ||
              !(types.includes("number") || (types.includes("integer") && Number.isInteger(item)))
            : !types.includes(typeof item)
      )
        invalid();
      if (
        typeof item === "number" &&
        ((field.minimum !== undefined && item < field.minimum) ||
          (field.maximum !== undefined && item > field.maximum) ||
          (field.exclusiveMinimum !== undefined && item <= field.exclusiveMinimum))
      )
        invalid();
    }
  }
}

function plainDrawing(value: unknown, depth = 0): void {
  if (depth > 16) invalid();
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > 10000 ||
      Reflect.ownKeys(value).length !== value.length + 1
    )
      invalid();
    for (let i = 0; i < value.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (!d || !("value" in d)) invalid();
      plainDrawing(d.value, depth + 1);
    }
    return;
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !("value" in d) || !d.enumerable) invalid();
    plainDrawing(d.value, depth + 1);
  }
}
