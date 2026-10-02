import { shapeSchemas, textGetSchema } from "./command-schema.js";

const location =
  textGetSchema.result.properties.data.oneOf[1]!.properties!.segments.items.properties.location;
const targetLocation = {
  allOf: [
    location,
    { properties: { scope: { const: "slides" }, coordinateSystem: { const: "identity" } } }
  ]
};
const length = {
  type: "object",
  additionalProperties: false,
  required: ["value", "unit"],
  properties: {
    value: { type: "number", minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    unit: { enum: ["emu", "in", "cm", "mm", "pt"] }
  }
};
const values = {
  name: { type: "string" },
  kind: { enum: [1, 2, 3, "STRAIGHT", "ELBOW", "CURVE"] },
  beginX: length,
  beginY: length,
  endX: length,
  endY: length,
  beginTarget: { anyOf: [targetLocation, { type: "null" }] },
  endTarget: { anyOf: [targetLocation, { type: "null" }] },
  site: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  detachPolicy: { enum: ["detach", "remove"] },
  lineColor: {
    anyOf: [{ type: "string", pattern: "^[0-9a-fA-F]{6}$" }, { const: "solid" }, { type: "null" }]
  },
  lineWidth: {
    anyOf: [
      {
        ...length,
        properties: {
          ...length.properties,
          value: { type: "number", minimum: 0, maximum: 27273042316900 }
        }
      },
      { type: "null" }
    ]
  }
};
const shapeRecord = JSON.parse(JSON.stringify(shapeSchemas["shapes.list"])).result.properties.data
  .oneOf[1].properties.records.items;
delete shapeRecord.properties.geometry;
const endpoint = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      required: ["objectId", "site"],
      properties: {
        objectId: { type: "integer", minimum: 1, maximum: 4294967295 },
        site: { type: "integer", minimum: 0 }
      }
    }
  ]
};
const recordProperties = {
  ...shapeRecord.properties,
  kind: { enum: [1, 2, 3, null] },
  geometryPreset: { type: ["string", "null"] },
  beginX: { type: "integer" },
  beginY: { type: "integer" },
  endX: { type: "integer" },
  endY: { type: "integer" },
  beginTarget: endpoint,
  endTarget: endpoint
};

export const connectorSchemas: typeof shapeSchemas = Object.fromEntries(
  ["list", "get", "add", "set", "remove"].map((action) => {
    const mutation = !["list", "get"].includes(action);
    const base = shapeSchemas[mutation ? "shapes.set" : "shapes.list"]!;
    const schema = JSON.parse(JSON.stringify(base));
    schema.options.$defs = textGetSchema.result.$defs;
    const properties = base.options.properties;
    schema.description =
      "Straight, elbow and curved connector endpoints use parent coordinates. Targets support rect/ellipse/roundRect sites 0..3; grouped connectors require same-parent targets. Null detaches an endpoint. Nonzero-rotated coordinate edits reject; arbitrary routing/guide geometry is preserve-only.";
    schema.options.properties = Object.fromEntries(
      [
        "json",
        "limit",
        "select",
        "scope",
        "slide",
        "part",
        "shape",
        ...(mutation ? ["all", "allowEmpty", "output", "inPlace", "force", "dryRun"] : [])
      ].map((key) => [key, properties[key as keyof typeof properties]])
    );
    schema.options.properties.scope = { const: "slides" };
    if (["add", "set"].includes(action)) Object.assign(schema.options.properties, values);
    if (action === "add") delete schema.options.properties.detachPolicy;
    schema.options.required = action === "add" ? ["kind", "beginX", "beginY", "endX", "endY"] : [];
    schema.options.allOf = mutation ? base.options.allOf.slice(0, -1) : [...base.options.allOf];
    if (action === "set")
      schema.options.allOf.push({ anyOf: Object.keys(values).map((key) => ({ required: [key] })) });
    if (action === "set")
      schema.options.allOf.push({
        if: { required: ["detachPolicy"], properties: { detachPolicy: { const: "remove" } } },
        then: {
          not: {
            anyOf: Object.keys(values)
              .filter((key) => key !== "detachPolicy")
              .map((key) => ({ required: [key] }))
          }
        }
      });
    if (["add", "set"].includes(action))
      schema.options.allOf.push({
        if: {
          anyOf: ["beginTarget", "endTarget"].map((key) => ({
            required: [key],
            properties: { [key]: { type: "object" } }
          }))
        },
        then: { required: ["site"] }
      });
    if (["add", "set"].includes(action))
      schema.options.allOf.push({
        if: { required: ["site"] },
        then: {
          anyOf: ["beginTarget", "endTarget"].map((key) => ({
            required: [key],
            properties: { [key]: { type: "object" } }
          }))
        }
      });
    schema.result.properties.operation = { const: `connectors.${action}` };
    if (mutation)
      schema.result.properties.data.oneOf[1].properties.effects.items.properties.feature = {
        const: "F26"
      };
    else
      schema.result.properties.data.oneOf[1].properties.records.items = {
        type: "object",
        additionalProperties: false,
        properties: recordProperties,
        required: Object.keys(recordProperties)
      };
    return [`connectors.${action}`, schema];
  })
);
const removal = JSON.parse(JSON.stringify(connectorSchemas["connectors.remove"]));
removal.options.properties.detachPolicy = values.detachPolicy;
removal.description =
  "Remove selected shapes. Referenced connector targets require explicit detach or remove policy; timing references reject deletion.";
removal.result.properties.operation = { const: "shapes.remove" };
removal.result.properties.data.oneOf[1].properties.effects.items.properties.feature = {
  const: "F22"
};
connectorSchemas["shapes.remove"] = removal;
