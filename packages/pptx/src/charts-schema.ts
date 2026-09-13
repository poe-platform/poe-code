import { textGetSchema } from "./command-schema.js";

const nullableString = { type: ["string", "null"] };
const xmlNode = { $ref: "#/$defs/chartXmlNode" };
const optionalXmlNode = { oneOf: [{ type: "null" }, xmlNode] };
const stringMap = { type: "object", additionalProperties: { type: "string" } };
const point = {
  type: "object",
  additionalProperties: false,
  required: ["index", "value"],
  properties: { index: nullableString, value: { type: "string" } }
};
const source = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "authority",
    "formula",
    "cached",
    "pointCount",
    "formatCode",
    "points",
    "levels"
  ],
  properties: {
    kind: { type: "string" },
    authority: { enum: ["literal", "referenced"] },
    formula: nullableString,
    cached: { type: "boolean" },
    pointCount: nullableString,
    formatCode: nullableString,
    points: { type: "array", items: point },
    levels: { type: "array", items: { type: "array", items: point } }
  }
};
const optionalSource = { oneOf: [{ type: "null" }, source] };
const seriesProperties = {
  index: nullableString,
  order: nullableString,
  name: nullableString,
  nameSource: optionalSource,
  categories: optionalSource,
  values: optionalSource,
  xValues: optionalSource,
  yValues: optionalSource,
  bubbleSizes: optionalSource,
  labels: optionalXmlNode,
  marker: optionalXmlNode,
  format: optionalXmlNode,
  points: { type: "array", items: xmlNode },
  xml: { type: "string" }
};
const plotProperties = {
  type: { type: "string" },
  properties: stringMap,
  axisIds: { type: "array", items: { type: "string" } },
  series: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: Object.keys(seriesProperties),
      properties: seriesProperties
    }
  },
  labels: optionalXmlNode,
  xml: { type: "string" }
};
const axisProperties = {
  type: { type: "string" },
  id: nullableString,
  crossAxisId: nullableString,
  properties: stringMap,
  details: xmlNode,
  xml: { type: "string" }
};
const linkProperties = {
  relationshipId: { type: "string" },
  type: { type: "string" },
  target: { type: "string" },
  external: { type: "boolean" },
  targetPart: nullableString,
  role: { enum: ["workbook", "style", "color-style", "other"] },
  authoritative: { type: "boolean" }
};

const options = {
  type: "object",
  additionalProperties: false,
  $defs: textGetSchema.result.$defs,
  properties: {
    json: { type: "boolean" },
    limit: textGetSchema.options.properties.limit,
    slide: textGetSchema.options.properties.slide,
    shape: textGetSchema.options.properties.shape,
    select: textGetSchema.options.properties.select,
    scope: { enum: ["slides"] }
  },
  allOf: [
    {
      if: { required: ["select"] },
      then: { not: { anyOf: ["scope", "slide", "shape"].map((key) => ({ required: [key] })) } }
    }
  ]
};
const chart = {
  type: "object",
  required: [
    "location",
    "token",
    "part",
    "shapeId",
    "name",
    "chartPart",
    "relationshipId",
    "plots",
    "axes",
    "title",
    "legend",
    "style",
    "links",
    "externalData",
    "unsupported",
    "xml"
  ],
  additionalProperties: false,
  properties: {
    location: { $ref: "#/$defs/location" },
    token: { type: "string" },
    part: { type: "string" },
    shapeId: { type: "string" },
    name: { type: ["string", "null"] },
    chartPart: { type: "string" },
    relationshipId: { type: "string" },
    plots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(plotProperties),
        properties: plotProperties
      }
    },
    axes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(axisProperties),
        properties: axisProperties
      }
    },
    title: optionalXmlNode,
    legend: optionalXmlNode,
    style: nullableString,
    links: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(linkProperties),
        properties: linkProperties
      }
    },
    externalData: { type: "array", items: xmlNode },
    unsupported: { type: "array", items: xmlNode },
    xml: { type: "string" }
  }
};

export const chartSchemas = Object.fromEntries(
  ["list", "get"].map((action) => {
    const operation = `charts.${action}`;
    return [
      operation,
      {
        description:
          "Inspect slide chart data and metadata without evaluating formulas, opening workbooks or fetching external links. Unknown XML remains available verbatim.",
        input: textGetSchema.input,
        options,
        result: {
          ...textGetSchema.result,
          $defs: {
            ...textGetSchema.result.$defs,
            chartXmlNode: {
              type: "object",
              additionalProperties: false,
              required: ["name", "namespace", "attributes", "text", "children", "xml"],
              properties: {
                name: { type: "string" },
                namespace: { type: "string" },
                attributes: stringMap,
                text: { type: "string" },
                children: { type: "array", items: xmlNode },
                xml: { type: "string" }
              }
            }
          },
          properties: {
            ...textGetSchema.result.properties,
            operation: { const: operation },
            affected: { const: 0 },
            data: {
              oneOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["charts"],
                  properties: {
                    charts: {
                      type: "array",
                      ...(action === "get" ? { minItems: 1, maxItems: 1 } : {}),
                      items: chart
                    }
                  }
                }
              ]
            }
          }
        }
      }
    ];
  })
);
