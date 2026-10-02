import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../toolcraft-design/dist/explorer/reducer.js';
import {createInitialState} from '../../toolcraft-design/dist/explorer/state.js';

const rows=[{id:'one',title:'One',subtitle:'First'},{id:'two',title:'Two'},{id:'three',title:'Three'}];
function initial(overrides={}){return {...createInitialState({title:'Rows',rows:async()=>rows,detail:{items:async()=>[]},actions:[],multiSelect:true},{cols:100,rows:12}),...overrides};}
function loaded(overrides={}){return {...reference.step(initial(),{type:'rowsLoaded',rows}).state,...overrides};}
function snapshot(value){
  if(typeof value==='function')return {functionLength:value.length};
  if(value instanceof Map)return {map:[...value].map(([key,item])=>[snapshot(key),snapshot(item)])};
  if(value instanceof Set)return {set:[...value].map(snapshot)};
  if(Array.isArray(value))return value.map(snapshot);
  if(value&&typeof value==='object')return Object.fromEntries(Reflect.ownKeys(value).map(key=>[key,snapshot(value[key])]));
  return value;
}
function capture(api,state,event,handles){try{return {result:snapshot(api.step(state,event,handles))};}catch(error){return {error:[error.name,error.message]};}}
function key(target,extra={}){return {name:target,ctrl:false,meta:false,shift:false,...extra};}
const builtins=['quit','filter','help','palette','cursorUp','cursorDown','top','bottom','pageUp','pageDown','halfPageUp','halfPageDown','focusNext','escape','confirm','toggleSelect','selectAll','clearSelection','detailScrollDown','detailScrollUp','extendSelectionUp','extendSelectionDown','reorderUp','reorderDown'];

test('explorer reducer matches builtin navigation, selection, filters and all modal transitions',async()=>{
  const native=await import('toolcraft-design-rust/explorer/reducer');
  assert.deepEqual(Object.keys(native),Object.keys(reference));assert.equal(native.step.length,reference.step.length);
  const bindings={resolve:keypress=>builtins.includes(keypress.name)?{type:'builtin',id:keypress.name}:null};
  const resolver=()=>{},base=loaded({bindings});
  const variants=[base,{...base,multiSelect:false},{...base,filterFocused:true,filter:'O'},{...base,selected:new Set(['one','two'])},
    {...base,focused:'detail',detail:{...base.detail,items:[{id:'body',renderedContent:'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten'}]}},
    {...base,focused:'detail',paneDefinitions:[{kind:'list'},{kind:'list'}],detail:{...base.detail,items:rows.map(row=>({...row,render:()=>''})),filter:'',allItems:rows.map(row=>({...row,render:()=>''}))}},
    ...[{kind:'input',title:'Input',label:'Name',value:'A👩‍💻',resolver},{kind:'confirm',title:'Confirm',message:'Continue?',confirmLabel:'Yes',cancelLabel:'No',resolver},{kind:'help'},{kind:'palette',query:'',cursor:0},{kind:'content',title:'Body',content:'one\ntwo\nthree\nfour',scroll:0}].map(modal=>({...base,modal}))];
  for(const state of variants)for(const name of builtins.concat(['backspace','delete','space','text','yes','no','meta'])){
    const event={type:'key',key:key(name,{ch:({text:'修复',yes:'y',no:'N',meta:'q'})[name],meta:name==='meta'})};
    assert.deepEqual(capture(native,state,event),capture(reference,state,event),`${state.modal?.kind??state.focused}:${name}`);
  }
});

