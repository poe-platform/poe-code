import type { ClassNode, DynamicFunctionKind, FunctionDeclaration, FunctionNode, ParseResult, TemplateLiteral } from "./parser.js";

export type FunctionSource = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
};

export const functionSources = new WeakMap<FunctionNode | ClassNode, FunctionSource>();
export const templateSources = new WeakMap<TemplateLiteral, string>();
export const functionStrictness = new WeakMap<FunctionNode, boolean>();
/** Eval-root declarations are instantiated before statement execution. */
export const evalFunctionDeclarations = new WeakSet<FunctionDeclaration>();

export type EvalSourceContext = {
  strict: boolean;
  newTarget: boolean;
  superProperty: boolean;
  superCall: boolean;
  arguments: boolean;
  privateNames: string[];
};

export type DynamicSource = {
  body: string;
  nodes: Map<number, ParseResult>;
} & ({kind: DynamicFunctionKind; parameters: string} | {kind: "eval"; context: EvalSourceContext} | {kind: "module"; parameters: ""});

export const dynamicSourceRecords = new WeakSet<object>();
export const dynamicNodeSources = new WeakMap<object, DynamicSource>();
export const dynamicValueSources = new WeakMap<object, DynamicSource>();
