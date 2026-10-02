import assert from "node:assert/strict";
import test from "node:test";
import {createCLICommandTreeSnapshot as original} from "../../toolcraft/dist/cli.js";
import {defineCommand,defineGroup,S} from "../dist/index.js";
const native=async()=>(await import("../dist/cli-snapshot.js")).createCLICommandTreeSnapshot;
async function outcome(operation){try{return {value:await operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}
const command=(name,params,extra={})=>defineCommand({name,params,handler:async()=>undefined,...extra});

test("CLI snapshots preserve resolved fields, dynamic options, defaults and node visibility",async()=>{
  const snapshot=await native();
  const deploy=command("deploy",S.Object({environment:S.String(),enabled:S.Boolean({default:true}),mode:S.Enum(["compact","full"],{nullable:true}),labels:S.Record(S.String()),jobs:S.Array(S.Object({filePath:S.String(),retries:S.Number({default:2})}))}),{aliases:["ship"],description:"Deploy",positional:["environment"]});
  const root=defineGroup({name:"app",children:[deploy,command("hidden",S.Object({}),{hidden:true}),command("mcpOnly",S.Object({}),{scope:["mcp"]}),defineGroup({name:"empty",children:[],scope:["cli"]})],default:deploy});
  for(const casing of ["kebab","snake"])for(const options of [{},{presets:true,version:"1",controls:{yes:true,output:{formats:{compact:()=>""}},debug:true,logLevel:true,verbose:true}}])assert.deepEqual(await snapshot(root,{...options,casing}),await original(root,{...options,casing}));
  assert.equal(snapshot.name,original.name);assert.equal(snapshot.length,original.length);
});

test("CLI snapshot roots retain program-name inference, approval wiring and errors",async()=>{
  const snapshot=await native();
  const roots=[defineGroup({name:"one",children:[command("run",S.Object({path:S.String()}))]})];
  for(const argv of [undefined,[],["node"],["node","/path/to/example.mjs"],["node","."],["node",""],["node",17]])assert.deepEqual(await snapshot(roots,{argv}),await original(roots,{argv}));
  for(const options of [{approvals:true},{controls:{output:{formats:{json:()=>""}}}}])assert.deepEqual(await outcome(()=>snapshot(roots,options)),await outcome(()=>original(roots,options)));
  function run(api){const trace=[];const root=roots[0];const humanInLoop={mergeApprovalsGroup(value){trace.push([this===humanInLoop,value===root]);return value;}};return api(root,{approvals:true,humanInLoop}).then(value=>({trace,value}));}
  assert.deepEqual(await run(snapshot),await run(original));
});

test("CLI snapshot getters retain evaluation order and arbitrary thrown identity",async()=>{
  const snapshot=await native();
  async function run(api){
    const trace=[];
    const tracked=(name,value)=>new Proxy(value,{get(target,key){trace.push([name,key]);return target[key];}});
    const child=tracked("command",command("run",S.Object({value:S.String({description:"Value"})}),{description:"Run"}));
    const root=tracked("root",{kind:"group",name:"root",aliases:[],children:[child],default:child,description:"Root"});
    const options=tracked("options",{casing:"snake",version:"1",controls:{yes:true}});
    return {value:await api(root,options),trace};
  }
  assert.deepEqual(await run(snapshot),await run(original));
  for(const api of [original,snapshot])for(const failure of [undefined,null,false,17,Symbol("failure")])await assert.rejects(api({get children(){throw failure;}}),error=>error===failure);
});

test("CLI snapshots preserve conflicting flags and dynamic-default serialization failures",async()=>{
  const snapshot=await native();
  for(const params of [S.Object({yes:S.Boolean()}),S.Object({one:S.String({cliAliases:["same"]}),two:S.String({cliAliases:["same"]})}),{kind:"object",shape:{value:{kind:"string",default:1n}}},{kind:"object",shape:{values:{kind:"record",value:{kind:"string"},default:{toJSON(){throw new Error("dynamic default");}}}}}]){
    const root={kind:"group",name:"app",aliases:[],children:[{...command("run",S.Object({})),params}]};
    assert.deepEqual(await outcome(()=>snapshot(root,{controls:{yes:true}})),await outcome(()=>original(root,{controls:{yes:true}})));
  }
});

test("CLI snapshot visibility retains repeated reads, short circuits and live Boolean calls",async()=>{
  const snapshot=await native();
  async function run(api,defaultScope,groupScope,visibleChildren){
    const trace=[];
    const track=(name,value)=>new Proxy(value,{get(target,key){trace.push([name,key]);return target[key];}});
    const scope=value=>({includes(argument){trace.push(["includes",argument,value]);return value;}});
    const child=track("child",{kind:"group",name:"nested",aliases:[],children:visibleChildren?[command("run",S.Object({}))]:[],default:{scope:scope(defaultScope)},scope:groupScope===undefined?undefined:scope(groupScope)});
    const root={kind:"group",name:"root",aliases:[],children:[child]};
    return {value:await api(root),trace};
  }
  for(const defaultScope of [false,true,0,"allowed"])for(const groupScope of [undefined,false,true])for(const visibleChildren of [false,true])assert.deepEqual(await run(snapshot,defaultScope,groupScope,visibleChildren),await run(original,defaultScope,groupScope,visibleChildren));
  const saved=globalThis.Boolean;
  async function booleanOrder(api){
    const trace=[];
    const root={kind:"group",name:"root",aliases:[],children:[{kind:"group",name:"child",aliases:[],children:[],get default(){trace.push("default");globalThis.Boolean=()=>{trace.push("replacement");return false;};return undefined;}}]};
    globalThis.Boolean=value=>{trace.push("original");return saved(value);};
    try{return {value:await api(root),trace};}finally{globalThis.Boolean=saved;}
  }
  assert.deepEqual(await booleanOrder(snapshot),await booleanOrder(original));
});

test("CLI snapshots retain callback metadata, method receivers and default object identity",async()=>{
  const snapshot=await native();
  async function run(api){
    const trace=[];
    const item=command("run",S.Object({mode:S.Enum(["a","b"])}));
    const children=[item];
    children.filter=function(callback){trace.push(["filter",this===children,callback.name,callback.length,arguments.length]);const selected=Array.prototype.filter.call(this,callback);selected.map=function(callback){trace.push(["map",this===selected,callback.name,callback.length,arguments.length]);return Array.prototype.map.call(this,callback);};return selected;};
    return {value:await api({kind:"group",name:"root",aliases:[],children}),trace};
  }
  assert.deepEqual(await run(snapshot),await run(original));
  const value={owned:true};
  for(const api of [original,snapshot]){
    const root={kind:"group",name:"root",aliases:[],children:[{...command("run",S.Object({})),params:{kind:"object",shape:{value:{kind:"json",default:value}}}}]};
    const result=await api(root);
    assert.equal(result.root.children[0].options[0].default,value);
    assert.deepEqual(Reflect.ownKeys(result.root.children[0].options[0]),["name","flags","type","required","hidden","default"]);
  }
});

test("CLI snapshots close alias iterators and support reentrant construction",async()=>{
  const snapshot=await native();
  async function run(api){
    const trace=[];let nested;
    const root={kind:"group",name:"root",children:[],get aliases(){nested=api({kind:"group",name:"nested",children:[],aliases:[]});return {[Symbol.iterator]:function*(){try{yield "first";throw "alias failure";}finally{trace.push("closed");}}};}};
    const result=await outcome(()=>api(root));
    return {result,trace,nested:await nested};
  }
  assert.deepEqual(await run(snapshot),await run(original));
});

test("CLI snapshots preserve malformed root and option diagnostics",async()=>{
  const snapshot=await native();
  const group={kind:"group",name:"root",aliases:[],children:[]};
  const node=command("run",S.Object({}));
  for(const root of [null,{}, {...group,aliases:null},{...group,children:null},{...group,children:{filter:0}},{...group,children:[{...node,aliases:17}]},{...group,children:[{...node,scope:null}]},{...group,children:[{...group,default:{scope:{includes:0}}}]}]){
    assert.deepEqual(await outcome(()=>snapshot(root)),await outcome(()=>original(root)));
  }
  for(const options of [null,{argv:17},{argv:{[Symbol.iterator]:0}},{controls:{output:{formats:{json:()=>""}}}}])assert.deepEqual(await outcome(()=>snapshot(group,options)),await outcome(()=>original(group,options)));
});
