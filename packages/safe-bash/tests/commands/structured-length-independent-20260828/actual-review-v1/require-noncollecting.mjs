import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [file, expectedHash, manifestHash] = process.argv.slice(2);
const bytes = await readFile(file);
assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
const receipt = JSON.parse(bytes);
assert.equal(receipt.mode, 'allocation');
assert.equal(receipt.manifestSha256, manifestHash);
assert.equal(receipt.receipts.some(row => row.url.endsWith('/commands/structured/interpreter.js')), true);
assert.equal(receipt.observations[0].productCollected, false, 'actual bound interpreter must not collect the sentinel');
process.stdout.write('authenticated loaded interpreter is noncollecting\n');
