import assert from 'node:assert/strict';
import test from 'node:test';
import fixture from './fixtures/printable-ranges-python3.9.6.json' with {type:'json'};
import {isPythonPrintable} from './python-printable.js';

test('printability preserves every code point from pinned Python Unicode 13',()=>{
 assert.equal(fixture.python,'3.9.6');assert.equal(fixture.unicode,'13.0.0');
 let range=0;
 for(let point=0;point<0x110000;point++){
  while(range<fixture.excluded.length&&point>fixture.excluded[range]![1]!)range++;
  const expected=range===fixture.excluded.length||point<fixture.excluded[range]![0]!;
  assert.equal(isPythonPrintable(point),expected,'U+'+point.toString(16));
 }
});
