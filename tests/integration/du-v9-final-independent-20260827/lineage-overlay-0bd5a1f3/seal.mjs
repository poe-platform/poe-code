import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { owned, hash, inventory, save } from "./common.mjs";

assert.deepEqual(JSON.parse(await readFile(join(owned, "PRE.json"))), JSON.parse(await readFile(join(owned, "POST.json"))));
const files = await inventory(owned);
assert(!files.some(entry => /\.(?:ts|mts)$/u.test(entry.path) || /(^|\/)AGENTS\.md$/u.test(entry.path)));
await save("EVIDENCE-MANIFEST.json", { at: new Date().toISOString(), selfExcluded: "EVIDENCE-MANIFEST.json", files });
const actual = await inventory(owned);
assert.deepEqual(actual.filter(entry => entry.path !== "EVIDENCE-MANIFEST.json"), files);
process.stdout.write(`Sealed and verified ${files.length} non-self files; manifest SHA256 ${hash(await readFile(join(owned, "EVIDENCE-MANIFEST.json")))}.\n`);
