import assert from "node:assert/strict";
import {it,beforeEach,afterEach,vi} from "vitest";
import * as nativeDefinitions from "../dist/index.js";
import * as referenceDefinitions from "../../toolcraft/dist/index.js";
import * as nativeDesign from "toolcraft-design-rust";
import * as referenceDesign from "../../toolcraft-design/dist/index.js";
import {original} from "./cli-generated-help-reference.mjs";
import * as api from "../dist/cli-generated-help.js";
beforeEach(()=>{nativeDesign.configureTheme({brand:"blue",label:"Toolcraft"});referenceDesign.configureTheme({brand:"blue",label:"Toolcraft"});});
afterEach(()=>vi.restoreAllMocks());
function makeRoot(definitions){
  const S=definitions.S;
  const run=definitions.defineCommand({name:"run",aliases:["r"],description:"Run a job. Additional details.",params:S.Object({name:S.String(),count:S.Number({default:3}),mode:S.Enum(["fast","slow"]),labels:S.Optional(S.Record(S.String()))}),positional:["name"],secrets:{token:{env:"HELP_TEST_TOKEN",description:"Service token"}},requires:{auth:true},examples:[{title:"Run quickly",params:{name:"example",mode:"fast",enabled:true,quiet:false}}],handler:()=>undefined});
  const hidden=definitions.defineCommand({name:"hidden",hidden:true,params:S.Object({value:S.Optional(S.String())}),handler:()=>undefined});
  const sdk=definitions.defineCommand({name:"private",scope:["sdk"],params:S.Object({}),handler:()=>undefined});
  const nested=definitions.defineGroup({name:"jobs",description:"Jobs",children:[run,hidden,sdk],default:hidden});
  return definitions.defineGroup({name:"app",description:"Workspace commands.",children:[nested,run,hidden,sdk],default:hidden});
}
async function render(module,definitions,argv,options={}){
  const output=[],invocation={write:function(chunk){assert.equal(this,undefined);output.push(chunk);},signal:new AbortController().signal,async flush(){},exitCode:0};
  try{await module.renderGeneratedHelp(makeRoot(definitions),["node","/app/bin.mjs",...argv],options,invocation);return {output:output.join("")};}catch(error){return {error:{name:error.name,message:error.message}};}
}
it("Native generated help renders groups and leaves in rich, Markdown and JSON modes",async()=>{
  for(const output of ["rich","md","json"])for(const path of [[],["run"],["jobs"],["jobs","r"]]){
    const actual=await render(api,nativeDefinitions,[...path,"--help","--output",output],{version:"1.2.3",presets:true});
    assert.deepEqual(actual,await render(original,referenceDefinitions,[...path,"--help","--output",output],{version:"1.2.3",presets:true}));assert.equal(actual.error,undefined);assert.ok(actual.output.length>0);
  }
});
it("Native generated help handles aliases, hidden defaults, scope and unknown-command suggestions",async()=>{
  for(const argv of [["r"],["hidden"],["private"],["rnu"],["jobs","rnu"],["help","run"],["run","ignored"]])assert.deepEqual(await render(api,nativeDefinitions,argv),await render(original,referenceDefinitions,argv));
});
it("Native generated help preserves root naming, casing and control selection",async()=>{
  for(const options of [{rootUsageName:"tool",rootDisplayName:"",casing:"snake"},{controls:{help:"extended",yes:false,output:false,verbose:false},version:"1"},{controls:{output:{formats:{compact:()=>""}}},presets:true}])for(const argv of [[],["run"],["--output=json"]])assert.deepEqual(await render(api,nativeDefinitions,argv,options),await render(original,referenceDefinitions,argv,options));
});
it("Native generated help preserves width-dependent optional parameter collapsing",async()=>{
  for(const width of [24,80,160]){
    const saved=Object.getOwnPropertyDescriptor(process.stdout,"columns");Object.defineProperty(process.stdout,"columns",{configurable:true,value:width});
    try{const actual=await render(api,nativeDefinitions,[],{controls:{help:"extended"}});assert.deepEqual(actual,await render(original,referenceDefinitions,[],{controls:{help:"extended"}}));}finally{if(saved)Object.defineProperty(process.stdout,"columns",saved);else Reflect.deleteProperty(process.stdout,"columns");}
  }
});

