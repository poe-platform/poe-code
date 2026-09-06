import type { SandboxValue } from "./values.js";

export type GeneratorExpressionState<T = SandboxValue> =
  | { kind: "binary"; left: T }
  | { kind: "object"; value: T; index: number; key?: T }
  | { kind: "call" | "new"; callee: T; thisValue: T; args: T; index: number }
  | { kind: "array-call"; target: T; method: string; args: T; index: number }
  | { kind: "array"; values: T; index: number };
