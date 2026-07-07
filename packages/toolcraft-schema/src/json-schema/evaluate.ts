import type { CompiledGraph } from "./compiler.js";
import type {
  EvaluationContext,
  EvaluationResult,
  JsonSchema,
  SchemaNode,
  SchemaObject
} from "./types.js";
import {
  deepEqual,
  invalidResult,
  isMultipleOf,
  isObject,
  issue,
  mergeResults,
  typeMatches,
  unicodeLength,
  validResult
} from "./utils.js";

export function evaluateSchema(graph: CompiledGraph, value: unknown): EvaluationResult {
  return evaluateNode(graph, graph.root, value, {
    instancePath: [],
    dynamicScope: [],
    activePairs: new Map()
  });
}

function evaluateNode(
  graph: CompiledGraph,
  node: SchemaNode,
  value: unknown,
  context: EvaluationContext
): EvaluationResult {
  if (node.schema === true) {
    return validResult();
  }
  if (node.schema === false) {
    return invalidResult(issue(context.instancePath, "valid schema", value, "must NOT be valid"));
  }

  const activeValues = context.activePairs.get(node);
  if (activeValues?.has(value) === true) {
    return validResult();
  }
  const nextActivePairs = new Map(context.activePairs);
  const nextActiveValues = new Set(activeValues ?? []);
  nextActiveValues.add(value);
  nextActivePairs.set(node, nextActiveValues);

  const lastScope = context.dynamicScope.at(-1);
  const dynamicScope =
    lastScope?.resourceUri === node.resourceRoot.resourceUri
      ? context.dynamicScope
      : [...context.dynamicScope, node.resourceRoot];
  const nextContext = { ...context, dynamicScope, activePairs: nextActivePairs };
  const schema = node.schema;

  const referenceResult = evaluateReferences(graph, node, schema, value, nextContext);
  if (node.dialect === "draft7" && typeof schema.$ref === "string") {
    return referenceResult ?? validResult();
  }

  const results: EvaluationResult[] = [];
  if (referenceResult !== undefined) {
    results.push(referenceResult);
  }
  results.push(...evaluateApplicators(graph, node, schema, value, nextContext));
  if (node.validationVocabulary) {
    results.push(...evaluateValidationKeywords(node, schema, value, nextContext.instancePath));
  }

  const merged = mergeResults(results);
  if (isObject(value)) {
    evaluateUnevaluatedProperties(graph, node, schema, value, nextContext, merged);
  }
  if (Array.isArray(value)) {
    evaluateUnevaluatedItems(graph, node, schema, value, nextContext, merged);
  }
  return merged;
}

function evaluateReferences(
  graph: CompiledGraph,
  node: SchemaNode,
  schema: SchemaObject,
  value: unknown,
  context: EvaluationContext
): EvaluationResult | undefined {
  const results: EvaluationResult[] = [];
  if (typeof schema.$ref === "string") {
    results.push(evaluateNode(graph, graph.resolve(node, schema.$ref), value, context));
  }
  if (typeof schema.$dynamicRef === "string") {
    const staticTarget = graph.resolve(node, schema.$dynamicRef);
    const fragment = new URL(schema.$dynamicRef, node.baseUri).hash.slice(1);
    let target = staticTarget;
    if (
      fragment !== "" &&
      !fragment.startsWith("/") &&
      isObject(staticTarget.schema) &&
      staticTarget.schema.$dynamicAnchor === fragment
    ) {
      for (const scope of context.dynamicScope) {
        const candidate = graph.dynamicAnchor(scope, fragment);
        if (candidate !== undefined) {
          target = candidate;
          break;
        }
      }
    }
    results.push(evaluateNode(graph, target, value, context));
  }
  if (typeof schema.$recursiveRef === "string") {
    let target = graph.resolve(node, schema.$recursiveRef);
    if (schema.$recursiveRef === "#") {
      for (const scope of context.dynamicScope) {
        if (isObject(scope.schema) && scope.schema.$recursiveAnchor === true) {
          target = scope;
          break;
        }
      }
    }
    results.push(evaluateNode(graph, target, value, context));
  }
  return results.length === 0 ? undefined : mergeResults(results);
}

