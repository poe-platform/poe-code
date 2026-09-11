import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([
  "return Function('a','var arguments;return arguments[0]')(3)",
  "return Function('a','var arguments;var arguments;return arguments[0]')(3)",
  "return Function('a','var arguments=7;return arguments')(3)",
  "return Function('arguments','var arguments;return arguments')(3)",
  "return Function('a=1','var arguments;return arguments[0]')(3)",
  "return Function('...a','var arguments;return arguments[0]')(3)",
  "return Function('let arguments=7;return arguments')()",
  "return Function('const arguments=7;return arguments')()",
  "return Function('a','let arguments=7;return [a,arguments]')(3)",
  "return Function('a=arguments[0]','let arguments=7;return [a,arguments]')(3)",
  "return Function('function arguments(){return 7};return arguments()')()",
  "return Function('a','\"use strict\";var arguments;return arguments[0]')(3)"
])("preserves arguments var declaration semantics: %s", async source => {
  const wrapped = `try{${source}}catch(error){return error.name}`;
  const expected: unknown = runInNewContext(`(function(){${wrapped}})()`);
  expect(await run(wrapped)).toMatchObject({ok: true, returnValue: expected});
});

it.each([
  ["", "let arguments=7;yield 1;return arguments", 7],
  ["", "const arguments=7;yield 1;return arguments", 7],
  ["a=()=>arguments[0]", "let arguments=7;yield 1;return [a(),arguments]", [undefined, 7]]
] as const)("restores lexical arguments independently of parameter scope: %s / %s", async (parameters, body, expected) => {
  const source = `const C=(function*(){}).constructor;const g=C(${JSON.stringify(parameters)},${JSON.stringify(body)})();g.next();await 0;return g.next().value`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    expect(saved.pendingAwaits).toHaveLength(1);
    expect(await completed).toMatchObject({ok: true, returnValue: expected});
    expect(await run(source, {snapshot: restore(saved, {source})})).toMatchObject({ok: true, returnValue: expected});
  } finally { await completed; }
});

it.each(["a", "...a"])("restores arguments after var redeclaration with parameter %s", async parameter => {
  const source = `const C=(async function(){}).constructor;return await C(${JSON.stringify(parameter)},'var arguments;await 0;return arguments[0]')(3)`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ok: true, returnValue: 3});
    expect(await run(source, {snapshot: restore(saved, {source})})).toMatchObject({ok: true, returnValue: 3});
  } finally { await completed; }
});
