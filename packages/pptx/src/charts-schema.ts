import { textGetSchema } from "./command-schema.js";
import { chartTypes } from "./chart-editing.js";

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

const inspectionSchemas = Object.fromEntries(
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

const chartData = {
  type: "object",
  additionalProperties: false,
  required: ["series"],
  properties: {
    categories: { type: "array", minItems: 1, items: { type: ["string", "number", "null"] } },
    categoryLevels: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: { type: "array", minItems: 1, maxItems: 250000, items: { type: ["string", "null"] } }
    },
    numberFormat: { type: "string" },
    categoryNumberFormat: { type: "string" },
    date1904: { type: "boolean" },
    series: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "values"],
        properties: {
          name: { type: "string" },
          values: { type: "array", minItems: 1, items: { type: ["number", "null"] } },
          xValues: { type: "array", minItems: 1, items: { type: "number" } },
          bubbleSizes: { type: "array", minItems: 1, items: { type: "number", minimum: 0 } },
          numberFormat: { type: "string" }
        }
      }
    }
  }
};
export const chartSchemas = {
  ...inspectionSchemas,
  ...Object.fromEntries(
    ["add", "set", "replace"].map((action) => {
      const operation = `charts.${action}`;
      return [
        operation,
        {
          description:
            "Edit category area, bar, column, line, pie, doughnut, radar, XY and bubble charts with synchronized data and deterministic identifiers.",
          input: textGetSchema.input,
          options: {
            ...options,
            required:
              action === "add"
                ? ["slide", "type", "data"]
                : action === "replace"
                  ? ["data", "workbookPolicy"]
                  : [],
            properties: {
              ...options.properties,
              ...(action === "add"
                ? { placeholder: { type: "integer", minimum: 0, maximum: 4294967295 } }
                : {}),
              ...(action === "add" ? { type: { enum: chartTypes } } : {}),
              data: chartData,
              ...(action === "replace"
                ? { workbookPolicy: { enum: ["synchronize-simple", "reject-complex"] } }
                : {
                    style: { type: "integer", minimum: 1, maximum: 48 },
                    title: { type: "string" },
                    legend: { type: "boolean" },
                    ...Object.fromEntries(
                      ["left", "top", "width", "height"].map((key) => [
                        key,
                        {
                          type: "object",
                          additionalProperties: false,
                          required: ["value", "unit"],
                          properties: {
                            value: {
                              type: "number",
                              ...(["width", "height"].includes(key) ? { exclusiveMinimum: 0 } : {})
                            },
                            unit: { enum: ["emu", "in", "cm", "mm", "pt"] }
                          }
                        }
                      ])
                    )
                  }),
              all: { type: "boolean" },
              allowEmpty: { type: "boolean" },
              output: { type: "string", minLength: 1 },
              inPlace: { type: "boolean" },
              force: { type: "boolean" },
              dryRun: { type: "boolean" }
            },
            allOf: [
              ...options.allOf,
              ...(action === "add"
                ? [
                    {
                      if: { required: ["placeholder"] },
                      then: {
                        not: {
                          anyOf: ["left", "top", "width", "height", "style", "title", "legend"].map(
                            (key) => ({ required: [key] })
                          )
                        }
                      },
                      else: { required: ["left", "top", "width", "height"] }
                    }
                  ]
                : []),
              ...(action === "add"
                ? [
                    {
                      not: {
                        anyOf: ["shape", "select", "all", "allowEmpty"].map((key) => ({
                          required: [key]
                        }))
                      }
                    }
                  ]
                : []),
              ...(action === "set"
                ? [
                    {
                      anyOf: [
                        "data",
                        "style",
                        "title",
                        "legend",
                        "left",
                        "top",
                        "width",
                        "height"
                      ].map((key) => ({ required: [key] }))
                    }
                  ]
                : []),
              { if: { required: ["select"] }, then: { not: { required: ["all"] } } },
              { not: { required: ["output", "inPlace"] } },
              {
                if: { required: ["force"], properties: { force: { const: true } } },
                then: { required: ["output"] }
              },
              {
                if: { not: { required: ["dryRun"], properties: { dryRun: { const: true } } } },
                then: {
                  oneOf: [
                    { required: ["output"] },
                    { required: ["inPlace"], properties: { inPlace: { const: true } } }
                  ]
                }
              }
            ]
          },
          result: {
            ...textGetSchema.result,
            properties: {
              ...textGetSchema.result.properties,
              operation: { const: operation },
              affected: { type: "integer", minimum: 0 },
              data: {
                oneOf: [
                  { type: "null" },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["dryRun"],
                    properties: { dryRun: { type: "boolean" } }
                  }
                ]
              }
            }
          }
        }
      ];
    })
  )
};
