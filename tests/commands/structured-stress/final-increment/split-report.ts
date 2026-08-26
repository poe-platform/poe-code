import { readFileSync } from "node:fs";
import { executeBytes } from "../independent-increment/harness.js";

interface Fixture { id: string; argv: string[]; input: string; status: number; stdout: string; stderr: string }
const evidence = JSON.parse(readFileSync(new URL("../split-increment/native.json", import.meta.url), "utf8")) as { cases: Fixture[] };
const rows = [];
for (const fixture of evidence.cases) {
  const actual = await executeBytes(fixture.argv, Buffer.from(fixture.input));
  const expected = { status: fixture.status, stdoutHex: Buffer.from(fixture.stdout).toString("hex"), stderrHex: Buffer.from(fixture.stderr).toString("hex") };
  const differences = (Object.keys(expected) as (keyof typeof expected)[]).filter(key => actual[key] !== expected[key]);
  const classification = differences.length === 0 ? "exact" : differences.every(key => key === "stderrHex") ? "diagnostic-only" : "stdout-or-status";
  rows.push({ id: fixture.id, classification, differences, expected, actual });
}
console.log(JSON.stringify({ cases: rows.length, exact: rows.filter(row => row.classification === "exact").length,
  stdoutStatus: rows.filter(row => row.classification !== "stdout-or-status").length,
  diagnosticsOnly: rows.filter(row => row.classification === "diagnostic-only").length,
  stdoutOrStatus: rows.filter(row => row.classification === "stdout-or-status").length, rows }));
