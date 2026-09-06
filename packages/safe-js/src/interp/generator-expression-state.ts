import type { SandboxValue } from "./values.js";
import type { Scope } from "./scope.js";
import type { SandboxIterator, IteratorSnapshot } from "./iteration.js";

export type GeneratorExpressionState<T = SandboxValue, S = Scope, I = SandboxIterator | IteratorSnapshot> =
  | { kind: "declaration"; index: number }
  | { kind: "pattern-source"; value: T }
  | { kind: "object-pattern"; phase: "key" | "reference" | "binding"; index: number; excludedKeys: T[]; key: T; current: T; referenceObject?: T; referenceKey?: T }
  | { kind: "array-pattern"; phase: "reference" | "binding"; index: number; done: boolean; current: T; iterator: I; referenceObject?: T; referenceKey?: T }
  | { kind: "for-of-array"; phase: "left" | "body"; values: T; current: T; index: number; scope: S }
  | { kind: "for-of-iterator"; phase: "left" | "body"; async: boolean; value: T; current: T; index: number; scope: S; iterator: I }
  | { kind: "for-in"; phase?: "left" | "body"; object: T; keys: string[]; index: number; scope: S }
  | { kind: "for"; phase: "init" | "test" | "body" | "update"; loopScope: S; activeScope: S }
  | { kind: "binary"; left: T }
  | { kind: "identifier-assignment"; current: T }
  | { kind: "member"; object: T; superReceiver?: T }
  | { kind: "member-assignment"; object: T; property: T; current: T; key?: T; superReceiver?: T }
  | { kind: "template"; prefix: string; index: number }
  | { kind: "object"; value: T; index: number; key?: T }
  | { kind: "call" | "new" | "tagged"; callee: T; thisValue: T; args: T; index: number }
  | { kind: "array-call"; target: T; method: string; args: T; index: number }
  | { kind: "array"; values: T; index: number };
