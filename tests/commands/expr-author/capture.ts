import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir, platform, release, arch } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { nativeCases } from "../expr/native-cases.js";
import { native, oracleHash, oraclePath, qualifyOracle } from "../expr/oracle.js";
import { run } from "../expr/helpers.js";

if (process.argv[2] !== "--capture" || process.argv.length !== 3) throw new Error("Explicit opt-in required: capture.ts --capture");
qualifyOracle();
const root = fileURLToPath(new URL("../../../", import.meta.url));
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const source: Record<string, string> = {};
for (const entry of await readdir(join(root, "src/commands/expr"))) {
  if (entry.endsWith(".ts")) source[`src/commands/expr/${entry}`] = hash(await readFile(join(root, "src/commands/expr", entry)));
}
const specimens = nativeCases();
const rows = [];
for (const specimen of specimens) {
  const expected = native(specimen.args, specimen.locale);
  const observed = await run(specimen.args, {}, { env: { LC_ALL: specimen.locale } });
  const actual = { exitCode: observed.exitCode, stdoutHex: observed.stdoutHex, stderr: observed.stderr };
  rows.push({ ...specimen, expected, actual, equal: JSON.stringify(expected) === JSON.stringify(actual) });
}
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 2000 });
const status = spawnSync("git", ["status", "--short", "--", "src/commands/expr", "tests/commands/expr", "tests/commands/expr-author"], { cwd: root, encoding: "utf8", timeout: 2000 });
if (head.status !== 0 || status.status !== 0) throw new Error("Git source-state capture failed");
const directory = await mkdtemp(join(tmpdir(), "expr-author-"));
const summary = {
  capturedAt: new Date().toISOString(), candidate: { head: head.stdout.trim(), ownedStatus: status.stdout, source },
  profile: { platform: platform(), release: release(), arch: arch(), node: process.version, locales: ["C", "C.UTF-8"] },
  oracle: { path: relative(root, oraclePath), version: "GNU coreutils 9.7", sha256: oracleHash },
  total: rows.length, exactMatches: rows.filter(row => row.equal).length,
  corpusSha256: hash(JSON.stringify(specimens)), resultsSha256: hash(JSON.stringify(rows)),
  limitations: ["Author cohort, not independent holdouts or full gate", "No native Linux or Apple expr qualification", "No deployed-provider or performance claim"],
};
await writeFile(join(directory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
await writeFile(join(directory, "results.json"), `${JSON.stringify(rows, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ directory, ...summary }, null, 2));
if (summary.exactMatches !== summary.total) process.exitCode = 1;
