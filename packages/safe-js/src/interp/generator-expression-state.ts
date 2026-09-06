import type { SandboxValue } from "./values.js";

export type GeneratorExpressionState<T = SandboxValue> =
  | { kind: "binary"; left: T }
  | { kind: "array"; values: T; index: number };
