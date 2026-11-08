import { inspectSchema, textGetSchema } from "./command-schema.js";

export const metadataUsage =
  "Usage: pptx properties list|get|set|remove INPUT [--name NAME] [--value VALUE] [--type string|number|boolean|date]\n" +
  "       pptx tags list|get|add|set|remove INPUT [--slide N | --select TOKEN | --scope presentation] [--name NAME] [--value VALUE]\n" +
  "       pptx sanitize INPUT --remove '[\"notes\",\"comments\",\"properties\",\"links\",\"objects\"]' [output]\n" +
  "New custom properties require explicit type. Dates require caller-supplied UTC whole seconds.\n" +
  "Tag names are case-sensitive; duplicates fail. Presentation tags require presentation scope.\n" +
  "Sanitize removes only selected families throughout the presentation. A single category may be supplied directly.\n" +
  "Reports detail removed and retained content; unrecognized hidden data prevents clean-file claims.\n" +
  "Mutations require --output PATH | --in-place | --dry-run. Common: --json --limit NAME=VALUE.\n";
const property = {
  type: "object", additionalProperties: false,
  required: ["name", "kind", "type", "value", "part", "namespace"],
  properties: {
    name: { type: "string" }, kind: { enum: ["core", "custom", "unknown"] },
    type: { enum: ["string", "number", "boolean", "date", "unknown"] },
    value: { type: ["string", "number", "boolean", "null"] }, part: { type: "string" }, namespace: { type: "string" }
  }
};
const tag = {
  type: "object", additionalProperties: false,
  required: ["name", "value", "part", "owner", "slide", "selector", "location"],
  properties: { name: { type: "string" }, value: { type: "string" }, part: { type: "string" }, owner: { type: "string" }, slide: { type: ["integer", "null"], minimum: 1 }, selector: { type: "string" }, location: inspectSchema.result.properties.locations.items }
};
const sanitizationEntry = {
  type: "object", additionalProperties: false, required: ["category", "kind", "part", "reason"],
  properties: {
    category: { enum: ["notes", "comments", "properties", "links", "objects", "resources", "unknown"] },
    kind: { enum: ["part", "relationship", "element"] }, part: { type: "string" }, reason: { type: "string" },
    relationshipId: { type: "string" }, target: { type: "string" }
  }
};
export const metadataSchemas = Object.fromEntries(
  ["properties.list", "properties.get", "properties.set", "properties.remove", "tags.list", "tags.get", "tags.add", "tags.set", "tags.remove", "sanitize"].map(operation => {
    const tags = operation.startsWith("tags."), sanitize = operation === "sanitize";
    const action = operation.split(".")[1];
    const mutation = sanitize || ["add", "set", "remove"].includes(action!);
    const edit = action === "add" || action === "set";
    const required = sanitize ? ["remove"] : tags ? action === "add" ? ["name", "value"] : [] : action === "list" ? [] : action === "set" ? ["name", "value"] : ["name"];
    return [operation, {
      description: metadataUsage, input: inspectSchema.input,
      options: {
        type: "object", additionalProperties: false, ...(required.length ? { required } : {}),
        properties: {
          json: { type: "boolean" }, limit: textGetSchema.options.properties.limit,
          ...(!sanitize ? { scope: tags ? { enum: ["slides", "presentation"] } : { const: "presentation" } } : {}),
          ...(tags ? { select: inspectSchema.options.properties.select, slide: inspectSchema.options.properties.slide } : {}),
          ...((!tags && !sanitize) || edit ? { name: { type: "string", minLength: 1 } } : {}),
          ...(edit ? { value: tags ? { type: "string" } : { type: ["string", "number", "boolean"] } } : {}),
          ...(operation === "properties.set" ? { type: { enum: ["string", "number", "boolean", "date"] } } : {}),
          ...(sanitize ? { remove: { oneOf: [{ enum: ["notes", "comments", "properties", "links", "objects"] }, { type: "array", minItems: 1, uniqueItems: true, items: { enum: ["notes", "comments", "properties", "links", "objects"] } }] } } : {}),
          ...(mutation ? { output: { type: "string", minLength: 1 }, inPlace: { type: "boolean" }, force: { type: "boolean" }, dryRun: { type: "boolean" }, ...(tags || sanitize ? { all: { type: "boolean" }, allowEmpty: { type: "boolean" } } : {}) } : {})
        },
        allOf: [
          ...(tags ? [{ if: { required: ["select"] }, then: { not: { anyOf: ["slide", "scope", "all"].map(key => ({ required: [key] })) } } }, ...(action === "set" ? [{ anyOf: ["name", "value"].map(key => ({ required: [key] })) }] : [])] : []),
          ...(mutation ? [
            ...(tags ? [{ anyOf: [{ required: ["select"] }, { required: ["slide"] }, { required: ["scope"], properties: { scope: { const: "presentation" } } }, { required: ["all"], properties: { all: { const: true } } }] }] : []),
            { anyOf: [{ required: ["output"] }, { required: ["inPlace"], properties: { inPlace: { const: true } } }, { required: ["dryRun"], properties: { dryRun: { const: true } } }] },
            { not: { required: ["output", "inPlace"], properties: { inPlace: { const: true } } } },
            { if: { required: ["force"], properties: { force: { const: true } } }, then: { required: ["output"] } },
            { if: { required: ["output", "json"], properties: { output: { const: "-" }, json: { const: true } } }, then: { required: ["dryRun"], properties: { dryRun: { const: true } } } }
          ] : [])
        ]
      },
      result: { ...textGetSchema.result, properties: { ...textGetSchema.result.properties, affected: mutation ? { type: "integer", minimum: 0 } : { const: 0 }, operation: { const: operation }, data: { oneOf: [{ type: "null" }, {
        type: "object", additionalProperties: false,
        required: mutation ? sanitize ? ["dryRun", "removed", "retained"] : ["dryRun"] : [tags ? "tags" : "properties"],
        properties: mutation ? { dryRun: { type: "boolean" }, ...(sanitize ? { removed: { type: "array", items: sanitizationEntry }, retained: { type: "array", items: sanitizationEntry } } : {}) } : tags ? { tags: { type: "array", items: tag } } : { properties: { type: "array", items: property } }
      }] } } }
    }];
  })
);
