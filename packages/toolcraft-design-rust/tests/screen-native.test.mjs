import assert from "node:assert/strict";
import {test} from "node:test";
import {Screen as OriginalScreen} from "../../toolcraft-design/dist/screen/screen.js";
import {packStyle} from "../../toolcraft-design/dist/screen/style.js";
const load=async()=> (await import("toolcraft-design-rust/screen/screen")).Screen;

test("Screen preserves frame diffs, wide-cell invalidation and visible buffer state",async()=>{
  const Screen=await load();assert.equal(Screen,(await import("../dist/index.js")).Screen);
  for(const colors of [true,false]){
    const actual=new Screen({cols:12,rows:4},{colors}),expected=new OriginalScreen({cols:12,rows:4},{colors});
    const steps=[
      ["text",2,0,"a🙂中é",packStyle({bold:true,fg:2})],["put",0,1,"line",{dim:true,fg:"gray",bg:"#123"}],
      ["cell",11,2,"界",3],["flush"],
      ["text",2,0,"a🙂中é",packStyle({bold:true,fg:2})],["put",0,1,"line",{dim:true,fg:"gray",bg:"#123"}],
      ["cell",11,2,"界",3],["flush"],
      ["cell",3,0,"x"],["cell",4,0,"y"],["flush"],["flush"],
      ["text",-2,0,"abcdef"],["text",0,1,"\t\n\ŕ🇺🇸👩‍💻"],["flush"],
      ["clearRect",{x:-1,y:0,width:4,height:2},{underline:true,fg:"red"}],["flush"],
      ["resize",{cols:5.9,rows:2.1}],["text",0,0,"new",packStyle({inverse:true})],["flush"],
      ["resize",{cols:NaN,rows:Infinity}],["flush"]
    ];
    for(const [method,...args] of steps){assert.equal(actual[method](...args),expected[method](...args),method);assert.deepEqual({...actual},{...expected},method);assert.equal(actual.width,expected.width);assert.equal(actual.height,expected.height);}
  }
});

test("Screen retains subclass dispatch, method descriptors and argument defaults",async()=>{
  const Screen=await load();
  assert.deepEqual(Object.getOwnPropertyNames(Screen.prototype),Object.getOwnPropertyNames(OriginalScreen.prototype));
  for(const name of Object.getOwnPropertyNames(OriginalScreen.prototype)){
    const a=Object.getOwnPropertyDescriptor(Screen.prototype,name),b=Object.getOwnPropertyDescriptor(OriginalScreen.prototype,name);
    assert.equal(a.enumerable,b.enumerable);assert.equal(a.configurable,b.configurable);assert.equal(a.writable,b.writable);
    if(typeof a.value==="function"){assert.equal(a.value.name,b.value.name);assert.equal(a.value.length,b.value.length);}
  }
  function run(Base){const events=[];class Derived extends Base{resize(size){events.push(["resize",size]);super.resize(size);}cell(...args){events.push(["cell",...args]);super.cell(...args);}text(...args){events.push(["text",...args]);super.text(...args);}}
    const screen=new Derived({cols:4,rows:2},{colors:false});screen.put(0,0,"a🙂");screen.clearRect({x:0,y:1,width:2,height:1});return [screen.flush(),events];}
  assert.deepEqual(run(Screen),run(OriginalScreen));
  assert.deepEqual({...new Screen()},{...new OriginalScreen()});
});

test("Screen preserves property/coercion order, fractional coordinates and thrown identity",async()=>{
  const Screen=await load();
  function run(Base){const events=[];const screen=new Base({get cols(){events.push("cols");return 5;},get rows(){events.push("rows");return 2;}},{colors:true});
    const style={get bold(){events.push("bold");return 1;},get dim(){events.push("dim");return 0;},get underline(){events.push("underline");return true;},get inverse(){events.push("inverse");return false;},get fg(){events.push("fg");return "black";},get bg(){events.push("bg");return "#123";}};
    screen.put(0,0,"xy",style);screen.cell(1.5,0,"f");screen.clearRect({x:1.5,y:1,width:2,height:1},0);
    const packed={valueOf(){events.push("style number");return 257;}};screen.cell(4,0,"Z",packed);
    return [screen.flush(),events];}
  assert.deepEqual(run(Screen),run(OriginalScreen));
  for(const failure of [{},null,undefined,"stop"]){const screen=new Screen({cols:2,rows:1});let caught=false;try{screen.put(0,0,"x",{get fg(){throw failure;}});}catch(error){caught=true;assert.equal(error,failure);}assert.equal(caught,true);screen.cell(0,0,"a");assert.equal(screen.flush(),"\u001b[1;1Ha");}
});

test("Screen reads mutable frame cells in the same order",async()=>{
  const Screen=await load();
  function run(Base){
    const screen=new Base({cols:4,rows:1},{colors:true}),events=[];
    function watched(ch,width,style,label){return new Proxy({ch,width,style,fg:0,bg:0},{get(target,key){events.push(`${label}.${String(key)}`);return target[key];}});}
    screen.front=[watched("界",2,0,"f0"),watched("",1,0,"f1"),watched("a",1,0,"f2"),watched(" ",1,0,"f3")];
    screen.back=[watched("x",1,257,"b0"),watched(" ",1,257,"b1"),watched("a",1,0,"b2"),watched("z",1,8,"b3")];
    const output=screen.flush();return [output,events];
  }
  assert.deepEqual(run(Screen),run(OriginalScreen));
});

test("Screen honors truthy subclass bounds and preserves index/style coercion order",async()=>{
  const Screen=await load();
  function run(Base){
    const events=[];
    class Derived extends Base{
      inBounds(){events.push("bounds");return 1;}
      index(){events.push("index");return {[Symbol.toPrimitive](){events.push("key");return 0;}};}
    }
    const screen=new Derived({cols:2,rows:1},{colors:false});
    screen.cell(0,0,"A",{valueOf(){events.push("style");return 0;}});
    return [screen.flush(),events];
  }
  assert.deepEqual(run(Screen),run(OriginalScreen));
});
