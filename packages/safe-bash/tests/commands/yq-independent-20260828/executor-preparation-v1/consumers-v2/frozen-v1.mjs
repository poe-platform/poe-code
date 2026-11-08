import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
export const fixtureRoot = join(root, '../consumers');
const verifierHash = 'a4f2bb661d91505a22fa414b83cbba26dd6d4f63fcd5bc08d648e0368b97bba1';
const recipeHash = '24e28a529cec877b82835d81ba3f274702a28d43ab5285754b7bd1ef0b82f98d';
const bytes = readFileSync(join(fixtureRoot, 'verify-recipe.mjs'));
if (createHash('sha256').update(bytes).digest('hex') !== verifierHash) throw new Error('FROZEN_V1_VERIFIER');
const verifier = await import(pathToFileURL(join(fixtureRoot, 'verify-recipe.mjs')).href);

export function verifyFrozenV1() {
  return verifier.verifyRecipe(recipeHash);
}

verifyFrozenV1();
