import { inspectSchema, textGetSchema } from "./command-schema.js";
import type { AnimationRecord } from "./animations.js";
import { transitionSchemas } from "./transitions-schema.js";

export const animationsUsage =
  "Usage: pptx animations list|get|add|set|remove INPUT [selection] [output]\n" +
  "Edits: --kind appear|fade-in|fade-out|pulse --trigger on-click|with-previous|after-previous\n" +
  "       --target TOKEN_OR_JSON --duration MS --delay MS\n" +
  "Target JSON: {\"slide\":1,\"shape\":\"Badge\"}; slide positions are one-based.\n" +
  "Add requires kind, trigger and target. Set/remove select one effect unless --all.\n" +
  "Timing: integer milliseconds 0..2147483647; duration defaults 500 (appear 0), delay 0.\n" +
  "Dependent triggers require a previous effect; unsafe timeline changes fail.\n" +
  "Output: --output PATH | --in-place | --dry-run; --force requires --output.\n" +
  "Selection: --slide N --shape NAME | --select TOKEN; --scope slides\n" +
  "Common: --limit NAME=VALUE lowers XML and output budgets.\n" +
  "Get selects one slide graph; multiple slide graphs are ambiguous.\n" +
  "Shape selection retains its complete containing graph when targeted.\n" +
  "Items follow XML order. Parent IDs and children preserve graph structure.\n" +
  "Attributes are namespace/name/value tuples; references are ID/node-list.\n" +
  "Diagnostics are code/reference/node-list tuples on the first node.\n" +
  "Complex timing and motion paths are metadata; nothing is executed.\n";
const scalar = (type: string) => ({ type: "object", additionalProperties: false, required: ["type", "value"], properties: { type: { const: type }, value: { type } } });
const list = (items: object) => ({ type: "object", additionalProperties: false, required: ["type", "value"], properties: { type: { const: "list" }, value: { type: "array", maxItems: 250000, items } } });
const strings = list(scalar("string"));
const nullable = { oneOf: [scalar("string"), scalar("null")] };
const tuple = (items: object[]) => ({ type: "object", additionalProperties: false, required: ["type", "value"], properties: { type: { const: "list" }, value: { type: "array", minItems: items.length, maxItems: items.length, prefixItems: items, items: false } } });
const fields = {
  id: scalar("string"), parentId: nullable, children: strings,
  namespace: scalar("string"), timingId: nullable, targetShapeId: nullable,
  effectType: nullable, triggerType: nullable, mediaInteraction: nullable, motionPath: nullable,
  attributes: list(tuple([scalar("string"), scalar("string"), scalar("string")])),
  timingReferences: list(tuple([scalar("string"), strings])),
  diagnostics: list(tuple([scalar("string"), scalar("string"), strings])),
  xml: nullable,
  executionVerified: { ...scalar("boolean"), properties: { type: { const: "boolean" }, value: { const: false } } }
};
type Value = { type: "string" | "null" | "boolean"; value: string | null | boolean } | { type: "list"; value: Value[] };
type FieldValue = string | null | boolean | readonly FieldValue[];
function wire(value: FieldValue): Value {
  if (Array.isArray(value)) return { type: "list", value: value.map(item => wire(item)) };
  return { type: value === null ? "null" : typeof value as "string" | "boolean", value: value as string | null | boolean };
}
export function animationItems(records: readonly AnimationRecord[]) {
  return records.flatMap(record => record.nodes.map((node, index) => ({
    location: record.location, kind: node.kind, name: node.type,
    fields: Object.entries({
      id: node.id, parentId: node.parentId, children: node.children, namespace: node.namespace,
      timingId: node.timingId, targetShapeId: node.targetShapeId, effectType: node.effectType,
      triggerType: node.triggerType, mediaInteraction: node.mediaInteraction, motionPath: node.motionPath,
      attributes: node.attributes.map(attribute => [attribute.name.namespace, attribute.name.localName, attribute.value]),
      timingReferences: node.timingReferences.map(reference => [reference.timingId, reference.nodeIds]),
      diagnostics: index === 0 ? record.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.reference, diagnostic.nodeIds]) : [],
      xml: node.parentId === null ? record.xml[record.roots.indexOf(node.id)] ?? null : null,
      executionVerified: false
    }).map(([name, value]) => ({ name, value: wire(value) }))
  })));
}
const inventorySchemas = Object.fromEntries(["list", "get"].map(action => [`animations.${action}`, {
  description: animationsUsage,
  input: inspectSchema.input,
  options: {
    type: "object", additionalProperties: false,
    properties: { json: { type: "boolean" }, limit: textGetSchema.options.properties.limit, select: textGetSchema.options.properties.select, slide: textGetSchema.options.properties.slide, shape: textGetSchema.options.properties.shape, scope: { const: "slides" } },
    allOf: [
      { if: { required: ["select"] }, then: { not: { anyOf: ["scope", "slide", "shape"].map(name => ({ required: [name] })) } } },
      { if: { required: ["shape"] }, then: { required: ["slide"] } }
    ]
  },
  result: {
    ...textGetSchema.result,
    properties: {
      ...textGetSchema.result.properties, operation: { const: `animations.${action}` },
      data: { oneOf: [{ type: "null" }, {
        type: "object", additionalProperties: false, required: ["items"],
        properties: { items: { type: "array", maxItems: 250000, items: {
          type: "object", additionalProperties: false, required: ["location", "kind", "name", "fields"],
          properties: {
            location: textGetSchema.result.properties.data.oneOf[1]!.properties!.segments.items.properties.location,
            kind: { enum: ["sequence", "parallel", "effect", "trigger", "media", "timing", "opaque"] },
            name: { type: "string" },
            fields: { type: "array", minItems: Object.keys(fields).length, maxItems: Object.keys(fields).length, prefixItems: Object.entries(fields).map(([name, value]) => ({ type: "object", additionalProperties: false, required: ["name", "value"], properties: { name: { const: name }, value } })), items: false }
          }
        } } }
      }] }
    }
  }
}]));

