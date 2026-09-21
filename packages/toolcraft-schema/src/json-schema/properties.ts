import type { ValidationResult } from "../validate.js";
import { compileGraph, type CompiledGraph } from "./compiler.js";
import { evaluateSchema } from "./evaluate.js";
import type { CompileJsonSchemaOptions, SchemaNode } from "./types.js";
import { isObject } from "./utils.js";

export interface JsonSchemaProperty {
  readonly name: string;
  /** Required regardless of the object's selected alternative or condition. */
  readonly required: boolean;
  /** Isolated annotation/schema copies, including resolved references. */
  readonly schemas: readonly unknown[];
  /** Candidate hint: accepts a value matching at least one advertised declaration.
   * Validate the complete object to enforce compositions and conditional rules. */
  validate(value: unknown): ValidationResult<unknown>;
}

function referenceNodes(graph: CompiledGraph, node: SchemaNode): SchemaNode[] {
  if (!isObject(node.schema)) return [];
  return ["$ref", "$dynamicRef", "$recursiveRef"].flatMap(keyword =>
    typeof node.schema === "object" && typeof node.schema[keyword] === "string"
      ? [graph.resolve(node, node.schema[keyword] as string)] : []);
}

function ignoresSiblings(node: SchemaNode): boolean {
  return node.dialect === "draft7" && isObject(node.schema) && typeof node.schema.$ref === "string";
}

function requiredFor(graph: CompiledGraph, node: SchemaNode, name: string, ancestors = new Set<SchemaNode>()): boolean {
  if (!isObject(node.schema) || ancestors.has(node)) return false;
  const next = new Set(ancestors).add(node);
  const referenced = referenceNodes(graph, node).some(target => requiredFor(graph, target, name, next));
  if (ignoresSiblings(node)) return referenced;
  if (referenced || (Array.isArray(node.schema.required) && node.schema.required.includes(name))) return true;
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    const branches = node.schema[keyword];
    if (!Array.isArray(branches)) continue;
    const requirements = branches.map((_branch, index) => {
      const child = node.children.get(`${keyword}/${index}`);
      return child !== undefined && requiredFor(graph, child, name, next);
    });
    if (keyword === "allOf" ? requirements.some(Boolean) : requirements.every(Boolean)) return true;
  }
  return false;
}

function annotationSchemas(graph: CompiledGraph, root: SchemaNode): unknown[] {
  const seen = new Set<SchemaNode>();
  const schemas: unknown[] = [];
  const visit = (node: SchemaNode): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (!ignoresSiblings(node)) schemas.push(structuredClone(node.schema));
    for (const target of referenceNodes(graph, node)) visit(target);
    if (ignoresSiblings(node) || !isObject(node.schema)) return;
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      const branches = node.schema[keyword];
      if (!Array.isArray(branches)) continue;
      branches.forEach((_branch, index) => {
        const child = node.children.get(`${keyword}/${index}`);
        if (child) visit(child);
      });
    }
  };
  visit(root);
  return schemas;
}

/** Project names and candidate validators while retaining the native reference graph.
 * Property hints cover declarations in refs, compositions and conditional branches;
 * full object validation remains necessary for branch-dependent constraints. */
export function projectJsonSchemaProperties(
  schema: unknown,
  options: CompileJsonSchemaOptions = {}
): readonly JsonSchemaProperty[] {
  const graph = compileGraph(structuredClone(schema), {
    ...options, ...(options.registry === undefined ? {} : { registry: structuredClone(options.registry) })
  });
  const declarations = new Map<string, Set<SchemaNode>>();
  const seen = new Set<SchemaNode>();
  const visit = (node: SchemaNode): void => {
    if (seen.has(node) || !isObject(node.schema)) return;
    seen.add(node);
    for (const target of referenceNodes(graph, node)) visit(target);
    if (ignoresSiblings(node)) return;
    if (isObject(node.schema.properties)) {
      for (const name of Object.keys(node.schema.properties)) {
        const child = node.children.get(`properties/${name}`);
        if (!child) continue;
        const sources = declarations.get(name) ?? new Set<SchemaNode>();
        sources.add(child);
        declarations.set(name, sources);
      }
    }
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      const branches = node.schema[keyword];
      if (!Array.isArray(branches)) continue;
      branches.forEach((_branch, index) => {
        const child = node.children.get(`${keyword}/${index}`);
        if (child) visit(child);
      });
    }
    for (const keyword of ["then", "else", "dependentSchemas"]) {
      if (keyword === "dependentSchemas" && isObject(node.schema.dependentSchemas)) {
        for (const key of Object.keys(node.schema.dependentSchemas)) {
          const child = node.children.get(`dependentSchemas/${key}`);
          if (child) visit(child);
        }
      } else {
        const child = node.children.get(keyword);
        if (child) visit(child);
      }
    }
  };
  visit(graph.root);
  return [...declarations.keys()].sort().map(name => {
    const sources = [...declarations.get(name)!];
    return {
      name,
      required: requiredFor(graph, graph.root, name),
      schemas: sources.flatMap(node => annotationSchemas(graph, node)),
      validate(value) {
        const results = sources.map(node => evaluateSchema({ ...graph, root: node }, value));
        if (results.some(result => result.valid)) return { ok: true, value };
        return { ok: false, issues: results.flatMap(result => result.issues) };
      }
    };
  });
}
