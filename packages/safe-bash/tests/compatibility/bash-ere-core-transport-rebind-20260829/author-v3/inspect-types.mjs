import * as fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root = '/Users/kjopek/Workspace/safe-bash';
const parent = root + '/tests/compatibility/bash-ere-core-transport-rebind-20260829';
function read(filename) { const stat = fs.lstatSync(filename); assert(stat.isFile() && stat.size <= 16777216); return fs.readFileSync(filename); }
const manifest = JSON.parse(read(parent + '/COMPOSITION.json'));
console.log(JSON.stringify({ toolKeys: Object.keys(manifest.tools), sourceManifest: manifest.baseSourceManifest, compiledManifest: manifest.compiledManifest }));
for (const [key, value] of Object.entries(manifest.tools)) if (Array.isArray(value)) console.log(JSON.stringify({ key, count: value.length, first: value[0], last: value.at(-1) }));
for (const filename of [root + '/node_modules/@types/node/package.json', root + '/node_modules/undici-types/package.json']) console.log(JSON.stringify({ filename, sha256: crypto.createHash('sha256').update(read(filename)).digest('hex'), json: JSON.parse(read(filename)) }));
const old = root + '/tests/compatibility/bash-ere-runtime-integration-author-20260829/rebind-v1';
const seal = JSON.parse(read(old + '/SEAL.json'));
console.log(JSON.stringify({ sealKeys: Object.keys(seal), oldToolPaths: seal.tools, fixture: seal.fixture, own: seal.own, node: seal.node }));
