import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import { renderCatalog } from "../../toolcraft-design/dist/components/catalog.js";
import { renderResourceBrowser } from "../../toolcraft-design/dist/components/resource-browser.js";
import { withOutputFormat } from "../../toolcraft-design/dist/internal/output-format.js";

const styles=["header","muted","accent","success","warning","error","info"];
const theme=Object.fromEntries(styles.map(name=>[name,value=>`[${name}:${value}]`]));
const outcome=callback=>{try{return {value:callback()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};

test("native collection renderers preserve all formats and optional fields", async () => {
  assert.equal(typeof native.renderCatalog,"function");
  assert.equal(typeof native.renderResourceBrowser,"function");
  const catalog=await import("toolcraft-design-rust/components/catalog");
  const browser=await import("toolcraft-design-rust/components/resource-browser");
  assert.equal(catalog.renderCatalog,native.renderCatalog);
  assert.equal(browser.renderResourceBrowser,native.renderResourceBrowser);
  assert.deepEqual(Object.keys(catalog),["renderCatalog"]);
  assert.deepEqual(Object.keys(browser),["renderResourceBrowser"]);
  for(const format of ["terminal","markdown","json"]) for(const optional of [undefined,"","\x1b[31mcolored\x1b[0m","wide 界\ud800\nnext"]) {
    const common={theme,title:"Inventory",subtitle:optional};
    const catalogOptions={...common,metrics:[{label:"items",value:3,tone:"success"},{label:"extra",value:optional ?? 0}],groups:[
      {title:"Routes",description:optional,items:[{label:"GET",value:"/`id`",tone:"accent",detail:optional},{label:"POST",value:"/items"}]},
      {title:"Empty",items:[]}
    ]};
    const browserOptions={...common,footer:optional,groups:[
      {title:"Project",description:optional,items:[{label:"task",meta:optional === undefined ? undefined : [optional,"local"],preview:optional,badge:optional},{label:"empty",meta:[],preview:""}]},
      {title:"Empty",emptyHint:optional,items:[]}
    ]};
    for(const [name,reference,options] of [["renderCatalog",renderCatalog,catalogOptions],["renderResourceBrowser",renderResourceBrowser,browserOptions]]) {
      assert.deepEqual(outcome(()=>native.withOutputFormat(format,()=>native[name](options))),outcome(()=>withOutputFormat(format,()=>reference(options))),`${name}/${format}/${optional}`);
    }
  }
});

test("collection getters and theme calls retain their order and receivers", () => {
  function run(render,format,name) {
    const trace=[];
    const observe=(name,value)=>new Proxy(value,{get(target,key,receiver){trace.push(`${name}.${String(key)}`);return Reflect.get(target,key,receiver);}});
    const themed=observe("theme",Object.fromEntries(styles.map(style=>[style,function(value){trace.push(`${style}:${this===themed}`);return value; }])));
    const item=observe("item",name === "renderCatalog" ? {label:"A",value:"/a",detail:"detail",tone:"accent"} : {label:"A",meta:["local"],preview:"preview",badge:"badge"});
    const group=observe("group",{title:"Group",description:"Description",items:[item]});
    const options=observe("options",{theme:themed,title:"Title",subtitle:"Subtitle",metrics:[observe("metric",{label:"items",value:1,tone:"info"})],groups:[group],footer:"Footer"});
    return [render(options,format),trace];
  }
  for(const format of ["terminal","markdown","json"]) for(const [name,reference] of [["renderCatalog",renderCatalog],["renderResourceBrowser",renderResourceBrowser]]) {
    assert.deepEqual(run(options=>native.withOutputFormat(format,()=>native[name](options)),format,name),run(options=>withOutputFormat(format,()=>reference(options)),format,name),`${name}/${format}`);
  }
});

test("collection JSON retains spread properties, changing values, species and toJSON", () => {
  function run(render,format,name) {
    const trace=[];
    class Items extends Array {static get [Symbol.species](){trace.push("species");return Array;}}
    const items=new Items(2);items[1]={label:"A",value:"/a",extra:"preserved",meta:["local"],toJSON(){trace.push("itemJSON");return {custom:this.label};}};
    let reads=0;
    const metric={get value(){trace.push("value");return ++reads === 2 ? "text" : 3;},label:"count",extra:4};
    const options={theme,title:"Title",metrics:[metric],groups:[{title:"Group",items}]};
    return [outcome(()=>format(()=>render(options))),trace,name];
  }
  for(const [name,reference] of [["renderCatalog",renderCatalog],["renderResourceBrowser",renderResourceBrowser]]) {
    assert.deepEqual(run(native[name],fn=>native.withOutputFormat("json",fn),name),run(reference,fn=>withOutputFormat("json",fn),name));
  }
});

test("collection renderers preserve thrown values and nested theme calls", () => {
  const thrown={marker:true};
  for(const name of ["renderCatalog","renderResourceBrowser"]) {
    assert.throws(()=>native[name]({theme:{header(){throw thrown;}},title:"Title",groups:[]}),error=>error===thrown);
    const nested={...theme,header(value){return value+native[name]({theme,title:"Inner",groups:[]});}};
    const options={theme:nested,title:"Outer",groups:[]};
    const reference=name === "renderCatalog" ? renderCatalog : renderResourceBrowser;
    assert.equal(native[name](options),reference(options));
  }
});

test("group publication captures push before formatting the joined block", () => {
  function run(render,format) {
    const trace=[],push=Object.getOwnPropertyDescriptor(Array.prototype,"push"),join=Array.prototype.join;
    Object.defineProperty(Array.prototype,"push",{configurable:true,get(){push.value.call(trace,"push");return push.value;}});
    Array.prototype.join=function(...args){if(typeof this[0] === "string" && this[0].startsWith("## Group")) push.value.call(trace,"group join");return join.apply(this,args);};
    try {return [format(()=>render({theme,title:"Title",groups:[{title:"Group",items:[]}]})),trace];}
    finally {Object.defineProperty(Array.prototype,"push",push);Array.prototype.join=join;}
  }
  for(const [name,reference] of [["renderCatalog",renderCatalog],["renderResourceBrowser",renderResourceBrowser]]) {
    assert.deepEqual(run(native[name],fn=>native.withOutputFormat("markdown",fn)),run(reference,fn=>withOutputFormat("markdown",fn)),name);
  }
});
