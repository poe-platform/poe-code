import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

const loops = ["in", "of", "await of"];
const declarations = ["let", "const", "var"];

it.each(loops.flatMap((loop) => declarations.map((declaration) => ({ loop, declaration }))))(
  "resolves destructuring defaults in the iteration scope: $declaration $loop",
  async ({ loop, declaration }) => {
    const source = `var a = "outer";
      try {
        for ${loop === "await of" ? "await " : ""}(${declaration} { x: a = a } ${loop === "in" ? "in { key: 1 }" : "of [{}]"}) {
          return a;
        }
      } catch (error) { return error.name; }`;
    const expected = declaration === "var" ? "outer" : "ReferenceError";
    expect(await runInNewContext(`(async () => { ${source} })()`)).toBe(expected);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  }
);

it.each(["let", "const"])("predeclares later %s bindings before defaults", async (declaration) => {
  const source = `var b = "outer";
    try {
      for (${declaration} [a = b, b = 1] of [[]]) { return a; }
    } catch (error) { return error.name; }`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: "ReferenceError" });
});

it.each(["let", "const"])(
  "allows defaults to read initialized %s bindings",
  async (declaration) => {
    const source = `const result = [];
    for (${declaration} [a, b = a] of [[1], [2]]) { result.push([a, b]); }
    return result;`;
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: [
        [1, 1],
        [2, 2]
      ]
    });
  }
);
