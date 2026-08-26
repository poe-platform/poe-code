import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oracleIdentity } from "../gnu-target/oracle.js";
import { fixtures, replacement } from "./fixtures.js";
import { captureNative, captureProduct, nativeCommand } from "./lab.js";

const startedAt = new Date().toISOString();
const oracles = { diff: oracleIdentity("diff"), patch: oracleIdentity("patch") };
const diffRoot = await mkdtemp(join(tmpdir(), "safe-bash-diff-revised-generation-"));
const generated = [];
try {
  await mkdir(join(diffRoot, "work"));
  for (const [label, before, after] of [["first", "keep", "changed"], ["first", "old", "new"], ['"alias/target"', "old", "new"]]) {
    assert(label !== undefined && before !== undefined && after !== undefined);
    await writeFile(join(diffRoot, "work/old"), `${before}\n`);
    await writeFile(join(diffRoot, "work/new"), `${after}\n`);
    const result = nativeCommand(diffRoot, "diff", ["-u", "--label", label, "--label", label, "old", "new"]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, replacement(label, before, after));
    generated.push({ label, before, after, ...result });
  }
} finally { await rm(diffRoot, { recursive: true, force: true }); }
const observations = [];
for (const fixture of fixtures) observations.push({ fixture, native: await captureNative(fixture),
  ordinary: await captureProduct(fixture, false), atomic: await captureProduct(fixture, true) });
const sources = ["fixtures.ts", "lab.ts", "capture.ts"];
const hashes = Object.fromEntries(await Promise.all(sources.map(async path => [path,
  createHash("sha256").update(await readFile(new URL(path, import.meta.url))).digest("hex")])));
const evidence = { startedAt, finishedAt: new Date().toISOString(), oracles, generated, hashes, observations };
if (process.argv.includes("--emit-patch")) {
  const lines = JSON.stringify(evidence, null, 2).split("\n").map(line => `+${line}`).join("\n");
  console.log(`*** Begin Patch\n*** Add File: tests/commands/diff-patch-stress/gnu-revised-acceptance/evidence.json\n${lines}\n*** End Patch`);
} else console.log(JSON.stringify(evidence, null, 2));
