import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {UserError,getCommandSourcePath,resolveCommandSecrets} from "./index.js";
import {createEnv,createFs,RESERVED_SERVICE_NAMES} from "./runtime-io.js";
import {formatAvailableList} from "./cli-values.js";
import {formatJsonParseUserErrorMessage} from "./cli-json-errors.js";
import {isNumericFixtureSelector} from "./cli-dynamic-paths.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliFixturesPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,null:()=>null,true:()=>true,false:()=>false,object:()=>({}),truthy:value=>!!value,
  isString:value=>typeof value==="string",isObject:value=>typeof value==="object",isNull:value=>value===null,isArray:value=>Array.isArray(value),
  lower:value=>value.toLowerCase(),upper:value=>value.toUpperCase(),prefix:(value,prefix)=>value.startsWith(prefix),
  wildcard:value=>value.endsWith("%"),matchPrefix:(expected,actual)=>actual.startsWith(expected.slice(0,-1)),
  sameLength:(expected,actual)=>expected.length===actual.length,
  arrayMatches:(expected,actual)=>expected.every((item,index)=>invoke("matches",[item,actual[index]])),
  objectMatches:(expected,actual)=>Object.entries(expected).every(([key,value])=>invoke("matches",[value,actual[key]])),
  same:(expected,actual)=>Object.is(expected,actual),isUrl:value=>value instanceof URL,urlString:value=>value.toString(),isRequest:value=>value instanceof Request,
  initMethod:init=>init?.method,
  entriesFind:(entries,method,url)=>entries.find(entry=>invoke("fetchEntry",[entry,method,url])),
  status:()=>200,headers:response=>new Headers(response.headers),
  nullResponse:(status,headers)=>new Response(null,{status,headers}),
  stringResponse:(response,status,headers)=>new Response(response.body,{status,headers}),
  jsonResponse:(response,status,headers)=>new Response(JSON.stringify(response.body),{status,headers}),
  hasContentType:headers=>headers.has("content-type"),setContentType:headers=>headers.set("content-type","application/json"),
  noContent:()=>new Response(null,{status:204}),
  fetch:entries=>async(input,init)=>invoke("fetchCall",[entries,input,init]),
  filesystem:(readFileEntries,existsEntries)=>({
    readFile:async filePath=>invoke("readFile",[readFileEntries,filePath]),
    writeFile:async()=>undefined,
    exists:async filePath=>invoke("exists",[readFileEntries,existsEntries,filePath]),
    lstat:async()=>({isSymbolicLink:()=>false}),rename:async()=>undefined,unlink:async()=>undefined
  }),
  own:(value,key)=>Object.prototype.hasOwnProperty.call(value,key),
  readString:(entries,key)=>String(entries[key]),readBoolean:(entries,key)=>Boolean(entries[key]),
  methodEntries(definition,args){for(const entry of definition){const step=invoke("methodEntry",[entry,args]);if(step.kind==="matched")return step;}return {kind:"skip"};},
  implicitMatcher:entry=>Object.fromEntries(Object.entries(entry).filter(([key])=>key!=="result"&&key!=="response"&&key!=="error")),
  first:args=>args[0],noKeys:matcher=>Object.keys(matcher).length===0,singleKey:matcher=>Object.keys(matcher).length===1,singleArg:args=>args.length===1,
  expected:matcher=>{const [[,expectedValue]]=Object.entries(matcher);return expectedValue;},
  methodError(entry){throw new Error(String(entry.error));},
  resolveProperty:(entry,key)=>Promise.resolve(entry[key]),resolveNull:()=>Promise.resolve(null),resolveUndefined:()=>Promise.resolve(undefined),
  service:methods=>new Proxy({},{get(_target,property){return invoke("serviceProperty",[methods,property]);}}),
  string:value=>String(value),method:(methods,methodName)=>async(...args)=>invoke("methodResult",[methodName,methods[methodName],args]),
  parsePath:commandPath=>path.parse(commandPath),fixturePath:parsed=>path.join(parsed.dir,`${parsed.name}.fixture.json`),
  numeric:isNumericFixtureSelector,indexed:(scenarios,selector)=>scenarios[Number(selector)-1],
  outOfRange(scenarios,selector){throw new UserError(`Fixture scenario index ${selector} is out of range. Available scenarios: ${scenarios.length}.`);},
  named:(scenarios,selector)=>scenarios.find(entry=>entry.name===selector),
  names:scenarios=>scenarios.map(entry=>entry.name).filter(name=>typeof name==="string"&&name.length>0),empty:values=>values.length===0,
  noFixtures:fixturePath=>`No fixtures are declared in ${fixturePath}.`,available:formatAvailableList,
  missingScenario(selector,available){throw new UserError(`Fixture scenario "${selector}" was not found. ${available}`);},
  source:getCommandSourcePath,
  noSource(command){throw new UserError(`Fixture mode could not determine the source file for command "${command.name}".`);},
  missingFile(command,fixturePath){throw new UserError(`Fixture file not found for command "${command.name}". Expected ${fixturePath}.`);},
  parse(raw){try{return {ok:true,value:JSON.parse(raw)};}catch(error){return {ok:false,error};}},
  jsonError(fixturePath,raw,error){throw new UserError(formatJsonParseUserErrorMessage("Fixture file",fixturePath,raw,error,{quotePath:false}),{cause:error});},
  notScenarios(fixturePath){throw new UserError(`Fixture file ${fixturePath} must contain a JSON array of scenarios.`);},
  secrets:(command,value)=>Object.fromEntries(Object.keys(command.secrets).map(name=>[name,value])),
  envBase:()=>({...process.env,POE_API_KEY:invoke("envFallback",[process.env.POE_API_KEY])}),
  envSecrets(values,command){for(const secret of Object.values(command.secrets))values[secret.env]=invoke("envFallback",[values[secret.env]]);},
  selector:()=>process.env.TOOLCRAFT_FIXTURE,
  normalRuntime:state=>({env:createEnv(state.runtimeEnv),fetch:state.runtimeFetch,fs:createFs(state.runtimeFs),isFixture:false,requirementOptions:state.requirementOptions,secrets:resolveCommandSecrets(state.command,state.runtimeEnv),services:state.services}),
  load:(state,selector)=>loadFixtureScenario(state.command,selector),
  serviceNames:(services,scenarioServices)=>new Set([...Object.keys(services),...Object.keys(scenarioServices).filter(name=>!RESERVED_SERVICE_NAMES.has(name))]),
  services:(names,scenarioServices)=>Object.fromEntries([...names].map(name=>[name,invoke("service",[scenarioServices[name]])])),
  fixtureRuntime:(state,scenarioServices,fixtureServices,fixtureEnvValues)=>({
    env:createEnv(fixtureEnvValues),fetch:invoke("fetch",[scenarioServices.fetch]),fs:invoke("fs",[scenarioServices.fs]),isFixture:true,
    requirementOptions:{...state.requirementOptions,env:fixtureEnvValues},secrets:invoke("secrets",[state.command]),services:fixtureServices
  }),
  invalidOperation(){throw new TypeError("Invalid CLI fixture operation");}
};
const host={operate:protect((name,args)=>name.startsWith("step:")?{kind:name.slice(5),value:args[0]}:operations[name](...args)),get:protect((value,key)=>value[key])};
export function normalizeHttpMethod(value){return invoke("httpMethod",[value]);}
export function isReadLikeMethod(name){return invoke("readLike",[name]);}
export function isWriteLikeMethod(name){return invoke("writeLike",[name]);}
export function matchesFixtureValue(expected,actual){return invoke("matches",[expected,actual]);}
export function getFetchUrl(input){return invoke("url",[input]);}
export function createFixtureResponse(response){return invoke("response",[response]);}
export function createFixtureFetch(entries){return invoke("fetch",[entries]);}
export function createFixtureFs(definition){return invoke("fs",[definition]);}
export function resolveFixtureMethodResult(methodName,definition,args){return invoke("methodResult",[methodName,definition,args]);}
export function createFixtureService(definition){return invoke("service",[definition]);}
export function resolveFixturePath(commandPath){return invoke("path",[commandPath]);}
export function selectFixtureScenario(scenarios,selector,fixturePath){return invoke("scenario",[scenarios,selector,fixturePath]);}
export async function loadFixtureScenario(command,selector){
  const fixturePath=invoke("loadStart",[command]);let raw;
  try{raw=await readFile(fixturePath,{encoding:"utf8"});}catch{return invoke("missingFile",[command,fixturePath]);}
  return invoke("loadResult",[raw,selector,fixturePath]);
}
export function resolveFixtureSecrets(command){return invoke("secrets",[command]);}
export function createFixtureEnvValues(command){return invoke("env",[command]);}
export async function resolveFixtureRuntime(command,services,requirementOptions,runtimeFetch,runtimeEnv,runtimeFs,embedded=false){
  const selector=invoke("selector",[embedded]),state={command,services,requirementOptions,runtimeFetch,runtimeEnv,runtimeFs};
  const step=invoke("runtimeStart",[state,selector]);
  if(step.kind==="return")return step.value;
  return invoke("runtimeResult",[state,await step.value]);
}
