import type { ArrowFunctionExpression, FunctionDeclaration, FunctionExpression } from "../parse.js";
import type { AsyncEvaluationContext } from "./async.js";
import type { Scope } from "./scope.js";
import type { SandboxClosure, SandboxGenerator } from "./values.js";
import { dynamicNodeSources, dynamicValueSources } from "../parse/function-source.js";

export type ClosureOrigin = {
  node: ArrowFunctionExpression | FunctionDeclaration | FunctionExpression;
  scope: Scope;
  environment?: AsyncEvaluationContext["functionEnvironment"];
};

const origins = new WeakMap<object, ClosureOrigin>();

export type GeneratorOrigin = ClosureOrigin & {
  asyncFunction?: boolean;
  awaitPhase?: "await" | "yield" | "return" | "resume-return";
  closureScope: Scope;
  suspendedScope?: Scope;
  blockScopes?: ReadonlyMap<number, Scope>;
  finallyCompletions?: AsyncEvaluationContext["finallyCompletions"];
  expressionStates?: AsyncEvaluationContext["generatorExpressionStates"];
};
const generatorOrigins = new WeakMap<object, GeneratorOrigin>();

export function registerClosureOrigin(closure: SandboxClosure, node: ClosureOrigin["node"], context: AsyncEvaluationContext): void {
  origins.set(closure, { node, scope: context.scope, environment: context.functionEnvironment });
  const source = dynamicNodeSources.get(node);
  if (source !== undefined) dynamicValueSources.set(closure, source);
}

export function getClosureOrigin(value: object): ClosureOrigin | undefined {
  return origins.get(value);
}

export function registerGeneratorOrigin(generator: SandboxGenerator, node: ClosureOrigin["node"], scope: Scope, context: AsyncEvaluationContext): GeneratorOrigin {
  const origin = { node, scope, closureScope: context.scope, environment: context.functionEnvironment };
  generatorOrigins.set(generator, origin);
  const source = dynamicNodeSources.get(node);
  if (source !== undefined) dynamicValueSources.set(generator, source);
  return origin;
}

export function getGeneratorOrigin(value: object): GeneratorOrigin | undefined {
  return generatorOrigins.get(value);
}
