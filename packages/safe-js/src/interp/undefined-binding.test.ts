import { expect, it } from "vitest";
import { run } from "../run.js";
import { parse } from "../parse.js";
import { tokenize } from "../parse/tokenizer.js";
import { lint } from "../lint.js";
import { interpret } from "./interpreter.js";
import { Scope } from "./scope.js";

it.each([
  ["let undefined=7;return undefined", 7],
  ["return (function(undefined){return undefined})(7)", 7],
  ["let undef\\u0069ned=7;return undefined", 7],
  ["let undefined=7;return {undefined}.undefined", 7],
  ["const {value:undefined}={value:7};return undefined", 7],
  ["let undefined=7;undefined++;return undefined", 8],
  ["return ((undefined=7)=>undefined)()", 7],
  ["try{return undefined;let undefined=7}catch(error){return error.name}", "ReferenceError"],
  ["try{undefined=7}catch(error){return error.name}", "TypeError"],
  ["try{undefined++}catch(error){return error.name}", "TypeError"],
  ["try{undefined+=7}catch(error){return error.name}", "TypeError"],
  ["return typeof undefined", "undefined"]
])("uses identifier semantics for %s", async (source, expected) => {
  expect(await run(source as string)).toMatchObject({ok:true,returnValue:expected});
});

it("tokenizes undefined and its escaped spelling as identifiers", () => {
  expect(tokenize("undefined undef\\u0069ned").slice(0,2).map(({type,value})=>({type,value})))
    .toEqual([{type:"identifier",value:"undefined"},{type:"identifier",value:"undefined"}]);
});

it("keeps undefined known to lint and available without installed builtins", async () => {
  expect(lint("return undefined")).toEqual([]);
  expect(await interpret(parse("return undefined")))
    .toMatchObject({ok:true,returnValue:undefined});
});

it("distinguishes undefined array elements from holes", async () => {
  expect(await run("const values=[undefined,,undefined];return [0 in values,1 in values,2 in values]"))
    .toMatchObject({ok:true,returnValue:[true,false,true]});
});

it("provides the readonly default in empty restored scopes without adding frame cells", () => {
  const root = new Scope();
  const frame = root.captureFrame();
  const restored = new Scope();
  restored.hydrateFrame(frame);
  expect(restored.captureFrame()).toEqual(frame);
  expect(restored.lookup("undefined")).toEqual({found:true,kind:"const",value:undefined});
  expect(() => restored.assign("undefined",7)).toThrow(TypeError);
  const child = restored.child();
  child.predeclare("undefined","let");
  expect(() => child.lookup("undefined")).toThrow(ReferenceError);
  child.declare("undefined","let",7);
  child.assign("undefined",8);
  expect(child.lookup("undefined")).toMatchObject({found:true,value:8});
  expect(restored.lookup("undefined")).toMatchObject({found:true,value:undefined});
});
