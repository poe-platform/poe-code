import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { createGuestProxy } from "../interp/guest-proxy.js";
import { sandboxGetProperty } from "../interp/guest-proxy-get.js";
import { createSandboxClosure, isSandboxClosure, type SandboxCallContext } from "../interp/values.js";
import { run } from "../run.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  { name: "DateTimeFormat", expression: "new Intl.DateTimeFormat('en-US',{year:'numeric',timeZone:'UTC'}).format", primitive: 0, expected: "1970" },
  { name: "NumberFormat", expression: "new Intl.NumberFormat('en-US').format", primitive: 42, expected: "42" },
  { name: "Collator", expression: "new Intl.Collator('en-US').compare", primitive: "a", expected: -1 }
])("retains Proxy property access after restoring cached $name", async ({ expression, primitive, expected }) => {
  const first = await run(`return ${expression}`);
  expect(first.ok).toBe(true);
  const format = first.returnValue;
  if (!isSandboxClosure(format)) throw new Error("Missing cached Intl function");
  const budget = new Budget();
  const context: SandboxCallContext = {
    stack: [],
    thisValue: undefined,
    getProperty: (value, key) => sandboxGetProperty(value, key, value, budget, context)
  };
  const value = createGuestProxy({
    [Symbol.toPrimitive]: createSandboxClosure({ guest: true, sandbox: true, call: () => primitive })
  }, {});
  await expect(format.call([value, "z"], context)).resolves.toBe(expected);
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { format } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source, budget })
    .currentScope.lookup("format").value;
  if (!isSandboxClosure(restored)) throw new Error("Missing restored Intl function");
  await expect(restored.call([value, "z"], context)).resolves.toBe(expected);
});
