import assert from "node:assert/strict";
import {beforeEach,it,vi} from "vitest";
import {Volume,createFsFromVolume} from "memfs";
import {loadParamsReference} from "./cli-params-reference.mjs";
import * as nativeCommands from "../dist/cli-commands.js";
import * as nativePreparation from "../dist/cli-prepare.js";
import {original as referenceCommands} from "./cli-commands-reference.mjs";
import {original as referencePreparation} from "./cli-prepare-reference.mjs";
const capabilities=vi.hoisted(()=>({readFile:vi.fn(),promptForField:vi.fn(),select:vi.fn(),isCancel:vi.fn()}));
vi.mock("node:fs/promises",()=>({readFile:capabilities.readFile}));
vi.mock("../dist/cli-prompts.js",async importOriginal=>({...await importOriginal(),promptForField:capabilities.promptForField}));
vi.mock("toolcraft-design-rust",async importOriginal=>({...await importOriginal(),select:capabilities.select,isCancel:capabilities.isCancel}));
const original=loadParamsReference(capabilities),volume=new Volume();
import * as api from "../dist/cli-params.js";
beforeEach(()=>{volume.reset();for(const mock of Object.values(capabilities))mock.mockReset();capabilities.readFile.mockImplementation(createFsFromVolume(volume).promises.readFile);capabilities.isCancel.mockReturnValue(false);});
const field=(id:string,schema:object,extra:object={})=>({id,path:id.split("."),displayPath:id,optionAttribute:id.replaceAll(".","_"),commanderOptionAttribute:id.replaceAll(".","_"),optionFlag:"--"+id,schema,optional:false,hasDefault:false,...extra});
const context={commandPath:"app run",params:{previous:true},output:"rich",stdinTTY:true,stdoutTTY:true};
async function run(module:typeof original,fields:unknown[],options:object={},extra:object={}){
  const args={dynamic:[],variants:[],positionals:[],raw:[],preset:undefined,prompt:false,context:undefined,streams:{},defaults:{},...extra};
  try{return {value:await module.resolveParams(fields,args.dynamic,args.variants,args.positionals,options,args.raw,"kebab",args.preset,args.prompt,args.context,args.streams,args.defaults)};}catch(error){return {error:{name:error.name,message:error.message}};}
}

it("Native parameter resolution preserves positional, option and preset precedence",async()=>{
  volume.fromJSON({"/preset.json":'{"name":"preset","count":7,"tags":["preset"]}'});
  const fields=[field("name",{kind:"string"},{positionalIndex:0}),field("count",{kind:"number",jsonType:"integer"},{hasDefault:true,defaultValue:3}),field("tags",{kind:"array",item:{kind:"string"}},{optional:true})];
  for(const extra of [{},{positionals:["positional"]},{preset:"/preset.json"},{preset:"/preset.json",positionals:["positional"]}])for(const options of [{},{name:"option",count:"9",tags:["a,b","c"]}])assert.deepEqual(await run(api,fields,options,extra),await run(original,fields,options,extra));
  assert.deepEqual((await run(api,fields,{count:"9"},{positionals:["positional"]})).value,{name:"positional",count:9});
});

it("Native parameter resolution clones root defaults and preserves explicit dynamic overrides",async()=>{
  const fields=[field("profile.name",{kind:"string"}),field("profile.age",{kind:"number"},{optional:true})];
  const dynamic=[field("labels",{kind:"record",value:{kind:"string"}},{optionPath:["labels"],optionPathDisplay:"labels.<key>",optional:true})];
  const defaults={profile:{name:"default",age:8},labels:{tag:"default"}};
  for(const options of [{},{profile_name:"option"}])for(const raw of [[],["--labels.tag=explicit"]])assert.deepEqual(await run(api,fields,options,{dynamic,raw,defaults}),await run(original,fields,options,{dynamic,raw,defaults}));
  const value=(await run(api,fields,{}, {dynamic,defaults})).value;assert.deepEqual(value,defaults);assert.notEqual(value.profile,defaults.profile);assert.notEqual(value.labels,defaults.labels);
});

it("Native parameter resolution combines validation errors and rejects extra positionals",async()=>{
  const fields=Array.from({length:12},(_,i)=>field("value"+i,{kind:"number"}));
  for(const extra of [{},{positionals:["unexpected"]}])assert.deepEqual(await run(api,fields,{},extra),await run(original,fields,{},extra));
  assert.match((await run(api,fields)).error?.message,/and 2 more/);
  const json=[field("value",{kind:"json",const:{value:1}})];for(const options of [{value:'{"value":2}'},{value:"{"}])assert.deepEqual(await run(api,json,options),await run(original,json,options));
});

