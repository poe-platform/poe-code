import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { resolveInventory, verifyTool } from './npm-tool.mjs';
import { census, digest } from '../executor-v1/boundary.mjs';

const encoded = fs.readFileSync(new URL('NPM-TOOL-INVENTORY.json.gz.base64', import.meta.url));
assert.equal(digest(encoded), '5623653d01886efdbb55e5a4c6b387ba8af00e4b4673740caf23a482ce473af4');
const bytes = gunzipSync(Buffer.from(encoded.toString().trim(), 'base64'));
assert.equal(digest(bytes), '1a09d4358a33e162bcc6fc260258d70089a0acdc463d0b0dac56f3f232dcf4ce');
const original = JSON.parse(bytes), rows = [];
function check(name, run) {
  try { run(); rows.push({ name, accepted: true }); }
  catch (error) { rows.push({ name, accepted: false, error: String(error.stack) }); }
}
function reject(name, mutate) {
  check(name, () => { const copy = structuredClone(original); mutate(copy); assert.throws(() => verifyTool(copy)); });
}
check('unchanged exact physical tool closure', () => verifyTool(original));
check('source regular-only guard still rejects npm links', () => assert.throws(() => census(original.root), /no linked member/u));
check('cross-realm own-data inventory accepted', () => verifyTool(vm.runInNewContext(`JSON.parse(${JSON.stringify(bytes.toString())})`)));
check('all twelve targets reproduce original independent metadata', () => {
  const previous = JSON.parse(fs.readFileSync(new URL('NPM-TOOL-LINKS.json', import.meta.url)));
  assert.equal(original.links.length, 12);
  for (const link of original.links) {
    const old = previous.links.find(entry => entry.path === link.path);
    assert.equal(link.text, old.target); assert.equal(link.mode, old.mode);
    for (const key of ['targetMode', 'targetBytes', 'targetSha256']) assert.equal(link[key], old[key]);
  }
});
const firstLink = copy => copy.entries.find(entry => entry.kind === 'link');
reject('absolute external target', copy => { firstLink(copy).target = '/tmp/unbound'; });
reject('relative external target', copy => { firstLink(copy).target = '../../../unbound'; });
reject('outside-then-back lexical escape', copy => { firstLink(copy).target = '../../../npm/bin/npm-cli.js'; });
reject('self cycle', copy => { firstLink(copy).target = 'arborist'; });
reject('two link cycle', copy => { firstLink(copy).target = 'cssesc'; copy.entries.find(entry => entry.path === 'node_modules/.bin/cssesc').target = 'arborist'; });
reject('new unapproved alias', copy => { copy.entries.push({ path: 'zz-alias', kind: 'link', mode: 493, target: 'bin/npm-cli.js' }); });
reject('changed link spelling even same target', copy => { firstLink(copy).target = '../@npmcli/arborist/bin/./index.js'; });
reject('changed link mode', copy => { firstLink(copy).mode = 0o777; });
reject('changed target payload', copy => { copy.entries.find(entry => entry.path === original.links[0].resolved).sha256 = '0'.repeat(64); });
reject('changed target mode', copy => { copy.entries.find(entry => entry.path === original.links[0].resolved).mode = 0o644; });
reject('missing expected regular file', copy => { copy.entries.push({ path: 'zz-new', kind: 'file', mode: 420, bytes: 0, sha256: digest('') }); });
reject('unbound extra actual entry', copy => { copy.entries = copy.entries.filter(entry => entry.path !== 'README.md'); });
reject('directory mode drift', copy => { copy.entries.find(entry => entry.kind === 'directory').mode ^= 0o100; });
reject('root mode drift', copy => { copy.rootMode ^= 0o100; });
reject('duplicate sorted path', copy => { copy.entries.push(copy.entries[0]); });
reject('hole in roles', copy => { delete copy.entries[0]; });
reject('extra own role key', copy => { copy.entries[0].extra = true; });
reject('extra array key', copy => { copy.entries.extra = true; });
check('accessors rejected without invocation', () => {
  const copy = structuredClone(original); let invoked = 0;
  Object.defineProperty(copy.entries[0], 'kind', { get() { invoked++; return 'directory'; } });
  assert.throws(() => verifyTool(copy)); assert.equal(invoked, 0);
});
check('in-memory link-only mechanism countercontrol', () => {
  const entries = [ { path: 'alias', kind: 'link', mode: 493, target: 'file' }, { path: 'file', kind: 'file', mode: 420, bytes: 1, sha256: digest('x') } ];
  assert.equal(resolveInventory(entries)[0].resolved, 'file');
  entries[0].target = 'alias'; assert.throws(() => resolveInventory(entries), /acyclic/u);
});
verifyTool(original);
console.log(JSON.stringify({ role: 'npm tool DATA/SYNTHETIC and readonly physical inventory controls; no child or product execution', total: rows.length, passed: rows.filter(row => row.accepted).length, failed: rows.filter(row => !row.accepted).length, rows }, null, 2));
if (rows.some(row => !row.accepted)) process.exitCode = 1;
