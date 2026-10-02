import assert from "node:assert/strict";
import {beforeEach,it,vi} from "vitest";
import {loadPromptReference} from "./cli-prompts-reference.mjs";
const prompts=vi.hoisted(()=>({select:vi.fn(),confirm:vi.fn(),promptText:vi.fn(),isCancel:vi.fn(),cancelled:Symbol("cancelled")}));
vi.mock("toolcraft-design-rust",()=>({select:prompts.select,confirm:prompts.confirm,promptText:prompts.promptText,isCancel:prompts.isCancel}));
const original=loadPromptReference({select:prompts.select,confirm:prompts.confirm,promptText:prompts.promptText,isCancel:prompts.isCancel});
import * as api from "../dist/cli-prompts.js";
const field=(schema:unknown,extra:object={})=>({schema,displayPath:"config.value",optionFlag:"--config.value",hasDefault:false,...extra});
beforeEach(()=>{prompts.select.mockReset();prompts.confirm.mockReset();prompts.promptText.mockReset();prompts.isCancel.mockReset().mockImplementation(value=>value===prompts.cancelled);});
async function outcome(operation:()=>unknown){try{return {value:await operation()};}catch(error){return {error:{name:(error as Error)?.name,message:(error as Error)?.message}};}}

it("CLI prompts preserve enum labels, loaded choices, defaults and stream identity",async()=>{
  for(const module of [api,original]){
    const input={},output={},selected={id:1};prompts.select.mockResolvedValue(selected);
    const schema={kind:"enum",values:["one",2],labels:{one:"First",2:"Second"}};
    assert.equal(await module.promptForField(field(schema,{description:"Choose",hasDefault:true,defaultValue:2}),{input,output}),selected);
    assert.deepEqual(prompts.select.mock.lastCall,[{message:"Choose",options:[{label:"First",value:"one"},{label:"Second",value:2}],initialValue:2,input,output}]);
    const options=[{label:"Loaded",value:selected}];Object.assign(schema,{loadOptions:async function(){assert.equal(this,schema);return options;}});
    assert.equal(await module.promptForField(field(schema)),selected);assert.equal(prompts.select.mock.lastCall?.[0].options,options);
  }
});

it("CLI prompts parse text, scalar arrays, nullable JSON and booleans",async()=>{
  for(const [schema,value] of [[{kind:"string"},"text"],[{kind:"number"},"12"],[{kind:"number"},"invalid"],[{kind:"array",item:{kind:"number"}},"1, 2 3"],[{kind:"json"},'{"name":"value"}'],[{kind:"json",nullable:true},"null"],[{kind:"string"},undefined]]){
    prompts.promptText.mockResolvedValue(value);assert.deepEqual(await outcome(()=>api.promptForField(field(schema))),await outcome(()=>original.promptForField(field(schema))));
  }
  for(const module of [api,original]){
    prompts.confirm.mockResolvedValue(false);assert.equal(await module.promptForField(field({kind:"boolean"},{description:"Ignored",hasDefault:true,defaultValue:17,positionalIndex:0})),false);
    assert.deepEqual(prompts.confirm.mock.lastCall,[{message:"<config.value>",initialValue:true}]);
  }
});

it("CLI prompts clone defaults after blank text and format initial values",async()=>{
  for(const module of [api,original]){
    const value={nested:[1,2]};prompts.promptText.mockResolvedValue("  ");
    const result=await module.promptForField(field({kind:"json"},{hasDefault:true,defaultValue:value}));
    assert.deepEqual(result,value);assert.notEqual(result,value);assert.notEqual(result.nested,value.nested);
    assert.deepEqual(prompts.promptText.mock.lastCall,[{message:"--config.value",initialValue:'{"nested":[1,2]}'}]);
    assert.equal(module.formatResolvedValue([1,"two",null]),"1, two, null");
  }
});

it("CLI prompts convert each cancellation into the reference user error",async()=>{
  for(const schema of [{kind:"enum",values:["one"]},{kind:"boolean"},{kind:"string"}]){
    for(const prompt of [prompts.select,prompts.confirm,prompts.promptText])prompt.mockResolvedValue(prompts.cancelled);
    assert.deepEqual(await outcome(()=>api.promptForField(field(schema))),await outcome(()=>original.promptForField(field(schema))));
  }
});

