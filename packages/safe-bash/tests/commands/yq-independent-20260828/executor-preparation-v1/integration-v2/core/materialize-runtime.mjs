import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { coreRoot, readJson, repository, verifyIntegration, verifyRuntimeSource } from './components.mjs';

const [sealPath, sealHash, destination, ...extra] = process.argv.slice(2);
assert(destination && extra.length === 0, 'Explicit fresh harness destination required');
verifyIntegration(sealPath, sealHash);
const pins = readJson(join(coreRoot, 'COMPONENTS.json'));
verifyRuntimeSource(pins);
const materializer = await import(pathToFileURL(join(repository, pins.runtime.materializer.path)).href);
const result = materializer.materializeRecipe(destination);
assert.equal(result.sealSha256, pins.runtime.seal.sha256);
assert.equal(result.seal.treeSha256, pins.runtime.treeSha256);
materializer.verifyRecipe(result.recipeRoot);
verifyRuntimeSource(pins);
verifyIntegration(sealPath, sealHash);
console.log(JSON.stringify({ schemaVersion: 1, jobId: 'materialize-runtime', outcome: 'CAPTURED', ...result, productImports: 0, proofRole: 'HARNESS_RECIPE_MATERIALIZATION_ONLY' }));
