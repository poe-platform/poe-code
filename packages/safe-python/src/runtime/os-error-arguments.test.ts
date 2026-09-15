import {expect,it} from "vitest";
import {initializeOsErrorArguments} from "./os-error-arguments.js";
import {ExecutionBudget} from "./execution-budget.js";

const absent=Symbol("absent");
function fixture(blocking=false){
  const fields=new Map<string,unknown>();
  let args:readonly unknown[]=[];
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
  return {fields,get args(){return args;},initialize(input:readonly unknown[],index=(value:unknown)=>BigInt(value as number)){
    initializeOsErrorArguments(input,{
      none:null,blocking,numeric:value=>typeof value==="number"||typeof value==="bigint",
      index,setMember:(name,value)=>fields.set(name,value===undefined?absent:value),
      setArgs:value=>{args=value;}
    },meter);
  }};
}

it("retains all non-file arguments and only parses arities two through five",()=>{
  for(let length=0;length<=7;length++){
    const f=fixture(),args=Array.from({length},(_,index)=>index===2?null:index);
    f.initialize(args);
    expect(f.args).toBe(args);
    expect(f.fields.get("errno")).toBe(length>=2&&length<=5?0:absent);
    expect(f.fields.get("strerror")).toBe(length>=2&&length<=5?1:absent);
    expect(f.fields.has("filename")).toBe(false);
  }
});

it("retains filename objects and strips both filenames and ignored winerror from args",()=>{
  const f=fixture(),first={},second={},args=[2,"missing",first,{},second];
  f.initialize(args);
  expect(f.args).toEqual([2,"missing"]);
  expect(f.fields.get("filename")).toBe(first);
  expect(f.fields.get("filename2")).toBe(second);
  expect(f.fields.has("winerror")).toBe(false);
});

it("reinitialization clears errno and strerror but retains absent filename and written fields",()=>{
  const f=fixture(true);
  f.initialize([35,"blocked",7]);
  expect(f.args).toEqual([35,"blocked",7]);
  expect(f.fields.get("characters_written")).toBe(7n);
  f.initialize([2,"missing","first",null,"second"]);
  f.initialize([]);
  expect(f.fields).toEqual(new Map([["errno",absent],["strerror",absent],["characters_written",7n],["filename","first"],["filename2","second"]]));
});

it("preserves partially published filename fields when args slicing fails",()=>{
  const events:string[]=[],failure=new Error("allocation");
  const args=new Proxy([2,"missing","file",null,"other"],{get(target,key,receiver){if(key==="slice")throw failure;return Reflect.get(target,key,receiver);}});
  expect(()=>initializeOsErrorArguments(args,{none:null,blocking:false,numeric:()=>false,index:()=>0n,setMember:name=>events.push(name),setArgs:()=>events.push("args")},new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000}))).toThrow(failure);
  expect(events).toEqual(["filename","filename2"]);
});

it("does not publish native fields or args when numeric conversion fails",()=>{
  const f=fixture(true),failure=new Error("guest index");
  f.initialize([1,"old"]);
  expect(()=>f.initialize([35,"new",1],()=>{throw failure;})).toThrow(failure);
  expect(f.args).toEqual([1,"old"]);
  expect(f.fields).toEqual(new Map([["errno",1],["strerror","old"]]));
});
