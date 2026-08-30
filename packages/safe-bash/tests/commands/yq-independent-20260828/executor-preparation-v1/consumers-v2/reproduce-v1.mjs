import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const frozen = join(root, '../consumers');
const hash = data => createHash('sha256').update(data).digest('hex');
const authority = JSON.parse(readFileSync(join(root, 'SOURCE-AUTHORITY.json')));
const pins = authority.frozenV1;
if (hash(readFileSync(join(frozen, 'verify-recipe.mjs'))) !== pins.verifierSha256) throw new Error('FROZEN_VERIFIER_HASH');
const verifier = await import(pathToFileURL(join(frozen, 'verify-recipe.mjs')).href);
verifier.verifyRecipe(pins.recipeSha256);
if (hash(readFileSync(join(frozen, 'guards.mjs'))) !== pins.guardSha256) throw new Error('FROZEN_GUARD_HASH');
const original = await import(pathToFileURL(join(frozen, 'guards.mjs')).href);
const receiptPath = join(root, 'SOURCE-RECEIPT.json');
const receiptHash = hash(readFileSync(receiptPath));
console.log(JSON.stringify({ role: 'ORIGINAL_V1_SOURCE_ADMISSION_REPRODUCTION', guardCommit: pins.commit, guardSha256: pins.guardSha256, sourceLines: [189, 200, 208], candidateCommit: authority.candidateCommit, receiptHash, productExecution: 0 }));
try {
  const result = original.authorizeSources(receiptPath, receiptHash);
  console.log(JSON.stringify({ unexpectedAdmission: result.sourceMapSha256 }));
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  verifier.verifyRecipe(pins.recipeSha256);
}
