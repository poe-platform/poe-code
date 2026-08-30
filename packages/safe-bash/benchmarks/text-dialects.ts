import { readFile, readdir, writeFile } from "node:fs/promises";
import { dialectFixtures } from "./dialect-fixtures.js";
import { engines, sha256, summarize, type CaseResult } from "./model.js";
import { EngineSession } from "./session.js";
import { oraclePolicy, recordedDialectCase } from "../tests/commands/text-programs-stress/oracle-policy.js";

async function sourceFingerprint(directory: URL): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const hashes: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    hashes.push(entry.name + ":" + (entry.isDirectory() ? await sourceFingerprint(child) : sha256(await readFile(child))));
  }
  return sha256(hashes.join("\n"));
}

const sourceBefore = await sourceFingerprint(new URL("../src/", import.meta.url));
const sessions = engines.map(engine => new EngineSession(engine));
const fixtures = dialectFixtures();
const results: CaseResult[] = [];
try {
  for (const fixture of fixtures) results.push(...await Promise.all(sessions.map(session => session.run({ kind: "fixture", fixture }))));
} finally { await Promise.all(sessions.map(session => session.dispose())); }
const sourceAfter = await sourceFingerprint(new URL("../src/", import.meta.url));
const comparatorPackage = new URL("./node_modules/just-bash/package.json", import.meta.url);
let installed: string | undefined;
try { installed = (JSON.parse(await readFile(comparatorPackage, "utf8")) as { version: string }).version; } catch {}
const summary = summarize(results);
const backgroundErrors = sessions.flatMap(session => session.backgroundErrors);
const report = {
  createdAt: new Date().toISOString(), node: process.version,
  purpose: "Two explicit GNU sed 4.9 utility-policy cases; not a universal Bash or superiority claim",
  versions: { expected: "GNU sed 4.9", comparatorPinned: "just-bash 3.4.2", comparatorInstalled: installed,
    comparatorLockSha256: sha256(await readFile(new URL("./package-lock.json", import.meta.url))) },
  validity: { sourceBefore, sourceAfter, sourceChanged: sourceBefore !== sourceAfter, backgroundErrors },
  oraclePolicy, assertions: ["stdout bytes", "stderr bytes", "exit status", "complete regular-file paths and bytes"],
  limitations: ["This comparison adapter does not assert directory metadata or file modes; the native policy tests retain those assertions"],
  fixtures, preservedNativeMatrix: oraclePolicy.selectedCases.map(recordedDialectCase), results, summary,
};
await writeFile(new URL("./reports/text-dialect-policy.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ summary: summary.byEngine, sourceChanged: report.validity.sourceChanged, backgroundErrors }));
if (summary.overall !== "pass" || report.validity.sourceChanged || backgroundErrors.length) process.exitCode = 1;
