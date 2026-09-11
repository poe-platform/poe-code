import type { Scope } from "./scope.js";
import type { SandboxClosure, SandboxObject, SandboxValue } from "./values.js";

export type ConstructionState = {
  constructor: SandboxClosure;
  newTarget: SandboxClosure;
  prototype: SandboxObject;
  thisValue: SandboxValue;
  thisScope: Scope | undefined;
  initialized: boolean;
  activeCalls: number;
};

export const constructionStates = new WeakMap<object, ConstructionState>();
