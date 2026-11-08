import assert from "node:assert/strict";
import { existsSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { directory, read, digest, putJson } from "./common.mjs";
import { authenticate } from "./auth.mjs";

assert.equal(existsSync(join(directory, "work")), false);
const proof = await authenticate({ raw: true });
putJson(join(directory, "BINDINGS.json"), proof.bindings);
const counts = { boundaryOutcomes: 16, correctedR21Groups: 4, validDispatchControls: 8, sourceFallbackControls: 4, validatorControls: 52, controls: 64, children: 28, forced: 0, workers: 0 };
putJson(join(directory, "PINS.json"), { authorizationDate: "2026-08-28", counts, runtimes: proof.bindings.runtimes, tools: proof.bindings.tools, bindingsSha256: digest(read(join(directory, "BINDINGS.json"))) });
const entries = readdirSync(directory).sort().map(path => ({ path, bytes: read(join(directory, path)).length, sha256: digest(read(join(directory, path))), mode: lstatSync(join(directory, path)).mode & 0o777 }));
putJson(join(directory, "RECIPE-SEAL.json"), { schema: "expr-r21-composed-recipe/1", counts, entries });
console.log(JSON.stringify({ phase: "PRESEALED_NO_PRODUCT_EXECUTION", counts, manifest: digest(read(join(directory, "RECIPE-SEAL.json"))), authenticatedArchives: proof.bindings.archives }));
