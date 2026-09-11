import { expect, it } from "vitest";
import { lint } from "./index.js";
import { run } from "../run.js";

it("recognizes FinalizationRegistry consistently in execution and linting", async () => {
  const source = "const token={};const registry=new FinalizationRegistry(()=>{});registry.register({},7,token);return registry.unregister(token)";
  expect(await run(source)).toMatchObject({ ok: true, returnValue: true });
  expect(lint(source)).toEqual([]);
  expect(lint("const FinalizationRegistry=1;return FinalizationRegistry")).toEqual([
    expect.objectContaining({ code: "AS-SHADOW-GLOBAL", severity: "warning" })
  ]);
});