test('explorer reducer matches loaded data, stale jobs, resize, reordering and successive events',async()=>{
  const native=await import('toolcraft-design-rust/explorer/reducer');
  const bindings={resolve:keypress=>({type:'builtin',id:keypress.name})};
  const base=loaded({bindings}),items=[{id:'a',title:'Alpha',render:()=>''},{id:'b',title:'Beta',render:()=>''}];
  const events=[{type:'resize',cols:70,rows:8},{type:'resize',cols:NaN,rows:Infinity},{type:'rowsLoaded',rows:[rows[2],rows[0]]},{type:'rowsLoaded',rows:[]},{type:'rowsLoaded',rows:[rows[0],rows[0]]},{type:'detailLoading',rowId:'one',token:1},{type:'detailLoaded',rowId:'one',token:1,items},{type:'detailLoaded',rowId:'stale',token:1,items},{type:'detailItemRendered',rowId:'one',token:1,itemIndex:0,content:'**Ready**'},{type:'detailError',rowId:'one',token:1,error:new Error('failed')},{type:'actionResolved',actionId:'none'},{type:'toastExpired'},{type:'suspendResumed',emit:{type:'resize',cols:90,rows:18}},{type:'modalOpened',title:'Log',content:'Body'},{type:'modalDismissed',result:'done'},{type:'unknown'}];
  for(const state of [base,{...base,detail:{...base.detail,items},toast:{message:'Saved'}},{...base,modal:{kind:'confirm',rows:[rows[1]],resolver(){}}}])for(const event of events)assert.deepEqual(capture(native,state,event),capture(reference,state,event),event.type);
  let left=initial({bindings}),right=initial({bindings});
  const sequence=[{type:'rowsLoaded',rows},...['cursorDown','toggleSelect','extendSelectionDown','reorderUp','focusNext','focusNext','clearSelection','top','palette','escape','help','escape'].map(name=>({type:'key',key:key(name)})),...events.filter(event=>!['unknown','rowsLoaded'].includes(event.type))];
  for(const event of sequence){const a=native.step(left,event),b=reference.step(right,event);assert.deepEqual(snapshot(a),snapshot(b),event.type);left=a.state;right=b.state;}
});

test('explorer actions retain deferred handlers, captured rows, receivers and resume identities',async()=>{
  const native=await import('toolcraft-design-rust/explorer/reducer');
  async function run(api,destructive){
    const trace=[],action={id:'run',label(){trace.push(['label',this===action]);return 'Run';},destructive,handler(context){trace.push(['handler',this===action,context.rows.map(row=>row.id),context.row.id,context.filter]);return 'result';},predicate(context){trace.push(['predicate',this===action,context.row.id]);return true;},visible(row){trace.push(['visible',this===action,row.id]);return true;}};
    const state=loaded({selected:new Set(['one','two']),bindings:{resolve(){return {type:'action',id:'run'};}},actionState:new Map([['run',{action,label:'Run',source:'row',available:true,running:false}]])});
    let result=api.step(state,{type:'key',key:key('action')});trace.push(['initial',snapshot(result)]);
    if(destructive)result=api.step(result.state,{type:'modalDismissed',result:true});
    trace.push(['before',snapshot(result)]);assert.equal(result.effects[0].type,'suspend');
    trace.push(['return',await result.effects[0].fn()]);action.id='renamed';trace.push(['resume',result.effects[0].resumeWith('ignored')]);
    const resolved=api.step(result.state,{type:'actionResolved',actionId:'run'});trace.push(['resolved',snapshot(resolved)]);return trace;
  }
  for(const destructive of [false,true])assert.deepEqual(await run(native,destructive),await run(reference,destructive));
});

test('explorer reducer preserves getter order, shared no-effect arrays and untouched identities',async()=>{
  const native=await import('toolcraft-design-rust/explorer/reducer');
  for(const event of [{type:'resize',cols:80,rows:10},{type:'detailLoading',rowId:'stale',token:1},{type:'toastExpired'},{type:'rowsLoaded',rows}]){
    function run(api){const trace=[],watch=(name,value)=>new Proxy(value,{get(target,key){trace.push([name,String(key)]);return target[key];},ownKeys(target){trace.push([name,'ownKeys']);return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){trace.push([name,'descriptor',String(key)]);return Reflect.getOwnPropertyDescriptor(target,key);}});const state=watch('state',loaded());const result=api.step(state,watch('event',event));return {trace,result:snapshot(result)};}
    assert.deepEqual(run(native),run(reference),event.type);
  }
  const state=loaded({dirty:0}),first=native.step(state,{type:'toastExpired'}),second=native.step(state,{type:'detailLoading',rowId:'stale',token:0});
  assert.equal(first.state,state);assert.equal(first.effects,second.effects);assert.equal(first.state.rows,state.rows);assert.equal(first.state.selected,state.selected);
});

test('explorer reducer closes input iterators and retains arbitrary callback exceptions',async()=>{
  const native=await import('toolcraft-design-rust/explorer/reducer');
  function run(api){const trace=[],failure=Symbol('row'),iterable={*[Symbol.iterator](){try{yield {get id(){throw failure;}};}finally{trace.push('closed');}}};try{api.step(loaded(),{type:'rowsLoaded',rows:iterable});}catch(error){trace.push(error===failure);}return trace;}
  assert.deepEqual(run(native),run(reference));
  const failure={resolver:true},state=loaded({modal:{kind:'input',resolver(){throw failure;}}});
  assert.throws(()=>native.step(state,{type:'modalDismissed',result:'x'}),error=>error===failure);
});

