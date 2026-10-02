import assert from "node:assert/strict";
import {test} from "node:test";
import * as reference from "../../toolcraft-design/dist/explorer/actions.js";
import {createInitialState} from "../../toolcraft-design/dist/explorer/state.js";

const action={id:'edit',label:'Edit',accelerator:'e',handler(){}};
const rows=[{id:'one',title:'One'},{id:'two',title:'Two'}];
function state(){return createInitialState({title:'Rows',rows:async()=>rows,initialRows:rows,detail:{items:async()=>[]},actions:[action]},{cols:100,rows:20});}
const handles={refresh:async()=>{},reloadDetail(){},suspendAnd:async fn=>fn(),openModal(){},toast(){},confirm:async()=>true,promptText:async()=>null,exit(){}};

test("explorer action resolution preserves targets, availability and live receiver reads",async()=>{
  const native=await import('toolcraft-design-rust/explorer/actions');
  assert.deepEqual(Object.keys(native),Object.keys(reference));
  for(const target of [null,undefined,{type:'builtin',id:'quit'},{type:'action',id:'edit'}])
    for(const available of [true,false,1])for(const running of [true,false,1]){
      function capture(api){
        const trace=[];const value=state();const event={ch:'e',ctrl:true,meta:false,shift:false};
        const observe=(name,item)=>new Proxy(item,{get(object,key,receiver){trace.push([name,key]);return Reflect.get(object,key,receiver);}});
        const bindings={resolve(key){trace.push(['resolve',this===bindings,key===event]);return target;}};
        value.bindings=bindings;value.actionState.set('edit',observe('action',{action,available,running}));
        return {result:api.resolveAction(observe('state',value),event),trace};
      }
      assert.deepEqual(capture(native),capture(reference));
    }
  const failure={reason:'resolve'};const value=state();value.bindings.resolve=()=>{throw failure;};
  assert.throws(()=>native.resolveAction(value,{}),e=>e===failure);
});

test("explorer action contexts match row/detail selections and retain handle identities",async()=>{
  const native=await import('toolcraft-design-rust/explorer/actions');
  for(const focused of ['list','detail'])for(const source of ['row','detail','both'])
    for(const multiSelect of [true,false])for(const selected of [[],['one'],['detail-two']])for(const override of [undefined,[],[rows[1]]]){
      const value=state();Object.assign(value,{focused,multiSelect,selected:new Set(selected),paneDefinitions:[{id:'tasks',title:'Tasks',kind:'list'},{id:'notes',title:'Notes',kind:'list'}]});
      value.detail.items=[{id:'detail-one',render:()=>''},{id:'detail-two',title:'Second detail',subtitle:'Details',badge:{label:'New'},render:()=>''}];value.detail.cursor=1;
      const actual=native.buildActionContext(value,action,source,handles,override),expected=reference.buildActionContext(value,action,source,handles,override);
      assert.deepEqual(actual,expected);
      assert.equal(actual.refresh,handles.refresh);assert.equal(actual.activePane.selected,value.selected);
      if(override!==undefined)assert.equal(actual.rows,override);
      if(source==='detail'||source==='both'&&focused==='detail')assert.equal(actual.item,value.detail.items[1]);
    }
  const value=state();value.rows=[];value.filtered=[];value.detail.items=null;
  assert.deepEqual(native.buildActionContext(value,action,'both',handles),reference.buildActionContext(value,action,'both',handles));
});

test("explorer action contexts retain getter order, array species and reentrant reads",async()=>{
  const native=await import('toolcraft-design-rust/explorer/actions');
  function capture(api){
    const trace=[];const observe=(name,item)=>new Proxy(item,{get(object,key,receiver){if(typeof key==='string')trace.push([name,key]);return Reflect.get(object,key,receiver);}});
    class DetailRows extends Array { static get [Symbol.species](){trace.push(['species']);return Array;} }
    const value=state();value.focused='detail';value.selected=new Set(['b']);value.detail.items=new DetailRows({id:'a',render:()=>''},{id:'b',render:()=>''});value.detail.cursor=1;
    value.detail=observe('detail',value.detail);value.paneDefinitions=[];
    const result=api.buildActionContext(observe('state',value),action,'both',observe('handles',handles));
    return {trace,result:{...result,item:{...result.item,render:undefined}}};
  }
  assert.deepEqual(capture(native),capture(reference));
  const value=state();Object.defineProperty(value,'filter',{get(){assert.equal(native.resolveAction(state(),{ch:'x'}),null);return 'nested';}});
  assert.equal(native.buildActionContext(value,action,'row',handles).filter,'nested');
  const failure={reason:'context'};
  assert.throws(()=>native.buildActionContext(value,action,'row',{...handles,get toast(){throw failure;}}),e=>e===failure);
});
