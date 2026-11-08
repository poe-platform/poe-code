import type { Budget } from "./budget.js";
import { guestProxyStates } from "./guest-proxy.js";
import { callGuestProxy } from "./guest-proxy-call.js";
import { constructGuestProxy } from "./guest-proxy-construct.js";
import { isSandboxPromise, type SandboxCallContext, type SandboxClosure, type SandboxValue } from "./values.js";

export async function invokeBuiltinClosure(
  closure: SandboxClosure,
  args: readonly SandboxValue[],
  budget: Budget,
  context: SandboxCallContext | undefined,
  thisValue: SandboxValue,
  construct = false,
  newTarget?: SandboxClosure
): Promise<SandboxValue> {
  if (context?.invokeClosure !== undefined) {
    return context.invokeClosure(closure, args, thisValue, construct, newTarget);
  }
  const leaveCall = budget.enterCall();
  try {
    if (guestProxyStates.has(closure))
      return await (construct
        ? constructGuestProxy(closure, args, budget, context, newTarget ?? closure)
        : callGuestProxy(closure, args, budget, context, thisValue));
    const invoke = construct ? closure.construct : closure.call;
    if (invoke === undefined) throw new TypeError("Value is not a constructor.");
    const result = await invoke(args, {
      ...context,
      stack: context?.stack ?? [],
      thisValue,
      newTarget: construct ? newTarget ?? closure : undefined,
      invokeClosure: (target, values, receiver, asConstructor, targetConstructor) =>
        invokeBuiltinClosure(target, values, budget, context, receiver, asConstructor, targetConstructor)
    });
    if (isSandboxPromise(result)) await result.synchronousPrefix;
    return result;
  } finally {
    leaveCall();
  }
}
