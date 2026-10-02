import assert from "node:assert/strict";
import {test} from "node:test";
import * as reference from "../../toolcraft-design/dist/explorer/state.js";

const row={id:'a',title:'Plan A'};
const rows=async()=>[row];
const actions=[{id:'edit',label:()=>"Edit",accelerator:'e',handler(){}}];
const config=(overrides={})=>({title:'Plans',rows,detail:{items:async()=>[]},actions,...overrides});
const ctx=()=>({width:80,height:24,row,signal:new AbortController().signal});
function snapshot(state){return {...state,bindings:{bindings:[...state.bindings.bindings],keysByTarget:[...state.bindings.keysByTarget]}};}

test("explorer initial state matches viewport modes, rows, actions and namespace constants",async()=>{
  const native=await import('toolcraft-design-rust/explorer/state');
  assert.deepEqual(Object.keys(native),Object.keys(reference));
  for(const key of Object.keys(reference).filter(key=>key.startsWith('REGION_')))assert.equal(native[key],reference[key]);
  for(const cols of [NaN,Infinity,-1,0,59,60,79,80,99,100,119,120,120.9])for(const height of [7,8,24]){
    const cfg=config({initialRows:[row],initialFilter:'a',multiSelect:false});
    assert.deepEqual(snapshot(native.createInitialState(cfg,{cols,rows:height})),snapshot(reference.createInitialState(cfg,{cols,rows:height})));
    assert.equal(native.resolveExplorerLayoutMode(cols,height),reference.resolveExplorerLayoutMode(cols,height));
  }
  const cfg=config();assert.equal(native.normalizeExplorerConfig(cfg),cfg);
});

test("explorer panes preserve async detail rendering, receivers, abort timing and list sharing",async()=>{
  const native=await import('toolcraft-design-rust/explorer/state');
  for(const kind of ['detail','list','none']){
    async function capture(api){
      const trace=[];let release;
      const first={id:'list',kind:'list',title:'Plans',rows,multiSelect:false,emptyHint:''};
      const companion={id:'preview',kind,title:'Preview',render(r,c){trace.push(['render',this===companion,r===row,c.width]);return new Promise(resolve=>{release=resolve;});},async rows(){trace.push(['rows',this===companion]);return [row];}};
      const input=config({panes:kind==='none'?[first]:[first,companion]});
      const normalized=api.normalizeExplorerConfig(input);const context=ctx();
      const result=normalized.detail.items(row,context);trace.push(['pending']);release?.('Preview');
      const items=await result;trace.push(['items',items.map(({render,...item})=>{assert.equal(typeof render,'function');return item;})]);
      for(const item of items)trace.push(['content',await item.render(context)]);
      assert.equal(normalized.rows,first.rows);assert.equal(normalized.multiSelect,false);assert.equal(normalized.emptyHint,'');
      if(kind==='list')assert.equal(normalized.detail.actions,input.actions);
      if(kind==='detail'){
        const controller=new AbortController();const pending=normalized.detail.items(row,{...context,signal:controller.signal});controller.abort();release('aborted');assert.deepEqual(await pending,[]);
      }
      return trace;
    }
    assert.deepEqual(await capture(native),await capture(reference));
  }
});

test("explorer configuration validation, action duplication and getters preserve observable behavior",async()=>{
  const native=await import('toolcraft-design-rust/explorer/state');
  for(const cfg of [{title:'Missing',actions:[]},config({panes:[]}),config({panes:[{kind:'detail'}]}),config({panes:Array(4).fill({kind:'list'})}),config({detail:{items:async()=>[],actions:[{id:'edit',label:'Duplicate',handler(){}}]}})]){
    const capture=api=>{try{api.createInitialState(cfg,{cols:80,rows:24});return 'ok';}catch(error){return [error.constructor.name,error.message];}};
    assert.deepEqual(capture(native),capture(reference));
  }
  function capture(api){
    const trace=[];const observe=value=>new Proxy(value,{get(target,key,receiver){if(typeof key==='string')trace.push(key);return Reflect.get(target,key,receiver);}});
    const cfg=observe(config({panes:[observe({id:'list',kind:'list',title:'List',rows}),observe({id:'detail',kind:'detail',title:'Preview',render:()=>'',titleForRow:()=>''})],initialRows:[row]}));
    const state=api.createInitialState(cfg,observe({cols:80.8,rows:24}));
    return {trace,state:snapshot(state)};
  }
  const actual=capture(native),expected=capture(reference);
  // Closures are intentionally fresh; compare the user-visible state without them.
  actual.state.paneDefinitions=actual.state.paneDefinitions.map(({titleForRow,...pane})=>({...pane,hasTitle:typeof titleForRow==='function'}));
  expected.state.paneDefinitions=expected.state.paneDefinitions.map(({titleForRow,...pane})=>({...pane,hasTitle:typeof titleForRow==='function'}));
  assert.deepEqual(actual,expected);
  const failure={reason:'caller'};
  assert.throws(()=>native.normalizeExplorerConfig(Object.defineProperty(config(),'panes',{get(){throw failure;}})),value=>value===failure);
});
