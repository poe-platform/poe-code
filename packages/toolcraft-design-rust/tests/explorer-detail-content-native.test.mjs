import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../toolcraft-design/dist/explorer/detail-content.js';

test('detail preparation matches Markdown wrapping and styled grapheme cells',async()=>{
  const native=await import('toolcraft-design-rust/explorer/detail-content');
  assert.deepEqual(Object.keys(native),Object.keys(reference));
  const sources=['',' \t\n','# Heading\n\n**Bold** and `code`\n\nlast\n\n','😀e\u0301\nsecond','- one\n- two','> quote\n\n---','| a | b |\n| - | - |\n| α | 😀 |','lone \ud800 surrogate','paragraph '.repeat(15)];
  for(const content of sources)for(const width of [0,1,9,20,66,113])assert.deepEqual(native.prepareDetailContent(content,width),reference.prepareDetailContent(content,width),JSON.stringify({content,width}));
});

test('detail preparation retains cache identity, mutable results and hash collisions',async()=>{
  const native=await import('toolcraft-design-rust/explorer/detail-content');
  for(const api of [native,reference]){
    const first=api.prepareDetailContent('Shared native cache source',20);
    assert.equal(api.prepareDetailContent('Shared native cache source',20),first);
    assert.notEqual(api.prepareDetailContent('Shared native cache source',40),first);
    assert.equal(api.prepareDetailContent('Shared native cache source',20),first);
    first.lines[0][0].ch='changed';assert.equal(api.prepareDetailContent('Shared native cache source',20).lines[0][0].ch,'changed');
    assert.equal(api.prepareDetailContent('Minimum native width',0),api.prepareDetailContent('Minimum native width',1));
    assert.notEqual(api.prepareDetailContent('',20),api.prepareDetailContent('',20));
    assert.equal(api.prepareDetailContent('costarring',81),api.prepareDetailContent('liquid',81));
  }
});

test('detail preparation preserves coercion order, hash readers and exact errors',async()=>{
  const native=await import('toolcraft-design-rust/explorer/detail-content');
  function capture(api){
    const source='Observed hash source',trace=[];
    api.prepareDetailContent(source,41);
    const content={trim(){trace.push('trim');return 'x';},get length(){trace.push('length');return source.length;},get charCodeAt(){trace.push('charCodeAt');return function(index){trace.push(['call',this===content,index]);return source.charCodeAt(index);};}};
    const width={valueOf(){trace.push('width');return 41;}};
    return {value:api.prepareDetailContent(content,width),trace};
  }
  assert.deepEqual(capture(native),capture(reference));
  for(const content of [null,undefined,123,{},Symbol('content')]){
    const capture=api=>{try{return api.prepareDetailContent(content,10);}catch(error){return [error.name,error.message];}};
    assert.deepEqual(capture(native),capture(reference));
  }
  for(const width of [NaN,Infinity,-Infinity,undefined,'12',null,1n,Symbol('width')]){
    const capture=api=>{try{return api.prepareDetailContent('Width validation source',width);}catch(error){return [error.name,error.message];}};
    assert.deepEqual(capture(native),capture(reference));
  }
  const failure={identity:'width'};
  assert.throws(()=>native.prepareDetailContent('Width failure',{valueOf(){throw failure;}}),error=>error===failure);
  assert.deepEqual(native.prepareDetailContent(' ',{valueOf(){throw failure;}}),{text:'',lines:[[]]});
  const source='Patched hash source';native.prepareDetailContent(source,43);reference.prepareDetailContent(source,43);
  const original=String.prototype.charCodeAt;
  try{
    const capture=api=>{const trace=[];String.prototype.charCodeAt=function(index){trace.push([String(this),index]);return original.call(this,index);};return {value:api.prepareDetailContent(source,43),trace};};
    assert.deepEqual(capture(native),capture(reference));
  }finally{String.prototype.charCodeAt=original;}
});
