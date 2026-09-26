import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFdArguments } from './arguments.js';
import { formatFdPath } from './command.js';
test('fd parses combined flags, attached values, equals and operands after --', () => {
  const a=parseFdArguments(['-uuL0','-eTS','--extension=js','-tf','-d3','--and','test','--','-pattern','dir']);
  assert.equal(a.hidden,true); assert.equal(a.ignore,false); assert.equal(a.follow,true); assert.equal(a.print0,true);
  assert.deepEqual(a.extensions,['TS','js']); assert.deepEqual(a.types,['file']); assert.deepEqual(a.patterns,['-pattern','test']); assert.deepEqual(a.roots,['dir']); assert.equal(a.maxDepth,3);
});
test('fd rejects malformed flags, counts, types and empty execution before effects',()=>{
  for (const argv of [['--wat'],['-dno'],['--min-depth=-1'],['-tno'],['-x'],['--hidden=yes']]) assert.throws(()=>parseFdArguments(argv));
});
test('fd batch mode rejects multiple replacement tokens',()=>{
  assert.throws(()=>parseFdArguments(['-X','echo','{}','{/}']));
  assert.throws(()=>parseFdArguments(['-X','echo','{}{}']));
});
test('fd placeholders support paths and literal brace escapes',()=>{
  assert.equal(formatFdPath('{}|{/}|{//}|{.}|{/.}','src/file.tar.gz'),'src/file.tar.gz|file.tar.gz|src|src/file.tar|file.tar');
  assert.equal(formatFdPath('{{}} {{/}} {}','file.txt'),'{} {/} file.txt');
});
test('zero depth and disjoint depth ranges are valid empty searches',()=>{
  assert.equal(parseFdArguments(['-d0']).maxDepth,0);
  assert.equal(parseFdArguments(['--min-depth=2','-d1']).maxDepth,1);
});

test("fd parses --path-separator, -C/--base-directory, and --strip-cwd-prefix", () => {
  const a = parseFdArguments(["-C", "sub/dir", "--path-separator", "::", "--strip-cwd-prefix", "README"]);
  assert.equal(a.baseDirectory, "sub/dir");
  assert.equal(a.pathSeparator, "::");
  assert.equal(a.stripCwdPrefix, true);
  assert.deepEqual(a.patterns, ["README"]);
});
