import { expect, it } from "vitest";
import { lint } from "./index.js";
import { run } from "../run.js";

it.each([
  ["WeakMap", "const key={};return new WeakMap([[key,7]]).get(key)", 7],
  ["WeakSet", "const key={};return new WeakSet([key]).has(key)", true]
] as const)("recognizes %s consistently in execution and linting", async (name, source, expected) => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  expect(lint(source)).toEqual([]);
  expect(lint(`const ${name}=1;return ${name}`)).toEqual([
    expect.objectContaining({ code: "AS-SHADOW-GLOBAL", severity: "warning" })
  ]);
});
