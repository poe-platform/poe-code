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

export function bounded(command: string, args: string[], input: string | Buffer, cwd: string, timeout = 10000, environment?: NodeJS.ProcessEnv): Outcome {
  const env: NodeJS.ProcessEnv = environment ? { ...environment } : { ...process.env, LC_ALL: "C", LANG: "C", RIPGREP_CONFIG_PATH: "", NO_COLOR: "1" };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(command, args, {
    cwd, input, timeout, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024,
    env,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null, `${command} killed: ${child.signal}`);
  assert.notEqual(child.status, null);
  return { code: child.status!, stdout: child.stdout.toString("base64"), stderr: child.stderr.toString("base64") };
}

export function virtual(probes: Probe[]): Outcome[] {
  const outcome = bounded(process.execPath, ["--import", "tsx", join(directory, "worker.ts")], JSON.stringify(probes), resolve(directory, "../../.."));
  assert.equal(outcome.code, 0, text(outcome.stderr));
  return JSON.parse(text(outcome.stdout)) as Outcome[];
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
