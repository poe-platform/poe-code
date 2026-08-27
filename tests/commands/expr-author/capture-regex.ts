import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { platform, release, arch } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { regexCases, unsupportedRegexCases } from "../expr/regex-cases.js";
import { nullableAuditCases } from "./regex-audit-cases.js";
import { native, oracleHash, oraclePath, qualifyOracle } from "../expr/oracle.js";
import { run } from "../expr/helpers.js";

if (process.argv[2] !== "--capture" || process.argv.length !== 3) throw new Error("Explicit opt-in required: capture-regex.ts --capture");
qualifyOracle();
const root = fileURLToPath(new URL("../../../", import.meta.url));
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const paths = ["src/commands/regex-execution/protocol.ts", "src/commands/regex-execution/client.ts", "src/commands/regex-execution/worker.ts"];
for (const directory of ["src/commands/expr", "tests/commands/expr", "tests/commands/expr-author"]) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name === "tsconfig.json")) paths.push(`${directory}/${entry.name}`);
  }
}
paths.sort();
const inputs: Record<string, string> = {};
for (const path of paths) inputs[path] = hash(await readFile(join(root, path)));
const specimens = [
  ...regexCases().map(specimen => ({ ...specimen, cohort: "primary-controls" })),
  ...unsupportedRegexCases().map(specimen => ({ ...specimen, cohort: "known-unsupported" })),
  ...nullableAuditCases().map(specimen => ({ ...specimen, cohort: "nullable-audit" })),
];
const rows: (typeof specimens[number] & { expected: ReturnType<typeof native>; actual: ReturnType<typeof native>; equal: boolean })[] = [];
for (const specimen of specimens) {
  const expected = native(specimen.args, specimen.locale);
  const observed = await run(specimen.args, {}, { env: { LC_ALL: specimen.locale } });
  const actual = { exitCode: observed.exitCode, stdoutHex: observed.stdoutHex, stderr: observed.stderr };
  rows.push({ ...specimen, expected, actual, equal: JSON.stringify(expected) === JSON.stringify(actual) });
}
for (const path of paths) if (inputs[path] !== hash(await readFile(join(root, path)))) throw new Error(`Input changed during capture: ${path}`);
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 2000 });
const status = spawnSync("git", ["status", "--short", "--", ...paths], { cwd: root, encoding: "utf8", timeout: 2000 });
if (head.status !== 0 || status.status !== 0) throw new Error("Git source-state capture failed");
const directory = await mkdtemp(join(root, "tests/commands/expr-author/regex-capture-"));
const summary = {
  capturedAt: new Date().toISOString(), candidate: { head: head.stdout.trim(), inputStatus: status.stdout, inputs },
  profile: { platform: platform(), release: release(), arch: arch(), node: process.version, locales: ["C", "C.UTF-8"] },
  oracle: { path: relative(root, oraclePath), version: "GNU coreutils 9.7", sha256: oracleHash },
  total: rows.length, exactMatches: rows.filter(row => row.equal).length,
  cohorts: Object.fromEntries(["primary-controls", "known-unsupported", "nullable-audit"].map(cohort => {
    const selected = rows.filter(row => row.cohort === cohort);
    return [cohort, { total: selected.length, exactMatches: selected.filter(row => row.equal).length }];
  })),
  corpusSha256: hash(JSON.stringify(specimens)), resultsSha256: hash(JSON.stringify(rows)),
  limitations: ["Author controls, not independent holdouts/full gate", "Known unsupported cases are differences, not passes", "Darwin GNU9.7 only, not GNU/Linux or Apple", "Input postcheck covers enumerated files only, not append-proof tree", "No performance or public/default dispatch claim"],
};
await writeFile(join(directory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
await writeFile(join(directory, "results.json"), `${JSON.stringify(rows, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ directory: relative(root, directory), ...summary }, null, 2));
if (summary.exactMatches !== summary.total) process.exitCode = 1;
