import { createSandboxClosure, type SandboxClosure } from "./values.js";
import { boundFunctionStates, type BoundFunctionState } from "./bound-function-state.js";
import type { FunctionMethodOptions } from "./methods/function.js";

export function createBoundFunction(
  state: BoundFunctionState,
  name: string | undefined,
  length: number | undefined,
  callClosure: FunctionMethodOptions["callClosure"]
): SandboxClosure {
  const bound = createSandboxClosure({
    guest: true,
    sandbox: true,
    name,
    length,
    boundTarget: state.target,
    retainedValues: () => [state.target, state.thisValue, ...state.args, bound.name],
    call: (args, context) => callClosure(state.target, [...state.args, ...args], context?.stack ?? [], state.thisValue, undefined, undefined, context),
    ...(state.target.construct === undefined ? {} : {
      construct: (args, context) => callClosure(state.target, [...state.args, ...args], context?.stack ?? [],
        undefined, true, context?.newTarget === bound ? state.target : context?.newTarget, context)
    })
  });
  boundFunctionStates.set(bound, state);
  return bound;
}
