import assert from 'node:assert/strict';
import test from 'node:test';
import * as source from './runtime-scripts.js';
import {loadPythonRuntimePrograms} from './runtime-programs.js';

test('packed runtime bootstrap preserves every Python program exactly', async()=>{
 const [first,second]=await Promise.all([loadPythonRuntimePrograms(),loadPythonRuntimePrograms()]);
 assert.deepEqual(first,{...source});
 assert.equal(first,second);
});
