import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/components/border.js";
import {computeDashboardLayout} from "../../toolcraft-design/dist/dashboard/layout.js";
import {ScreenBuffer as OriginalBuffer} from "../../toolcraft-design/dist/dashboard/buffer.js";

test("dashboard border preserves drawing calls for compact, full and degenerate frames",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/border");
  assert.deepEqual(Object.keys(native),Object.keys(original));
  for(const totalWidth of [0,1,2,3,10,40,80])for(const totalHeight of [0,1,2,3,8])for(const leftTitle of [undefined,"Title","界👩‍💻é long title","\x1b[31mRed\x1b[0m\nline"]){
    const layout=computeDashboardLayout({totalWidth,totalHeight});
    const opts={leftTitle,rightTitle:"Stats",style:{fg:"cyan",underline:true}};
    const capture=api=>{const calls=[];api.renderBorder({put(...args){calls.push(args);}},layout,opts);return calls;};
    assert.deepEqual(capture(native),capture(original),JSON.stringify({totalWidth,totalHeight,leftTitle}));
  }
});

test("dashboard border preserves junctions, style identity and native buffer output",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/border");
  const {ScreenBuffer}=await import("toolcraft-design-rust/dashboard/buffer");
  const layout={outerBorder:{x:0,y:0,width:10,height:6},leftPane:{x:1,y:1,width:4,height:3},rightPane:{x:6,y:1,width:3,height:3},divider:{x:5,top:1,bottom:4},footer:{x:1,y:4,width:8,height:1},footerDivider:{y:3,left:1,right:8}};
  for(const [top,bottom] of [[1,4],[0,5],[2,2],[4,4]]){
    layout.divider.top=top;layout.divider.bottom=bottom;
    const a=new ScreenBuffer(10,6),b=new OriginalBuffer(10,6),opts={leftTitle:"A",rightTitle:"B",style:{dim:true}};
    native.renderBorder(a,layout,opts);original.renderBorder(b,layout,opts);assert.deepEqual({...a},{...b});
    native.renderBorder({put(x,y,text,style){assert.equal(style,opts.style);}},layout,opts);
  }
});

test("dashboard border preserves getter order, reentrant puts and thrown identity",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/border");
  function capture(api){
    const trace=[],value=computeDashboardLayout({totalWidth:80,totalHeight:5});
    const wrap=(tag,obj)=>new Proxy(obj,{get(target,key){trace.push([tag,key]);const value=target[key];return typeof value==="object"&&value!==null?wrap(tag+"."+String(key),value):value;}});
    const opts={get leftTitle(){trace.push("leftTitle");return "long title";},get rightTitle(){trace.push("rightTitle");return "Stats";},get style(){trace.push("style");return {dim:true};}};
    const buffer={get put(){trace.push("put getter");return function(x,y,text,style){assert.equal(this,buffer);trace.push([x,y,text,style]);value.divider.bottom=2;};}};
    api.renderBorder(buffer,wrap("layout",value),opts);
    const failure={};assert.throws(()=>api.renderBorder({put(){throw failure;}},value,opts),error=>error===failure);
    return trace;
  }
  assert.deepEqual(capture(native),capture(original));
});

test("dashboard layout subpath exposes the original implementation contract",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/layout");
  const expected=await import("../../toolcraft-design/dist/dashboard/layout.js");
  assert.deepEqual(Object.keys(native),Object.keys(expected));
  assert.deepEqual(native.computeDashboardLayout({totalWidth:80,totalHeight:24}),computeDashboardLayout({totalWidth:80,totalHeight:24}));
});
