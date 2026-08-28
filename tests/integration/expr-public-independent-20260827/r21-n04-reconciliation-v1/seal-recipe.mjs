import assert from "node:assert/strict";
import { join } from "node:path";
import { directory, inventory, putJson, json, digest, read } from "./common.mjs";
const entries = inventory(directory); assert.ok(entries.every(row => row.kind === "file" && !row.path.includes("/")));
putJson(join(directory, "RECIPE-SEAL.json"), { schema: "expr-r21-n04-recipe/1", authorizationDate: "2026-08-28", counts: json(join(directory, "PINS.json")).counts, entries: entries.map(({ kind, ...row }) => row) });
console.log(JSON.stringify({ checkpoint: "recipe-sealed-no-product-execution", recipeManifestSha256: digest(read(join(directory, "RECIPE-SEAL.json"))), files: entries.length }));
