import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as source from './runtime-scripts.js';
import {loadPythonRuntimePrograms} from './runtime-programs.js';

test('packed runtime bootstrap preserves every Python program exactly', async()=>{
 const [first,second]=await Promise.all([loadPythonRuntimePrograms(),loadPythonRuntimePrograms()]);
 assert.deepEqual(first,{...source,pythonMetadataDiscovery:readFileSync(new URL('./metadata-discovery.py',import.meta.url),'utf8')});
 assert.equal(first,second);
});
