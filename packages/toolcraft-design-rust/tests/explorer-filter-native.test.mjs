import assert from "node:assert/strict";
import {test} from "node:test";
import * as reference from "../../toolcraft-design/dist/explorer/filter.js";

test("explorer filter preserves scores, tie order and UTF-16 positions",async()=>{
  const native=await import('toolcraft-design-rust/explorer/filter');
  assert.deepEqual(Object.keys(native),Object.keys(reference));
  const alphabet=['a','b',' ','-','_','/','.','😀','\ud83d','\ude00','İ','Σ','\u0307'];
  const titles=['','abc','a-b-c','abc abc','a/abc','a_abc','a.abc','👩‍💻','İΟΣ','İΟΣΑ','I\u0307ab','I\u0301ab','\u001b[31mAb\u001b[0m','\u001b[2KAb'];
  for(const a of alphabet)for(const b of alphabet)titles.push(a+b+a+b);
  const rows=titles.map((title,index)=>({id:String(index),title,subtitle:index%3===0?'Ab😀':undefined,group:'hidden'}));
  for(const query of [...alphabet,...alphabet.flatMap(a=>alphabet.map(b=>a+b)),'abc','aaa','👩💻','hidden',' \t']){
    for(const caseSensitive of [true,false])assert.deepEqual(native.filterRows(query,rows,{caseSensitive}),reference.filterRows(query,rows,{caseSensitive}),JSON.stringify({query,caseSensitive}));
  }
  let seed=7171;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let i=0;i<300;i++){
    const title=Array.from({length:64},()=>alphabet[random()%alphabet.length]).join('');
    const query=Array.from({length:8},()=>alphabet[random()%alphabet.length]).join('');
    assert.deepEqual(native.filterRows(query,[{title}]),reference.filterRows(query,[{title}]));
  }
});

test("explorer filter retains sparse species, getter order and live iteration",async()=>{
  const native=await import('toolcraft-design-rust/explorer/filter');
  class Rows extends Array {}
  const sparse=new Rows(4);sparse[2]={id:'a',title:'a'};
  for(const query of ['',' \t','a'])assert.deepEqual(native.filterRows(query,sparse),reference.filterRows(query,sparse));
  function capture(api){
    const trace=[];
    const rows=[{get title(){trace.push('title');rows.push({title:'ABC'});return 'AB';},get subtitle(){trace.push('subtitle');return 'c';}}];
    let reads=0;
    const options={get caseSensitive(){trace.push('caseSensitive');return ++reads===2;}};
    const result=api.filterRows('ab',rows,options);
    return {result,trace};
  }
  assert.deepEqual(capture(native),capture(reference));
  for(const title of [null,123,{},Symbol('title')]){
    const capture=api=>{try{return api.filterRows('a',[{title}]);}catch(error){return [error.constructor.name,error.message];}};
    assert.deepEqual(capture(native),capture(reference));
  }
  const failure={reason:'row'};
  assert.throws(()=>native.filterRows('a',[{get title(){throw failure;}}]),error=>error===failure);
  assert.deepEqual(native.filterRows('a',[{get title(){assert.deepEqual(native.filterRows('b',[{title:'b'}]),reference.filterRows('b',[{title:'b'}]));return 'a';}}]),reference.filterRows('a',[{title:'a'}]));
});

test("explorer filter preserves locale folding order, bounded projection and thrown values",async()=>{
  const native=await import('toolcraft-design-rust/explorer/filter');
  const lower=String.prototype.toLocaleLowerCase;
  try{
    for(const locale of ['en','tr','lt'])for(const query of ['i','a','x','ς','σ','\u0307']){
      function capture(api){
        const trace=[];
        String.prototype.toLocaleLowerCase=function(){trace.push(String(this));return lower.call(this,locale);};
        return {value:api.filterRows(query,[{title:'I\u0307ab',subtitle:'x'},{title:'I\u0301ab'},{title:'İΟΣ'},{title:'İ'.repeat(128)+'A'}]),trace};
      }
      assert.deepEqual(capture(native),capture(reference));
    }
    const failure=Symbol('projection');
    let calls=0;
    String.prototype.toLocaleLowerCase=function(){if(++calls===3)throw failure;return lower.call(this);};
    assert.throws(()=>native.filterRows('a',[{title:'A'}]),error=>error===failure);
  }finally{String.prototype.toLocaleLowerCase=lower;}
});
