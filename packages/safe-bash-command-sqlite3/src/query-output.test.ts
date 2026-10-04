import assert from 'node:assert/strict';
import test from 'node:test';
import {formatQueryParts, type QueryOutputOptions} from './query-output.js';
import {JsonText} from './engine.js';

const options: QueryOutputOptions = {mode:'list',insertTable:'items',showHeaders:true,colSeparator:'|',rowSeparator:'\n',nullValue:'N',widths:[]};
const expected = {
 list:'v\nab\nN\n', tabs:'v\nab\nN\n', ascii:'v\nab\nN\n',
 csv:'v\nab\nN\n', json:'[{"v":"ab"},\n{"v":null}]\n',
 line:'    v = ab\n\n    v = N\n', html:'<TR><TH>v</TH>\n</TR>\n<TR><TD>ab</TD>\n</TR>\n<TR><TD>N</TD>\n</TR>\n',
 quote:"'v'\n'ab'\nNULL\n",insert:"INSERT INTO items VALUES('ab');\nINSERT INTO items VALUES(NULL);\n",
 column:'v \n--\nab\nN \n',markdown:'| v  |\n|----|\n| ab |\n| N  |\n',
 table:'+----+\n| v  |\n+----+\n| ab |\n| N  |\n+----+\n',
 box:'┌────┐\n│ v  │\n├────┤\n│ ab │\n│ N  │\n└────┘\n'
};
for(const [mode, output] of Object.entries(expected)) test(`preserves ${mode} formatting`,()=>{
 assert.equal([...formatQueryParts({columns:['v'],rows:[['ab'],[null]]},{...options,mode:mode as QueryOutputOptions['mode']})].join(''),output);
});

test('sequential formatting produces its header before accessing rows',()=>{
 const rows = new Proxy([['value']], {get(target,key,receiver){if(key===Symbol.iterator)throw new Error('rows consumed early');return Reflect.get(target,key,receiver);}});
 const parts=formatQueryParts({columns:['header'],rows}, options);
 assert.equal(parts.next().value,'header');
 parts.return(undefined);
});

for(const mode of Object.keys(expected))test(`bounds ${mode} fragments for large cells, headers, nulls and padding`,()=>{
 const text='é😀\'"<&\r\n'.repeat(12000);
 const parts=formatQueryParts({columns:[text],rows:[[text],[null],[new TextEncoder().encode(text)]]},{...options,mode:mode as QueryOutputOptions['mode'],nullValue:text,widths:[text.length+5000]});
 let length=0;
 for(const part of parts){assert.ok(part.length<=8192,`unbounded ${mode} fragment: ${part.length}`);length+=part.length;}
 assert.ok(length>text.length);
});

test('CSV scans quoted separators across UTF-8 chunks and preserves BLOB NUL/BOM rules',()=>{
 const text='a'.repeat(4095)+'::é😀"\r\n';
 const bytes=new TextEncoder().encode('\ufeff'+text+'\0ignored');
 assert.equal([...formatQueryParts({columns:['x'],rows:[[bytes]]},{...options,mode:'csv',showHeaders:false,colSeparator:'::',rowSeparator:'END'})].join(''),'"'+text.replaceAll('"','""')+'"END');
});

test('JSON keeps raw JSON subtype, boxed real numbers, bigint and lone surrogates',()=>{
 const result={columns:['j','r'],rows:[[new JsonText('{"a":1}'),new Number(1)]]};
 assert.equal([...formatQueryParts(result,{...options,mode:'json'})].join(''),'[{"j":{"a":1},"r":1.0}]\n');
 const value='a'.repeat(4095)+'😀\ud800';
 const output=[...formatQueryParts({columns:['x','n'],rows:[[value,9007199254740993n]]},{...options,mode:'json'})].join('');
 assert.equal(output,'[{"x":'+JSON.stringify(value)+',"n":9007199254740993}]\n');
});

 test('column widths include null replacement and leave missing columns empty',()=>{
  assert.equal([...formatQueryParts({columns:['x'],rows:[[null],[]]},{...options,mode:'column',nullValue:'long'})].join(''),'x   \n----\nlong\n\n');
 });
 test('CSV empty separators quote empty strings',()=>{
  assert.equal([...formatQueryParts({columns:[''],rows:[['']]},{...options,mode:'csv',colSeparator:''})].join(''),'""\n""\n');
 });
