import type { SandboxClosure, SandboxValue } from "./values.js";

export type DisposableResource = {
  method: SandboxClosure;
  receiver: SandboxValue;
  args: SandboxValue[];
};

export type DisposableStackState = {
  disposed: boolean;
  active: boolean;
  resources: DisposableResource[];
};

export const disposableStackStates = new WeakMap<object, DisposableStackState>();
