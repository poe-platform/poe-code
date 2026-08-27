import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureTree, compareTrees, createTreeGuard } from './tree.mjs';

const mutations = {
  'added file': root => writeFileSync(join(root,'injected.ts'),'code'),
  'added empty directory': root => mkdirSync(join(root,'empty-new')),
  'added nested file': root => writeFileSync(join(root,'nested/injected'),'bytes'),
  'added symlink': root => symlinkSync('/does-not-exist',join(root,'injected-link')),
  'removed file': root => rmSync(join(root,'file')),
  'removed empty directory': root => rmSync(join(root,'empty'),{recursive:true}),
  'same-size modification': root => writeFileSync(join(root,'file'),'evil'),
  'mode change': root => chmodSync(join(root,'file'),0o700),
  'link target change': root => {rmSync(join(root,'link'));symlinkSync('nested',join(root,'link'));},
  'file replaced by directory': root => {rmSync(join(root,'file'));mkdirSync(join(root,'file'));},
  'directory replaced by link': root => {rmSync(join(root,'nested'),{recursive:true});symlinkSync('/tmp',join(root,'nested'));},
  'root replaced by symlink': root => {rmSync(root,{recursive:true});symlinkSync('/tmp',root);},
};
for (const [name, mutate] of Object.entries(mutations)) for (const role of ['source','installed-package']) test(`${role}: ${name}`, context => {
  const parent=mkdtempSync(join(tmpdir(),'integrity73-control-')),root=join(parent,role);mkdirSync(root);
  context.after(()=>rmSync(parent,{recursive:true,force:true}));
  mkdirSync(join(root,'nested'));mkdirSync(join(root,'empty'));writeFileSync(join(root,'file'),'safe');symlinkSync('file',join(root,'link'));
  const guard=createTreeGuard(root);assert.deepEqual(guard.check().changes,[]);
  const before=guard.before();before.entries.length=0;assert.ok(guard.before().entries.length>0);
  mutate(root);assert.ok(guard.check().changes.length>0,name);
});
test('deterministic inventories freeze legitimate setup outputs without exclusions',context=>{
  const root=mkdtempSync(join(tmpdir(),'integrity73-setup-'));context.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'src'));writeFileSync(join(root,'src/input.ts'),'source');const inputs=createTreeGuard(join(root,'src'));
  mkdirSync(join(root,'dist'));writeFileSync(join(root,'dist/index.js'),'built');mkdirSync(join(root,'__proto__'));writeFileSync(join(root,'é\nname'),'bytes');
  assert.deepEqual(inputs.check().changes,[]);const artifacts=createTreeGuard(root);assert.deepEqual(captureTree(root),captureTree(root));assert.deepEqual(compareTrees(artifacts.before(),captureTree(root)),[]);
  writeFileSync(join(root,'dist/late.js'),'unexpected');assert.equal(artifacts.check().changes[0].kind,'added');
});
test('source additions during authorized build remain rejected',context=>{
  const root=mkdtempSync(join(tmpdir(),'integrity73-build-'));context.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'src'));writeFileSync(join(root,'src/main.ts'),'source');const guard=createTreeGuard(join(root,'src'));
  mkdirSync(join(root,'dist'));writeFileSync(join(root,'dist/index.js'),'expected build');writeFileSync(join(root,'src/new.ts'),'not authorized');assert.equal(guard.check().changes[0].kind,'added');
});
test('restored bytes are outside before-after observation guarantees',context=>{
  const root=mkdtempSync(join(tmpdir(),'integrity73-limits-'));context.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'file'),'safe');const guard=createTreeGuard(root);writeFileSync(join(root,'file'),'evil');writeFileSync(join(root,'file'),'safe');assert.deepEqual(guard.check().changes,[]);assert.equal(readFileSync(join(root,'file'),'utf8'),'safe');
});
