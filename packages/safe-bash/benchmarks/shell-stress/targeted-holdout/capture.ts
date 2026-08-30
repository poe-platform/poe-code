import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { holdoutCases } from "../../../tests/shell-stress/targeted-holdout/cases.js";
import type { HoldoutCase } from "../../../tests/shell-stress/targeted-holdout/cases.js";
import type { Observation, Snapshot } from "../../../tests/shell-stress/model.js";
import { isolatedSpawn } from "../../../tests/shell-stress/process.js";

const directoryRoot = fileURLToPath(new URL("./", import.meta.url));
const primary = process.argv[2];
const legacy = process.argv[3];
assert.ok(primary && legacy && isAbsolute(primary) && isAbsolute(legacy), "Provide explicit absolute GNU5.3 and legacy Bash binary paths");

function environment(directory: string, locale = "C"): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, LANG: locale, LC_ALL: locale, TZ: "UTC" };
}

function snapshot(directory: string, prefix = ""): Snapshot {
  const files: Snapshot = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files[name] = { type: "directory" };
      Object.assign(files, snapshot(path, `${name}/`));
    } else {
      assert.ok(entry.isFile(), `Unexpected native artifact: ${name}`);
      files[name] = { type: "file", base64: readFileSync(path).toString("base64") };
    }
  }
  return files;
}

async function identity(executable: string) {
  const directory = mkdtempSync(join(directoryRoot, ".native-"));
  try {
    const result = await isolatedSpawn(executable, ["--noprofile", "--norc", "--version"], { cwd: directory, env: environment(directory), timeout: 2000, maxBuffer: 65536 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.signal, null);
    return { executable, sha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), stdout: result.stdout.toString(), stderr: result.stderr.toString(), stdoutBase64: result.stdout.toString("base64"), stderrBase64: result.stderr.toString("base64") };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

async function capture(executable: string, fixture: HoldoutCase): Promise<Observation> {
  const directory = mkdtempSync(join(directoryRoot, ".native-"));
  try {
    for (const [name, contents] of Object.entries(fixture.initialFiles ?? {})) {
      const path = resolve(directory, name);
      assert.ok(path.startsWith(`${directory}/`), `Escaping fixture path: ${name}`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    }
    assert.equal(fixture.env, undefined);
    const result = await isolatedSpawn(executable, ["--noprofile", "--norc", "-c", fixture.script, "shell-stress"], {
      cwd: directory, env: environment(directory, fixture.locale), input: fixture.stdin ?? "", timeout: 2000, maxBuffer: 65536,
    });
    assert.equal(result.error, undefined, `${fixture.name}: ${result.error?.message}`);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, null);
    return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), stdoutBase64: result.stdout.toString("base64"), stderrBase64: result.stderr.toString("base64"), exitCode: result.status!, files: snapshot(directory) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

const primaryIdentity = await identity(primary);
const legacyIdentity = await identity(legacy);
assert.match(primaryIdentity.stdout, /version 5\.3\.0\(/u);
assert.match(legacyIdentity.stdout, /version 3\.2\./u);
const cases = [];
for (const fixture of holdoutCases) {
  const modern = await capture(primary, fixture);
  const old = await capture(legacy, fixture);
  assert.deepEqual(await capture(primary, fixture), modern, `${fixture.name}: unstable modern reference`);
  assert.deepEqual(await capture(legacy, fixture), old, `${fixture.name}: unstable legacy reference`);
  cases.push({ fixture, primary: modern, legacy: old, differs: JSON.stringify(modern) !== JSON.stringify(old) });
}
const evidence = {
  capturedAt: new Date().toISOString(), primary: primaryIdentity, legacy: legacyIdentity, platform: `${process.platform}/${process.arch}`, node: process.version,
  caseSourceSha256: createHash("sha256").update(readFileSync(new URL("../../../tests/shell-stress/targeted-holdout/cases.ts", import.meta.url))).digest("hex"),
  safety: { literalArgv: true, shell: false, detached: true, deadlineMs: 2000, combinedOutputBytes: 65536, sanitizedEnvironment: true, isolatedTemporaryCwd: true, cleanup: "finally plus shared process-group cleanup", capturesPerBinaryPerCase: 2 },
  policy: "GNU Bash 5.3.0 is primary only for these NEW cases; all existing Bash3.2 references and expectations remain unchanged. Raw streams and file bytes are preserved without diagnostic normalization.",
  cases,
};
console.log(`*** Begin Patch\n*** Add File: benchmarks/shell-stress/targeted-holdout/references.json\n${JSON.stringify(evidence, null, 2).split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch`);