it("Native parameter resolution applies missing-value callbacks and interactive choices",async()=>{
  for(const choices of [[],[{label:"one",value:1}],[{label:"one",value:1},{label:"two",value:2}],[{label:"invalid",value:"bad"}]]){
    const fields=[field("value",{kind:"number",cli:{resolveMissing:async()=>({choices})}},{optional:true,hasDefault:true,defaultValue:7})];capabilities.select.mockResolvedValue(2);
    assert.deepEqual(await run(api,fields,{}, {context}),await run(original,fields,{}, {context}));
  }
  for(const module of [api,original]){capabilities.promptForField.mockResolvedValueOnce("entered");assert.deepEqual((await run(module,[field("name",{kind:"string"})],{}, {prompt:true})).value,{name:"entered"});}
});

it("Native parameter resolution composes branch selection and inactive-branch validation",async()=>{
  const fields=[field("mode",{kind:"enum",values:["local","remote"]}),field("path",{kind:"string"},{variantId:"v",optional:true}),field("url",{kind:"string"},{variantId:"v",optional:true})];
  const variants=[{id:"v",controlFieldId:"mode",controlDisplayPath:"mode",optional:false,branches:[{branchId:"local",fieldIds:["path"],dynamicFieldIds:[],requiredFieldIds:["path"],requiredDynamicFieldIds:[]},{branchId:"remote",fieldIds:["url"],dynamicFieldIds:[],requiredFieldIds:["url"],requiredDynamicFieldIds:[]}]}];
  for(const options of [{mode:"local",path:"here"},{mode:"local",url:"there"},{mode:"remote"},{}])assert.deepEqual(await run(api,fields,options,{variants}),await run(original,fields,options,{variants}));
});

it("Native parameter resolution retains field getters, option receivers and callback snapshots",async()=>{
  async function inspect(module:typeof original){
    const trace:unknown[]=[],track=(value:object,name:string)=>new Proxy(value,{get(target,key,receiver){trace.push([name,String(key)]);return Reflect.get(target,key,receiver);}});
    const cli={resolveMissing(details){trace.push(["resolver",this===cli,details]);return {choices:[{label:"resolved",value:5}]};}};
    const fields=[track(field("name",track({kind:"string"},"name.schema")),"name"),track(field("count",track({kind:"number",cli},"count.schema"),{optional:true}),"count")];
    const options=track({name:"value"},"options");
    const output=await run(module,fields,options,{context});return {trace,output};
  }
  assert.deepEqual(await inspect(api),await inspect(original));
});

it("Native parameter resolution preserves variadic positionals and verbose attribute fallback",async()=>{
  const fields=[field("count",{kind:"array",item:{kind:"number"}},{positionalIndex:0,variadicPosition:true}),field("verbose",{kind:"boolean"},{commanderOptionAttribute:"internalVerbose",optional:true})];
  for(const positionals of [[],["1","2"],["bad"]])for(const options of [{},{verbose:true},{internalVerbose:false,verbose:true}])assert.deepEqual(await run(api,fields,options,{positionals}),await run(original,fields,options,{positionals}));
  const inherited=Object.create({internalVerbose:true});assert.deepEqual(await run(api,fields,inherited,{positionals:["3"]}),await run(original,fields,inherited,{positionals:["3"]}));
});

it("Native parameter resolution skips synthetic variant roots replaced by whole-root defaults",async()=>{
  const fields=[field("configKind",{kind:"enum",values:["local","remote"]},{synthetic:true}),field("config.path",{kind:"string"},{variantId:"variant",optional:true})];
  const variants=[{id:"variant",controlFieldId:"configKind",controlDisplayPath:"configKind",optional:false,branches:[{branchId:"local",fieldIds:["config.path"],dynamicFieldIds:[],requiredFieldIds:["config.path"],requiredDynamicFieldIds:[]}]}];
  const defaults={config:{path:"default"}};
  for(const options of [{},{configKind:"local",config_path:"explicit"}])assert.deepEqual(await run(api,fields,options,{variants,defaults}),await run(original,fields,options,{variants,defaults}));
  assert.deepEqual((await run(api,fields,{}, {variants,defaults})).value,defaults);
});

