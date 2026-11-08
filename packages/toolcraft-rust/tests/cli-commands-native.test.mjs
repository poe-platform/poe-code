import assert from "node:assert/strict";
import test from "node:test";
import {Command} from "commander";
import {original} from "./cli-commands-reference.mjs";
import {original as referencePreparation} from "./cli-prepare-reference.mjs";
import {original as referenceDynamic} from "./cli-dynamic-argv-reference.mjs";
const native=()=>import("../dist/cli-commands.js");
const controls={yes:true,output:true,outputFormats:{custom:()=>"result"},debug:true,logLevel:true,verbose:true};
const globals=new Set(["--help","--output","--yes","--debug","--verbose","--log-level","--preset"]);
const leaf=(name,extra={})=>({kind:"command",name,aliases:[],scope:["cli"],positional:[],params:{kind:"object",shape:{}},...extra});
const group=(name,children,extra={})=>({kind:"group",name,aliases:[],children,...extra});
function optionView(option){return {flags:option.flags,description:option.description,hidden:option.hidden,choices:option.argChoices,preset:option.presetArg};}
function tree(command){if(command===null)return null;return {name:command.name(),aliases:command.aliases(),description:command.description(),hidden:command._toolcraftHidden,original:command._toolcraftOriginalName,hiddenDefaults:command._toolcraftHiddenDefaultNames,reserved:command._toolcraftReservedChildNames,defaultName:command._defaultCommandName,options:command.options.map(optionView),children:command.commands.map(tree)};}
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}

test("Native CLI commands build scoped trees, aliases and hidden defaults",async()=>{
  const api=await native();
  const hidden=leaf("",{hidden:true,aliases:["default","d"]});
  const root=group("app",[hidden,leaf("run",{aliases:["r"],description:"Run task"}),leaf("remote",{scope:["mcp"],aliases:["server"]}),leaf("__toolcraft_default__")],{default:hidden});
  for(const node of [root,hidden,leaf("skip",{scope:["sdk"]}),group("empty",[],{scope:["mcp"]})]){
    const a=new Map(),b=new Map();
    assert.deepEqual(tree(api.createNodeCommand(node,"kebab",globals,async()=>{},true,controls,a)),tree(original.createNodeCommand(node,"kebab",globals,async()=>{},true,controls,b)));
    assert.equal(a.size,b.size);
  }
});

test("Native CLI commands lazily build fields once and retain dynamic field identity",async()=>{
  const api=await native();
  function inspect(module){
    let reads=0;const node=leaf("run",{positional:["name"]});
    Object.defineProperty(node,"params",{get(){reads++;return {kind:"object",shape:{name:{kind:"string"},values:{kind:"array",item:{kind:"number"}},labels:{kind:"record",value:{kind:"string"}}}};}});
    const loaders=new Map(),command=module.createNodeCommand(node,"kebab",globals,async()=>{},false,controls,loaders);
    assert.equal(reads,0);const load=loaders.get(command),first=load(),second=load();assert.equal(first,second);assert.equal(reads,1);
    return {tree:tree(command),fields:first,arguments:command.registeredArguments.map(arg=>({name:arg.name(),required:arg.required,variadic:arg.variadic})),allowUnknown:command._allowUnknownOption};
  }
  assert.deepEqual(inspect(api),inspect(original));
});

test("Native CLI command actions retain positional, dynamic and numeric-array parse state",async()=>{
  const api=await native();
  async function inspect(module,argv){
    const node=leaf("run",{positional:["name"],params:{kind:"object",shape:{name:{kind:"string"},values:{kind:"array",item:{kind:"number"}},labels:{kind:"record",value:{kind:"string"}}}}}),states=[],loaders=new Map();
    const command=module.createNodeCommand(node,"kebab",globals,async state=>{assert.equal(state.command,node);assert.equal(state.actionCommand,command);states.push({commandPath:state.commandPath,declarationPath:state.declarationPath,positionals:state.positionalValues,rawArgv:state.rawArgv,variants:state.variants,options:state.actionCommand.opts()});},false,controls,loaders,["app"]);
    command.exitOverride();command.configureOutput({writeErr:()=>{}});loaders.get(command)();
    await command.parseAsync(["node","app",...argv]);return states;
  }
  for(const argv of [["one","--values","-1,-2"],["one","--labels.name=value"],["one","--","-tail"],["--output","markdown","one"],["--debug","--yes","one"]])assert.deepEqual(await inspect(api,argv),await inspect(original,argv));
});

test("Native global option parsers preserve successful values and exact validation errors",async()=>{
  const api=await native();
  function inspect(module,flag,value){const command=new Command();module.addGlobalOptions(command,true,controls);const option=command.options.find(option=>option.long===flag);return outcome(()=>option.parseArg(value));}
  for(const [flag,values] of [["--output",["rich","md","markdown","json","custom","markdow",17]],["--debug",[true,"trim","raw","ra",false]],["--log-level",["warn","debug","trace","debgu","unknown",17]]])for(const value of values)assert.deepEqual(inspect(api,flag,value),inspect(original,flag,value));
});

