import type { SandboxClosure, SandboxValue } from "./values.js";

export type BoundFunctionState = {
  target: SandboxClosure;
  thisValue: SandboxValue;
  args: SandboxValue[];
};

export const boundFunctionStates = new WeakMap<object, BoundFunctionState>();
