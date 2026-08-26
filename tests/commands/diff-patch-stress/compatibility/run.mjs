import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const source = new URL("../../../../src/commands/diff-patch/", import.meta.url);
const snapshot = () => Object.fromEntries(readdirSync(source).filter(name => name.endsWith(".ts")).sort().map(name =>
  [name, createHash("sha256").update(readFileSync(new URL(name, source))).digest("hex")]));
const report = { startedAt: new Date().toISOString(), head: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  selected: { diff: process.env.DIFF_PATCH_NATIVE_DIFF ?? "/usr/bin/diff", patch: process.env.DIFF_PATCH_NATIVE_PATCH ?? "/usr/bin/patch" },
  sourceBefore: snapshot(), suites: {}, typescript: {}, sourceAfter: {}, sourceChanged: false };
const typedFiles = [];
for (const suite of ["compatibility", "fuzz", "safety"]) {
  const directory = `tests/commands/diff-patch-stress/${suite}`;
  const files = readdirSync(`${root}/${directory}`).filter(name => name.endsWith(".ts")).map(name => `${directory}/${name}`);
  typedFiles.push(...files);
  const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", ...files.filter(name => name.endsWith(".test.ts"))], {
    cwd: root, encoding: "utf8", timeout: 180_000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  report.suites[suite] = { status: result.status, signal: result.signal, error: result.error?.message,
    summary: result.stdout?.split("\n").filter(line => /^# (tests|pass|fail|cancelled|skipped|todo|duration_ms|FUZZ_REPORT|FAILURE_INDEX)/u.test(line)),
    failures: result.stdout?.split("\n").filter(line => /^not ok /u.test(line)),
    stdoutSha256: createHash("sha256").update(result.stdout ?? "").digest("hex") };
}
const typescript = spawnSync(`${root}/node_modules/.bin/tsc`, ["--noEmit", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node", ...typedFiles], {
  cwd: root, encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
});
report.typescript = { status: typescript.status, signal: typescript.signal, error: typescript.error?.message, stdout: typescript.stdout, stderr: typescript.stderr };
report.sourceAfter = snapshot();
report.sourceChanged = JSON.stringify(report.sourceBefore) !== JSON.stringify(report.sourceAfter);
console.log(`RECONCILIATION_REPORT ${JSON.stringify(report)}`);
process.exitCode = report.sourceChanged || typescript.status !== 0 || Object.values(report.suites).some(suite => suite.status !== 0) ? 1 : 0;
