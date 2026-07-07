import type {
  CompileJsonSchemaOptions,
  Dialect,
  JsonSchema,
  SchemaNode,
  SchemaObject
} from "./types.js";
import {
  dialectFor,
  escapePointer,
  fragmentOf,
  isObject,
  isSchema,
  resolveUri,
  withoutFragment
} from "./utils.js";

const schemaMapKeywords = new Set([
  "$defs",
  "definitions",
  "properties",
  "patternProperties",
  "dependentSchemas",
  "dependencies"
]);
const schemaArrayKeywords = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const schemaKeywords = new Set([
  "additionalItems",
  "additionalProperties",
  "contains",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties"
]);
const draftTypes = ["null", "boolean", "object", "array", "number", "integer", "string"];
const draftTypeSet = new Set(draftTypes);
const metaSchemaKeywordProperties = {
  type: {
    anyOf: [
      { enum: draftTypes },
      { type: "array", items: { enum: draftTypes }, minItems: 1, uniqueItems: true }
    ]
  },
  minLength: { type: "integer", minimum: 0 },
  maxLength: { type: "integer", minimum: 0 },
  minItems: { type: "integer", minimum: 0 },
  maxItems: { type: "integer", minimum: 0 },
  minProperties: { type: "integer", minimum: 0 },
  maxProperties: { type: "integer", minimum: 0 }
};
const builtInRegistry: Record<string, unknown> = {
  "https://json-schema.org/draft/2020-12/schema": {
    $id: "https://json-schema.org/draft/2020-12/schema",
    type: ["object", "boolean"],
    properties: {
      ...metaSchemaKeywordProperties,
      $defs: { type: "object", additionalProperties: { $ref: "#" } }
    }
  },
  "http://json-schema.org/draft-07/schema": {
    $id: "http://json-schema.org/draft-07/schema#",
    type: ["object", "boolean"],
    properties: {
      ...metaSchemaKeywordProperties,
      definitions: { type: "object", additionalProperties: { $ref: "#" } }
    }
  }
};

export interface CompiledGraph {
  root: SchemaNode;
  locations: Map<string, SchemaNode>;
  resources: Map<string, SchemaNode>;
  anchors: Map<string, SchemaNode>;
  dynamicAnchors: Map<string, SchemaNode>;
  resolve(node: SchemaNode, reference: string): SchemaNode;
  dynamicAnchor(scope: SchemaNode, name: string): SchemaNode | undefined;
}

function mapKey(dialect: Dialect, uri: string): string {
  return `${dialect}\0${uri}`;
}

function assertSchemaArray(value: unknown, keyword: string): asserts value is JsonSchema[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isSchema)) {
    throw new Error(`${keyword} must be a non-empty array of schemas.`);
  }
}

function assertStringArray(value: unknown, keyword: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${keyword} must be an array of strings.`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`${keyword} must contain unique strings.`);
  }
}

function assertSchemaMap(value: unknown, keyword: string): asserts value is SchemaObject {
  if (!isObject(value) || !Object.values(value).every(isSchema)) {
    throw new Error(`${keyword} must be an object containing schemas.`);
  }
}

function assertNonNegativeInteger(value: unknown, keyword: string): void {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${keyword} must be a non-negative integer.`);
  }
}

