import type { ArrowFunctionExpression, FunctionDeclaration, FunctionExpression } from "../parse.js";
import type { AsyncEvaluationContext } from "./async.js";
import type { Scope } from "./scope.js";
import type { SandboxClosure, SandboxGenerator } from "./values.js";

export type ClosureOrigin = {
  node: ArrowFunctionExpression | FunctionDeclaration | FunctionExpression;
  scope: Scope;
  environment?: AsyncEvaluationContext["functionEnvironment"];
};

const origins = new WeakMap<object, ClosureOrigin>();

export type GeneratorOrigin = ClosureOrigin & {
  closureScope: Scope;
  suspendedScope?: Scope;
  blockScopes?: ReadonlyMap<number, Scope>;
  finallyCompletions?: AsyncEvaluationContext["finallyCompletions"];
  expressionStates?: AsyncEvaluationContext["generatorExpressionStates"];
};
const generatorOrigins = new WeakMap<object, GeneratorOrigin>();

export function registerClosureOrigin(closure: SandboxClosure, node: ClosureOrigin["node"], context: AsyncEvaluationContext): void {
  origins.set(closure, { node, scope: context.scope, environment: context.functionEnvironment });
}

export function getClosureOrigin(value: object): ClosureOrigin | undefined {
  return origins.get(value);
}

export function registerGeneratorOrigin(generator: SandboxGenerator, node: ClosureOrigin["node"], scope: Scope, context: AsyncEvaluationContext): GeneratorOrigin {
  const origin = { node, scope, closureScope: context.scope, environment: context.functionEnvironment };
  generatorOrigins.set(generator, origin);
  return origin;
}

export function getGeneratorOrigin(value: object): GeneratorOrigin | undefined {
  return generatorOrigins.get(value);
}
