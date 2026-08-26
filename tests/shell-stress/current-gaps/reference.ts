import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Observation, Snapshot, StressCase } from "../model.js";
import { isolatedSpawn } from "../process.js";

const directoryRoot = fileURLToPath(new URL("./", import.meta.url));
const executable = "/bin/bash";
const environment = (directory: string): NodeJS.ProcessEnv => ({ PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, LANG: "C", LC_ALL: "C", TZ: "UTC" });

function snapshot(directory: string, prefix = ""): Snapshot {
  const result: Snapshot = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result[name] = { type: "directory" };
      Object.assign(result, snapshot(path, `${name}/`));
    } else {
      assert.ok(entry.isFile(), `Unexpected reference artifact ${name}`);
      result[name] = { type: "file", base64: readFileSync(path).toString("base64") };
    }
  }
  return result;
}

export async function referenceIdentity() {
  const directory = mkdtempSync(join(directoryRoot, ".reference-"));
  try {
    const result = await isolatedSpawn(executable, ["--noprofile", "--norc", "--version"], {
      cwd: directory, env: environment(directory), timeout: 1500, maxBuffer: 65536,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    return { executable, sha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), stdout: result.stdout.toString(), stderr: result.stderr.toString(), node: process.version, platform: `${process.platform}/${process.arch}` };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export async function independentBash(fixture: StressCase): Promise<Observation> {
  const directory = mkdtempSync(join(directoryRoot, ".reference-"));
  try {
    for (const [name, content] of Object.entries(fixture.initialFiles ?? {})) {
      const path = resolve(directory, name);
      assert.ok(path.startsWith(`${directory}/`), `Escaping fixture path ${name}`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    for (const name of Object.keys(fixture.env ?? {})) assert.match(name, /^(?:VALUE|STRESS_[A-Z_]+)$/u);
    const result = await isolatedSpawn(executable, ["--noprofile", "--norc", "-c", fixture.script, "shell-stress"], {
      cwd: directory, env: { ...environment(directory), ...fixture.env }, input: fixture.stdin ?? "",
      timeout: 1500, maxBuffer: 65536,
    });
    assert.equal(result.error, undefined, `${fixture.name}: ${result.error?.message}`);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, null);
    return {
      stdout: result.stdout.toString(), stderr: result.stderr.toString(),
      stdoutBase64: result.stdout.toString("base64"), stderrBase64: result.stderr.toString("base64"),
      exitCode: result.status!, files: snapshot(directory),
    };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
