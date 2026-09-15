import { expect,it } from "vitest";
import { ExecutionBudget,ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";
import { parseComplexText } from "./complex-text.js";

function fixture(){const meter=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:4000000}),values=new RuntimeValues(meter);return {meter,values,parse:(source:string)=>parseComplexText(values.string(source).value,meter)};}

it.each([
  ["1",1,0],["1+2j",1,2],["-1-2J",-1,-2],["j",0,1],["-j",0,-1],["1+j",1,1],["1-j",1,-1],
  ["1e-2+3e+2j",.01,300],[" ( 1_2+3_4j ) ",12,34],["\u2003١.٢+３j\u00a0",1.2,3]
] as const)("parses complex text %j",(source,real,imaginary)=>{expect(fixture().parse(source)).toEqual({real,imaginary});});

it("preserves component signed zeros, infinities and NaNs",()=>{
  const {parse}=fixture();expect(parse("-0-0j")).toEqual({real:-0,imaginary:-0});expect(parse("-0j")).toEqual({real:0,imaginary:-0});
  expect(parse("inf-infj")).toEqual({real:Infinity,imaginary:-Infinity});
  const value=parse("-nan-nanj"),bits=new DataView(new ArrayBuffer(8));
  for(const component of [value.real,value.imaginary]){bits.setFloat64(0,component);expect(bits.getBigUint64(0)).toBe(0xfff8000000000000n);}
});

it.each([""," ","()","((1))","(1","1)","1 +2j","1+ 2j","1 2j","1+2 j","1\u2003+2j","\u001c1","1\0","1+-2j","1e+j","1e--2j","1+2","0x1j","j1","\0_1"])("rejects malformed complex text %j",source=>{
  expect(()=>fixture().parse(source)).toThrow("complex() arg is a malformed string");
});

it.each(["1__2j","1_+2j","_١","١_+٢j","(1_)"])("reports misplaced underscores separately in %j",source=>{
  expect(()=>fixture().parse(source)).toThrow(`could not convert string to complex: '${source}'`);
});

it("meters long component conversion and does not swallow execution limits",()=>{
  const {values,parse}=fixture();expect(parse("0".repeat(5000)+"1+j")).toEqual({real:1,imaginary:1});
  const text=values.string("1".repeat(10000)+"j").value;
  expect(()=>parseComplexText(text,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
  expect(()=>parseComplexText(text,new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100}))).toThrow(ExecutionLimitError);
});
