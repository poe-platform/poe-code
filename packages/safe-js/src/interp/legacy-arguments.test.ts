import { expect, it } from "vitest";
import { run } from "../run.js";

it.each(["", "x", "...rest", "x=1", "{x}={}"])("preserves the arguments object around a block function with %s", async parameter => {
  const body = 'const before=arguments;let inner;{inner=arguments();function arguments(){return 7}}return [before===arguments,inner,Object.prototype.toString.call(arguments)]';
  const source = `return Function(${JSON.stringify(parameter)},${JSON.stringify(body)})()`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:[true,7,"[object Arguments]"]});
});

it.each([
  ['return Function("arguments", "{function arguments(){return 7}}return arguments")(3)',3],
  ['return Function("return (()=>{{function arguments(){return 7}}return arguments()})()")()',7],
  ['return Function("function arguments(){return 3}{function arguments(){return 7}}return arguments()")()',7],
  ['return Function("let arguments=3;{function arguments(){return 7}}return arguments")()',3]
])("preserves explicit arguments bindings: %s", async (source, expected)=> {
  expect(await run(source as string)).toMatchObject({ok:true,returnValue:expected});
});
