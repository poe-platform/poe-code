import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../toolcraft-design/dist/explorer/render/footer.js';

function state(overrides={}){
  return {modal:null,focused:'list',multiSelect:true,selected:new Set([1,2]),bindings:{keysByTarget:new Map()},actionState:new Map([
    ['edit',{available:true,label:'edit',source:'row',running:false,action:{accelerator:'e'}}],
    ['run',{available:true,label:'run',source:'shared',running:true,action:{key:['F5','F6']}}],
    ['primary',{available:true,label:'open',source:'row',action:{primary:true}}],
    ['hidden',{available:true,label:'hidden',action:{showInFooter:false}}],
    ['disabled',{available:false,label:'disabled'}]
  ]),...overrides};
}
function capture(api,value,rect){
  const calls=[],screen={clearRect(arg){assert.equal(this,screen);assert.equal(arg,rect);calls.push(['clear',arg]);},put(...args){assert.equal(this,screen);calls.push(['put',...args]);}};
  try{return {calls,result:api.renderFooter(value,screen,{footer:rect})};}catch(error){return {calls,error:[error.name,error.message]};}
}

test('explorer footers match action, modal, selection and clipping states',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/footer');
  assert.deepEqual(Object.keys(native),Object.keys(reference));assert.equal(native.renderFooter.length,reference.renderFooter.length);
  const variants=[state(),state({focused:'detail',selected:new Set()}),state({multiSelect:false}),state({modal:{kind:'input'}}),state({modal:{kind:'confirm',confirmLabel:'Yes 界😀',cancelLabel:'No'}}),state({bindings:{keysByTarget:new Map([['builtin:reorderUp',['Shift+up']],['builtin:reorderDown',['Shift+down']]])}}),state({actionState:new Map([['fallback',{available:true,label:'修复🚀\tflow',source:'row',action:{key:[]}}],['plain',{available:true,label:'done',action:null}]])})];
  for(const width of [-1,0,1,8,25,80,160])for(const height of [0,1])for(const value of variants){
    const rect={x:3,y:4,width,height};assert.deepEqual(capture(native,value,rect),capture(reference,value,rect));
  }
});

test('explorer footer hints preserve property reads, coercion and lazy rendering',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/footer');
  function trace(api){
    const events=[],watch=(name,value)=>new Proxy(value,{get(target,key){events.push([name,String(key)]);return target[key];}});
    const label={toString(){events.push('label-string');return 'edit';}};
    const action=watch('action',{accelerator:'e'}),entry=watch('entry',{available:true,action,label,source:'row',running:true});
    const selected=watch('selected',{size:2}),keys={get(key){events.push(['key',key,this===keys]);return key.endsWith('Up')?[]:['Shift+down'];}};
    const value=watch('state',state({actionState:new Map([['edit',entry]]),selected,bindings:watch('bindings',{keysByTarget:keys})}));
    const rect=watch('rect',{x:1,y:4,width:70,height:1});
    const screen={get clearRect(){events.push('clear-method');return function(arg){events.push(['clear',this===screen,arg===rect]);arg.width=90;};},get put(){events.push('put-method');return function(...args){events.push(['put',this===screen,...args]);};}};
    api.renderFooter(value,screen,{footer:rect});return events;
  }
  assert.deepEqual(trace(native),trace(reference));
});

test('explorer footers preserve iterable closing, thrown values and reentrant callbacks',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/footer');
  function iterated(api){
    const events=[],failure=Symbol('label');
    const actionState={*[Symbol.iterator](){try{yield ['bad',{available:true,action:{accelerator:'x'},source:'row',get label(){throw failure;}}];}finally{events.push('closed');}}};
    try{api.renderFooter(state({actionState}),{clearRect(){},put(){}},{footer:{x:0,y:0,width:80,height:1}});}catch(error){events.push(error===failure);}
    return events;
  }
  assert.deepEqual(iterated(native),iterated(reference));
  const failure={screen:true};assert.throws(()=>native.renderFooter(state(),{clearRect(){throw failure;}},{footer:{width:0,height:0}}),error=>error===failure);
  function reentrant(api){
    const calls=[];let active=false;const screen={clearRect(rect){calls.push(['clear',rect]);},put(...args){calls.push(['put',...args]);if(!active){active=true;api.renderFooter(state({modal:{kind:'input'}}),screen,{footer:{x:0,y:1,width:25,height:1}});}}};
    api.renderFooter(state(),screen,{footer:{x:0,y:0,width:60,height:1}});return calls;
  }
  assert.deepEqual(reentrant(native),reentrant(reference));
});

test('explorer footers retain nullish action keys and malformed-field diagnostics',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/footer');
  const rect={x:0,y:0,width:100,height:1};
  for(const action of [undefined,null,{}, {key:null},{key:''},{key:[null]},{key:[false]},{key:Symbol('key')},{accelerator:null},{accelerator:3},{accelerator:Symbol('accelerator')}]){
    const value=state({actionState:new Map([['fallback',{available:true,action,label:'run',source:'shared'}]])});
    assert.deepEqual(capture(native,value,rect),capture(reference,value,rect));
  }
  for(const selected of [undefined,null,{size:0},{size:'2'}])assert.deepEqual(capture(native,state({selected}),rect),capture(reference,state({selected}),rect));
});

test('explorer footer reorder checks retain truthiness and short-circuit custom readers',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/footer');
  for(const up of [false,0,'yes',{}])for(const down of [false,'yes']){
    function checked(api){
      const trace=[],keysByTarget={get(key){trace.push(['get',key]);return {includes(value){trace.push(['includes',value]);return key.endsWith('Up')?up:down;}};}};
      const result=capture(api,state({actionState:new Map(),selected:new Set(),bindings:{keysByTarget}}),{x:0,y:0,width:120,height:1});
      return {trace,result};
    }
    assert.deepEqual(checked(native),checked(reference));
  }
});
