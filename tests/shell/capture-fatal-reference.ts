import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const executable = process.argv[2];
assert.ok(executable, "Pass the explicit pinned Bash executable");
const scripts = [
  ': "${missing:?stop}"; : >after',
  ': >before; call() { : "${missing:?stop}"; : >wrong; }; call || : >recovered; : >after',
  ': >before; ( : "${missing:?stop}"; : >wrong ); printf "%s" "$?"; : >after',
  'value=$(printf inner; : "${missing:?stop}"; : >wrong); printf "<%s>:%s" "$value" "$?"; : >after',
  ': >before;\n: "${missing:?stop}"; : >after',
  ': <<<"${missing:?stop}"; : >after',
  'cat <<<"${missing:?stop}"; printf "%s" "$?"; : >after',
  ': "$((1/0))"; : >after',
  ': >before; { : "$((7/0))"; : >wrong; } || : >recovered; : >after',
  '((7/0)) || printf "recovered:%s" "$?"; : >after',
  'value=$(printf inner; : "$((7/0))"; : >wrong); printf "<%s>:%s" "$value" "$?"; : >after',
  ': >before; : "$((1+))" || : >recovered; : >after',
  'value=$(: "$((1+))"); printf "%s" "$?"; : >after',
  ': >before;\n: "$((10 / (2-2)))"; : >after',
  'printf touched >marker; printf "%s" "$(true |)"',
  ': >before; never() { value=$(true |); }; : >after',
  ': >before; if false; then value=$(true |); fi; : >after',
  ': >before; true &&',
  ': >before; if true; then :',
  ': >before;\n: 4>&9; printf "%s" "$?"; : >after',
  'value=$(<missing); printf "<%s>:%s" "$value" "$?"; : >after',
];
const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" };
const version = spawnSync(executable, ["--noprofile", "--norc", "--version"], { env: environment, encoding: "utf8", timeout: 2000 }).stdout.split("\n")[0];
const records = scripts.map((source) => {
  const directory = mkdtempSync(join(tmpdir(), "virtual-bash-fatal-reference-"));
  try {
    const result = spawnSync(executable, ["--noprofile", "--norc", "-c", source, "shell"], { cwd: directory, env: { ...environment, HOME: directory }, encoding: "utf8", timeout: 2000, maxBuffer: 262144 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return { source, stdout: result.stdout, stderr: result.stderr, exitCode: result.status, files: Object.fromEntries(readdirSync(directory).map((name) => [name, readFileSync(join(directory, name), "utf8")])) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
const evidence = { executable, version, executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), argv0: "shell", environment, records };
process.stdout.write(`*** Begin Patch\n*** Add File: tests/shell/fatal-reference.json\n${JSON.stringify(evidence, null, 2).split("\n").map((line) => `+${line}`).join("\n")}\n*** End Patch\n`);