function evaluateApplicators(
  graph: CompiledGraph,
  node: SchemaNode,
  schema: SchemaObject,
  value: unknown,
  context: EvaluationContext
): EvaluationResult[] {
  const results: EvaluationResult[] = [];
  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    const schemas = schema[keyword];
    if (!Array.isArray(schemas)) {
      continue;
    }
    const branchResults = schemas.map((_, index) =>
      evaluateChild(graph, node, `${keyword}/${index}`, value, context)
    );
    if (keyword === "allOf") {
      results.push(mergeResults(branchResults));
    } else {
      const successful = branchResults.filter((result) => result.valid);
      const valid = keyword === "anyOf" ? successful.length > 0 : successful.length === 1;
      if (valid) {
        results.push(mergeResults(successful));
      } else {
        results.push(
          invalidResult(
            issue(
              context.instancePath,
              keyword,
              value,
              keyword === "anyOf"
                ? "must match a schema in anyOf"
                : "must match exactly one schema in oneOf"
            )
          )
        );
      }
    }
  }

  if (schema.not !== undefined) {
    const result = evaluateChild(graph, node, "not", value, context);
    if (result.valid) {
      results.push(invalidResult(issue(context.instancePath, "not", value, "must NOT be valid")));
    }
  }

  if (schema.if !== undefined) {
    const condition = evaluateChild(graph, node, "if", value, context);
    const selected = condition.valid ? "then" : "else";
    if (condition.valid) {
      results.push(condition);
    }
    if (schema[selected] !== undefined) {
      results.push(evaluateChild(graph, node, selected, value, context));
    }
  }

  if (isObject(value)) {
    results.push(...evaluateObjectApplicators(graph, node, schema, value, context));
  }
  if (Array.isArray(value)) {
    results.push(...evaluateArrayApplicators(graph, node, schema, value, context));
  }
  return results;
}

function evaluateObjectApplicators(
  graph: CompiledGraph,
  node: SchemaNode,
  schema: SchemaObject,
  value: SchemaObject,
  context: EvaluationContext
): EvaluationResult[] {
  const results: EvaluationResult[] = [];
  const evaluated = new Set<string>();
  const properties = isObject(schema.properties) ? schema.properties : {};
  for (const key of Object.keys(properties)) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const result = evaluateChild(
        graph,
        node,
        `properties/${key}`,
        value[key],
        childContext(context, key)
      );
      evaluated.add(key);
      results.push(markProperty(atChildLocation(result), key));
    }
  }

  const patternProperties = isObject(schema.patternProperties) ? schema.patternProperties : {};
  for (const [pattern] of Object.entries(patternProperties)) {
    const expression = new RegExp(pattern, "u");
    for (const [key, propertyValue] of Object.entries(value)) {
      if (expression.test(key)) {
        const result = evaluateChild(
          graph,
          node,
          `patternProperties/${pattern}`,
          propertyValue,
          childContext(context, key)
        );
        evaluated.add(key);
        results.push(markProperty(atChildLocation(result), key));
      }
    }
  }

  if (schema.additionalProperties !== undefined) {
    for (const [key, propertyValue] of Object.entries(value)) {
      if (!evaluated.has(key)) {
        const result = evaluateChild(
          graph,
          node,
          "additionalProperties",
          propertyValue,
          childContext(context, key)
        );
        results.push(markProperty(atChildLocation(result), key));
      }
    }
  }

  if (schema.propertyNames !== undefined) {
    for (const key of Object.keys(value)) {
      results.push(
        atChildLocation(
          evaluateChild(graph, node, "propertyNames", key, childContext(context, key))
        )
      );
    }
  }

  const dependentSchemas = isObject(schema.dependentSchemas) ? schema.dependentSchemas : {};
  for (const key of Object.keys(dependentSchemas)) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      results.push(evaluateChild(graph, node, `dependentSchemas/${key}`, value, context));
    }
  }

  if (node.dialect === "draft7" && isObject(schema.dependencies)) {
    for (const [key, dependency] of Object.entries(schema.dependencies)) {
      if (Object.prototype.hasOwnProperty.call(value, key) && !Array.isArray(dependency)) {
        results.push(
          evaluateInline(graph, node, dependency, value, context, `dependencies/${key}`)
        );
      }
    }
  }
  return results;
}

