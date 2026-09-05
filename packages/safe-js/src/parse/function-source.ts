import type { FunctionNode } from "./parser.js";

export type FunctionSource = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
};

export const functionSources = new WeakMap<FunctionNode, FunctionSource>();
