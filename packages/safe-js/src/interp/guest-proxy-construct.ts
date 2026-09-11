import type { Budget } from "./budget.js";
import { isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxValue } from "./values.js";
import { requireActiveGuestProxy, withGuestProxyTrap } from "./guest-proxy.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { retainValues } from "./resources.js";

export async function constructGuestProxy(
  proxy: object, args: readonly SandboxValue[], budget: Budget,
  context: SandboxCallContext | undefined, newTarget: SandboxClosure
): Promise<SandboxValue> {
  if (!isSandboxClosure(proxy) || proxy.construct === undefined)
    throw new TypeError("Proxy target is not a constructor.");
  requireActiveGuestProxy(proxy);
  budget.visitNode();
  let argumentsList: SandboxValue[] | undefined;
  const release = retainValues(budget, () => [proxy, newTarget, ...args, argumentsList]);
  try {
    return await withGuestProxyTrap(proxy, "construct", budget, context, async ({ target, handler, trap }) => {
      if (!isSandboxClosure(target) || target.construct === undefined)
        throw new TypeError("Proxy target is not a constructor.");
      if (trap === undefined)
        return invokeBuiltinClosure(target, args, budget, context, undefined, true, newTarget);
      budget.allocateArrayLength(args.length);
      argumentsList = [...args];
      const result = await invokeBuiltinClosure(trap, [target, argumentsList, newTarget], budget, context, handler);
      if (result === null || typeof result !== "object") throw new TypeError("Proxy construct must return an object.");
      return result;
    });
  } finally {
    release();
  }
}
