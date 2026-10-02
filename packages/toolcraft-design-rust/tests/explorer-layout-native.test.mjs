import assert from "node:assert/strict";
import {test} from "node:test";
import * as reference from "../../toolcraft-design/dist/explorer/layout.js";

test("explorer layout matches responsive boundaries and nonfinite sizes",async()=>{
  const native=await import('toolcraft-design-rust/explorer/layout');
  assert.deepEqual(Object.keys(native),Object.keys(reference));
  for(const cols of [-Infinity,NaN,Infinity,-1,-0,0,59.9,60,79.9,80,99.9,100,119.9,120,240,Number.MAX_VALUE])
    for(const rows of [-1,-0,0,1,2,3,4,7.9,8,19,24.9,Infinity,Number.MAX_VALUE])
      for(const focused of [undefined,'list','detail'])for(const detailHidden of [undefined,false,true,1]){
        const options={cols,rows,focused,detailHidden};
        assert.deepEqual(native.computeExplorerLayout(options),reference.computeExplorerLayout(options));
      }
});

test("explorer layout reads only active options, retaining thrown values and reentrancy",async()=>{
  const native=await import('toolcraft-design-rust/explorer/layout');
  for(const cols of [40,70,90,110,130,'130',null,{},1n,Symbol('cols')]){
    function capture(api){
      const trace=[];
      const options=new Proxy({cols,rows:24,focused:'detail',detailHidden:true},{get(target,key){trace.push(key);return target[key];}});
      return {value:api.computeExplorerLayout(options),trace};
    }
    assert.deepEqual(capture(native),capture(reference));
  }
  const failure={reason:'getter'};
  assert.throws(()=>native.computeExplorerLayout({cols:80,rows:24,get detailHidden(){throw failure;}}),e=>e===failure);
  const options={cols:70,rows:24,get focused(){assert.deepEqual(native.computeExplorerLayout({cols:120,rows:24}),reference.computeExplorerLayout({cols:120,rows:24}));return 'detail';}};
  assert.deepEqual(native.computeExplorerLayout(options),reference.computeExplorerLayout(options));
});

test("pane body coordinates retain coercion order, NaN and exceptional inputs",async()=>{
  const native=await import('toolcraft-design-rust/explorer/layout');
  for(const value of [0,-0,-5,0.5,Infinity,-Infinity,NaN,'4',null,undefined,1n,Symbol('rect')]){
    function capture(api){
      const trace=[];
      const rect=new Proxy({x:value,y:value,width:value,height:value},{get(target,key){trace.push(key);return target[key];}});
      try{return {trace,value:api.paneBodyRect(rect)};}catch(error){return {trace,error:[error.constructor.name,error.message]};}
    }
    assert.deepEqual(capture(native),capture(reference));
  }
  function capture(api){
    const trace=[];
    const scalar=key=>({[Symbol.toPrimitive](hint){trace.push([key,hint]);return 8;}});
    return {result:api.paneBodyRect({x:scalar('x'),y:scalar('y'),width:scalar('width'),height:scalar('height')}),trace};
  }
  assert.deepEqual(capture(native),capture(reference));
});
