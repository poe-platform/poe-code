import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../toolcraft-design/dist/explorer/render/list.js';

function state(overrides={}){
  const rows=[{id:'one',title:'Plans',group:'Active',subtitle:'First item',badge:{text:'ready',tone:'success'}},{id:'two',title:'修复🚀流程abcdef',group:'Active'},{id:'three',title:'e\u0301\tthird',group:'Saved',badge:{text:'new'}}];
  return {title:'Plans',paneDefinitions:[{title:'Items',kind:'list'}],focused:'list',rowsLoading:false,rows,filtered:[0,1,2],emptyHint:'No items',cursor:1,multiSelect:true,selected:new Set(['one']),matchPositions:new Map([[1,[0,1,2,3]]]),...overrides};
}
function capture(api,value,layout){
  const calls=[],screen={clearRect(rect){assert.equal(this,screen);assert.equal(rect,layout.list);calls.push(['clear',rect]);},put(...args){assert.equal(this,screen);calls.push(['put',...args]);}};
  try{return {calls,result:api.renderList(value,screen,layout)};}catch(error){return {calls,error:[error.name,error.message]};}
}

test('explorer lists match groups, subtitles, loading, selection and Unicode highlights',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/list');
  assert.deepEqual(Object.keys(native),Object.keys(reference));assert.equal(native.renderList.length,reference.renderList.length);assert.equal(native.visibleStart.length,reference.visibleStart.length);
  const rows=Array.from({length:20},(_,i)=>({id:String(i),title:`Row ${i}`}));
  const variants=[state(),state({focused:'detail',multiSelect:false}),state({rows:[],filtered:[]}),state({rows:[],filtered:[],rowsLoading:true}),state({rows,filtered:rows.map((_,i)=>i),cursor:15}),state({filtered:[0,99,2],cursor:2})];
  for(const width of [0,1,4,18,36])for(const height of [0,2,3,8])for(const mode of ['too-narrow','medium'])for(const value of variants){
    const layout={mode,list:{x:2,y:1,width,height}};assert.deepEqual(capture(native,value,layout),capture(reference,value,layout));
  }
});

test('visibleStart preserves cursor search, boundary arithmetic and custom callbacks',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/list');
  for(const cursor of [-1,0,2,5])for(const height of [-2,0,1,3,10,NaN,Infinity,'4',null,1n,Symbol('height')])for(const scrolloff of [undefined,-1,0,3,12,'2',NaN]){
    const lines=Array.from({length:6},(_,i)=>({kind:i%2?'subtitle':'row',cursor:i===cursor}));
    function run(api){try{return api.visibleStart(lines,height,scrolloff);}catch(error){return [error.name,error.message];}}
    assert.deepEqual(run(native),run(reference));
  }
  function run(api){
    const trace=[],cursor={value:'truthy'},lines={findIndex(callback){trace.push(callback({kind:'group',cursor:true}));trace.push(callback({kind:'row',cursor})===cursor);return 7;}};
    return {value:api.visibleStart(lines,5),trace};
  }
  assert.deepEqual(run(native),run(reference));
});

test('explorer list building retains getter order, callback receivers and clearing effects',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/list');
  function trace(api){
    const events=[],watch=(name,value)=>new Proxy(value,{get(target,key){events.push([name,String(key)]);return target[key];}});
    const row=watch('row',{id:'one',title:'A😀B',group:'Group',subtitle:'Sub',badge:watch('badge',{text:'ok',tone:'info'})});
    const selected={has(id){events.push(['selected',this===selected,id]);return true;}},matches={get(index){events.push(['matches',this===matches,index]);return [1,2];}};
    const value=watch('state',state({rows:watch('rows',[row]),filtered:watch('filtered',[0]),cursor:0,selected,matchPositions:matches}));
    const rect=watch('rect',{x:0,y:0,width:30,height:7}),layout=watch('layout',{mode:'medium',list:rect});
    const screen={get clearRect(){events.push('clear-method');return function(arg){events.push(['clear',this===screen,arg===rect]);arg.width=32;};},get put(){events.push('put-method');return function(...args){events.push(['put',this===screen,...args]);};}};
    api.renderList(value,screen,layout);return events;
  }
  assert.deepEqual(trace(native),trace(reference));
});

test('explorer list errors close iterators and preserve thrown values and reentrancy',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/list');
  function iterated(api){
    const trace=[],failure=Symbol('row');const filtered={length:1,*[Symbol.iterator](){try{yield 0;}finally{trace.push('closed');}}};
    const value=state({filtered,rows:[{get group(){throw failure;}}]});
    try{api.renderList(value,{clearRect(){},put(){}},{mode:'medium',list:{x:0,y:0,width:30,height:5}});}catch(error){trace.push(error===failure);}
    return trace;
  }
  assert.deepEqual(iterated(native),iterated(reference));
  const failure={screen:true};assert.throws(()=>native.renderList(state(),{clearRect(){throw failure;}},{list:{width:0,height:0}}),error=>error===failure);
  function reentrant(api){
    const calls=[];let active=false;const screen={clearRect(rect){calls.push(['clear',rect]);},put(...args){calls.push(['put',...args]);if(!active){active=true;api.renderList(state({rows:[],filtered:[]}),screen,{mode:'medium',list:{x:0,y:0,width:20,height:4}});}}};
    api.renderList(state(),screen,{mode:'medium',list:{x:0,y:0,width:35,height:6}});return calls;
  }
  assert.deepEqual(reentrant(native),reentrant(reference));
});