function validateSchemaObject(schema: SchemaObject, dialect: Dialect): void {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (
      types.length === 0 ||
      !types.every((type) => typeof type === "string" && draftTypeSet.has(type)) ||
      new Set(types).size !== types.length
    ) {
      throw new Error("type must be a JSON Schema type or a unique array of JSON Schema types.");
    }
  }
  for (const keyword of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] as const) {
    if (schema[keyword] !== undefined && typeof schema[keyword] !== "number") {
      throw new Error(`${keyword} must be a number.`);
    }
  }
  if (
    schema.multipleOf !== undefined &&
    (typeof schema.multipleOf !== "number" || schema.multipleOf <= 0)
  ) {
    throw new Error("multipleOf must be a number greater than zero.");
  }
  for (const keyword of [
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minContains",
    "maxContains",
    "minProperties",
    "maxProperties"
  ] as const) {
    if (schema[keyword] !== undefined) {
      assertNonNegativeInteger(schema[keyword], keyword);
    }
  }
  if (schema.pattern !== undefined && typeof schema.pattern !== "string") {
    throw new Error("pattern must be a string.");
  }
  for (const keyword of ["uniqueItems", "$recursiveAnchor"] as const) {
    if (schema[keyword] !== undefined && typeof schema[keyword] !== "boolean") {
      throw new Error(`${keyword} must be a boolean.`);
    }
  }
  if (schema.required !== undefined) {
    assertStringArray(schema.required, "required");
  }
  if (schema.dependentRequired !== undefined) {
    if (!isObject(schema.dependentRequired)) {
      throw new Error("dependentRequired must be an object containing string arrays.");
    }
    for (const dependencies of Object.values(schema.dependentRequired)) {
      assertStringArray(dependencies, "dependentRequired");
    }
  }
  for (const keyword of schemaMapKeywords) {
    const value = schema[keyword];
    if (value === undefined || keyword === "dependencies") continue;
    assertSchemaMap(value, keyword);
  }
  if (schema.dependencies !== undefined) {
    if (!isObject(schema.dependencies)) {
      throw new Error("dependencies must be an object containing schemas or string arrays.");
    }
    for (const dependency of Object.values(schema.dependencies)) {
      if (!isSchema(dependency)) assertStringArray(dependency, "dependencies");
    }
  }
  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    if (schema[keyword] !== undefined) assertSchemaArray(schema[keyword], keyword);
  }
  if (schema.prefixItems !== undefined) {
    if (!Array.isArray(schema.prefixItems) || !schema.prefixItems.every(isSchema)) {
      throw new Error("prefixItems must be an array of schemas.");
    }
  }
  for (const keyword of schemaKeywords) {
    const value = schema[keyword];
    if (value === undefined) continue;
    if (keyword === "items" && dialect === "draft7" && Array.isArray(value)) {
      if (!value.every(isSchema)) throw new Error("items must contain only schemas.");
    } else if (!isSchema(value)) {
      throw new Error(`${keyword} must be a schema.`);
    }
  }
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    throw new Error("enum must be an array.");
  }
}

