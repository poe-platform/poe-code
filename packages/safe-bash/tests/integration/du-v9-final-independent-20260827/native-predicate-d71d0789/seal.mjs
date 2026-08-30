import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { owned, hash, inventory, save } from "./review.mjs";

assert.deepEqual(JSON.parse(await readFile(join(owned, "PRE.json"))), JSON.parse(await readFile(join(owned, "POST.json"))));
const files = await inventory(owned);
assert(!files.some(entry => /\.(?:ts|mts)$/u.test(entry.path)));
await save("EVIDENCE-MANIFEST.json", { at: new Date().toISOString(), selfExcluded: "EVIDENCE-MANIFEST.json", files });
assert.deepEqual((await inventory(owned)).filter(entry => entry.path !== "EVIDENCE-MANIFEST.json"), files);
process.stdout.write(`Sealed ${files.length} non-self files; evidence manifest SHA256 ${hash(await readFile(join(owned, "EVIDENCE-MANIFEST.json")))}.\n`);
