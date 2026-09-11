import type { Budget } from "../budget.js";
import { readPropertyDescriptor } from "../accessors.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createThrowCompletion } from "../exceptions.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { getSandboxPropertyDescriptor, registerIntrinsicFunction } from "../object-model.js";
import { attachPendingPromiseReaction, createPendingPromiseCapability, getPromiseMember } from "../promise.js";
import { wellKnownSymbols } from "../symbols.js";
import { createSandboxClosure, isSandboxClosure, isSandboxPromise, type SandboxCallContext, type SandboxObject, type SandboxValue } from "../values.js";

export function installAsyncIteratorDispose(prototype: SandboxObject, budget: Budget): void {
  const promiseConstructor = getPromiseMember("constructor", budget);
  const unwrap = createSandboxClosure({guest: true, sandbox: true, name: "", length: 1, call: () => undefined});
  registerBuiltinIdentities(budget, {"%AsyncIteratorDisposeResult%": unwrap});
  registerIntrinsicFunction(budget, unwrap);
  const dispose = createSandboxClosure({
    guest: true, sandbox: true, name: "[Symbol.asyncDispose]", length: 0,
    call: (_args, context) => {
      let completePrefix!: () => void;
      let failPrefix!: (reason: unknown) => void;
      const prefix = new Promise<void>((resolve, reject) => {completePrefix = resolve; failPrefix = reject;});
      const capability = createPendingPromiseCapability(budget, context, prefix);
      void (async () => {
        try {
          const receiver = context?.thisValue;
          if (receiver === null || receiver === undefined) throw new TypeError("Cannot read return from a nullish receiver.");
          const method = await read(receiver, "return", context);
          if (method === undefined || method === null) {await capability.resolve.call([], context); return;}
          if (!isSandboxClosure(method)) throw new TypeError("Iterator return must be callable.");
          const result = await invokeBuiltinClosure(method, [], budget, context, receiver);
          if (isSandboxPromise(result) && await read(result, "constructor", context) === promiseConstructor) {
            attachPendingPromiseReaction(result, capability, unwrap, undefined, budget, context);
          } else {
            const wrapper = createPendingPromiseCapability(budget, context);
            attachPendingPromiseReaction(wrapper.promise, capability, unwrap, undefined, budget, context);
            await wrapper.resolve.call([result], context);
          }
        } catch (error) {
          await capability.reject.call([createThrowCompletion(error, budget, context?.stack ?? []).value], context);
        }
      })().then(completePrefix, failPrefix);
      return capability.promise;
    }
  });
  Object.defineProperty(prototype, wellKnownSymbols.asyncDispose, {value: dispose, writable: true, configurable: true});
  registerIntrinsicFunction(budget, dispose);

  async function read(value: SandboxValue, key: PropertyKey, context?: SandboxCallContext): Promise<SandboxValue> {
    if (context?.getProperty !== undefined) return context.getProperty(value, key);
    const descriptor = getSandboxPropertyDescriptor(value, key, budget);
    return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, context);
  }
}
