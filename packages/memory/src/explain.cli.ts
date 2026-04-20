import { explainPage } from "./explain.js";
import type { ExplainResult, SpawnFn } from "./types.js";

export async function runMemoryExplain(input: {
  root: string;
  relPath: string;
  budget: number;
  agent?: string;
  spawnFn?: SpawnFn;
}): Promise<ExplainResult> {
  return explainPage(input.root, {
    relPath: input.relPath,
    budget: input.budget,
    agent: input.agent,
    spawnFn: input.spawnFn
  });
}
