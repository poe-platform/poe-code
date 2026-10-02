import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../toolcraft-design/dist/explorer/render/pane.js';

test('explorer pane frames match dimensions, clipping, indicators and graphemes',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/pane');
  const layout=await import('toolcraft-design-rust/explorer/layout');
  assert.deepEqual(Object.keys(native),Object.keys(reference));
  assert.equal(native.drawPaneFrame.length,reference.drawPaneFrame.length);
  assert.equal(native.paneBodyRect,layout.paneBodyRect);
  const style={fg:'blue',bold:true};
  function draw(api,rect,title,options){const calls=[];const screen={put(...args){assert.equal(this,screen);assert.equal(args[3],style);calls.push(args);}};assert.equal(api.drawPaneFrame(screen,rect,title,style,options),undefined);return calls;}
  for(const width of [-1,0,1,2,3,8,25])for(const height of [0,1,2,5])for(const focused of [false,true])
    for(const title of ['', 'Title', 'long title that clips', '界😀', 'e\u0301\tlabel', '\u001b[31mred\u001b[0m'])
      for(const indicator of [undefined,'3/9','😀']){
        const rect={x:3,y:2,width,height},options={focused,indicator};
        assert.deepEqual(draw(native,rect,title,options),draw(reference,rect,title,options));
      }
});

test('explorer pane drawing preserves property reads, receiver binding and coercion order',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/pane');
  function capture(api,width){
    const trace=[],scalar=key=>({[Symbol.toPrimitive](hint){trace.push([key,hint]);return key==='x'?2:1;}});
    const raw={x:scalar('x'),y:scalar('y'),width,height:4};
    const rect=new Proxy(raw,{get(target,key){trace.push(['rect',key]);return target[key];}});
    let focusReads=0;
    const options={get focused(){trace.push('focused');return ++focusReads%2===0;},get indicator(){trace.push('indicator');return {[Symbol.toPrimitive](hint){trace.push(['indicator',hint]);return '3/8';}};}};
    const title={[Symbol.toPrimitive](hint){trace.push(['title',hint]);return 'Rows';}};
    const screen={get put(){trace.push('put');return function(...args){trace.push(['draw',this===screen,...args.map(value=>value===raw.x?'x-object':value===raw.y?'y-object':value)]);};}};
    api.drawPaneFrame(screen,rect,title,{},options);return trace;
  }
  for(const width of [0,1,2,20])assert.deepEqual(capture(native,width),capture(reference,width));
});

test('explorer pane frames preserve unusual inputs, thrown values and reentrant callbacks',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/pane');
  for(const value of [NaN,-Infinity,0.5,1.5,'5',null,undefined,2n,Symbol('value')]){
    for(const key of ['x','y','width','height','title','focused','indicator','screen','put']){
      function capture(api){
        const calls=[],rect={x:0,y:0,width:8,height:3},options={};let title='T',screen={put(...args){calls.push(args);}};
        if(key==='title')title=value;else if(key==='screen')screen=value;else if(key==='put')screen.put=value;else if(key==='focused'||key==='indicator')options[key]=value;else rect[key]=value;
        try{return {calls,value:api.drawPaneFrame(screen,rect,title,{},options)};}catch(error){return {calls,error:[error.name,error.message]};}
      }
      assert.deepEqual(capture(native),capture(reference),`${key}: ${String(value)}`);
    }
  }
  const failure=Symbol('screen failure');
  assert.throws(()=>native.drawPaneFrame({put(){throw failure;}},{x:0,y:0,width:4,height:3},'T'),error=>error===failure);
  function reentrant(api){
    const calls=[];let active=false;const screen={put(...args){calls.push(args);if(!active){active=true;api.drawPaneFrame(screen,{x:2,y:1,width:1,height:2},'nested');}}};
    api.drawPaneFrame(screen,{x:0,y:0,width:6,height:3},'outer');return calls;
  }
  assert.deepEqual(reentrant(native),reentrant(reference));
});

test('explorer pane frames capture repeat before its argument evaluation',async()=>{
  const native=await import('toolcraft-design-rust/explorer/render/pane');
  function capture(api){
    const original=Object.getOwnPropertyDescriptor(String.prototype,'repeat'),trace=[];
    try{
      Object.defineProperty(String.prototype,'repeat',{configurable:true,get(){trace.push('repeat');return original.value;}});
      const title={toString(){trace.push('title');return 'text';}};
      api.drawPaneFrame({put(...args){trace.push(args);}},{x:1,y:0,width:12,height:2},title);
      return trace;
    }finally{Object.defineProperty(String.prototype,'repeat',original);}
  }
  assert.deepEqual(capture(native),capture(reference));
});
