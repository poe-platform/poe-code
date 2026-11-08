import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../toolcraft-design/dist/explorer/render/index.js';
import {createInitialState} from '../../toolcraft-design/dist/explorer/state.js';

function state(cols=100,rows=12){
  const value=createInitialState({title:'Plans',actions:[],rows:async()=>[],detail:{items:async()=>[]},multiSelect:true},{cols,rows});
  value.rows=[{id:'a',title:'First plan',subtitle:'Ready',group:'Current'},{id:'b',title:'Second plan'}];value.filtered=[0,1];value.cursor=0;
  value.detail={rowId:'a',items:[{id:'body',renderedContent:'# Preview\n\nRead the plan.'}],scroll:0,cursor:0,loading:false,token:0};
  return value;
}
function capture(api,value){
  const calls=[],screen={width:value.size.cols,height:value.size.rows,clearRect(rect){assert.equal(this,screen);calls.push(['clear',rect]);},put(...args){assert.equal(this,screen);calls.push(['put',...args]);}};
  try{return {calls,result:api.renderExplorer(value,screen)};}catch(error){return {calls,error:[error.name,error.message]};}
}

test('combined explorer rendering matches all dirty masks, overlays and width breakpoints',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/index');
  assert.deepEqual(Object.keys(native),Object.keys(reference));assert.equal(native.renderExplorer.length,reference.renderExplorer.length);
  for(let dirty=0;dirty<64;dirty++){
    const value=state();value.dirty=dirty;value.modal=dirty%2?{kind:'help'}:null;value.toast=dirty%3?null:{message:'Saved 修复🚀',tone:'info',expiresAt:0};
    assert.deepEqual(capture(native,value),capture(reference,value));
  }
  for(const cols of [0,1,12,50,60,70,80,100,120])for(const focused of ['list','detail']){
    const value=state(cols);value.focused=focused;
    assert.deepEqual(capture(native,value),capture(reference,value));
  }
  for(const name of ['Detail','Footer','Header','List','Modal']){
    const module=await import(`toolcraft-design-rust/explorer/render/${name.toLowerCase()}`);
    assert.equal(native[`render${name}`],module[`render${name}`]);
  }
});

test('explorer dirty coercions, layout reads and toast effects retain evaluation order',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/index');
  function run(api){
    const trace=[],watch=(name,value)=>new Proxy(value,{get(target,key){trace.push([name,String(key)]);return target[key];}});
    const value=state();value.dirty={valueOf(){trace.push('dirty-coercion');return 32;}};value.size=watch('size',value.size);value.toast=watch('toast',{message:{toString(){trace.push('message-string');return 'Saved';}}});
    const wrapped=watch('state',value),screen=watch('screen',{width:40,height:10,clearRect(rect){trace.push(['clear',this===screen,rect]);},put(...args){trace.push(['put',this===screen,...args]);}});
    api.renderExplorer(wrapped,screen);return trace;
  }
  assert.deepEqual(run(native),run(reference));
  for(const clearToast of [false,true]){
    function runClear(api){const value=state(),calls=[];value.dirty=32;value.toast={message:'Saved'};api.renderExplorer(value,{width:40,height:10,clearRect(rect){calls.push(['clear',rect]);if(clearToast)value.toast=null;},put(...args){calls.push(['put',...args]);}});return calls;}
    assert.deepEqual(runClear(native),runClear(reference));
  }
});

test('explorer overlays redraw after partial updates and retain thrown values',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/index');
  for(const dirty of [1,2,4,8,16,32,63]){
    const value=state();value.dirty=dirty;value.modal={kind:'input',title:'Rename',label:'Name',value:'Plan'};value.toast={message:'Saved'};
    assert.deepEqual(capture(native,value),capture(reference,value));
  }
  const failure=Symbol('screen'),value=state();value.dirty=32;value.toast={message:'Saved'};
  assert.throws(()=>native.renderExplorer(value,{width:40,height:10,clearRect(){throw failure;},put(){}}),error=>error===failure);
  for(const dirty of [1n,Symbol('dirty')]){value.dirty=dirty;assert.deepEqual(capture(native,value),capture(reference,value));}
});

test('explorer composite rendering supports nested screen callbacks',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/index');
  function run(api){const calls=[],value=state();value.dirty=1;let nested=false;const screen={width:100,height:12,clearRect(rect){calls.push(['clear',rect]);},put(...args){calls.push(['put',...args]);if(!nested){nested=true;const inner=state();inner.dirty=32;inner.toast={message:'Nested'};api.renderExplorer(inner,screen);}}};api.renderExplorer(value,screen);return calls;}
  assert.deepEqual(run(native),run(reference));
});
