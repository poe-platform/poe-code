import type { SandboxClosure, SandboxValue } from "./values.js";
import type { IteratorWrapperState } from "./iterator-wrapper.js";

export type IteratorHelperState = {
  method: "map" | "filter" | "take" | "drop" | "flatMap" | "concat" | "zip" | "zipKeyed";
  status: "start" | "executing" | "yield" | "done";
  outer?: IteratorWrapperState;
  inner?: IteratorWrapperState;
  iterables?: Array<{ iterable: SandboxValue; open: SandboxClosure }>;
  joint?: {
    mode: "shortest" | "longest" | "strict";
    cursors: Array<IteratorWrapperState | null>;
    padding: SandboxValue[];
    arrayPrototype?: SandboxValue;
    keys?: Array<string | symbol>;
  };
  callback: SandboxValue;
  remaining: number;
  index: number;
};
export const iteratorHelperStates = new WeakMap<object, IteratorHelperState>();
