import { expect, it } from "vitest";
import { lint } from "./index.js";
import { run } from "../run.js";

it("recognizes WeakRef consistently in execution and linting", async () => {
  const source = "const target={};return new WeakRef(target).deref()===target";
  expect(await run(source)).toMatchObject({ ok: true, returnValue: true });
  expect(lint(source)).toEqual([]);
  expect(lint("const WeakRef=1;return WeakRef")).toEqual([
    expect.objectContaining({ code: "AS-SHADOW-GLOBAL", severity: "warning" })
  ]);
});
