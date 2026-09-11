import type { DynamicFunctionKind } from "../parse/parser.js";
import { createDynamicSource } from "../parse/dynamic-source.js";
import { createInterpretedClosure, type AsyncEvaluationContext, type EvaluateAsyncNode } from "./async.js";

export function compileDynamicFunction(
  context: AsyncEvaluationContext,
  evaluateNode: EvaluateAsyncNode,
  kind: DynamicFunctionKind,
  parameters: string,
  body: string
) {
  const {node} = createDynamicSource(kind, parameters, body, context.compilation?.owner);
  return createInterpretedClosure(node, {
    ...context, scope: context.scope.globalScope(), inferredName: "anonymous",
    functionEnvironment: undefined
  }, evaluateNode);
}
