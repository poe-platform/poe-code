import assert from 'node:assert/strict';
import test from 'node:test';
import {similarOutput} from './similar-output.js';
const signal=new AbortController().signal;
function field(value:string){const bytes=new TextEncoder().encode(value);return {size:bytes.length,bytes:{async *[Symbol.asyncIterator](){for(let offset=0;offset<bytes.length;offset+=17)yield bytes.subarray(offset,offset+17);}}};}
async function output(content:string,plain:boolean,metadata:string|null=null){let result='';const decoder=new TextDecoder('utf-8',{ignoreBOM:true});for await(const bytes of similarOutput({id:'é',score:1,content:field(content),metadata:metadata===null?null:field(metadata)},plain,signal)){assert.ok(bytes.length<16384);result+=decoder.decode(bytes,{stream:true});}return result+decoder.decode();}
test('similarity JSON streams Unicode content and metadata with Python separators',async()=>{
 assert.equal(await output('hello\n😀',false,'{"x":"é","items":[1,true,null],"quote":"\\""}'),'{"id": "\\u00e9", "score": 1.0, "content": "hello\\n\\ud83d\\ude00", "metadata": {"x": "\\u00e9", "items": [1, true, null], "quote": "\\""}}\n');
});
test('plain indentation preserves long blank lines and split multibyte characters',async()=>{
 const content=' '.repeat(20000)+'\n  hello😀\r\n\nend';
 assert.equal(await output(content,true),'é (1.0)\n\n'+' '.repeat(20000)+'\n    hello😀\r\n\n  end\n\n');
 assert.equal(await output('\u001c\u0085\ufeff',true),'é (1.0)\n\n\u001c\u0085  \ufeff\n\n');
});
test('similarity output observes cancellation before emitting a row',async()=>{
 const controller=new AbortController();controller.abort(new Error('cancelled'));
 await assert.rejects(async()=>{for await(const ignored of similarOutput({id:'id',score:0,content:null,metadata:null},false,controller.signal)){assert.fail('unexpected output');}},/cancelled/);
});
