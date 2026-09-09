import type { CompileOwner } from "../interp/budget.js";
import { parseDynamicFunction, parseEvalScript, type EvalParseContext, type DynamicFunctionKind, type ParseResult } from "./parser.js";

import { dynamicNodeSources, dynamicSourceRecords, type DynamicSource } from "./function-source.js";
export type { DynamicSource, EvalSourceContext } from "./function-source.js";

export function createDynamicSource(kind: DynamicFunctionKind, parameters: string, body: string, owner?: CompileOwner) {
  const node = parseDynamicFunction(kind, parameters, body, owner);
  const source: DynamicSource = {kind, parameters, body, nodes: new Map()};
  registerDynamicSource(node, source);
  return {node, source};
}

export function createEvalSource(body: string,
  context: Omit<EvalParseContext, "privateNames"> & {privateNames?: Iterable<string>}, owner?: CompileOwner) {
  const source: DynamicSource = {kind: "eval", body, nodes: new Map(), context: {
    strict: context.strict === true, newTarget: context.newTarget === true,
    superProperty: context.superProperty === true, superCall: context.superCall === true,
    arguments: context.arguments !== false, privateNames: [...(context.privateNames ?? [])]
  }};
  const parsed = parseEvalScript(body, {...source.context, privateNames: new Set(source.context.privateNames)}, owner);
  registerDynamicSource(parsed.node, source);
  return {...parsed, source};
}

function registerDynamicSource(node: unknown, source: DynamicSource): void {
  const seen = new Set<object>();
  const pending: unknown[] = [node];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if ("nodeId" in value && typeof value.nodeId === "number" && "type" in value && value.type !== "Module") {
      source.nodes.set(value.nodeId, value as ParseResult);
      dynamicNodeSources.set(value, source);
    }
    pending.push(...Object.values(value));
  }
  dynamicSourceRecords.add(source);
}
