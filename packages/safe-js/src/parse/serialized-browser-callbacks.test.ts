import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

import { run } from "../run.js";
import { parseModule } from "./parser.js";

it.each([
  ["() => { let from = 0; return from; }", "value", 0],
  ["() => new Set", "[value.size, value.add('item').has('item'), value.size]", [0, true, 1]],
  ["() => new Set()", "[value.size, value.add('item').has('item'), value.size]", [0, true, 1]]
])("parses and executes serialized browser callback %s", async (callback, observation, expected) => {
  const source = `export default ${callback}`;
  expect(parseModule(source).body[0]).toMatchObject({ type: "ExportDefaultDeclaration" });

  const invocation = `const value = (${callback})(); return ${observation};`;
  const native = runInNewContext(`(function () { ${invocation} })()`);
  expect(native).toEqual(expected);
  await expect(run(source, { modules: {}, entryPointArgs: [] })).resolves.toMatchObject({ ok: true });
  await expect(run(invocation, { modules: {} })).resolves.toMatchObject({
    ok: true,
    returnValue: expected
  });
});
