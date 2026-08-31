import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { SearchOptions } from "../../../src/commands/search/index.js";
import { nativeRgEnvironment, requireNativeRg } from "../search/native-tool.js";

export interface Probe {
  name: string;
  args: string[];
  files?: Record<string, string | number[]>;
  links?: Record<string, string>;
  stdin?: string | number[];
  options?: SearchOptions;
  script?: string;
  chunkSize?: number;
}

export interface Outcome { code: number; stdout: string; stderr: string }
export const directory = fileURLToPath(new URL("./", import.meta.url));
export const bytes = (value: string | number[] = ""): Buffer => Buffer.from(typeof value === "string" ? value : new Uint8Array(value));
export const text = (value: string): string => Buffer.from(value, "base64").toString();

export function bounded(command: string, args: string[], input: string | Buffer, cwd: string, timeout = 10000, environment?: NodeJS.ProcessEnv, maxOutputBytes = 16 * 1024 * 1024): Outcome {
  assert.ok(Number.isSafeInteger(maxOutputBytes) && maxOutputBytes > 0 && maxOutputBytes <= 16 * 1024 * 1024, "invalid captured output budget");
  const env: NodeJS.ProcessEnv = environment ? { ...environment } : { ...process.env, LC_ALL: "C", LANG: "C", RIPGREP_CONFIG_PATH: "", NO_COLOR: "1" };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(command, args, {
    cwd, input, timeout, killSignal: "SIGKILL", maxBuffer: maxOutputBytes,
    env,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null, `${command} killed: ${child.signal}`);
  assert.notEqual(child.status, null);
  return { code: child.status!, stdout: child.stdout.toString("base64"), stderr: child.stderr.toString("base64") };
}

export function virtual(probes: Probe[], budget?: { remainingBytes: number }, run: typeof bounded = bounded): Outcome[] {
  const remaining = budget?.remainingBytes ?? 16 * 1024 * 1024;
  assert.ok(Number.isSafeInteger(remaining) && remaining <= 16 * 1024 * 1024, "invalid captured output budget");
  assert.ok(remaining > 0, "captured output budget exhausted");
  const outcome = run(process.execPath, ["--import", "tsx", join(directory, "worker.ts")], JSON.stringify(probes), resolve(directory, "../../.."), 10000, undefined, remaining);
  const captured = Buffer.from(outcome.stdout, "base64").length + Buffer.from(outcome.stderr, "base64").length;
  assert.ok(captured <= remaining, "captured output exceeds remaining budget");
  if (budget) budget.remainingBytes -= captured;
  assert.equal(outcome.code, 0, text(outcome.stderr));
  return JSON.parse(text(outcome.stdout)) as Outcome[];
}

export function virtualBatches(probes: Probe[], run: typeof bounded = bounded): Outcome[] {
  assert.ok(probes.length <= 64 * 8, "virtual matrix supports at most 8 batches of 64 probes");
  const budget = { remainingBytes: 16 * 1024 * 1024 };
  const outcomes: Outcome[] = [];
  for (let offset = 0; offset < probes.length; offset += 64) {
    const batch = probes.slice(offset, offset + 64);
    const result = virtual(batch, budget, run);
    assert.ok(Array.isArray(result), "virtual batch must return an outcome array");
    assert.equal(result.length, batch.length, "virtual batch outcome count");
    outcomes.push(...result);
  }
  return outcomes;
}

export function native(probe: Probe): Outcome {
  const identity = requireNativeRg();
  const root = mkdtempSync(join(directory, ".native-"));
  const pathFor = (name: string) => {
    const path = resolve(root, name);
    assert(path.startsWith(root + sep));
    return path;
  };
  try {
    mkdirSync(join(root, ".git"));
    for (const [name, value] of Object.entries(probe.files ?? {})) {
      const path = pathFor(name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes(value));
    }
    for (const [name, target] of Object.entries(probe.links ?? {})) {
      const path = pathFor(name);
      const destination = resolve(dirname(path), target);
      assert(destination === root || destination.startsWith(root + sep));
      mkdirSync(dirname(path), { recursive: true });
      symlinkSync(target, path);
    }
    const env = nativeRgEnvironment(root, identity.path);
    if (probe.script !== undefined) return bounded("/bin/bash", ["--noprofile", "--norc", "-c", `rg() { command "$SAFE_BASH_TEST_RG" --no-config --no-ignore-global --sort=path "$@"; }; ${probe.script}`], bytes(probe.stdin), root, 3000, env);
    return bounded(identity.path, ["--no-config", "--no-ignore-parent", "--no-ignore-global", "--sort=path", ...probe.args], bytes(probe.stdin), root, 3000, env);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

export function compare(actual: Outcome, expected: Outcome, probe: Probe): void {
  assert.equal(actual.code, expected.code, `${probe.name}: ${text(actual.stderr)} versus ${text(expected.stderr)}`);
  assert.equal(text(actual.stderr), text(expected.stderr), probe.name);
  if (probe.args.includes("--json") && text(actual.stdout).startsWith("{")) {
    const events = (value: string) => text(value).replace(/("(?:elapsed|elapsed_total)":)\{[^{}]*\}/gu, "$1null");
    assert.equal(events(actual.stdout), events(expected.stdout), probe.name);
  } else assert.equal(text(actual.stdout), text(expected.stdout), probe.name);
  if (!probe.args.includes("--json")) assert.equal(actual.stdout, expected.stdout, `${probe.name}: byte equality`);
}
