import { createHash } from "node:crypto";

export const engines = ["virtual-bash", "just-bash"] as const;
export type Engine = typeof engines[number];
export type Status = "pass" | "fail" | "error" | "timeout" | "pending" | "unsupported";
export const statuses: readonly Status[] = ["pass", "fail", "error", "timeout", "pending", "unsupported"];

export interface Expected {
  stdout: string;
  stderr: string;
  exitCode: number;
  files: Record<string, string>;
}

export interface BenchmarkCase {
  name: string;
  tier: string;
  tags: string[];
  source: "bash-oracle" | "deterministic" | "native-dialect" | "plugin-integration";
  script: string;
  initialFiles: Record<string, string>;
  stdin: string;
  env: Record<string, string>;
  expected: Expected;
}

export interface Observation extends Expected {
  unsupportedEntries: string[];
  stdoutCapture: "native-bytes" | "declared-bytes" | "public-text-utf8";
  stderrCapture: "native-bytes" | "public-text-utf8";
}

export interface ByteEvidence {
  byteLength: number;
  sha256: string;
  base64Prefix: string;
  truncated: boolean;
}

export interface Assertion {
  name: string;
  status: "pass" | "fail" | "pending";
  expected?: unknown;
  actual?: unknown;
  detail?: string;
}

export interface CaseResult {
  engine: Engine;
  name: string;
  tier: string;
  tags: string[];
  source: BenchmarkCase["source"] | "stress-probe";
  status: Status;
  durationMs: number;
  assertions: Assertion[];
  details?: Record<string, unknown>;
  reason?: string;
}

export interface Probe {
  kind: "probe";
  name: "concurrent-pipelines" | "cooperative-cancellation" | "streaming-backpressure";
  tier: "stress";
  tags: string[];
}

export type Task = { kind: "fixture"; fixture: BenchmarkCase } | Probe;

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function textBytes(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

export function byteEvidence(base64: string): ByteEvidence {
  const bytes = Buffer.from(base64, "base64");
  return {
    byteLength: bytes.length,
    sha256: sha256(bytes),
    base64Prefix: bytes.subarray(0, 1024).toString("base64"),
    truncated: bytes.length > 1024,
  };
}

function validUtf8(base64: string): boolean {
  const bytes = Buffer.from(base64, "base64");
  return Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes);
}

export function compareObservation(fixture: BenchmarkCase, observation: Observation): Assertion[] {
  const assertions: Assertion[] = [];
  for (const stream of ["stdout", "stderr"] as const) {
    const expected = fixture.expected[stream];
    const actual = observation[stream];
    const fidelity = observation[`${stream}Capture`];
    const pending = fidelity === "public-text-utf8" && !validUtf8(expected);
    assertions.push({
      name: `${stream}.bytes`,
      status: pending ? "pending" : Buffer.from(expected, "base64").equals(Buffer.from(actual, "base64")) ? "pass" : "fail",
      expected: byteEvidence(expected), actual: byteEvidence(actual),
      detail: pending ? "Public text output cannot establish invalid-UTF-8 byte fidelity" : fidelity,
    });
  }
  assertions.push({ name: "exitCode", status: fixture.expected.exitCode === observation.exitCode ? "pass" : "fail",
    expected: fixture.expected.exitCode, actual: observation.exitCode });
  const paths = [...new Set([...Object.keys(fixture.expected.files), ...Object.keys(observation.files)])].sort();
  const fileDifferences = paths.flatMap((path) => {
    const expected = fixture.expected.files[path];
    const actual = observation.files[path];
    return expected !== undefined && actual !== undefined
      && Buffer.from(expected, "base64").equals(Buffer.from(actual, "base64")) ? [] : [{ path,
      expected: expected === undefined ? null : byteEvidence(expected),
      actual: actual === undefined ? null : byteEvidence(actual) }];
  });
  assertions.push({ name: "filesystem.complete-regular-file-snapshot",
    status: fileDifferences.length === 0 && observation.unsupportedEntries.length === 0 ? "pass" : "fail",
    expected: Object.fromEntries(Object.entries(fixture.expected.files).map(([path, bytes]) => [path, byteEvidence(bytes)])),
    actual: Object.fromEntries(Object.entries(observation.files).map(([path, bytes]) => [path, byteEvidence(bytes)])),
    detail: JSON.stringify({ fileDifferences, rejectedNonRegularEntries: observation.unsupportedEntries }) });
  return assertions;
}

export function assertionStatus(assertions: readonly Assertion[]): Status {
  if (assertions.some((assertion) => assertion.status === "fail")) return "fail";
  if (assertions.some((assertion) => assertion.status === "pending")) return "pending";
  return assertions.length ? "pass" : "pending";
}

export function taskInfo(task: Task): Pick<CaseResult, "name" | "tier" | "tags" | "source"> {
  const metadata = task.kind === "fixture" ? task.fixture : { ...task, source: "stress-probe" as const };
  return { name: metadata.name, tier: metadata.tier, tags: metadata.tags, source: metadata.source };
}

export function summarize(results: readonly CaseResult[]) {
  const counts = (selected: readonly CaseResult[]) => {
    const tally = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<Status, number>;
    for (const result of selected) tally[result.status]++;
    return { total: selected.length, ...tally, passRate: selected.length ? tally.pass / selected.length : 0 };
  };
  const byEngine = Object.fromEntries(engines.map((engine) => [engine, counts(results.filter((result) => result.engine === engine))]));
  const tags = [...new Set(results.flatMap((result) => result.tags))].sort();
  const tiers = [...new Set(results.map((result) => result.tier))].sort();
  const sources = [...new Set(results.map((result) => result.source))].sort();
  const group = (keys: string[], predicate: (result: CaseResult, key: string) => boolean) =>
    Object.fromEntries(keys.map((key) => [key, Object.fromEntries(engines.map((engine) =>
      [engine, counts(results.filter((result) => result.engine === engine && predicate(result, key)))]))]));
  return {
    byEngine,
    byFeature: group(tags, (result, key) => result.tags.includes(key)),
    byTier: group(tiers, (result, key) => result.tier === key),
    bySource: group(sources, (result, key) => result.source === key),
    overall: results.some((result) => ["fail", "error", "timeout"].includes(result.status)) ? "fail"
      : results.length > 0 && results.every((result) => result.status === "pass") ? "pass" : "incomplete",
  };
}
