import { shapeSchemas, textGetSchema } from "./command-schema.js";
const length = {
  type: "object",
  additionalProperties: false,
  required: ["value", "unit"],
  properties: {
    value: { type: "number", minimum: 0, maximum: 4294967295 },
    unit: { enum: ["emu", "in", "cm", "mm", "pt"] }
  }
};
const nullableLength = { anyOf: [length, { type: "null" }] };
const color = { anyOf: [{ type: "string", minLength: 6, maxLength: 6 }, { type: "null" }] };
export const tableValues = {
  rows: { type: "integer", minimum: 1, maximum: 250000 },
  columns: { type: "integer", minimum: 1, maximum: 250000 },
  data: {
    type: "array",
    maxItems: 250000,
    items: { type: "array", maxItems: 250000, items: { type: "string", maxLength: 1048576 } }
  },
  text: { type: "string" },
  left: {
    ...length,
    properties: {
      ...length.properties,
      value: { type: "number", minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }
    }
  },
  top: {
    ...length,
    properties: {
      ...length.properties,
      value: { type: "number", minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }
    }
  },
  width: length,
  height: length,
  rowHeight: length,
  columnWidth: length,
  style: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
  fill: color,
  borderColor: color,
  borderWidth: nullableLength,
  marginLeft: nullableLength,
  marginRight: nullableLength,
  marginTop: nullableLength,
  marginBottom: nullableLength,
  firstRow: { type: "boolean" },
  lastRow: { type: "boolean" },
  firstCol: { type: "boolean" },
  lastCol: { type: "boolean" },
  horzBand: { type: "boolean" },
  vertBand: { type: "boolean" },
  verticalAnchor: { enum: ["top", "middle", "bottom", null] }
};
const shapeRecord = JSON.parse(JSON.stringify(shapeSchemas["shapes.list"])).result.properties.data
  .oneOf[1].properties.records.items;
