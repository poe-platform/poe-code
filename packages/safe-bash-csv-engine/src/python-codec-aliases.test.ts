import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {pythonCodecAliases} from './python-codec-aliases.js';

test('the complete pinned codec registry preserves all 447 mappings',()=>{
 const entries=Object.entries(pythonCodecAliases).sort(([a],[b])=>a<b?-1:a>b?1:0);
 assert.equal(entries.length,447);
 assert.equal(createHash('sha256').update(JSON.stringify(entries)).digest('hex'),'d03523a811afd50bc4692209af0c5f00f4fefa2484e6648e8c0246de179cf18c');
 assert.ok(Object.isFrozen(pythonCodecAliases));
});
