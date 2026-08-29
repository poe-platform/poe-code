import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashRegularFile } from './hash-regular-file.mjs';
import { verifyComposition } from './derived-tree.mjs';
import { verifyToolClosure } from './tool-closure.mjs';
const own=path.dirname(fileURLToPath(import.meta.url));const seal=JSON.parse(fs.readFileSync(path.join(own,'PRESEAL.json')));
assert.deepEqual(process.argv.slice(2),['--source-data-only']);assert.equal(process.execPath,seal.node.path);assert.equal(process.version,seal.node.version);assert.equal(hashRegularFile(process.execPath).sha256,seal.node.sha256);assert.equal(hashRegularFile(seal.developmentGit.path).sha256,seal.developmentGit.sha256);
console.log(JSON.stringify({role:'SOURCE_DATA_ONLY',composition:verifyComposition(JSON.parse(fs.readFileSync(path.join(own,'SOURCE.json')))),node:seal.node}));
await verifyToolClosure(JSON.parse(fs.readFileSync(path.join(own,'TOOL-CENSUS.json'))));
for(const copy of seal.fixtureCopies)assert.equal(hashRegularFile(path.join(own,copy.from)).sha256,copy.sha256);
console.log(JSON.stringify({toolClosures:4,fixtures:seal.fixtureCopies.length,productRuns:0,compilerRuns:0,workers:0}));

