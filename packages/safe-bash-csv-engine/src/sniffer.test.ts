import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {sniff} from './sniffer.js';

test('unrestricted sniffing matches the pinned Python 3.9 reference',()=>{
 const cases=JSON.parse(readFileSync(new URL('./sniffer-python39.json',import.meta.url),'utf8')) as {sample:string;result:unknown}[];
 for(const row of cases)assert.deepEqual(sniff(row.sample,()=>{},'python39')??null,row.result,JSON.stringify(row.sample));
});