function evaluateArrayApplicators(
  graph: CompiledGraph,
  node: SchemaNode,
  schema: SchemaObject,
  value: unknown[],
  context: EvaluationContext
): EvaluationResult[] {
  const results: EvaluationResult[] = [];
  if (node.dialect === "draft2020-12") {
    const prefixItems = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
    prefixItems.forEach((_, index) => {
      if (index < value.length) {
        const result = evaluateChild(
          graph,
          node,
          `prefixItems/${index}`,
          value[index],
          childContext(context, String(index))
        );
        results.push(markItem(atChildLocation(result), index));
      }
    });
    if (schema.items !== undefined && !Array.isArray(schema.items)) {
      for (let index = prefixItems.length; index < value.length; index += 1) {
        const result = evaluateChild(
          graph,
          node,
          "items",
          value[index],
          childContext(context, String(index))
        );
        results.push(markItem(atChildLocation(result), index));
      }
    }
  } else if (Array.isArray(schema.items)) {
    schema.items.forEach((_, index) => {
      if (index < value.length) {
        const result = evaluateChild(
          graph,
          node,
          `items/${index}`,
          value[index],
          childContext(context, String(index))
        );
        results.push(markItem(atChildLocation(result), index));
      }
    });
    if (schema.additionalItems !== undefined) {
      for (let index = schema.items.length; index < value.length; index += 1) {
        const result = evaluateChild(
          graph,
          node,
          "additionalItems",
          value[index],
          childContext(context, String(index))
        );
        results.push(markItem(atChildLocation(result), index));
      }
    }
  } else if (schema.items !== undefined) {
    for (let index = 0; index < value.length; index += 1) {
      const result = evaluateChild(
        graph,
        node,
        "items",
        value[index],
        childContext(context, String(index))
      );
      results.push(markItem(atChildLocation(result), index));
    }
  }

  if (schema.contains !== undefined) {
    const containsResults = value.map((item, index) =>
      evaluateChild(graph, node, "contains", item, childContext(context, String(index)))
    );
    const matching = containsResults
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.valid);
    const minimum =
      node.dialect === "draft2020-12" && typeof schema.minContains === "number"
        ? schema.minContains
        : 1;
    const maximum =
      node.dialect === "draft2020-12" && typeof schema.maxContains === "number"
        ? schema.maxContains
        : Number.POSITIVE_INFINITY;
    if (matching.length < minimum || matching.length > maximum) {
      results.push(
        invalidResult(
          issue(context.instancePath, "contains", value, "must contain required matching items")
        )
      );
    } else if (node.dialect === "draft2020-12") {
      const result = validResult();
      for (const match of matching) {
        result.evaluatedItems.add(match.index);
      }
      results.push(result);
    }
  }
  return results;
}

function evaluateValidationKeywords(
  node: SchemaNode,
  schema: SchemaObject,
  value: unknown,
  path: readonly string[]
): EvaluationResult[] {
  const results: EvaluationResult[] = [];
  if (schema.nullable === true && value === null) {
    return results;
  }
  const types =
    typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
  if (
    types.length > 0 &&
    !types.some((type) => typeof type === "string" && typeMatches(type, value))
  ) {
    results.push(invalidResult(issue(path, types.join(","), value, `must be ${types.join(",")}`)));
    return results;
  }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    results.push(invalidResult(issue(path, "const", value, "must be equal to constant")));
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => deepEqual(entry, value))) {
    results.push(
      invalidResult(issue(path, "enum", value, "must be equal to one of the allowed values"))
    );
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    evaluateNumberKeywords(schema, value, path, results);
  }
  if (typeof value === "string") {
    evaluateStringKeywords(schema, value, path, results);
  }
  if (Array.isArray(value)) {
    evaluateArrayKeywords(schema, value, path, results);
  }
  if (isObject(value)) {
    evaluateObjectKeywords(node, schema, value, path, results);
  }
  return results;
}

