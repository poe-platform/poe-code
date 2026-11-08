import type { Budget } from "./budget.js";
import { isSandboxClosure, type SandboxCallContext, type SandboxValue } from "./values.js";
import { requireActiveGuestProxy, withGuestProxyTrap } from "./guest-proxy.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { retainValues } from "./resources.js";

export async function callGuestProxy(
  proxy: object, args: readonly SandboxValue[], budget: Budget,
  context: SandboxCallContext | undefined, thisValue: SandboxValue
): Promise<SandboxValue> {
  if (!isSandboxClosure(proxy)) throw new TypeError("Proxy target is not callable.");
  requireActiveGuestProxy(proxy);
  budget.visitNode();
  let argumentsList: SandboxValue[] | undefined;
  const release = retainValues(budget, () => [proxy, thisValue, ...args, argumentsList]);
  try {
    return await withGuestProxyTrap(proxy, "apply", budget, context, async ({ target, handler, trap }) => {
      if (!isSandboxClosure(target)) throw new TypeError("Proxy target is not callable.");
      if (trap === undefined) return invokeBuiltinClosure(target, args, budget, context, thisValue);
      budget.allocateArrayLength(args.length);
      argumentsList = [...args];
      return invokeBuiltinClosure(trap, [target, thisValue, argumentsList], budget, context, handler);
    });
  } finally {
    release();
  }
}
