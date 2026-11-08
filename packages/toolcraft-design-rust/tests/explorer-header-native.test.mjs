import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../toolcraft-design/dist/explorer/render/header.js';

function state(overrides={}){
  return {title:'Plans',focused:'list',paneDefinitions:[{kind:'list'},{kind:'detail'}],filter:'auth',filtered:[1,2],rows:[1,2,3],multiSelect:true,selected:new Set([1]),detail:{filter:'local',items:[1,2],allItems:[1,2,3,4],loading:false},...overrides};
}
function capture(api,value,layout){
  const calls=[],screen={clearRect(rect){assert.equal(this,screen);assert.equal(rect,layout.header);calls.push(['clear',rect]);},put(...args){assert.equal(this,screen);calls.push(['put',...args]);}};
  try{return {calls,result:api.renderHeader(value,screen,layout)};}catch(error){return {calls,error:[error.name,error.message]};}
}

test('explorer headers match widths, title clipping, counts and active list filters',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/header');
  assert.deepEqual(Object.keys(native),Object.keys(reference));assert.equal(native.renderHeader.length,reference.renderHeader.length);
  const variants=[state(),state({title:'计划🚀看板',filter:'',selected:new Set()}),state({title:'e\u0301\tRows',multiSelect:false,detail:{loading:true}}),state({focused:'detail',paneDefinitions:[{kind:'list'},{kind:'list'}]}),state({focused:'detail',paneDefinitions:[{kind:'list'},{kind:'list'}],detail:{items:null,filter:null,loading:true}})];
  for(const width of [-1,0,1,2,12,30,80])for(const height of [0,1,2,3])for(const mode of ['too-narrow','medium'])for(const value of variants){
    const layout={mode,header:{x:4,y:3,width,height}};
    assert.deepEqual(capture(native,value,layout),capture(reference,value,layout));
  }
});

test('explorer headers retain getter order, coercions, clearing effects and callback receivers',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/header');
  function trace(api,second){
    const events=[];
    const watched=(name,value)=>new Proxy(value,{get(target,key){events.push([name,String(key)]);return target[key];}});
    const title={toString(){events.push('title-string');return 'Plans';},toLocaleLowerCase(){events.push(['lower',this===title]);return 'plans';}};
    const count={toString(){events.push('count-string');return '2';}};
    const detail=watched('detail',{filter:'remote',items:watched('items',{length:count}),allItems:null,loading:true});
    const value=watched('state',state({title,focused:second?'detail':'list',paneDefinitions:watched('panes',[{},watched('pane',{kind:'list'})]),filtered:watched('filtered',{length:count}),rows:watched('rows',{length:3}),selected:watched('selected',{size:1}),detail}));
    const rect=watched('rect',{x:0,y:0,width:30,height:3}),layout=watched('layout',{mode:'medium',header:rect});
    const screen={get clearRect(){events.push('clear-method');return function(arg){events.push(['clear',this===screen,arg===rect]);arg.width=35;};},get put(){events.push('put-method');return function(...args){events.push(['put',this===screen,...args]);};}};
    api.renderHeader(value,screen,layout);return events;
  }
  for(const second of [false,true])assert.deepEqual(trace(native,second),trace(reference,second));
});

test('explorer headers preserve missing fields, malformed values and exception identity',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/header');
  for(const field of ['title','filter','filtered','rows','selected','detail','paneDefinitions'])for(const item of [undefined,null,0,1n,Symbol('field')]){
    const value=state({focused:'detail',[field]:item}),layout={mode:'medium',header:{x:0,y:0,width:20,height:3}};
    assert.deepEqual(capture(native,value,layout),capture(reference,value,layout),`${field}: ${String(item)}`);
  }
  const failure=Symbol('screen');
  assert.throws(()=>native.renderHeader(state(),{clearRect(){throw failure;}},{header:{width:0,height:0}}),error=>error===failure);
  function reentrant(api){
    const calls=[];let active=false;const screen={clearRect(rect){calls.push(['clear',rect]);if(!active){active=true;api.renderHeader(state(),screen,{mode:'too-narrow',header:{width:10,height:1}});}},put(...args){calls.push(['put',...args]);}};
    api.renderHeader(state(),screen,{mode:'medium',header:{width:20,height:3}});return calls;
  }
  assert.deepEqual(reentrant(native),reentrant(reference));
});

test('explorer headers preserve modified repeat-method diagnostics',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/header');
  function modified(api){
    const original=Object.getOwnPropertyDescriptor(String.prototype,'repeat');
    try{
      Object.defineProperty(String.prototype,'repeat',{...original,value:null});
      return capture(api,state(),{mode:'medium',header:{width:20,height:3}});
    }finally{Object.defineProperty(String.prototype,'repeat',original);}
  }
  assert.deepEqual(modified(native),modified(reference));
});
