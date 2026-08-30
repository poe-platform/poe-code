import assert from "node:assert/strict";
import { cases } from "./cases.js";

const name = process.argv[2];
assert.ok(name && Object.hasOwn(cases, name), "Expected a named entrypoint holdout");
await cases[name]!();
console.log(JSON.stringify({ passed: name }));
