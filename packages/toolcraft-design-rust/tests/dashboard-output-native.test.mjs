import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/components/output-pane.js";
import {ScreenBuffer as OriginalBuffer} from "../../toolcraft-design/dist/dashboard/buffer.js";

test("dashboard output preserves plain, styled and Unicode visual lines",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/output-pane");
  assert.deepEqual(Object.keys(native),Object.keys(original));
  for(const width of [-1,0,1,3,4,8,15,40])for(const preformatted of [false,true])for(const kind of ["info","success","error","tool","status"]){
    const items=["", "alpha  beta\n\nlongwordlongword\n", "\t hello\rworld", "项目 👩‍💻 é 🚀", "\x1b[31mred\x1b[0m normal", "before\b!\rreplace", "\x1b[1;4mstyled\ttext\x1b[0m"].map(text=>({kind,text,ts:0}));
    assert.deepEqual(native.computeVisualLines(items,width,preformatted),original.computeVisualLines(items,width,preformatted));
  }
});

test("dashboard output preserves conversation folding, details, elapsed labels and scroll",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/output-pane");
  const {ScreenBuffer}=await import("toolcraft-design-rust/dashboard/buffer");
  const items=[{role:"user",kind:"info",text:"\nBuild a table\n",ts:0},
    {role:"reasoning",kind:"info",text:"Hidden thoughts",ts:0},
    ...Array.from({length:6},(_,i)=>({role:"action",kind:"success",text:`Completed ${i}`,ts:i})),
    {role:"action",kind:"tool",text:"Working",detail:"Details\nMore",ts:0},
    {role:"plan",kind:"status",text:"Plan",detail:"One\nTwo",ts:0},
    {role:"agent",kind:"info",text:"# Result\n\n**Ready**\n\n- one\n- two\n",ts:0}];
  for(const width of [0,3,12,40])for(const height of [0,1,5,20])for(const scroll of [0,3,100])for(const options of [{},{conversation:true,now:1500},{conversation:true,details:true,now:3600000}]){
    const a=new ScreenBuffer(width+2,height+1),b=new OriginalBuffer(width+2,height+1),rect={x:1,y:1,width,height};
    assert.equal(native.renderOutputPane(a,rect,items,scroll,options),original.renderOutputPane(b,rect,items,scroll,options));
    assert.deepEqual({...a},{...b});
  }
});

test("dashboard output keeps live property reads, receivers and thrown identity",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/output-pane");
  function capture(api){
    const trace=[];
    const wrap=(tag,value)=>new Proxy(value,{get(target,key,receiver){trace.push([tag,key]);return Reflect.get(target,key,receiver);}});
    const rect=wrap("rect",{x:1,y:2,width:18,height:3}),options=wrap("options",{conversation:true,details:true,now:3000});
    const items=[wrap("item",{role:"action",kind:"tool",text:"hello",detail:"more",ts:0})];
    const buffer={get clearRect(){trace.push("clear getter");return function(value){assert.equal(this,buffer);trace.push(["clear",{...value}]);};},get putInRect(){trace.push("put getter");return function(rect,...args){assert.equal(this,buffer);trace.push([{...rect},...args]);};}};
    const result=api.renderOutputPane(buffer,rect,items,0,options);
    const failure={};assert.throws(()=>api.renderOutputPane({clearRect(){throw failure;}},rect,items),error=>error===failure);
    return {trace,result};
  }
  assert.deepEqual(capture(native),capture(original));
});

test("dashboard output refreshes cached markdown after streaming edits",async()=>{
  const native=await import("toolcraft-design-rust/dashboard/components/output-pane");
  const item={role:"agent",kind:"info",text:"",ts:0};
  for(const text of ["# Heading\n\nText\n", "---\nbroken: [\n---\ntext", "Footnote[^x]\n\n[^x]: note", "first\n\nsecond\n\nthird"]){
    item.text=text;
    for(const height of [1,3,15]){
      const capture=api=>{const calls=[];return [api.renderOutputPane({clearRect(){},putInRect(...args){calls.push(args);}},{x:0,y:0,width:20,height},[item],0,{conversation:true}),calls];};
      assert.deepEqual(capture(native),capture(original));
    }
  }
});
