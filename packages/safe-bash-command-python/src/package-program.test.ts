import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadPythonPackageProgram} from './package-program.js';
test('the cached package program preserves its maintained Python source exactly',async()=>{
 const first=loadPythonPackageProgram();assert.equal(loadPythonPackageProgram(),first);
 assert.equal(await first,await readFile(new URL('./package-program.py',import.meta.url),'utf8'));
});