it("CLI prompts preserve loader thenable timing, getter order and callback receivers",async()=>{
  async function inspect(module:typeof original,loaded:boolean){
    const trace:unknown[]=[],track=(value:object,label:string)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}});
    const options=[{label:"One",value:"one"}];
    const schema=track({kind:"enum",values:["one"],labels:{one:"One"},...(loaded?{loadOptions(){trace.push(["load",this===schema]);return {get then(){trace.push("load then");return (resolve:(value:unknown)=>void)=>{trace.push("load resolve");resolve(options);};}};}}:{})},"schema");
    const selected=field(schema,{description:"Pick",hasDefault:true,defaultValue:"one"});
    prompts.select.mockImplementation(function(config){trace.push(["select",this===undefined,config]);return {get then(){trace.push("select then");return (resolve:(value:unknown)=>void)=>{trace.push("select resolve");resolve("one");};}};});
    prompts.isCancel.mockImplementation(value=>{trace.push(["cancel",value]);return false;});
    const pending=module.promptForField(track(selected,"field"),track({input:undefined,output:undefined},"streams"));
    trace.push("returned");queueMicrotask(()=>trace.push("tick"));const value=await pending;trace.push("resolved");return {value,trace};
  }
  for(const loaded of [false,true])assert.deepEqual(await inspect(api,loaded),await inspect(original,loaded));
});

it("CLI prompts preserve arbitrary loader, input and cancellation-check failures",async()=>{
  for(const module of [api,original])for(const failure of [undefined,null,false,17,Symbol("failure"),new Error("failure")]){
    let pending:Promise<unknown>;
    assert.doesNotThrow(()=>{pending=module.promptForField({get schema(){throw failure;}});});await assert.rejects(pending!,error=>error===failure);
    await assert.rejects(module.promptForField(field({kind:"enum",loadOptions(){throw failure;}})),error=>error===failure);
    prompts.promptText.mockRejectedValue(failure);await assert.rejects(module.promptForField(field({kind:"string"})),error=>error===failure);
    prompts.promptText.mockResolvedValue("value");prompts.isCancel.mockImplementation(()=>{throw failure;});await assert.rejects(module.promptForField(field({kind:"string"})),error=>error===failure);
    prompts.isCancel.mockImplementation(()=>false);
  }
});

it("Prompt stream merging preserves spread descriptors, symbols and repeated stream reads",async()=>{
  function inspect(module:typeof original){
    const trace:unknown[]=[],symbol=Symbol.for("prompt option"),options={message:"Prompt",input:"old",[symbol]:17};
    const tracked=new Proxy(options,{ownKeys(target){trace.push("keys");return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){trace.push(["descriptor",key]);return Reflect.getOwnPropertyDescriptor(target,key);},get(target,key){trace.push(["get",key]);return Reflect.get(target,key);}});
    let reads=0;const result=module.withPromptStreams(tracked,{get input(){trace.push("input");return ++reads;},get output(){trace.push("output");return null;}});
    return {trace,descriptors:Object.getOwnPropertyDescriptors(result)};
  }
  assert.deepEqual(inspect(api),inspect(original));
  for(const module of [api,original])assert.deepEqual(module.withPromptStreams({input:"kept"},{input:undefined}),{input:"kept"});
});

it("Prompt helpers preserve live label coercions, default formatting and malformed diagnostics",async()=>{
  for(const schema of [{labels:{yes:"Yes"}},{labels:Object.create({yes:"inherited"})},{labels:{yes:null}},{labels:null}])assert.deepEqual(await outcome(()=>api.enumOptionLabel(schema,"yes")),await outcome(()=>original.enumOptionLabel(schema,"yes")));
  for(const value of [undefined,null,true,17,"text",Object.assign(new Array(3),{0:1,2:3}),{toJSON(){return {value:17};}}])assert.deepEqual(await outcome(()=>api.formatResolvedValue(value)),await outcome(()=>original.formatResolvedValue(value)));
  for(const operation of [module=>module.fieldPromptLabel(null),module=>module.withPromptStreams({},null),module=>module.enumOptionLabel(null,"yes"),module=>module.throwPromptCancellation()])assert.deepEqual(await outcome(()=>operation(api)),await outcome(()=>operation(original)));
});

it("Concurrent CLI prompts retain independent continuations when choices resolve out of order",async()=>{
  async function inspect(module:typeof original){
    const calls:unknown[]=[],releases:Array<(value:unknown)=>void>=[];
    prompts.select.mockImplementation(options=>{calls.push(options.message);return options.options[0].value;});
    prompts.isCancel.mockImplementation(()=>false);
    const first=module.promptForField(field({kind:"enum",loadOptions:()=>new Promise(resolve=>releases.push(resolve))},{description:"First"}));
    const second=module.promptForField(field({kind:"enum",loadOptions:()=>new Promise(resolve=>releases.push(resolve))},{description:"Second"}));
    releases[1]([{label:"Two",value:"two"}]);const secondValue=await second;
    releases[0]([{label:"One",value:"one"}]);const firstValue=await first;
    return {calls,firstValue,secondValue};
  }
  assert.deepEqual(await inspect(api),await inspect(original));
});
