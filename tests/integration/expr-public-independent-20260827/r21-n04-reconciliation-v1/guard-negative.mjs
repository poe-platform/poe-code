import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const binding = JSON.parse(readFileSync(new URL("./binding.json", import.meta.url)));
await assert.rejects(import(binding.forbiddenSource), /EXPR_FORBIDDEN_SOURCE/u);
console.log(JSON.stringify({ id: "source-fallback-guard", status: "pass", forbiddenSource: binding.forbiddenSource }));
