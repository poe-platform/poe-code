import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../toolcraft-design/dist/explorer/render/detail.js';

function state(items,overrides={}){
  return {rows:[{id:'one',title:'Row one'}],paneDefinitions:[{title:'Items'},{title:'Preview'}],focused:'detail',emptyHint:'Nothing to preview',multiSelect:true,selected:new Set(['a']),detail:{rowId:'one',items,scroll:0,cursor:1,loading:false},...overrides};
}
function capture(api,value,rect){
  const calls=[],screen={clearRect(arg){assert.equal(this,screen);assert.equal(arg,rect);calls.push(['clear',arg]);},put(...args){assert.equal(this,screen);calls.push(['put',...args]);}};
  try{return {calls,result:api.renderDetail(value,screen,{detail:rect})};}catch(error){return {calls,error:[error.name,error.message]};}
}

test('explorer detail matches blob, list, empty and loading frames across geometry and scrolling',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/detail');
  assert.deepEqual(Object.keys(native),Object.keys(reference));assert.equal(native.renderDetail.length,reference.renderDetail.length);
  const variants=[null,[],[{id:'a',renderedContent:'# Heading\n\n修复🚀 e\u0301\ttext\n\n- One\n- Two\n- Three'}],[{id:'a',title:'First',subtitle:'Subtitle',badge:{text:'ready'},renderedContent:'**Bold**\n\nBody'},{id:'b',title:'Second',render:()=> 'Second body'}]];
  for(const items of variants)for(const width of [0,1,2,8,28])for(const height of [0,1,2,5,10])for(const scroll of [-2,0,2,99]){
    const value=state(items);value.detail.scroll=scroll;
    const rect={x:2,y:1,width,height};assert.deepEqual(capture(native,value,rect),capture(reference,value,rect));
  }
  for(const overrides of [{rows:[]},{focused:'list'},{paneDefinitions:[]},{paneDefinitions:[{}, {titleForRow:row=>row?.title??'No row'}]}]){
    const value=state(null,overrides);value.detail.loading=true;
    assert.deepEqual(capture(native,value,{x:0,y:0,width:32,height:6}),capture(reference,value,{x:0,y:0,width:32,height:6}));
  }
});

test('detail rendering preserves render context, receiver, return coercion and error boundaries',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/detail');
  for(const kind of ['text','nonstring','error','thrown','getter','missing','rendered-getter']){
    function run(api){
      const trace=[],item={id:'a',get renderedContent(){trace.push('renderedContent');if(kind==='rendered-getter')throw new Error('outside render');return undefined;},get render(){trace.push('render');if(kind==='getter')throw new Error('render getter');if(kind==='missing')return null;return function(context){trace.push(['context',this===item,context.width,context.height,context.row.id,context.signal instanceof AbortSignal,context.signal.aborted,Object.keys(context)]);if(kind==='error')throw new Error('failed');if(kind==='thrown')throw Symbol('failed');return kind==='text'?'Body':{toString(){throw new Error('must not coerce');}};};}};
      return {trace,output:capture(api,state([item],{rows:[]}),{x:0,y:0,width:30,height:7})};
    }
    assert.deepEqual(run(native),run(reference),kind);
  }
});

test('detail property reads, custom find callbacks and drawing effects retain source order',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/detail');
  for(const mode of ['blob','list','empty']){
    function run(api){
      const trace=[],watch=(name,value)=>new Proxy(value,{get(target,key){trace.push([name,String(key)]);return target[key];}});
      const row=watch('row',{id:'one',title:'Row'}),pane=watch('pane',{titleForRow(rowArg){trace.push(['titleForRow',this===pane,rowArg===row]);return 'Live';}});
      const item=watch('item',{id:'a',title:mode==='list'?'Title':undefined,subtitle:'Sub',badge:watch('badge',{text:'ok'}),render(context){trace.push(['render',this===item,context.row===row,context.width,context.height]);return 'Body';}});
      const rows={find(callback){trace.push(['find',this===rows,callback(row),callback({id:'missing'})]);return row;}};
      const value=watch('state',state(watch('items',mode==='empty'?[]:[item]),{rows,paneDefinitions:watch('panes',[{},pane])}));value.detail=watch('detail',value.detail);
      const rect=watch('rect',{x:1,y:2,width:25,height:8}),layout=watch('layout',{detail:rect});
      const screen={get clearRect(){trace.push('clear-method');return function(arg){trace.push(['clear',this===screen,arg===rect]);arg.width=28;};},get put(){trace.push('put-method');return function(...args){trace.push(['put',this===screen,...args]);};}};
      api.renderDetail(value,screen,layout);return trace;
    }
    assert.deepEqual(run(native),run(reference),mode);
  }
});

test('detail drawing retains arbitrary failures and supports nested rendering',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/detail');
  const failure={screen:true};assert.throws(()=>native.renderDetail(state([]),{clearRect(){throw failure;}},{detail:{width:0,height:0}}),error=>error===failure);
  function run(api){
    const calls=[];let nested=false;const screen={clearRect(rect){calls.push(['clear',rect]);},put(...args){calls.push(['put',...args]);if(!nested){nested=true;api.renderDetail(state([]),screen,{detail:{x:0,y:0,width:16,height:4}});}}};
    api.renderDetail(state([{id:'a',renderedContent:'Body'}]),screen,{detail:{x:1,y:1,width:30,height:6}});return calls;
  }
  assert.deepEqual(run(native),run(reference));
});

test('detail rendering closes prepared cell iterators on clipping and arbitrary screen errors',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/detail');
  const nativeContent=await import('toolcraft-design-rust/explorer/detail-content');
  const referenceContent=await import('../../toolcraft-design/dist/explorer/detail-content.js');
  for(const fail of [false,true]){
    function run(api,contentApi){
      const trace=[],failure=Symbol('screen'),text=`iterator detail ${fail}`,content=contentApi.prepareDetailContent(text,18),lines=content.lines;
      content.lines=[{*[Symbol.iterator](){try{yield {ch:'A',width:1,style:{}};yield {ch:'B',width:30,style:{}};}finally{trace.push('closed');}}}];
      try{
        api.renderDetail(state([{id:'a',renderedContent:text}]),{clearRect(){},put(x,y,ch){trace.push([x,y,ch]);if(fail)throw failure;}},{detail:{x:0,y:0,width:20,height:4}});
      }catch(error){trace.push(error===failure);}
      finally{content.lines=lines;}
      return trace;
    }
    assert.deepEqual(run(native,nativeContent),run(reference,referenceContent));
  }
});
