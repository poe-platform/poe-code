import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { isSandboxClosure } from "./values.js";

it.each(["Map", "Set"])("retains the originating %s prototype during foreign inspection", async name => {
  const source = `return [new ${name}(),${name}.prototype]`;
  const native = runInNewContext(`(function(){${source}})()`);
  expect(runInNewContext("Object.getPrototypeOf")(native[0]) === native[1]).toBe(true);
  const first = await run(source);
  const second = await run("return Object.getPrototypeOf");
  if (!first.ok || !Array.isArray(first.returnValue) || !second.ok || !isSandboxClosure(second.returnValue))
    throw new Error("Missing realm exports");
  const prototype = await second.returnValue.call([first.returnValue[0]], { stack: [], thisValue: undefined });
  expect(prototype === first.returnValue[1]).toBe(true);
});
