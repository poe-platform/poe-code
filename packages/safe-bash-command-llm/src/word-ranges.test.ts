import assert from 'node:assert/strict';
import test from 'node:test';
import fixture from './fixtures/word-ranges-python3.9.6.json' with {type:'json'};
import {wordRanges} from './word-ranges.js';

test('word classification preserves the complete pinned Python Unicode capture',()=>{
 assert.equal(fixture.python,'3.9.6');
 assert.equal(fixture.unicode,'13.0.0');
 assert.deepEqual(wordRanges,fixture.ranges);
});
