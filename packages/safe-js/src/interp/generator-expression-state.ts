import type { SandboxValue } from "./values.js";
import type { Scope } from "./scope.js";
import type { CompletionResult } from "./exceptions.js";
import type { SandboxIterator, IteratorSnapshot, IteratorAwaitState } from "./iteration.js";

export type GeneratorExpressionState<T = SandboxValue, S = Scope, I = SandboxIterator | IteratorSnapshot> =
  | { kind: "switch"; phase: "test" | "body"; index: number; statementIndex: number; value: T; scope: S }
  | { kind: "yield-delegate"; async: boolean; value: T; current: T; iterator: I;
      phase?: "await" | "close"; awaitState?: IteratorAwaitState; completion?: {type:"normal"|"return"|"throw";value:T} }
  | { kind: "declaration"; index: number }
  | { kind: "pattern-source"; value: T }
  | { kind: "object-pattern"; phase: "key" | "reference" | "binding"; index: number; excludedKeys: T[]; key: T; current: T; referenceObject?: T; referenceKey?: T; privateName?: string; referenceScope?: S; referenceUnresolvable?: true }
  | { kind: "array-pattern"; phase: "reference" | "binding"; index: number; done: boolean; current: T; iterator: I; referenceObject?: T; referenceKey?: T; privateName?: string; referenceScope?: S; referenceUnresolvable?: true }
  | { kind: "for-of-array"; phase: "left" | "body"; values: T; current: T; index: number; scope: S }
  | { kind: "for-of-iterator"; phase: "left" | "body" | "next" | "close"; awaitState?: IteratorAwaitState;
      closeCompletion?: Omit<CompletionResult, "value" | "node" | "stackFrames"> & {value: T; stackFrames?: string[]};
      async: boolean; value: T; current: T; index: number; scope: S; iterator: I }
  | { kind: "for-in"; phase?: "left" | "body"; object: T; keys: string[]; index: number; scope: S }
  | { kind: "for"; phase: "init" | "test" | "body" | "update" | "dispose"; loopScope: S; activeScope: S }
  | { kind: "binary"; left: T }
  | { kind: "dynamic-import"; source: T }
  | { kind: "identifier-assignment"; current: T; referenceKind?: "binding" | "object" | "unresolvable"; referenceScope?: S; referenceObject?: T }
  | { kind: "member"; object: T; superReceiver?: T }
  | { kind: "member-assignment"; object: T; property: T; current: T; key?: T; superReceiver?: T; privateName?: string }
  | { kind: "template"; prefix: string; index: number }
  | { kind: "object"; value: T; index: number; key?: T }
  | { kind: "call" | "new" | "tagged"; callee: T; thisValue: T; args: T; index: number }
  | { kind: "array-call"; target: T; method: string; args: T; index: number }
  | { kind: "array"; values: T; index: number };
