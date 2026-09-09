import type { SandboxClosure, SandboxValue } from "./values.js";
import type { IteratorWrapperState } from "./iterator-wrapper.js";

export type IteratorHelperState = {
  method: "map" | "filter" | "take" | "drop" | "flatMap" | "concat";
  status: "start" | "executing" | "yield" | "done";
  outer?: IteratorWrapperState;
  inner?: IteratorWrapperState;
  iterables?: Array<{ iterable: SandboxValue; open: SandboxClosure }>;
  callback: SandboxValue;
  remaining: number;
  index: number;
};
export const iteratorHelperStates = new WeakMap<object, IteratorHelperState>();
