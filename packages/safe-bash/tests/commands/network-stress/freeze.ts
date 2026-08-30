import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertNative, owned, profile, runNative, type Observation } from "./native.js";
import { contractRows, rows } from "./rows.js";

assert.deepEqual(process.argv.slice(2), ["--freeze-new"], "Use --freeze-new only before product comparison; existing evidence is never overwritten");
const destination = join(owned, "oracle.json");
await assert.rejects(access(destination), { code: "ENOENT" });
const nativeProfile = await profile();
const observations: Observation[] = [];
for (const row of rows) {
  const observation = await runNative(row);
  process.stderr.write(`${row.id}: native=${observation.code ?? observation.signal}, requests=${observation.traces.length}\n`);
  assertNative(row, observation);
  observations.push(observation);
}
const sourceHashes: Record<string, string> = {};
for (const path of ["rows.ts", "lab.ts", "native.ts"]) {
  sourceHashes[path] = createHash("sha256").update(await readFile(join(owned, path))).digest("hex");
}
const evidence = {
  schema: 1,
  capturedAt: new Date().toISOString(),
  handoffObserved: false,
  productRuns: 0,
  docs: {
    retrieved: "2026-08-26",
    observedManpageVersion: "8.22.0 (rolling documentation, not the executable oracle)",
    urls: ["https://curl.se/docs/manpage.html", "https://curl.se/docs/manpage.html#data", "https://curl.se/docs/manpage.html#data-binary", "https://curl.se/docs/manpage.html#location", "https://curl.se/docs/manpage.html#retry", "https://curl.se/docs/manpage.html#max-time", "https://curl.se/libcurl/c/libcurl-errors.html"],
  },
  nativeProfile,
  sourceHashes,
  counts: {
    nativeRows: rows.length,
    nativeCurlTransfers: observations.length,
    nativeCurlVersionCalls: 1,
    nativeHeadCalls: rows.filter((row) => row.mode === "head").length,
    httpRequests: observations.reduce((count, row) => count + row.traces.length, 0),
    virtualOnlyRows: contractRows.length,
    totalVirtualPending: rows.length + contractRows.length,
  },
  contractRows,
  observations,
};
const json = `${JSON.stringify(evidence, null, 2)}\n`;
const patch = `*** Begin Patch\n*** Add File: ${destination}\n${json.trimEnd().split("\n").map((line) => `+${line}`).join("\n")}\n*** End Patch\n`;
const applied = spawnSync("apply_patch", [], { cwd: owned, input: patch, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 10000, shell: false });
assert.equal(applied.status, 0, applied.stderr || applied.stdout);
process.stdout.write(`${JSON.stringify(evidence.counts)}\nsha256=${createHash("sha256").update(json).digest("hex")}\n`);
