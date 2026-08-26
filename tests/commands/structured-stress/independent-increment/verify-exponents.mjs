import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { captureCase, executable, invokeNative, sha256 } from './native.mjs';

const overflow = process.argv[2] === '--overflow';
const bytes = await readFile(new URL(overflow ? './overflow-comparison-vectors.json' : './exponent-vectors.json', import.meta.url));
assert.equal(sha256(bytes), overflow ? '86808210a4d14d5c5e5ad86db2a0803875e6143047a3f8dbf256378635891789' : 'e90ececb9f163080873975c46063245df6200b7316edd682a401e33c07f9039d');
const document = JSON.parse(bytes.toString());
assert.equal(sha256(await readFile(executable)), document.provenance.executableSha256);
assert.deepEqual(await invokeNative(['--version']), document.provenance.version);
assert.deepEqual(await invokeNative(['--build-configuration']), document.provenance.build);
for (const vector of document.cases) assert.deepEqual(await captureCase(vector), vector, vector.id);
console.log(`Verified ${document.cases.length} frozen exponent/conversion cases + 2 metadata invocations.`);