function evaluateNumberKeywords(
  schema: SchemaObject,
  value: number,
  path: readonly string[],
  results: EvaluationResult[]
): void {
  if (typeof schema.multipleOf === "number" && !isMultipleOf(value, schema.multipleOf)) {
    results.push(
      invalidResult(
        issue(
          path,
          `multiple of ${schema.multipleOf}`,
          value,
          `must be multiple of ${schema.multipleOf}`
        )
      )
    );
  }
  if (typeof schema.maximum === "number" && value > schema.maximum) {
    results.push(
      invalidResult(issue(path, `<= ${schema.maximum}`, value, `must be <= ${schema.maximum}`))
    );
  }
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    results.push(
      invalidResult(issue(path, `>= ${schema.minimum}`, value, `must be >= ${schema.minimum}`))
    );
  }
  if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
    results.push(
      invalidResult(
        issue(path, `< ${schema.exclusiveMaximum}`, value, `must be < ${schema.exclusiveMaximum}`)
      )
    );
  }
  if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
    results.push(
      invalidResult(
        issue(path, `> ${schema.exclusiveMinimum}`, value, `must be > ${schema.exclusiveMinimum}`)
      )
    );
  }
}

function evaluateStringKeywords(
  schema: SchemaObject,
  value: string,
  path: readonly string[],
  results: EvaluationResult[]
): void {
  const length = unicodeLength(value);
  if (typeof schema.maxLength === "number" && length > schema.maxLength) {
    results.push(
      invalidResult(
        issue(
          path,
          `length <= ${schema.maxLength}`,
          value,
          `must NOT have more than ${schema.maxLength} characters`
        )
      )
    );
  }
  if (typeof schema.minLength === "number" && length < schema.minLength) {
    results.push(
      invalidResult(
        issue(
          path,
          `length >= ${schema.minLength}`,
          value,
          `must NOT have fewer than ${schema.minLength} characters`
        )
      )
    );
  }
  if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
    results.push(
      invalidResult(
        issue(path, `pattern ${schema.pattern}`, value, `must match pattern ${schema.pattern}`)
      )
    );
  }
}

function evaluateArrayKeywords(
  schema: SchemaObject,
  value: unknown[],
  path: readonly string[],
  results: EvaluationResult[]
): void {
  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    results.push(
      invalidResult(
        issue(
          path,
          `items <= ${schema.maxItems}`,
          value,
          `must NOT have more than ${schema.maxItems} items`
        )
      )
    );
  }
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    results.push(
      invalidResult(
        issue(
          path,
          `items >= ${schema.minItems}`,
          value,
          `must NOT have fewer than ${schema.minItems} items`
        )
      )
    );
  }
  if (schema.uniqueItems === true) {
    for (let left = 0; left < value.length; left += 1) {
      for (let right = left + 1; right < value.length; right += 1) {
        if (deepEqual(value[left], value[right])) {
          results.push(
            invalidResult(issue(path, "unique items", value, "must NOT have duplicate items"))
          );
          return;
        }
      }
    }
  }
}

function evaluateObjectKeywords(
  node: SchemaNode,
  schema: SchemaObject,
  value: SchemaObject,
  path: readonly string[],
  results: EvaluationResult[]
): void {
  const keys = Object.keys(value);
  if (typeof schema.maxProperties === "number" && keys.length > schema.maxProperties) {
    results.push(
      invalidResult(
        issue(
          path,
          `properties <= ${schema.maxProperties}`,
          value,
          `must NOT have more than ${schema.maxProperties} properties`
        )
      )
    );
  }
  if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) {
    results.push(
      invalidResult(
        issue(
          path,
          `properties >= ${schema.minProperties}`,
          value,
          `must NOT have fewer than ${schema.minProperties} properties`
        )
      )
    );
  }
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (typeof key === "string" && !Object.prototype.hasOwnProperty.call(value, key)) {
        results.push(
          invalidResult(
            issue([...path, key], "required", undefined, `must have required property '${key}'`)
          )
        );
      }
    }
  }
  const dependentRequired = isObject(schema.dependentRequired) ? schema.dependentRequired : {};
  for (const [key, dependencies] of Object.entries(dependentRequired)) {
    if (Object.prototype.hasOwnProperty.call(value, key) && Array.isArray(dependencies)) {
      addMissingDependencies(value, dependencies, path, results);
    }
  }
  if (node.dialect === "draft7" && isObject(schema.dependencies)) {
    for (const [key, dependencies] of Object.entries(schema.dependencies)) {
      if (Object.prototype.hasOwnProperty.call(value, key) && Array.isArray(dependencies)) {
        addMissingDependencies(value, dependencies, path, results);
      }
    }
  }
}