export const animationUpdates = {
  kind: { enum: ["appear", "fade-in", "fade-out", "pulse"] },
  trigger: { enum: ["on-click", "with-previous", "after-previous"] },
  duration: { type: "integer", minimum: 0, maximum: 2147483647 },
  delay: { type: "integer", minimum: 0, maximum: 2147483647 },
  target: { oneOf: [
    { type: "string", minLength: 1 },
    inspectSchema.result.$defs.location,
    { type: "object", additionalProperties: false, required: ["slide", "shape"], properties: {
      slide: { type: "integer", minimum: 1 },
      shape: { type: "string", minLength: 1 }
    } }
  ] }
};
export const animationSchemas = {
  ...inventorySchemas,
  ...Object.fromEntries(["add", "set", "remove"].map(action => {
    const transition = transitionSchemas[`transitions.${action}`]!;
    const base = transitionSchemas["transitions.remove"]!;
    const result = structuredClone(transition.result);
    result.properties.operation = { const: `animations.${action}` };
    const mutation = result.properties.data.oneOf[1]!;
    if ("properties" in mutation && mutation.properties?.effects) mutation.properties.effects.items.properties.feature = { const: "F46" };
    return [`animations.${action}`, {
      description: animationsUsage, input: inspectSchema.input,
      options: {
        ...base.options,
        properties: { ...base.options.properties, shape: textGetSchema.options.properties.shape, ...(action === "remove" ? {} : animationUpdates) },
        ...(action === "add" ? { required: ["kind", "trigger", "target"] } : {}),
        allOf: [
          ...base.options.allOf.slice(1).filter((_, index) => action !== "add" || index !== 0),
          { if: { required: ["select"] }, then: { not: { anyOf: ["scope", "slide", "shape"].map(name => ({ required: [name] })) } } },
          { if: { required: ["shape"] }, then: { required: ["slide"] } },
          ...(action === "set" ? [{ anyOf: Object.keys(animationUpdates).map(name => ({ required: [name] })) }] : []),
          ...(action !== "remove" ? [{ if: { required: ["kind"], properties: { kind: { const: "appear" } } }, then: { properties: { duration: { const: 0 } } } }] : [])
        ]
      },
      result
    }];
  }))
};