test('action recomputation preserves callback receivers, nonboolean availability and palette dispatch',async()=>{
  const native=await import('toolcraft-design-rust/explorer/reducer');
  for(const visible of [true,false,0,'visible'])for(const predicate of [true,false,0,'available']){
    function run(api){
      const trace=[],action={id:'run',label(){trace.push(['label',this===action]);return 'Run';},visible(row){trace.push(['visible',this===action,row.id]);return visible;},predicate(context){trace.push(['predicate',this===action,context.rows.map(row=>row.id),context.activePane?.id]);return predicate;},handler(){}};
      let state=loaded({actionState:new Map([['run',{action,source:'row',available:true,label:'Run',running:false}],['missing',{available:false,label:'Missing'}]]),bindings:{resolve:key=>({type:'builtin',id:key.name})}});
      const results=[];for(const name of ['cursorDown','toggleSelect','focusNext','focusNext','palette','confirm']){const result=api.step(state,{type:'key',key:key(name)});results.push(snapshot(result));state=result.state;}
      return {trace,results};
    }
    assert.deepEqual(run(native),run(reference));
  }
});

test('reducer invalid callback diagnostics match the original call sites',async()=>{
  const native=await import('toolcraft-design-rust/explorer/reducer');
  const cases=[
    [loaded({bindings:{resolve:0}}),{type:'key',key:key('cursorDown')}],
    [loaded({modal:{kind:'input',resolver:0}}),{type:'modalDismissed',result:'x'}],
    [loaded({modal:{kind:'confirm',resolver:0}}),{type:'modalDismissed',result:true}],
    ...['visible','predicate'].map(name=>{const action={id:'run',label:'Run',handler(){},[name]:0};return [loaded({actionState:new Map([['run',{action,source:'row',available:true,label:'Run'}]])}),{type:'rowsLoaded',rows}];})
  ];
  for(const [state,event]of cases)assert.deepEqual(capture(native,state,event),capture(reference,state,event));
});

test('reducer callbacks can reenter and deferred failures retain rejection identity',async()=>{
  const native=await import('toolcraft-design-rust/explorer/reducer');
  function run(api){
    const trace=[],inner=loaded({dirty:0}),action={id:'a',label:'Action',handler(){},predicate(){const result=api.step(inner,{type:'toastExpired'});trace.push(result.state===inner);return true;}};
    const state=loaded({actionState:new Map([['a',{action,label:'Action',source:'row',available:true}]])});
    const result=api.step(state,{type:'rowsLoaded',rows});return {trace,result:snapshot(result)};
  }
  assert.deepEqual(run(native),run(reference));
  const failure=Symbol('handler'),action={id:'run',label:'Run',handler(){throw failure;}};
  const state=loaded({bindings:{resolve:()=>({type:'action',id:'run'})},actionState:new Map([['run',{action,label:'Run',source:'row',available:true}]])});
  const result=native.step(state,{type:'key',key:key('action')});
  await assert.rejects(result.effects[0].fn(),error=>error===failure);
});

test('navigation and modal callback traces preserve deep property access order',async()=>{
  const native=await import('toolcraft-design-rust/explorer/reducer');
  for(const target of builtins)for(const mode of ['list','input','palette']){
    function run(api){
      const trace=[],cache=new WeakMap();
      function watch(value,path){if(!value||typeof value!=='object'||value instanceof Map||value instanceof Set)return value;if(cache.has(value))return cache.get(value);const proxy=new Proxy(value,{get(object,key){trace.push([path,String(key)]);return watch(object[key],`${path}.${String(key)}`);},ownKeys(object){trace.push([path,'ownKeys']);return Reflect.ownKeys(object);},getOwnPropertyDescriptor(object,key){trace.push([path,'descriptor',String(key)]);return Reflect.getOwnPropertyDescriptor(object,key);}});cache.set(value,proxy);return proxy;}
      const modal=mode==='input'?{kind:'input',title:'Name',label:'Name',value:'ABC',resolver(){}}:mode==='palette'?{kind:'palette',query:'',cursor:0}:null;
      const state=loaded({modal,bindings:{resolve(){return {type:'builtin',id:target};}}});
      api.step(watch(state,'state'),watch({type:'key',key:key(target)},'event'));return trace;
    }
    assert.deepEqual(run(native),run(reference),`${mode}:${target}`);
  }
});