test("Native command construction preserves getter, collection callback and registration order",async()=>{
  const api=await native();
  function inspect(module){
    const trace=[],track=(value,label)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}});
    const child=track(leaf("run",{aliases:["r"],description:"Run",params:{kind:"object",shape:{count:{kind:"number"}}}}),"child");
    const root=track(group("app",[child],{default:child,description:"App"}),"root"),loaders=new Map();
    const set=loaders.set;loaders.set=function(command,load){trace.push(["set",this===loaders,command.name(),load.name,load.length]);return set.call(this,command,load);};
    const command=module.createNodeCommand(root,"kebab",globals,async()=>{},true,track(controls,"controls"),loaders);
    for(const load of loaders.values())load();
    return {tree:tree(command),trace};
  }
  assert.deepEqual(inspect(api),inspect(original));
});

test("Native lazy loaders retry failed collection and preserve thrown identity",async()=>{
  const api=await native();
  for(const module of [api,original])for(const failure of [undefined,null,false,17,Symbol("failure"),new Error("failure")]){
    const node=leaf("run"),loaders=new Map();let reads=0;
    Object.defineProperty(node,"params",{get(){if(++reads===1)throw failure;return {kind:"object",shape:{}};}});
    const command=module.createNodeCommand(node,"kebab",globals,async()=>{},false,controls,loaders),load=loaders.get(command);
    assert.throws(()=>load(),error=>error===failure);const loaded=load();assert.equal(load(),loaded);assert.equal(reads,2);
  }
});

test("Native action callbacks preserve async timing, receiver and rejection identity",async()=>{
  const api=await native();
  async function inspect(module,failure){
    const trace=[],loaders=new Map(),node=leaf("run");let action;
    const originalAction=Command.prototype.action;
    Command.prototype.action=function(callback){action=callback;trace.push(["register",callback.name,callback.length]);return this;};
    let command;
    try{command=module.createNodeCommand(node,"kebab",globals,async function(state){assert.equal(this,undefined);assert.equal(state.command,node);trace.push("execute");await Promise.resolve();trace.push("throw");throw failure;},false,controls,loaders);loaders.get(command)();}finally{Command.prototype.action=originalAction;}
    const pending=action(command);trace.push("called");await assert.rejects(pending,error=>error===failure);trace.push("rejected");return trace;
  }
  for(const failure of [undefined,null,17,Symbol("failure"),new Error("failure")])assert.deepEqual(await inspect(api,failure),await inspect(original,failure));
});

test("Native child attachment preserves name collisions, metadata filtering and live Reflect calls",async()=>{
  const api=await native();
  function inspect(module){
    const trace=[],parent=new Command("app"),child=new Command("").aliases(["alias","alias"]);
    parent._toolcraftHiddenDefaultNames=["prior",17];child._toolcraftOriginalName="original";
    const siblings={has(name){trace.push(["has",name]);return name==="__toolcraft_default__"||name==="__toolcraft_default_2";}};
    const result=module.addCommanderChild(parent,child,true,siblings);
    return {result,tree:tree(parent),trace};
  }
  assert.deepEqual(inspect(api),inspect(original));
  for(const value of [undefined,null,17,["one",17,null,"two"],Object.assign(["one"],{filter(){return "custom";}})]){
    const command={_toolcraftHiddenDefaultNames:value,_toolcraftReservedChildNames:value,_toolcraftHidden:value};
    for(const name of ["getToolcraftHiddenDefaultNames","getToolcraftReservedChildNames","isToolcraftHiddenCommander"])assert.deepEqual(api[name](command),original[name](command));
  }
});

test("Native command construction preserves malformed errors and reentrant loaders",async()=>{
  const api=await native();
  for(const node of [null,{},leaf("bad",{scope:null}),leaf("bad",{aliases:null}),group("bad",null)]){
    const run=module=>outcome(()=>module.createNodeCommand(node,"kebab",globals,async()=>{},false,controls,new Map()));
    assert.deepEqual(run(api),run(original));
  }
  for(const module of [api,original]){
    const node=leaf("run"),loaders=new Map();
    Object.defineProperty(node,"params",{get(){const nested=module.createNodeCommand(leaf("nested"),"kebab",globals,async()=>{},false,controls,new Map());assert.equal(nested.name(),"nested");return {kind:"object",shape:{}};}});
    const command=module.createNodeCommand(node,"kebab",globals,async()=>{},false,controls,loaders);assert.deepEqual(loaders.get(command)(),[]);
  }
});

test("Native command trees compose preparation, Commander dispatch and dynamic value parsing",async()=>{
  const api=await native(),preparation=await import("../dist/cli-prepare.js"),dynamic=await import("../dist/cli-dynamic-argv.js");
  async function inspect(module,prepare,parse){
    const node=leaf("run",{aliases:["r"],positional:["name"],params:{kind:"object",shape:{name:{kind:"string"},values:{kind:"array",item:{kind:"number"}},labels:{kind:"record",value:{kind:"string"}}}}}),loaders=new Map(),calls=[];
    const command=module.createNodeCommand(group("app",[node]),"kebab",globals,async state=>{
      const errors=[],parsed=parse.parseDynamicValues(state.dynamicFields,state.rawArgv,"kebab",errors);
      calls.push({path:state.commandPath,positionals:state.positionalValues,options:state.actionCommand.opts(),values:[...parsed.values],errors});
    },false,controls,loaders);
    const prepared=prepare.prepareCliArguments(command,["node","app","r","one","--labels.tag","hello","--values","-1,-2"],loaders,"kebab",controls);
    await command.parseAsync(prepared.argv);return {prepared,calls};
  }
  assert.deepEqual(await inspect(api,preparation,dynamic),await inspect(original,referencePreparation,referenceDynamic));
});
