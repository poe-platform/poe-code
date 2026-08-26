import type { TextCase } from "./cases.js";

export interface Observation {
  exitCode: number;
  stdout: string;
  stderr: string;
  files: Record<string, { type: string; bytes?: string; mode: number }>;
}

export type Execution = { status: "completed"; observation: Observation; durationMs: number }
  | { status: "pending" | "error" | "timeout" | "oracle-unavailable"; reason: string; durationMs: number };

export interface Comparison {
  name: string;
  tool: TextCase["tool"];
  feature: string;
  status: "pass" | "fail" | "unsupported" | "pending" | "error" | "timeout" | "oracle-unavailable" | "oracle-rejected";
  differences: string[];
  native: Execution;
  virtual: Execution;
}

export function compare(fixture: TextCase, native: Execution, virtual: Execution): Comparison {
  const base = { name: fixture.name, tool: fixture.tool, feature: fixture.feature, native, virtual };
  if (native.status !== "completed") return { ...base, status: native.status, differences: [native.reason] };
  if (virtual.status !== "completed") return { ...base, status: virtual.status, differences: [virtual.reason] };
  const expected = native.observation;
  const actual = virtual.observation;
  const differences: string[] = [];
  for (const field of ["exitCode", "stdout", "stderr"] as const) if (actual[field] !== expected[field]) differences.push(field);
  for (const path of new Set([...Object.keys(expected.files), ...Object.keys(actual.files)])) {
    if (JSON.stringify(expected.files[path]) !== JSON.stringify(actual.files[path])) differences.push(`file:${path}`);
  }
  if (expected.exitCode !== (fixture.nativeExitCode ?? 0)) return { ...base, status: "oracle-rejected", differences };
  if (!differences.length) return { ...base, status: "pass", differences };
  const unsupported = actual.exitCode !== 0 && /unsupported|not supported/iu.test(Buffer.from(actual.stderr, "base64").toString());
  return { ...base, status: unsupported ? "unsupported" : "fail", differences };
}

export function totals(results: readonly { status: Comparison["status"] }[]): Record<string, number> {
  const counts: Record<string, number> = { total: results.length, pass: 0, fail: 0, unsupported: 0, pending: 0, error: 0, timeout: 0, "oracle-unavailable": 0, "oracle-rejected": 0, skipped: 0 };
  for (const result of results) counts[result.status]!++;
  return counts;
}
