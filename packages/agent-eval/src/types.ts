import type { Dirent } from "node:fs";
import type { Stats } from "node:fs";
import type { AcpEvent } from "@poe-code/agent-spawn";
import type { AggregateStats } from "./aggregate.js";

export type { AggregateStats } from "./aggregate.js";
export type { SpawnUsage } from "@poe-code/agent-spawn";

export type PlanKind = "plan" | "pipeline" | "superintendent" | "experiment";
export type RubricKey = "completeness" | "spec_adherence" | "code_quality" | string;
export type Verdict = "pass" | "fail" | "error" | "cheated" | "budget_exceeded";

export interface EvalSource {
  rootDir: string;
}

export interface EvalFs {
  readdir(
    path: string,
    options?: { withFileTypes?: boolean }
  ): Promise<readonly (string | Dirent)[]>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  stat(path: string): Promise<Stats | { isDirectory(): boolean; isFile?(): boolean }>;
}

export interface Budget {
  maxIterations: number;
  maxTokens: number;
  wallClockMs: number;
}

export type SpawnEvent = AcpEvent | ({ sessionUpdate: string } & Record<string, unknown>);

export interface JudgeSpec {
  agent: string;
  model: string;
  rubric: readonly RubricKey[];
}

export interface JudgeOverrideSpec {
  agent?: string;
  model?: string;
  rubric?: readonly RubricKey[];
}

export interface ScorerSpec {
  command: string;
  cwd: string;
  resultPath: string;
  timeoutMs: number;
}

export interface EvalDef {
  id: string;
  title: string;
  rootDir: string;
  target: {
    repo: string;
    ref: string;
    planDest: string;
  };
  scorer: ScorerSpec;
  oracle: {
    path: string;
  };
  budget: Budget;
  judge: JudgeSpec;
  weights: {
    tests: number;
    judge: number;
  };
  verify?: {
    command: string;
    timeoutMs: number;
  };
  plan: {
    path: string;
    kind: PlanKind;
    body: string;
    frontmatter: Record<string, unknown>;
  };
}

export interface EvalRunOptions {
  sourceDir: string;
  evalId: string;
  agent: string;
  model: string;
  outDir?: string;
  cloneCacheDir?: string | null;
  repeatIndex?: number;
  verifyOracle?: boolean;
  judge?: "on" | "off" | JudgeSpec | JudgeOverrideSpec;
}

export interface CheatReport {
  cheated: boolean;
  violations: readonly {
    path: string;
    toolCall: string;
    reason: "outside-clone";
  }[];
}

export interface EvalRunResult {
  runId: string;
  eval: string;
  agent: string;
  model: string;
  planKind: PlanKind;
  verdict: Verdict;
  correctness: number;
  iterations: number;
  durationMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    costUsd?: number;
  };
  tests: {
    passed: number;
    total: number;
  };
  judge?: Record<RubricKey, number> & { mean: number };
  cheated: boolean;
  cheatReport: CheatReport;
  error?: string;
}

export interface EvalMatrixOptions {
  sourceDir: string;
  evalIds?: readonly string[];
  agents: readonly string[];
  models: readonly string[];
  repeats?: number;
  outDir?: string;
  cloneCacheDir?: string | null;
  verifyOracle?: boolean;
  judge?: "on" | "off" | JudgeSpec | JudgeOverrideSpec;
}

export interface AggregatedCell {
  cell: {
    eval: string;
    agent: string;
    model: string;
    planKind: PlanKind;
  };
  repeats: number;
  runIds: readonly string[];
  cheated_any: boolean;
  iterations: AggregateStats;
  durationMs: AggregateStats;
  usage: {
    inputTokens: AggregateStats;
    outputTokens: AggregateStats;
    cachedTokens: AggregateStats;
    costUsd: AggregateStats;
  };
  tests: {
    passRateMean: number;
    passRateMin: number;
    passRateMax: number;
  };
  correctness: AggregateStats;
  judge?: {
    mean: AggregateStats;
  };
}

export interface SourceConfig {
  judge: {
    agent: string;
    model: string;
  };
  out: string;
  weights: {
    tests: number;
    judge: number;
  };
  clone_cache_dir: string | null;
}
