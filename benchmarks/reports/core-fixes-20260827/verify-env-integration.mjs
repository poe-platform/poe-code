import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const repo = process.cwd(), output = resolve(process.argv[3]);
const revision = execFileSync("git", ["rev-parse", process.argv[2] ?? "HEAD"], { encoding: "utf8" }).trim();
const source = await mkdtemp(join(tmpdir(), "safe-env-accepted-"));
const selected = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "tests/contracts", "tests/commands/helpers.ts", "tests/commands/execution.test.ts", "tests/commands/core-env", "tests/commands/core-expanded", "tests/shell/env-replacement.test.ts", "tests/shell/env-replacement-bounds.test.ts", "tests/shell/env-replacement-bounds.ts"];
const sourceHashes = {};
async function hashes(prefix) {
  for (const entry of (await readdir(join(source, prefix), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await hashes(path);
    else sourceHashes[path] = createHash("sha256").update(await readFile(join(source, path))).digest("hex");
  }
}
try {
  execFileSync("git", ["archive", "-o", join(source, "snapshot.tar"), revision, ...selected]);
  execFileSync("tar", ["-xf", join(source, "snapshot.tar"), "-C", source]);
  await symlink(join(repo, "node_modules"), join(source, "node_modules"), "dir");
  await hashes("src"); await hashes("tests");
  const cases = [
    { label: "actual-shell acceptance", executable: process.execPath, args: ["--unhandled-rejections=strict", "--import", "tsx", "--test", "tests/commands/core-env/runtime-acceptance.test.ts"] },
    { label: "boundary ordering and shell author cohorts", executable: process.execPath, args: ["--unhandled-rejections=strict", "--import", "tsx", "--test", "tests/commands/core-env/forwarding.test.ts", "tests/commands/core-env/order.test.ts", "tests/commands/execution.test.ts", "tests/commands/core-expanded/regressions.test.ts", "tests/contracts/invoke.test.ts", "tests/contracts/stdin-provenance.test.ts", "tests/shell/env-replacement.test.ts", "tests/shell/env-replacement-bounds.test.ts"] },
    { label: "all-source and selected-test typecheck (not global tests)", executable: "npm", args: ["run", "typecheck"] },
    { label: "frozen production build", executable: "npm", args: ["run", "build"] },
    { label: "built package root env integration", executable: process.execPath, args: ["--input-type=module", "-e", "import assert from 'node:assert/strict';import{Shell,agentCommands,createMemoryFileSystem}from'virtual-bash';const shell=new Shell({fs:createMemoryFileSystem(),env:{INHERITED:'secret'}}).use(agentCommands());try{const result=await shell.exec('env -i A=1 B=2 env -u A');assert.equal(result.stdout,'B=2\\n');assert.equal(result.stderr,'');assert.equal(result.exitCode,0);console.log(JSON.stringify({stdout:result.stdout,stderr:result.stderr,exitCode:result.exitCode}));}finally{await shell.dispose();}"] },
  ];
  const results = cases.map(specimen => {
    const start = new Date().toISOString();
    const result = spawnSync(specimen.executable, specimen.args, { cwd: source, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    return { ...specimen, start, end: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr, counts: result.stdout?.match(/^# (?:tests|pass|fail|skipped|todo|cancelled).*$/gm) ?? [] };
  });
  const report = { capturedAt: new Date().toISOString(), revision, selected, sourceHashes, results,
    runtime: { node: process.version, platform: process.platform },
    scope: "Frozen committed production and selected tests, cached dev dependencies only. Actual-shell acceptance plus source/type/build/root smoke. Not the full product suite or globally complete test typecheck; no dirty product source or expected-output edits.",
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ revision, results: results.map(({ label, exitCode, error, counts }) => ({ label, exitCode, error, counts })) }, null, 2));
  assert.ok(results.every(result => result.exitCode === 0 && !result.error), "Frozen integration verification failed; inspect preserved report");
} finally { await rm(source, { recursive: true, force: true }); }