it("Native generated help deduplicates schema-global fields and preserves examples and secrets",async()=>{
  async function inspect(module,definitions,output){
    const S=definitions.S,global=S.Optional(S.String({global:true,short:"p",description:"Project directory"}));
    const first=definitions.defineCommand({name:"first",params:S.Object({project:global,verbose:S.Optional(S.Boolean({global:true,short:"v"})),value:S.Optional(S.String()),items:S.Array(S.String())}),positional:["items"],secrets:{a:{env:"HELP_A",optional:true},b:{env:"HELP_B"}},examples:[{title:"Mixed values",params:{text:"with space",blank:"",arr:[1,2],object:{value:1},enabled:true,disabled:false}}],handler(){}});
    const second=definitions.defineCommand({name:"second",params:S.Object({project:global}),handler(){}});
    const root=definitions.defineGroup({name:"app",children:[first,second]}),chunks=[];
    await module.renderGeneratedHelp(root,["node","app",...(output==="leaf"?["first"]:[]),"--output",output==="leaf"?"rich":output],{controls:{verbose:true}}, {write:chunk=>chunks.push(chunk)});
    return chunks.join("");
  }
  for(const output of ["rich","json","leaf"])assert.equal(await inspect(api,nativeDefinitions,output),await inspect(original,referenceDefinitions,output));
});

it("Native generated help preserves getter order and arbitrary writer failures",async()=>{
  async function inspect(module,definitions,output){
    const trace=[],track=(value,name)=>new Proxy(value,{get(target,key,receiver){trace.push([name,String(key)]);return Reflect.get(target,key,receiver);}});
    const root=makeRoot(definitions),command=root.children[1];root.children=[track(root.children[0],"group"),track(command,"command")];root.default=undefined;
    const options=track({rootUsageName:"app",controls:{help:"extended",output:true},version:"1"},"options"),chunks=[];
    await module.renderGeneratedHelp(track(root,"root"),["node","app",...output],options,{get write(){trace.push("write getter");return function(chunk){trace.push(["write",this===undefined]);chunks.push(chunk);};}});
    return {trace,output:chunks.join("")};
  }
  for(const argv of [[],["run"],["--output=json"],["run","--output=json"]])assert.deepEqual(await inspect(api,nativeDefinitions,argv),await inspect(original,referenceDefinitions,argv));
  for(const failure of [undefined,null,false,17,Symbol("failure"),new Error("writer")])for(const module of [api,original]){
    const definitions=module===api?nativeDefinitions:referenceDefinitions;
    await assert.rejects(module.renderGeneratedHelp(makeRoot(definitions),["node","app"],{},{write(){throw failure;}}),error=>error===failure);
  }
});

it("Native generated help preserves fallback program names and output precedence",async()=>{
  for(const argv of [[],["node"],["node",""],["node","/"],["node",undefined],["node","app","--output","invalid","--output=markdown"],["node","app","--output=json","--output=rich"]]){
    async function inspect(module,definitions){const chunks=[];await module.renderGeneratedHelp(makeRoot(definitions),argv,{},{write:chunk=>chunks.push(chunk)});return chunks.join("");}
    assert.equal(await inspect(api,nativeDefinitions),await inspect(original,referenceDefinitions));
  }
});

it("Native generated help closes argv iterators when target resolution fails",()=>{
  function inspect(module,definitions,failure){
    const trace=[],tokens={*[Symbol.iterator](){try{yield "jobs";yield {startsWith(){throw failure;}};}finally{trace.push("closed");}}};
    assert.throws(()=>module.resolveHelpTarget(makeRoot(definitions),{slice(){return tokens;}},"cli","app"),error=>error===failure);
    return trace;
  }
  for(const failure of [undefined,null,17,Symbol("failure")])assert.deepEqual(inspect(api,nativeDefinitions,failure),inspect(original,referenceDefinitions,failure));
});

it("Native generated help renders styled TTY rows and collapses large optional signatures",async()=>{
  const saved=Object.getOwnPropertyDescriptor(process.stdout,"isTTY");Object.defineProperty(process.stdout,"isTTY",{configurable:true,value:true});
  try{
    for(const argv of [[],["run"]])assert.deepEqual(await render(api,nativeDefinitions,argv,{controls:{help:"extended"}}),await render(original,referenceDefinitions,argv,{controls:{help:"extended"}}));
    function inspect(module,definitions){const S=definitions.S,shape=Object.fromEntries(Array.from({length:10},(_,i)=>["option"+i,S.Optional(S.String())]));shape.required=S.String();const command=definitions.defineCommand({name:"large",params:S.Object(shape),handler(){}});return module.formatCommandRows(definitions.defineGroup({name:"app",children:[command]}),"cli","kebab",new Set(),"concise");}
    const actual=inspect(api,nativeDefinitions);assert.deepEqual(actual,inspect(original,referenceDefinitions));assert.ok(actual[0].name.includes("+10 options"));assert.ok(actual[0].name.includes("--required"));
  }finally{if(saved)Object.defineProperty(process.stdout,"isTTY",saved);else Reflect.deleteProperty(process.stdout,"isTTY");}
});