function addMissingDependencies(
  value: SchemaObject,
  dependencies: unknown[],
  path: readonly string[],
  results: EvaluationResult[]
): void {
  for (const dependency of dependencies) {
    if (
      typeof dependency === "string" &&
      !Object.prototype.hasOwnProperty.call(value, dependency)
    ) {
      results.push(
        invalidResult(
          issue(
            [...path, dependency],
            "dependency",
            undefined,
            `must have property '${dependency}'`
          )
        )
      );
    }
  }
}

function evaluateUnevaluatedProperties(
  graph: CompiledGraph,
  node: SchemaNode,
  schema: SchemaObject,
  value: SchemaObject,
  context: EvaluationContext,
  result: EvaluationResult
): void {
  if (node.dialect !== "draft2020-12" || schema.unevaluatedProperties === undefined) {
    return;
  }
  for (const [key, propertyValue] of Object.entries(value)) {
    if (!result.evaluatedProperties.has(key)) {
      const propertyResult = evaluateChild(
        graph,
        node,
        "unevaluatedProperties",
        propertyValue,
        childContext(context, key)
      );
      propertyResult.evaluatedProperties.add(key);
      mergeInto(result, propertyResult);
    }
  }
}

function evaluateUnevaluatedItems(
  graph: CompiledGraph,
  node: SchemaNode,
  schema: SchemaObject,
  value: unknown[],
  context: EvaluationContext,
  result: EvaluationResult
): void {
  if (node.dialect !== "draft2020-12" || schema.unevaluatedItems === undefined) {
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!result.evaluatedItems.has(index)) {
      const itemResult = evaluateChild(
        graph,
        node,
        "unevaluatedItems",
        value[index],
        childContext(context, String(index))
      );
      itemResult.evaluatedItems.add(index);
      mergeInto(result, itemResult);
    }
  }
}

function evaluateChild(
  graph: CompiledGraph,
  node: SchemaNode,
  key: string,
  value: unknown,
  context: EvaluationContext
): EvaluationResult {
  const child = node.children.get(key);
  if (child === undefined) {
    return validResult();
  }
  return evaluateNode(graph, child, value, context);
}

function evaluateInline(
  graph: CompiledGraph,
  node: SchemaNode,
  schema: unknown,
  value: unknown,
  context: EvaluationContext,
  key: string
): EvaluationResult {
  const child = node.children.get(key);
  if (child !== undefined) {
    return evaluateNode(graph, child, value, context);
  }
  if (typeof schema !== "boolean" && !isObject(schema)) {
    return validResult();
  }
  const inlineNode: SchemaNode = {
    schema: schema as JsonSchema,
    documentId: node.documentId,
    dialect: node.dialect,
    baseUri: node.baseUri,
    resourceUri: node.resourceUri,
    resourceRoot: node.resourceRoot,
    pointer: node.pointer,
    validationVocabulary: node.validationVocabulary,
    children: new Map()
  };
  return evaluateNode(graph, inlineNode, value, context);
}

function childContext(context: EvaluationContext, segment: string): EvaluationContext {
  return { ...context, instancePath: [...context.instancePath, segment] };
}

function mergeInto(target: EvaluationResult, source: EvaluationResult): void {
  target.valid &&= source.valid;
  target.issues.push(...source.issues);
  for (const key of source.evaluatedProperties) {
    target.evaluatedProperties.add(key);
  }
  for (const index of source.evaluatedItems) {
    target.evaluatedItems.add(index);
  }
}

function atChildLocation(result: EvaluationResult): EvaluationResult {
  return {
    valid: result.valid,
    issues: result.issues,
    evaluatedProperties: new Set(),
    evaluatedItems: new Set()
  };
}

function markProperty(result: EvaluationResult, key: string): EvaluationResult {
  result.evaluatedProperties.add(key);
  return result;
}

function markItem(result: EvaluationResult, index: number): EvaluationResult {
  result.evaluatedItems.add(index);
  return result;
}
