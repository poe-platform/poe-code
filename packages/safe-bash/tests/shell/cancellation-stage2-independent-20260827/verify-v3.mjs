import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const overlay = JSON.parse(readFileSync(path.join(own, "R08-v3.overlay.json"), "utf8"));
const base = readFileSync(path.join(own, overlay.baseFixture));
assert.equal(hash(base), overlay.baseFixtureSha256);
const original = base.toString("utf8");
assert.deepEqual(Buffer.from(original, "utf8"), base);
assert.equal(overlay.case, "R08");
assert.equal(overlay.replacement.occurrences, 1);
assert.equal(original.split(overlay.replacement.before).length, 2);
const effective = original.replace(overlay.replacement.before, overlay.replacement.after);
assert.equal(hash(effective), overlay.effectiveFixtureSha256);
const beforeLines = original.split("\n");
const afterLines = effective.split("\n");
assert.equal(afterLines.length, beforeLines.length);
const changes = beforeLines.flatMap((line, index) => line === afterLines[index] ? [] : [index + 1]);
assert.deepEqual(changes, [263]);
assert.equal(effective.slice(effective.indexOf('row("R09",')), original.slice(original.indexOf('row("R09",')));
assert.ok(effective.includes('for (const inner of [Object.freeze({ local: true }), null, false, 0, -0, "", NaN])'));
assert.ok(effective.includes('    thrown(result.innerOutcome, inner);'));
assert.equal(hash(readFileSync(path.join(own, "baseline.data.json.gz"))), "cfdc64a565c516836c4b7dfc7b25c802fb6a91b3321b3343bf4c24723fbf6b36");
assert.equal(hash(readFileSync(path.join(own, "baseline-v2.data.json.gz"))), "b0c351e37ae57b55784dc8a69ac11172e444d220267aa9b73669874158b6ed0a");
console.log(JSON.stringify({ version: 3, baseSha256: hash(base), effectiveSha256: hash(effective),
  changedLines: changes, unchangedStoredV2: true, R09AndLaterUnchanged: true,
  originalBaselineHashesPreserved: true, candidateExecutions: 0, baselineReplays: 0 }, null, 2));
