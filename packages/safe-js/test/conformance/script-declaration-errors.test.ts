import { expect, it } from "vitest";
import { createTest262Realm } from "./realm.js";
import { classifyScriptOutcome } from "./result.js";
import { getSandboxDataProperty } from "../../src/interp/object-model.js";
import { isSandboxClosure, type SandboxValue } from "../../src/interp/values.js";

it.each(["let undefined;", "const NaN=0;", "class Infinity {}", '"use strict";let undefined;'])("creates a guest SyntaxError for restricted global declaration %s", async source => {
  const realm=createTest262Realm();
  try{
    const result=await realm.evaluate(source);
    expect(classifyScriptOutcome(result,{phase:"runtime",type:"SyntaxError"})).toEqual({status:"passed"});
    expect(result).toMatchObject({status:"throw",phase:"runtime"});
    if(result.status!=="throw")throw new Error("Expected throw");
    const constructor=getSandboxDataProperty(result.error as SandboxValue,"constructor");
    expect(isSandboxClosure(constructor)).toBe(true);
    expect(getSandboxDataProperty(constructor,"name")).toBe("SyntaxError");
  }finally{await realm.dispose();}
});

it.each(["var x;", "function x(){}", "let x;"])("preserves guest error identity after an earlier Script: %s",async source=>{
  const realm=createTest262Realm();
  try{
    expect(await realm.evaluate("let x=7;")).toMatchObject({status:"normal"});
    expect(classifyScriptOutcome(await realm.evaluate(source),{phase:"runtime",type:"SyntaxError"})).toEqual({status:"passed"});
    expect(await realm.evaluate("x")).toMatchObject({status:"normal",value:7});
  }finally{await realm.dispose();}
});

it("keeps forged error names and fatal budgets distinct from declaration errors",async()=>{
  const realm=createTest262Realm({maxSteps:100});
  try{
    expect(classifyScriptOutcome(await realm.evaluate('throw {name:"SyntaxError"}'),{phase:"runtime",type:"SyntaxError"})).toMatchObject({status:"failed",reason:"wrong-error-type"});
    expect(await realm.evaluate('for(;;){}')).toMatchObject({status:"host-error",error:{code:"budgetExceeded"}});
  }finally{await realm.dispose();}
});

it.each(["var added;", "function added(){}"])("keeps non-extensible global declaration TypeErrors in the guest realm: %s", async source=>{
  const realm=createTest262Realm();
  try{
    expect(await realm.evaluate("Object.preventExtensions(globalThis)")).toMatchObject({status:"normal"});
    expect(classifyScriptOutcome(await realm.evaluate(source),{phase:"runtime",type:"TypeError"})).toEqual({status:"passed"});
  }finally{await realm.dispose();}
});