it("Native parameter resolution preserves continuation timing, selection labels and stream identity",async()=>{
  async function inspect(module:typeof original){
    const trace:unknown[]=[],streams={input:{identity:"input"},output:{identity:"output"}};
    const fields=[field("value",{kind:"number",cli:{resolveMissing(){trace.push("resolver called");return {get then(){trace.push("then");return resolve=>{trace.push("resolve");resolve({choices:[{label:"one",value:1},{label:"two",value:2}]});};}};} }},{optional:true,description:"Choose a value"})];
    capabilities.select.mockImplementationOnce(options=>{trace.push(["select",options.message,options.options,options.input===streams.input,options.output===streams.output]);return Promise.resolve(2);});
    const pending=run(module,fields,{}, {context,streams});trace.push("returned");queueMicrotask(()=>trace.push("tick"));const result=await pending;trace.push("done");return {trace,result};
  }
  assert.deepEqual(await inspect(api),await inspect(original));
  for(const module of [api,original]){
    const fields=[field("value",{kind:"number",cli:{resolveMissing:()=>({choices:[{label:"one",value:1},{label:"two",value:2}]})}},{optional:true})];
    capabilities.select.mockResolvedValueOnce(Symbol("cancel"));capabilities.isCancel.mockReturnValueOnce(true);
    assert.equal((await run(module,fields,{}, {context})).error?.message,"Operation cancelled.");
  }
});

it("Native parameter resolution closes field iterators on rejected prompts and resolvers",async()=>{
  async function inspect(module:typeof original,failure:unknown,optional:boolean){
    const trace:unknown[]=[],f=field("value",{kind:"string",cli:{resolveMissing:()=>Promise.reject(failure)}},{optional});
    const fields=[f];fields[Symbol.iterator]=function*(){try{yield f;}finally{trace.push("closed");}};
    capabilities.promptForField.mockRejectedValueOnce(failure);
    await assert.rejects(module.resolveParams(fields,[],[],[],{},[],"kebab",undefined,true,context,{}),error=>error===failure);
    return trace;
  }
  for(const failure of [undefined,null,false,17,Symbol("failure"),new Error("failure")])for(const optional of [true,false]){
    capabilities.promptForField.mockReset();const actual=await inspect(api,failure,optional);
    capabilities.promptForField.mockReset();assert.deepEqual(actual,await inspect(original,failure,optional));
  }
});

it("Native parameter resolution isolates concurrent missing-value continuations",async()=>{
  for(const module of [api,original]){
    const releases:Array<(value:unknown)=>void>=[],fields=[field("value",{kind:"number",cli:{resolveMissing:()=>new Promise(resolve=>releases.push(resolve))}},{optional:true})];
    const first=run(module,fields,{}, {context}),second=run(module,fields,{}, {context});
    releases[1]({choices:[{label:"second",value:2}]});assert.deepEqual((await second).value,{value:2});
    releases[0]({choices:[{label:"first",value:1}]});assert.deepEqual((await first).value,{value:1});
  }
});

it("Native command construction and Commander dispatch compose with complete parameter resolution",async()=>{
  const controls={yes:true,output:true,outputFormats:{},debug:true,logLevel:true,verbose:true};
  const globals=new Set(["--help","--output","--yes","--debug","--verbose","--log-level","--preset"]);
  async function inspect(commands:typeof nativeCommands,preparation:typeof nativePreparation,params:typeof original){
    const node={kind:"command",name:"run",aliases:["r"],scope:["cli"],positional:["name"],params:{kind:"object",shape:{name:{kind:"string"},values:{kind:"array",item:{kind:"number"}},labels:{kind:"record",value:{kind:"string"}},enabled:{kind:"boolean",default:true}}}};
    const root={kind:"group",name:"app",aliases:[],children:[node]},loaders=new Map(),calls=[];
    const command=commands.createNodeCommand(root,"kebab",globals,async state=>{
      const value=await params.resolveParams(state.fields,state.dynamicFields,state.variants,state.positionalValues,state.actionCommand.opts(),state.rawArgv,"kebab",undefined,false,undefined,{});
      calls.push({path:state.commandPath,value});
    },false,controls,loaders);
    const prepared=preparation.prepareCliArguments(command,["node","app","r","workspace","--values","-1,-2","--labels.tag","hello"],loaders,"kebab",controls);
    await command.parseAsync(prepared.argv);return calls;
  }
  const actual=await inspect(nativeCommands,nativePreparation,api);
  assert.deepEqual(actual,await inspect(referenceCommands,referencePreparation,original));
  assert.deepEqual(actual,[{path:"app.run",value:{name:"workspace",values:[-1,-2],enabled:true,labels:{tag:"hello"}}}]);
});
