import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildRequest, Observation, Snapshot, StressCase } from "./model.js";
import { isolatedSpawn } from "./process.js";
import { collectSourceInputs } from "../source-census.js";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const bashPath = "/bin/bash";
export const hardDeadlineMs = 5000;
const maxBuffer = 1024 * 1024;

export function sourceEvidence() {
  const captured = collectSourceInputs(root);
  const hashes: Record<string, string> = {};
  for (const [path, bytes] of [...captured.files, ...captured.admissionInputs]) {
    hashes[path] = createHash("sha256").update(bytes).digest("hex");
  }
  for (const path of ["package.json", "package-lock.json", "tsconfig.json", "tests/fixtures/shell-cases.json"]) {
    hashes[path] = createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
  }
  return {
    time: new Date().toISOString(),
    revision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 2000 }).stdout.trim(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    aggregate: createHash("sha256").update(JSON.stringify(hashes)).digest("hex"),
    hashes,
    sourceAdmission: captured.admission,
  };
}

function environment(home: string): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", HOME: home, TMPDIR: home, LANG: "C", LC_ALL: "C", TZ: "UTC" };
}

function checkChild(result: { error?: Error | undefined; signal: NodeJS.Signals | null; status: number | null }, label: string): void {
  assert.equal(result.error, undefined, `${label}: ${result.error?.message}`);
  assert.equal(result.signal, null, `${label}: killed by ${result.signal}`);
  assert.notEqual(result.status, null, `${label}: no exit status`);
}

export function bashVersion(): string {
  const result = spawnSync(bashPath, ["--noprofile", "--norc", "--version"], {
    env: environment(tmpdir()), encoding: "utf8", timeout: hardDeadlineMs, maxBuffer,
  });
  checkChild(result, "Bash version");
  assert.equal(result.status, 0);
  return result.stdout.trim();
}

function hostSnapshot(directory: string, prefix = ""): Snapshot {
  const snapshot: Snapshot = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const key = `${prefix}${entry.name}`;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      snapshot[key] = { type: "directory" };
      Object.assign(snapshot, hostSnapshot(path, `${key}/`));
    } else {
      assert.ok(entry.isFile(), `Unexpected non-regular reference artifact: ${key}`);
      snapshot[key] = { type: "file", base64: readFileSync(path).toString("base64") };
    }
  }
  return snapshot;
}

export async function runBash(fixture: StressCase): Promise<Observation> {
  const directory = mkdtempSync(join(tmpdir(), "virtual-bash-shell-stress-"));
  let temporary: string | undefined;
  try {
    const base = realpathSync(tmpdir());
    if (process.env.FULL_GATE_ROOT) {
      const owned = realpathSync(process.env.FULL_GATE_ROOT);
      assert(base === owned || base.startsWith(owned + sep), "native scratch is outside the admitted gate root");
    }
    temporary = mkdtempSync(join(base, "safe-bash-shell-scratch-"));
    for (const [name, content] of Object.entries(fixture.initialFiles ?? {})) {
      const path = resolve(directory, name);
      assert.ok(path.startsWith(`${directory}/`), `Unsafe fixture path: ${name}`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    for (const name of Object.keys(fixture.env ?? {})) {
      assert.match(name, /^(?:STRESS_[A-Z_]+|VALUE|EMPTY|PRESENT)$/u, `Unsafe fixture environment key: ${name}`);
    }
    const result = await isolatedSpawn(bashPath, ["--noprofile", "--norc", "-c", fixture.script, "shell-stress"], {
      cwd: directory,
      env: { ...environment(directory), TMPDIR: temporary, ...fixture.env },
      input: fixture.stdin ?? "",
      timeout: hardDeadlineMs, maxBuffer,
    });
    checkChild(result, fixture.name);
    return {
      stdout: result.stdout.toString(), stderr: result.stderr.toString(),
      stdoutBase64: Buffer.from(result.stdout).toString("base64"), stderrBase64: Buffer.from(result.stderr).toString("base64"),
      exitCode: result.status!, files: hostSnapshot(directory),
    };
  } finally {
    try { rmSync(directory, { recursive: true, force: true }); }
    finally { if (temporary !== undefined) rmSync(temporary, { recursive: true }); }
  }
}

export async function runVirtual(request: ChildRequest): Promise<Observation | { passed: string }> {
  const before = sourceEvidence();
  const result = await isolatedSpawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./virtual-child.ts", import.meta.url))], {
    cwd: root, env: environment(tmpdir()), input: JSON.stringify(request),
    timeout: hardDeadlineMs, maxBuffer,
  });
  const after = sourceEvidence();
  const context = `${request.fixture?.name ?? request.probe}; source ${before.revision} ${before.aggregate} @ ${before.time}; after ${after.aggregate} @ ${after.time}`;
  checkChild(result, context);
  assert.equal(result.status, 0, `${context}\n${result.stderr}\n${result.stdout}`);
  assert.equal(result.stderr.toString(), "", `${context}: unexpected child stderr`);
  assert.equal(after.aggregate, before.aggregate, `${context}: source changed during execution; rerun instead of attributing this result`);
  return JSON.parse(result.stdout.toString()) as Observation | { passed: string };
}

export async function runVirtualScript(fixture: StressCase): Promise<Observation> {
  const result = await runVirtual({ kind: "script", fixture });
  assert.ok("exitCode" in result);
  return result;
}
