import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { captureCase, sha256 } from "../independent-increment/native.mjs";

const directory = "tests/commands/structured-stress/jq-42-author-20260827";
const regressions = [];
for (const value of ["true", "false", "null"]) {
  for (const prefix of ["", "2\n"]) {
    regressions.push({ id: `failed-prefix-${value}-${prefix ? "prior" : "none"}`, argv: ["-ce", `if . == 0 then (${value},1/0) elif . == 1 then empty else . end`], inputHex: Buffer.from(`${prefix}0\n1`).toString("hex") });
  }
}
for (const [id, input] of [["nul-string-next-line", '"a\0b"\n"next"\n'], ["nul-between-values", 'null\0ignored\ntrue\n'], ["nul-before-newline", '\0ignored\ntrue\n']]) regressions.push({ id, argv: ["-c", "."], inputHex: Buffer.from(input).toString("hex") });
for (const [id, input] of [["two-errors-one-line", '[{}] [{}]\n'], ["two-errors-no-newline", '[{}] [{}]'], ["errors-across-blank-lines", '[{}]\n\n\n[{}]\n']]) regressions.push({ id, argv: ["-c", 'join("/")'], inputHex: Buffer.from(input).toString("hex") });
const cases = [];
for (const vector of regressions) cases.push(await captureCase(vector));
const sourceHashes = Object.fromEntries(readdirSync("src/commands/structured").sort().map(name => [name, sha256(readFileSync(`src/commands/structured/${name}`))]));
const evidence = { capturedAt: new Date().toISOString(), phase: "after initial 42 fix, before followup root-cause fix", sourceHashes, cases };
const target = `${directory}/native-followup.json`;
assert.equal(existsSync(target), false);
const content = JSON.stringify(evidence, null, 2);
assert.equal(spawnSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${target}\n${content.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`, encoding: "utf8" }).status, 0);
console.log({ cases: cases.length, hash: sha256(Buffer.from(content + "\n")) });
