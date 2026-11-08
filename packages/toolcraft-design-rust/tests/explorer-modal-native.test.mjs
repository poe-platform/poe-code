import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../toolcraft-design/dist/explorer/render/modal.js';

function state(modal){return {modal,actionState:new Map([['a',{label:'Review changes',available:true,running:false,action:{}}],['b',{label:'Publish',available:true,running:false,action:{}}],['c',{label:'Hidden',available:false,action:{}}],['d',{label:'Running',available:true,running:true,action:{}}]])};}
function capture(api,value,width,height){
  const calls=[],screen={width,height,clearRect(rect){assert.equal(this,screen);calls.push(['clear',rect]);},put(...args){assert.equal(this,screen);calls.push(['put',...args]);}};
  try{return {calls,result:api.renderModal(value,screen)};}catch(error){return {calls,error:[error.name,error.message]};}
}

test('explorer dialogs match all modal kinds, narrow geometry, ANSI and Unicode content',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/modal');
  assert.deepEqual(Object.keys(native),Object.keys(reference));assert.equal(native.renderModal.length,reference.renderModal.length);
  const variants=[null,{kind:'help'},{kind:'confirm',title:'Deploy',message:'Deploy 修复🚀 now?',confirmLabel:'Yes',cancelLabel:'No'},{kind:'input',title:'Name',label:'New name',value:'e\u0301\tText',placeholder:'Fallback'},{kind:'input',title:'Name',label:'New name',value:'',placeholder:'Fallback'},{kind:'palette',query:'',cursor:1},{kind:'palette',query:'missing',cursor:0},{kind:'content',title:'Preview',content:'\x1b[31mRed\x1b[0m\n\x1b]0;hidden\x07Visible\n修复🚀abcdef\nlast',scroll:0},{kind:'content',title:'Scrolled',content:'one\ntwo\nthree',scroll:2}];
  for(const modal of variants)for(const width of [0,1,2,10,34,72])for(const height of [0,1,2,4,12])assert.deepEqual(capture(native,state(modal),width,height),capture(reference,state(modal),width,height));
});

test('modal sizing and palette selection retain repeated getters, receivers and clear effects',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/modal');
  for(const kind of ['palette','input','content','confirm']){
    function run(api){
      const trace=[],watch=(name,value)=>new Proxy(value,{get(target,key){trace.push([name,String(key)]);return target[key];}});
      const query={toLocaleLowerCase(){trace.push(['query',this===query]);return 're';}};
      const label={toLocaleLowerCase(){trace.push(['label',this===label]);return {includes(value){trace.push(['includes',value]);return 'truthy';}};},toString(){trace.push('label-string');return 'Review';}};
      const entry=watch('entry',{available:true,running:false,action:{},label});
      const actionState={values(){trace.push(['values',this===actionState]);return [entry].values();}};
      const modal=watch('modal',{kind,query,cursor:0,title:'Live',label:'Name',value:'Value',placeholder:'Fallback',content:'first\nsecond',scroll:0,message:'Confirm',confirmLabel:'Yes',cancelLabel:'No'});
      const value=watch('state',{modal,actionState});
      const screen=watch('screen',{width:60,height:12,clearRect(rect){trace.push(['clear',this===screen,rect]);modal.cursor=1;},put(...args){trace.push(['put',this===screen,...args]);}});
      api.renderModal(value,screen);return trace;
    }
    assert.deepEqual(run(native),run(reference),kind);
  }
});

test('modal palette errors close iterators and preserve arbitrary exceptions',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/modal');
  function run(api){
    const trace=[],failure={label:true},value=state({kind:'palette',query:'',cursor:0});
    value.actionState={*values(){try{yield {available:true,action:{},get label(){throw failure;}};}finally{trace.push('closed');}}};
    try{api.renderModal(value,{width:60,height:12,clearRect(){},put(){}});}catch(error){trace.push(error===failure);}
    return trace;
  }
  assert.deepEqual(run(native),run(reference));
  for(const modal of [{kind:'palette',query:null,cursor:0},{kind:'input',value:null},{kind:'content',content:12,scroll:0}])assert.deepEqual(capture(native,state(modal),60,12),capture(reference,state(modal),60,12));
});

test('modal rendering supports reentrant drawing and strict action eligibility',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/modal');
  for(const available of [true,false,1,'true'])for(const running of [true,false,1,undefined]){
    const value=state({kind:'palette',query:'',cursor:0});value.actionState=new Map([['a',{available,running,action:{},label:'Action'}]]);
    assert.deepEqual(capture(native,value,60,12),capture(reference,value,60,12));
  }
  function run(api){
    const calls=[];let nested=false;const screen={width:60,height:12,clearRect(rect){calls.push(['clear',rect]);},put(...args){calls.push(['put',...args]);if(!nested){nested=true;api.renderModal(state({kind:'help'}),screen);}}};
    api.renderModal(state({kind:'input',title:'Name',label:'Name',value:'x'}),screen);return calls;
  }
  assert.deepEqual(run(native),run(reference));
});
