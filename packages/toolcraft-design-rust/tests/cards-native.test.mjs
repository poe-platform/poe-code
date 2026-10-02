import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import { renderDetailCard } from "../../toolcraft-design/dist/components/detail-card.js";
import { renderInspectorCard } from "../../toolcraft-design/dist/components/inspector-card.js";
import { widths as referenceWidths } from "../../toolcraft-design/dist/tokens/widths.js";

const theme={header:value=>`<${value}>`,muted:value=>`[${value}]`};
const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};

test("native cards preserve wrapping, badges, sections and preview clipping",async()=>{
  assert.equal(typeof native.renderDetailCard,"function");
  assert.equal(typeof native.renderInspectorCard,"function");
  const detail=await import("toolcraft-design-rust/components/detail-card");
  const inspector=await import("toolcraft-design-rust/components/inspector-card");
  assert.deepEqual(Object.keys(detail),["renderDetailCard"]);
  assert.deepEqual(Object.keys(inspector),["renderInspectorCard"]);
  assert.equal(detail.renderDetailCard,native.renderDetailCard);
  assert.equal(inspector.renderInspectorCard,native.renderInspectorCard);
  for(const width of [undefined,0,8,29.5,60,Infinity,NaN]) for(const text of ["","one two three\n\nnext line","e\u0301 界 👩‍💻\ud800","\x1b[31mstyled long text\x1b[39m"]) {
    const common={theme,title:"Record",subtitle:text,badges:["OFFICIAL","camelCase",""],width};
    const options={...common,prose:[{value:text},{title:"Description",value:text}],sections:[{title:"Empty",rows:[]},{title:"Fields",rows:[{label:"A",value:text},{label:"界",value:text}]}]};
    assert.deepEqual(outcome(()=>native.renderDetailCard(options)),outcome(()=>renderDetailCard(options)));
    for(const maxPreviewLines of [undefined,-1,0,1.5,3,NaN]) {
      const inspect={...common,preview:`\n\r\n ${text}  \r\nsecond\nthird\n`,previewTitle:"",maxPreviewLines,sections:[{title:"Empty",fields:[]},{fields:[{label:"Text",value:text}]}]};
      assert.deepEqual(outcome(()=>native.renderInspectorCard(inspect)),outcome(()=>renderInspectorCard(inspect)));
    }
  }
});

test("card property reads and theme receivers match the reference",()=>{
  function run(fn,inspector) {
    const trace=[];
    const observe=(name,value)=>new Proxy(value,{get(target,key,receiver){trace.push(`${name}.${String(key)}`);return Reflect.get(target,key,receiver);}});
    const style=observe("theme",{header(value){trace.push(`header:${this===style}`);return value;},muted(value){trace.push(`muted:${this===style}`);return value;}});
    const row=observe("row",{label:"Field",value:"a long value to wrap across lines"});
    const section=observe("section",{title:"Details",[inspector?"fields":"rows"]:[row]});
    const options=observe("options",{theme:style,title:"Title",subtitle:"Sub",badges:["ABC"],preview:"\n first\r\nsecond\nthird",maxPreviewLines:1,prose:[observe("prose",{title:"Prose",value:"Some text"})],sections:[section],width:24});
    return [fn(options),trace];
  }
  assert.deepEqual(run(native.renderDetailCard,false),run(renderDetailCard,false));
  assert.deepEqual(run(native.renderInspectorCard,true),run(renderInspectorCard,true));
});

test("cards preserve species, live width tokens, nested calls and arbitrary throws",()=>{
  function run(fn,inspect) {
    const trace=[];
    class Rows extends Array {static get [Symbol.species](){trace.push("species");return Array;}}
    const rows=new Rows(2);rows[1]={label:"Label",value:"one two three"};
    const sections=new Rows({title:"Details",[inspect?"fields":"rows"]:rows});
    return [outcome(()=>fn({theme,title:"Title",sections,preview:"a\nb"})),trace];
  }
  assert.deepEqual(run(native.renderDetailCard,false),run(renderDetailCard,false));
  assert.deepEqual(run(native.renderInspectorCard,true),run(renderInspectorCard,true));
  const original=native.widths.maxLine,originalReference=referenceWidths.maxLine;
  try {
    native.widths.maxLine=referenceWidths.maxLine=7;
    const options={theme,title:"Title",prose:[{value:"long words and text"}]};
    assert.equal(native.renderDetailCard(options),renderDetailCard(options));
  } finally {native.widths.maxLine=original;referenceWidths.maxLine=originalReference;}
  const thrown={};
  for(const fn of [native.renderDetailCard,native.renderInspectorCard]) {
    assert.throws(()=>fn({theme:{header(){throw thrown;}},title:"X"}),error=>error===thrown);
    const options={theme:{...theme,header(value){return value+fn({theme,title:"Nested"});}},title:"Outer"};
    const reference=fn===native.renderDetailCard?renderDetailCard:renderInspectorCard;
    assert.equal(fn(options),reference(options));
  }
});

test("card prose iterators close on failure and push is captured before rendering",()=>{
  const thrown={};
  function run(fn) {
    const trace=[];
    const prose={[Symbol.iterator](){let count=0;return {next(){return count++?{done:true}:{done:false,value:{get title(){throw thrown;}}};},return(){trace.push("closed");return {};}};}};
    assert.throws(()=>fn({theme,title:"X",prose}),error=>error===thrown);
    return trace;
  }
  assert.deepEqual(run(native.renderDetailCard),run(renderDetailCard));
  function ordering(fn) {
    const trace=[],push=Object.getOwnPropertyDescriptor(Array.prototype,"push");
    Object.defineProperty(Array.prototype,"push",{configurable:true,get(){push.value.call(trace,"push");return push.value;}});
    const options={theme,title:"X",prose:[{get title(){push.value.call(trace,"title");return "Prose";},value:"text"}],sections:[{get title(){push.value.call(trace,"section");return "Fields";},rows:[{label:"L",value:"V"}]}]};
    try {return [fn(options),trace];} finally {Object.defineProperty(Array.prototype,"push",push);}
  }
  assert.deepEqual(ordering(native.renderDetailCard),ordering(renderDetailCard));
});
