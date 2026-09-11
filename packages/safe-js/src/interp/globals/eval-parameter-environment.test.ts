import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  ['a=eval("var x=2")', 'var x;return x'],
  ['a=eval("var x=2"),b=()=>x', 'var x;return [b(),x]'],
  ['a=eval("var a=2")', 'return a'],
  ['a=eval("var b=2"),b', 'return b'],
  ['{a}=eval("var a=2;({a:1})")', 'return a'],
  ['a=eval("var x=2")', 'return x'],
  ['a=eval("var x=2")', 'var x=3;return x'],
  ['a=eval("var x=2"),b=()=>x', 'var x=3;return [b(),x]'],
  ['a=1', 'eval("var a");return a'],
  ['a=1,b=()=>a', 'eval("var a=2");return [a,b()]'],
  ['a=1', 'eval("function a(){return 3}");return a()'],
  ['a=eval("var x=2"),b=()=>x', 'eval("var x=3");return [x,b()]'],
  ['a=eval("var x=2"),b=()=>x', 'eval("var x");return [x,b()]'],
  ['a=1,b=()=>arguments[0]', 'var arguments;return [arguments.length,b()]']
])("matches eval in parameter environments: %s / %s", async (parameters, body) => {
  const source = `try{return ["return",Function(${JSON.stringify(parameters)},${JSON.stringify(body)})()]}catch(e){return ["throw",e.name]}`;
  const expected: unknown = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});

it.each(['var arguments=2', 'function arguments(){}'])("rejects implicit arguments redeclaration across the parameter environment: %s", async declaration => {
  // FunctionDeclarationInstantiation puts implicit arguments in the parameter
  // environment; EvalDeclarationInstantiation rejects hoisting across it.
  // Node 22 does not enforce this case, so use the specification as the oracle.
  const parameters = `a=eval(${JSON.stringify(declaration)})`;
  const source = `try{Function(${JSON.stringify(parameters)},"return a")();return "accepted"}catch(e){return e.name}`;
  expect(await run(source)).toMatchObject({ok: true, returnValue: "SyntaxError"});
});