delete shapeRecord.properties.geometry;
const nullableNumber = { type: ["integer", "null"] };
const borderProperties = {
  fillType: { type: ["string", "null"] },
  color: { type: ["string", "null"] },
  themeColor: { type: ["string", "null"] },
  width: { type: ["integer", "null"] }
};
const border = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(borderProperties),
  properties: borderProperties
};
const cellProperties = {
  fillType: { type: ["string", "null"] },
  borders: {
    type: "object",
    additionalProperties: false,
    required: ["left", "right", "top", "bottom"],
    properties: { left: border, right: border, top: border, bottom: border }
  },
  row: { type: "integer", minimum: 0 },
  column: { type: "integer", minimum: 0 },
  text: { type: "string" },
  spanWidth: { type: "integer", minimum: 1 },
  spanHeight: { type: "integer", minimum: 1 },
  isSpanned: { type: "boolean" },
  isMergeOrigin: { type: "boolean" },
  fill: { type: ["string", "null"] },
  themeFill: { type: ["string", "null"] },
  marginLeft: nullableNumber,
  marginRight: nullableNumber,
  marginTop: nullableNumber,
  marginBottom: nullableNumber,
  verticalAnchor: { type: ["string", "null"] }
};
const recordProperties = {
  ...shapeRecord.properties,
  rows: { type: "integer", minimum: 1 },
  columns: { type: "integer", minimum: 1 },
  rowHeights: { type: "array", items: { type: "integer", minimum: 0 } },
  columnWidths: { type: "array", items: { type: "integer", minimum: 0 } },
  style: { type: ["string", "null"] },
  firstRow: { type: "boolean" },
  lastRow: { type: "boolean" },
  firstCol: { type: "boolean" },
  lastCol: { type: "boolean" },
  horzBand: { type: "boolean" },
  vertBand: { type: "boolean" },
  data: tableValues.data,
  cells: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: Object.keys(cellProperties),
      properties: cellProperties
    }
  }
};
export const tableSchemas: typeof shapeSchemas = Object.fromEntries(
  ["list", "get", "add", "set"].map((action) => {
    const mutation = action === "add" || action === "set",
      base = shapeSchemas[mutation ? "shapes.set" : "shapes.list"]!,
      schema = JSON.parse(JSON.stringify(base));
    schema.description =
      "Tables use one-based slide/table positions and row,column cell selectors. Reads report physical cells and logical spans. Formatting edits preserve unrelated theme references.";
    schema.options.$defs = textGetSchema.result.$defs;
    schema.options.properties = Object.fromEntries(
      [
        "json",
        "limit",
        "select",
        "scope",
        "slide",
        ...(mutation ? ["output", "inPlace", "force", "dryRun"] : []),
        ...(action === "set" ? ["all", "allowEmpty"] : [])
      ].map((key) => [key, base.options.properties[key as keyof typeof base.options.properties]])
    );
    schema.options.properties.scope = { const: "slides" };
    schema.options.properties.cell = { type: "string", minLength: 3 };
    if (action !== "add")
      schema.options.properties.table = {
        type: "integer",
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER
      };
    if (mutation) Object.assign(schema.options.properties, tableValues);
    schema.options.required = action === "add" ? ["rows", "columns"] : [];
    schema.options.allOf = mutation ? base.options.allOf.slice(0, -1) : [...base.options.allOf];
    if (action === "add") {
      schema.options.properties.placeholder = { type: "integer", minimum: 0, maximum: 4294967295 };
      schema.options.allOf.push({
        if: { required: ["placeholder"] },
        then: {
          required: ["slide"],
          not: {
            anyOf: [
              ...Object.keys(tableValues).filter((key) => !["rows", "columns"].includes(key)),
              "select",
              "cell"
            ].map((key) => ({
              required: [key]
            }))
          }
        },
        else: { required: ["left", "top", "width", "height"] }
      });
    }
    if (action === "set")
      schema.options.allOf.push({
        anyOf: Object.keys(tableValues).map((k) => ({ required: [k] }))
      });
    schema.options.allOf.push({
      if: { required: ["select"] },
      then: { not: { anyOf: ["slide", "table", "cell", "all"].map((k) => ({ required: [k] })) } }
    });
    if (mutation)
      schema.options.allOf.push({
        if: { required: ["text"] },
        then: { required: ["cell"], not: { required: ["data"] } }
      });
    schema.result.properties.operation = { const: `tables.${action}` };
    if (mutation)
      schema.result.properties.data.oneOf[1].properties.effects.items.properties.feature = {
        const: "F28"
      };
    else
      schema.result.properties.data.oneOf[1].properties.records.items = {
        type: "object",
        additionalProperties: false,
        required: Object.keys(recordProperties),
        properties: recordProperties
      };
    return [`tables.${action}`, schema];
  })
);
for (const action of [
  "merge",
  "split",
  "rows.add",
  "rows.remove",
  "columns.add",
  "columns.remove"
]) {
  const schema = JSON.parse(JSON.stringify(tableSchemas["tables.set"]));
  for (const key of Object.keys(tableValues)) delete schema.options.properties[key];
  schema.options.allOf = schema.options.allOf.filter(
    (rule: { anyOf?: unknown; if?: { required?: string[] } }) =>
      !rule.anyOf && rule.if?.required?.[0] !== "text"
  );
  schema.description =
    "Merge requires an ordered rectangle containing complete spans; text joins in row-major paragraph order. Split releases one origin. Span policies are mandatory for insertion/deletion; positions are one-based.";
  if (action === "merge") {
    schema.options.properties.from = { type: "string", minLength: 3 };
    schema.options.properties.to = { type: "string", minLength: 3 };
    schema.options.required = ["from", "to"];
    delete schema.options.properties.cell;
  } else if (action === "split") schema.options.required = ["cell"];
  else {
    delete schema.options.properties.cell;
    schema.options.properties.position = { type: "integer", minimum: 1, maximum: 250001 };
    schema.options.properties.spanPolicy = {
      enum: action.endsWith("add") ? ["expand", "reject"] : ["shrink", "reject"]
    };
    schema.options.required = ["position", "spanPolicy"];
  }
  schema.result.properties.operation = { const: `tables.${action}` };
  schema.result.properties.data.oneOf[1].properties.effects.items.properties.feature = {
    const: "F29"
  };
  tableSchemas[`tables.${action}`] = schema;
}
