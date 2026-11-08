import { expect, it } from "vitest";
import { asyncDisposableStackStates } from "./async-disposable-stack.js";
import { createSandboxClosure, measureSandboxData } from "./values.js";

it("charges private async resources and releases moved-away ownership", () => {
  const stack={};const moved={};const method=createSandboxClosure({call:()=>undefined});
  const baseline=measureSandboxData([stack,method]);
  const resources=[{method,receiver:undefined,args:['x'.repeat(1000)],syncFallback:false}];
  asyncDisposableStackStates.set(stack,{disposed:false,resources});
  expect(measureSandboxData([stack,method])-baseline).toBeGreaterThanOrEqual(1000);
  asyncDisposableStackStates.set(moved,{disposed:false,resources});
  asyncDisposableStackStates.set(stack,{disposed:true,resources:[]});
  expect(measureSandboxData([stack,method])).toBe(baseline);
  expect(measureSandboxData([moved,method])-baseline).toBeGreaterThanOrEqual(1000);
});
