import type { Budget } from "./budget.js";
import { isSandboxPromise, type SandboxCallContext, type SandboxClosure, type SandboxValue } from "./values.js";

export async function invokeBuiltinClosure(
  closure: SandboxClosure,
  args: readonly SandboxValue[],
  budget: Budget,
  context: SandboxCallContext | undefined,
  thisValue: SandboxValue,
  construct = false
): Promise<SandboxValue> {
  if (context?.invokeClosure !== undefined) {
    return context.invokeClosure(closure, args, thisValue, construct);
  }
  const leaveCall = budget.enterCall();
  try {
    const invoke = construct ? closure.construct : closure.call;
    if (invoke === undefined) throw new TypeError("Value is not a constructor.");
    const result = await invoke(args, {
      ...context,
      stack: context?.stack ?? [],
      thisValue,
      invokeClosure: (target, values, receiver, asConstructor) =>
        invokeBuiltinClosure(target, values, budget, context, receiver, asConstructor)
    });
    if (isSandboxPromise(result)) await result.synchronousPrefix;
    return result;
  } finally {
    leaveCall();
  }
}
