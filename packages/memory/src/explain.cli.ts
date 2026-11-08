import { type MemoryRuntime } from "./filesystem.js";
import { explainPage } from "./explain.js";
import type { ExplainResult } from "./types.js";

export async function runMemoryExplain(input: {
  root: string;
  relPath: string;
  budget: number;
  agent?: string;
}, runtime: MemoryRuntime = {}): Promise<ExplainResult> {
  return explainPage(input.root, {
    relPath: input.relPath,
    budget: input.budget,
    agent: input.agent
  }, runtime);
}
