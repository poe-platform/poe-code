import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../toolcraft-design/dist/explorer/index.js';
import * as root from 'toolcraft-design-rust';

test('explorer namespace preserves public exports and shared root identities',async()=>{
  const native=await import('toolcraft-design-rust/explorer/index');
  assert.deepEqual(Object.keys(native),Object.keys(reference));
  assert.deepEqual(Object.keys(root.explorer),Object.keys(reference));
  for(const key of Object.keys(native))assert.equal(root.explorer[key],native[key],key);
  for(const key of ['singleDetail','runExplorer','normalizeExplorerConfig'])assert.equal(root[key],native[key],key);
  for(const [key,path]of [['runExplorer','runtime'],['createInitialState','state'],['normalizeExplorerConfig','state'],['resolveBindings','keymap']])assert.equal(native[key],(await import(`toolcraft-design-rust/explorer/${path}`))[key]);
  for(const [key,path]of [['runExplorer','run-explorer'],['singleDetail','single-detail']]){
    const direct=await import(`toolcraft-design-rust/${path}`);
    assert.deepEqual(Object.keys(direct),[key]);assert.equal(direct[key],native[key]);
  }
});

test('singleDetail preserves deferred callbacks, captured identities and function descriptors',async()=>{
  const {singleDetail}=await import('toolcraft-design-rust/explorer/index');
  async function capture(create){
    const trace=[];const row={get id(){trace.push('id');return 'first';}},context={width:80};
    const descriptor=create(function(renderRow,ctx){trace.push(['render',this,renderRow===row,ctx===context]);return ctx;});
    trace.push(['shape',Object.keys(descriptor),descriptor.items.name,descriptor.items.length]);
    const itemsPromise=descriptor.items(row,new Proxy({},{get(){throw Error('unused context');}}));
    trace.push('after-items-call');const items=await itemsPromise;
    trace.push(['item',Object.keys(items[0]),Object.getOwnPropertyDescriptor(items[0],'id'),items[0].render.name,items[0].render.length]);
    assert.equal(items[0].render.call({},context),context);
    trace.push(['create',create.name,create.length,Object.getOwnPropertyNames(create)]);return trace;
  }
  assert.deepEqual(await capture(singleDetail),await capture(reference.singleDetail));
});

test('singleDetail preserves synchronous returns, promises and arbitrary thrown values',async()=>{
  const {singleDetail}=await import('toolcraft-design-rust/explorer/index');
  for(const create of [singleDetail,reference.singleDetail]){
    const row={id:'one'};
    for(const value of [null,undefined,17,Symbol('value'),{value:true},Promise.resolve('result')]){
      const [item]=await create(()=>value).items(row);assert.equal(item.render({}),value);
      const [failure]=await create(()=>{throw value;}).items(row);assert.throws(()=>failure.render({}),error=>error===value);
      // assert.rejects assimilates a promise used as the rejection reason.
      let rejected=false;
      try{await create(()=>undefined).items({get id(){throw value;}});}catch(error){rejected=true;assert.equal(error,value);}
      assert.equal(rejected,true);
    }
    const [invalid]=await create(17).items(row);assert.throws(()=>invalid.render({}),{name:'TypeError',message:'fn is not a function'});
    let called=false;const detail=create(()=>{called=true;});const pending=detail.items(null);assert.equal(called,false);await assert.rejects(pending,{name:'TypeError',message:"Cannot read properties of null (reading 'id')"});
  }
});