export function compileGraph(
  schema: unknown,
  options: CompileJsonSchemaOptions = {}
): CompiledGraph {
  if (!isSchema(schema)) {
    throw new Error("JSON Schema must be a boolean or object.");
  }

  const locations = new Map<string, SchemaNode>();
  const resources = new Map<string, SchemaNode>();
  const anchors = new Map<string, SchemaNode>();
  const dynamicAnchors = new Map<string, SchemaNode>();
  const nodesBySchema = new WeakMap<SchemaObject, SchemaNode[]>();
  const pendingReferences: Array<{ node: SchemaNode; reference: string }> = [];
  const registry = { ...builtInRegistry, ...options.registry };
  const rootBase = "https://toolcraft.invalid/root";

  function validationVocabularyFor(schemaObject: SchemaObject): boolean {
    const metaSchema = schemaObject.$schema;
    if (typeof metaSchema !== "string") {
      return true;
    }
    const registered = registry[metaSchema];
    if (!isObject(registered) || !isObject(registered.$vocabulary)) {
      return true;
    }
    return Object.prototype.hasOwnProperty.call(
      registered.$vocabulary,
      "https://json-schema.org/draft/2020-12/vocab/validation"
    );
  }

  function recordNode(schemaObject: SchemaObject | undefined, node: SchemaNode): void {
    if (schemaObject === undefined) {
      return;
    }
    const nodes = nodesBySchema.get(schemaObject) ?? [];
    nodes.push(node);
    nodesBySchema.set(schemaObject, nodes);
  }

  function setLocation(dialect: Dialect, uri: string, node: SchemaNode): void {
    locations.set(mapKey(dialect, uri), node);
  }

  function scan(
    currentSchema: JsonSchema,
    inheritedDialect: Dialect,
    inheritedBase: string,
    resourceRoot: SchemaNode | undefined,
    pointer: string,
    validationVocabulary: boolean,
    documentId: string
  ): SchemaNode {
    const schemaObject = isObject(currentSchema) ? currentSchema : undefined;
    const dialect =
      schemaObject === undefined ? inheritedDialect : dialectFor(schemaObject, inheritedDialect);
    if (schemaObject !== undefined) {
      validateSchemaObject(schemaObject, dialect);
    }
    const declaredId =
      dialect === "draft7" ? (schemaObject?.$id ?? schemaObject?.id) : schemaObject?.$id;
    const effectiveId =
      dialect === "draft7" && typeof schemaObject?.$ref === "string" ? undefined : declaredId;
    const baseUri =
      typeof effectiveId === "string" ? resolveUri(effectiveId, inheritedBase) : inheritedBase;
    const node = {
      schema: currentSchema,
      documentId,
      dialect,
      baseUri,
      resourceUri: resourceRoot?.resourceUri ?? withoutFragment(baseUri),
      resourceRoot: undefined as unknown as SchemaNode,
      pointer,
      validationVocabulary,
      children: new Map<string, SchemaNode>()
    };
    recordNode(schemaObject, node);

    if (resourceRoot !== undefined) {
      setLocation(
        resourceRoot.dialect,
        resolveUri(`#${encodeURI(pointer)}`, resourceRoot.resourceUri),
        node
      );
    }

    const startsResource =
      resourceRoot === undefined || withoutFragment(baseUri) !== resourceRoot.resourceUri;
    node.resourceRoot = startsResource ? node : resourceRoot;
    node.resourceUri = startsResource ? withoutFragment(baseUri) : resourceRoot.resourceUri;
    const resourcePointer = startsResource ? "" : pointer;
    node.pointer = resourcePointer;

    if (startsResource) {
      resources.set(mapKey(node.dialect, node.resourceUri), node);
      setLocation(node.dialect, node.resourceUri, node);
    }
    setLocation(node.dialect, resolveUri(`#${encodeURI(resourcePointer)}`, node.resourceUri), node);

    if (schemaObject === undefined) {
      return node;
    }

    if (typeof schemaObject.$anchor === "string") {
      anchors.set(mapKey(node.dialect, `${node.resourceUri}#${schemaObject.$anchor}`), node);
    }
    if (typeof schemaObject.$dynamicAnchor === "string") {
      const anchorUri = `${node.resourceUri}#${schemaObject.$dynamicAnchor}`;
      anchors.set(mapKey(node.dialect, anchorUri), node);
      dynamicAnchors.set(mapKey(node.dialect, anchorUri), node);
    }
    if (dialect === "draft7" && typeof effectiveId === "string" && fragmentOf(baseUri) !== "") {
      anchors.set(mapKey(dialect, baseUri), node);
    }
    for (const keyword of ["$ref", "$dynamicRef", "$recursiveRef"] as const) {
      const reference = schemaObject[keyword];
      if (reference !== undefined) {
        if (typeof reference !== "string") {
          throw new Error(`${keyword} must be a string.`);
        }
        pendingReferences.push({ node, reference });
      }
    }
    if (typeof schemaObject.pattern === "string") {
      new RegExp(schemaObject.pattern, "u");
    }
    if (isObject(schemaObject.patternProperties)) {
      for (const pattern of Object.keys(schemaObject.patternProperties)) {
        new RegExp(pattern, "u");
      }
    }

    const nextValidationVocabulary =
      resourceRoot === undefined ? validationVocabularyFor(schemaObject) : validationVocabulary;
    for (const [keyword, value] of Object.entries(schemaObject)) {
      if (schemaMapKeywords.has(keyword) && isObject(value)) {
        for (const [key, childSchema] of Object.entries(value)) {
          if (isSchema(childSchema)) {
            node.children.set(
              `${keyword}/${key}`,
              scan(
                childSchema,
                dialect,
                baseUri,
                node.resourceRoot,
                `${resourcePointer}/${escapePointer(keyword)}/${escapePointer(key)}`,
                nextValidationVocabulary,
                documentId
              )
            );
          }
        }
      } else if (schemaArrayKeywords.has(keyword) && Array.isArray(value)) {
        value.forEach((childSchema, index) => {
          if (isSchema(childSchema)) {
            node.children.set(
              `${keyword}/${index}`,
              scan(
                childSchema,
                dialect,
                baseUri,
                node.resourceRoot,
                `${resourcePointer}/${escapePointer(keyword)}/${index}`,
                nextValidationVocabulary,
                documentId
              )
            );
          }
        });
      } else if (schemaKeywords.has(keyword)) {
        if (keyword === "items" && Array.isArray(value)) {
          value.forEach((childSchema, index) => {
            if (isSchema(childSchema)) {
              node.children.set(
                `items/${index}`,
                scan(
                  childSchema,
                  dialect,
                  baseUri,
                  node.resourceRoot,
                  `${resourcePointer}/items/${index}`,
                  nextValidationVocabulary,
                  documentId
                )
              );
            }
          });
        } else if (isSchema(value)) {
          node.children.set(
            keyword,
            scan(
              value,
              dialect,
              baseUri,
              node.resourceRoot,
              `${resourcePointer}/${escapePointer(keyword)}`,
              nextValidationVocabulary,
              documentId
            )
          );
        }
      }
    }
    return node;
  }

  const root = scan(schema, "draft2020-12", rootBase, undefined, "", true, "root");
  resources.set(mapKey(root.dialect, rootBase), root);
  setLocation(root.dialect, rootBase, root);
  setLocation(root.dialect, `${rootBase}#`, root);

  for (const [uri, registeredSchema] of Object.entries(registry)) {
    if (!isSchema(registeredSchema)) {
      throw new Error(`Registered JSON Schema ${uri} must be a boolean or object.`);
    }
    for (const inheritedDialect of ["draft2020-12", "draft7"] as const) {
      const remote = scan(
        registeredSchema,
        inheritedDialect,
        uri,
        undefined,
        "",
        true,
        `${inheritedDialect}:${uri}`
      );
      resources.set(mapKey(remote.dialect, withoutFragment(uri)), remote);
      setLocation(remote.dialect, withoutFragment(uri), remote);
      setLocation(remote.dialect, `${withoutFragment(uri)}#`, remote);
    }
  }

  function findByDialect<T>(map: Map<string, T>, dialect: Dialect, uri: string): T | undefined {
    const alternate = dialect === "draft7" ? "draft2020-12" : "draft7";
    return map.get(mapKey(dialect, uri)) ?? map.get(mapKey(alternate, uri));
  }

  function resolve(node: SchemaNode, reference: string): SchemaNode {
    const absolute = resolveUri(reference, node.baseUri);
    const direct =
      findByDialect(locations, node.dialect, absolute) ??
      findByDialect(resources, node.dialect, absolute) ??
      findByDialect(anchors, node.dialect, absolute);
    if (direct !== undefined) {
      return direct;
    }
    const resource = findByDialect(resources, node.dialect, withoutFragment(absolute));
    const fragment = fragmentOf(absolute);
    if (resource !== undefined && fragment === "") {
      return resource;
    }
    if (fragment.startsWith("/")) {
      const pointerTarget = findByDialect(
        locations,
        node.dialect,
        `${withoutFragment(absolute)}#${fragment}`
      );
      if (pointerTarget !== undefined) {
        return pointerTarget;
      }
      if (resource !== undefined && isObject(resource.schema)) {
        let target: unknown = resource.schema;
        for (const segment of fragment.slice(1).split("/")) {
          if (!isObject(target) && !Array.isArray(target)) {
            target = undefined;
            break;
          }
          const key = decodeURIComponent(segment).replaceAll("~1", "/").replaceAll("~0", "~");
          target = Array.isArray(target) ? target[Number(key)] : target[key];
        }
        if (isObject(target)) {
          const targetNode = nodesBySchema
            .get(target)
            ?.find((candidate) => candidate.dialect === node.dialect);
          if (targetNode !== undefined) {
            return targetNode;
          }
        }
      }
    }
    throw new Error(`Unresolvable $ref: ${reference}`);
  }

  const reachableDocuments = new Set([root.documentId]);
  let discoveredDocument = true;
  while (discoveredDocument) {
    discoveredDocument = false;
    for (const pending of pendingReferences) {
      if (!reachableDocuments.has(pending.node.documentId)) {
        continue;
      }
      const target = resolve(pending.node, pending.reference);
      if (!reachableDocuments.has(target.documentId)) {
        reachableDocuments.add(target.documentId);
        discoveredDocument = true;
      }
    }
  }

  return {
    root,
    locations,
    resources,
    anchors,
    dynamicAnchors,
    resolve,
    dynamicAnchor(scope, name) {
      return dynamicAnchors.get(mapKey(scope.dialect, `${scope.resourceUri}#${name}`));
    }
  };
}
