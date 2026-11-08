import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { own, metadata, authenticate } from './auth.mjs';

export function authenticateCorrection(includeNode = false) {
  const original = authenticate(includeNode);
  const seal = JSON.parse(fs.readFileSync(path.join(own, 'CORRECTION-PRESEAL.json')));
  for (const row of seal.files) assert.deepEqual(metadata(path.join(own, row.path)), row.metadata, row.path);
  return { original, correctionFiles: seal.files.length, passed: true };
}
