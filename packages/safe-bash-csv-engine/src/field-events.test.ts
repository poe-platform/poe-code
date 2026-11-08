import assert from 'node:assert/strict';
import test from 'node:test';
import {CsvBudget,CsvParser} from './index.js';

test('streamed CSV fields preserve buffered syntax across every byte boundary',()=>{
 const input=new TextEncoder().encode('id,content\r\n1,"hello\r\n😀 ""quoted"""\r\n2,last\n\n');
 for(let split=1;split<=input.length;split++){
  const signal=new AbortController().signal,budget=new CsvBudget({},signal);
  const expectedParser=new CsvParser({},new CsvBudget({},signal));const expected=[...expectedParser.push(input),...expectedParser.end()].map(row=>row.cells);
  const rows:string[][]=[];let row:string[]=[],field='';let largest=0;
  const parser=new CsvParser({},budget,{text(value){largest=Math.max(largest,value.length);field+=value;},field(){row.push(field);field='';},row(){rows.push(row);row=[];}});
  for(let offset=0;offset<input.length;offset+=split)assert.deepEqual(parser.push(input.subarray(offset,offset+split)),[]);
  assert.deepEqual(parser.end(),[]);assert.deepEqual(rows,expected);assert.ok(largest<=2049);parser.dispose();budget.dispose();
 }
});
test('large CSV fields are emitted in bounded fragments without retaining rows',()=>{
 let units=0,fields=0,rows=0,largest=0;
 const budget=new CsvBudget({},new AbortController().signal);
 const parser=new CsvParser({},budget,{text(value){units+=value.length;largest=Math.max(largest,value.length);},field(){fields++;},row(){rows++;}});
 parser.push(Uint8Array.of(34));const chunk=new Uint8Array(4096).fill(97);
 for(let index=0;index<1024;index++)assert.deepEqual(parser.push(chunk),[]);
 parser.push(Uint8Array.of(34,10));parser.end();
 assert.equal(units,4194304);assert.equal(fields,1);assert.equal(rows,1);assert.ok(largest<=2049);
});
test('streaming CSV enforces field limits after fragments have been emitted',()=>{
 const budget=new CsvBudget({fieldBytes:6000},new AbortController().signal);
 const parser=new CsvParser({},budget,{text(){},field(){},row(){}});
 assert.throws(()=>parser.push(new Uint8Array(4000).fill(97)),/Field byte limit/);
 for(const quoting of [2,4] as const)assert.throws(()=>new CsvParser({quoting},new CsvBudget({},new AbortController().signal),{text(){},field(){},row(){}}),/numeric/);
});
test('CSV events reject reentry and preserve cancellation',()=>{
 for(const input of [new Uint8Array(4096).fill(97),new TextEncoder().encode('a\n')]){
  const controller=new AbortController(),reason=new Error('stop');
  const parser:CsvParser=new CsvParser({},new CsvBudget({},controller.signal),{text(){assert.throws(()=>parser.push(Uint8Array.of(97)),/reenter/);assert.throws(()=>parser.dispose(),/reenter/);controller.abort(reason);},field(){assert.fail('field after cancellation');},row(){assert.fail('row after cancellation');}});
  assert.throws(()=>parser.push(input),error=>error===reason);
 }
});
