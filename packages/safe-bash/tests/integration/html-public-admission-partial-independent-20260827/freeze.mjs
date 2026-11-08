import assert from 'node:assert/strict';
import { join } from 'node:path';
import { authenticate, identity, own, write } from './common.mjs';
import { adapted, drivers } from './adapt.mjs';

assert.equal(process.argv.length, 2);
const started = new Date().toISOString();
const authentication = await authenticate();
write(join(own, 'PREPARE-AUTH.json'), authentication);
write(join(own, 'ADAPTERS.json'), drivers.map(name => { const { code: unused, ...mapping } = adapted(name); return mapping; }));
const names = ['common.mjs', 'adapt.mjs', 'trace.cjs', 'freeze.mjs', 'execute.mjs', 'verify.mjs', 'RECIPE.md', 'STATIC-REVIEW.md', 'PREPARE-AUTH.json', 'ADAPTERS.json'];
const files = Object.fromEntries(names.map(name => [name, identity(join(own, name))]));
write(join(own, 'RECIPE-MANIFEST.json'), { schema: 'html-partial-recipe/1', started, finished: new Date().toISOString(), files, controls: drivers[0], executionOrder: ['four-extras', 'one-full-build-pack-with-reconstruction', 'parent-author-only-reconstruction'], oldResource35: 0, actualHtml34: 0, resourceV32: 0, du29: 0, partialOnly: true });
console.log(JSON.stringify({ scope: 'static-only freeze; no controls/archive/build/reconstruction executed', manifest: identity(join(own, 'RECIPE-MANIFEST.json')).sha256, protectedAuthorFiles: Object.keys(authentication.sealed).length, protectedHoldFiles: Object.keys(authentication.hold).length, links: authentication.links.length, inputs: authentication.selectedInputs, delta: authentication.delta.length }));
