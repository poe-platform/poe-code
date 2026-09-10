import type { ArrowFunctionExpression, FunctionDeclaration, FunctionExpression } from "../parse.js";
import type { AsyncEvaluationContext } from "./async.js";
import type { Scope } from "./scope.js";
import type { SandboxClosure, SandboxGenerator } from "./values.js";
import { dynamicNodeSources, dynamicValueSources } from "../parse/function-source.js";
import { getSandboxPrototype } from "./object-model.js";
import { registerFunctionRealm } from "./function-realm.js";
import { getIntrinsicRealmIdentity } from "./intrinsics.js";

export type ClosureOrigin = {
  node: ArrowFunctionExpression | FunctionDeclaration | FunctionExpression;
  scope: Scope;
  environment?: AsyncEvaluationContext["functionEnvironment"];
};

const origins = new WeakMap<object, ClosureOrigin>();

export type GeneratorOrigin = ClosureOrigin & {
  realmIdentity?: object;
  resultPrototype?: object | null;
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
  registerFunctionRealm(closure, context.budget);
  origins.set(closure, { node, scope: context.scope, environment: context.functionEnvironment });
  const source = dynamicNodeSources.get(node);
  if (source !== undefined) dynamicValueSources.set(closure, source);
}

export function getClosureOrigin(value: object): ClosureOrigin | undefined {
  return origins.get(value);
}

export function registerGeneratorOrigin(generator: SandboxGenerator, node: ClosureOrigin["node"], scope: Scope, context: AsyncEvaluationContext): GeneratorOrigin {
  const prototype = getSandboxPrototype({}, context.budget);
  const origin = { node, scope, closureScope: context.scope, environment: context.functionEnvironment,
    realmIdentity: prototype === null ? undefined : getIntrinsicRealmIdentity(prototype),
    ...(node.type !== "ArrowFunctionExpression" && node.generator && node.async
      ? {resultPrototype: getSandboxPrototype({}, context.budget)} : {}) };
  generatorOrigins.set(generator, origin);
  const source = dynamicNodeSources.get(node);
  if (source !== undefined) dynamicValueSources.set(generator, source);
  return origin;
}

export function getGeneratorOrigin(value: object): GeneratorOrigin | undefined {
  return generatorOrigins.get(value);
}
