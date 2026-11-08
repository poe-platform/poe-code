import { isFatalSandboxError, type Budget } from "../budget.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { sandboxGetOwnPropertyDescriptor } from "../guest-proxy-descriptor.js";
import { sandboxOwnKeys } from "../guest-proxy-own-keys.js";
import { HostCallResumabilityError } from "../host-call.js";
import { iteratorHelperStates, type IteratorHelperState } from "../iterator-helper.js";
import { createIteratorResult } from "../iterator-result.js";
import type { IteratorWrapperState } from "../iterator-wrapper.js";
import { closeIterator, type SandboxIterator } from "../iteration.js";
import { getSandboxPrototype, materializeFunctionProperties, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";

type StepResult = { value: SandboxValue; done: boolean };
type Protocol = {
  callContext(context?: SandboxCallContext): SandboxCallContext;
  adapter(record: IteratorWrapperState, context: SandboxCallContext): SandboxIterator;
  step(record: IteratorWrapperState, context: SandboxCallContext, skipValue?: boolean): Promise<StepResult>;
};

export function installJointIteratorHelpers(
  prototype: SandboxObject, constructor: SandboxClosure, budget: Budget, protocol: Protocol
): (state: IteratorHelperState, operation: "next" | "return", context: SandboxCallContext) => Promise<StepResult> {
  async function closeAll(records: Array<IteratorWrapperState | null>, context: SandboxCallContext, failure?: { error: unknown }): Promise<void> {
    let failed = failure !== undefined;
    let firstError: unknown = failure?.error;
    const release = retainValues(budget, () => [firstError]);
    try {
      for (let index = records.length - 1; index >= 0; index--) {
        const record = records[index];
        if (record === null) continue;
        try { await closeIterator(protocol.adapter(record, context), failed); }
        catch (error) {
          if (isFatalSandboxError(error) || error instanceof HostCallResumabilityError) throw error;
          if (!failed) { firstError = error; failed = true; }
        } finally { records[index] = null; }
      }
      if (failed && failure === undefined) throw firstError;
    } finally { release(); }
  }

  async function acquire(value: SandboxValue, context: SandboxCallContext, flattenable: boolean): Promise<IteratorWrapperState> {
    if (value === null || typeof value !== "object") throw new TypeError("Joint iteration inputs must be objects.");
    let iterator: SandboxValue = value;
    let method: SandboxValue;
    const release = retainValues(budget, () => [value, iterator, method]);
    try {
      method = await context.getProperty!(value, Symbol.iterator);
      if (!flattenable || (method !== undefined && method !== null)) {
        if (!isSandboxClosure(method)) throw new TypeError("Input must be iterable.");
        iterator = await invokeBuiltinClosure(method, [], budget, context, value);
        if (iterator === null || typeof iterator !== "object") throw new TypeError("Iterator must be an object.");
      }
      return { iterator, next: await context.getProperty!(iterator, "next") };
    } finally { release(); }
  }

  for (const method of ["zip", "zipKeyed"] as const) {
    const closure = createSandboxClosure({ guest: true, sandbox: true, name: method, length: 1, call: async ([inputs, options], caller) => {
      const context = protocol.callContext(caller);
      if (inputs === null || typeof inputs !== "object") throw new TypeError("Joint iteration inputs must be objects.");
      if (options !== undefined && (options === null || typeof options !== "object")) throw new TypeError("Iterator options must be an object.");
      const selected = options === undefined ? undefined : await context.getProperty!(options, "mode");
      const mode = selected === undefined ? "shortest" : selected;
      if (mode !== "shortest" && mode !== "longest" && mode !== "strict") throw new TypeError("Invalid joint iteration mode.");
      const padding = mode === "longest" && options !== undefined ? await context.getProperty!(options, "padding") : undefined;
      if (padding !== undefined && (padding === null || typeof padding !== "object")) throw new TypeError("Iterator padding must be an object.");
      const helper: SandboxObject = Object.create(null);
      const joint: NonNullable<IteratorHelperState["joint"]> = {
        mode, cursors: [], padding: [], ...(method === "zipKeyed" ? { keys: [] } : {arrayPrototype:getSandboxPrototype([],budget) as SandboxObject})
      };
      iteratorHelperStates.set(helper, { method, status: "start", joint, callback: undefined, remaining: 0, index: 0 });
      setSandboxPrototype(helper, prototype, budget);
      let outer: IteratorWrapperState | undefined;
      let paddingIterator: IteratorWrapperState | undefined;
      let current: SandboxValue;
      let inputKeys: Array<string | symbol> | undefined;
      const release = retainValues(budget, () => [helper, inputs, options, padding, current, inputKeys,
        outer?.iterator, outer?.next, paddingIterator?.iterator, paddingIterator?.next]);
      const checkpoint = createDataCheckpoint(budget, context);
      try {
        if (method === "zip") {
          outer = await acquire(inputs, context, false);
          while (true) {
            budget.visitNode();
            let result: StepResult;
            try { result = await protocol.step(outer, context); }
            catch (error) { outer = undefined; throw error; }
            if (result.done) { outer = undefined; break; }
            current = result.value;
            joint.cursors.push(await acquire(current, context, true));
            checkpoint(helper, 0, true);
          }
        } else {
          inputKeys = await sandboxOwnKeys(inputs, budget, context);
          for (const key of inputKeys) {
            budget.visitNode();
            const descriptor = await sandboxGetOwnPropertyDescriptor(inputs, key, budget, context);
            if (!descriptor?.enumerable) continue;
            current = await context.getProperty!(inputs, key);
            if (current === undefined) continue;
            joint.cursors.push(await acquire(current, context, true));
            joint.keys!.push(key);
            checkpoint(helper, 0, true);
          }
        }
        current = undefined;
        if (mode === "longest") {
          if (method === "zip" && padding !== undefined) paddingIterator = await acquire(padding, context, false);
          for (let index = 0; index < joint.cursors.length; index++) {
            budget.visitNode();
            if (method === "zipKeyed") {
              current = padding === undefined ? undefined : await context.getProperty!(padding, joint.keys![index]);
            } else if (paddingIterator !== undefined) {
              const result = await protocol.step(paddingIterator, context);
              current = result.value;
              if (result.done) paddingIterator = undefined;
            } else current = undefined;
            joint.padding.push(current);
            checkpoint(helper, 0, true);
          }
          if (paddingIterator !== undefined) await closeIterator(protocol.adapter(paddingIterator, context));
        }
        checkpoint(helper, 0, true);
        return helper;
      } catch (error) {
        if (!isFatalSandboxError(error) && !(error instanceof HostCallResumabilityError)) await closeAll(outer === undefined ? joint.cursors : [outer, ...joint.cursors], context, {error});
        throw error;
      } finally { release(); }
    } });
    Object.defineProperty(materializeFunctionProperties(constructor), method, { value: closure, writable: true, configurable: true });
    // Register installation-path identities in the caller before assigning fallback identities.
  }

  return async (state, operation, context) => {
    const joint = state.joint!;
    if (operation === "return") {
      await closeAll(joint.cursors, context);
      return createIteratorResult(undefined, true, budget);
    }
    const values: SandboxValue[] = [];
    let row: SandboxValue;
    const release = retainValues(budget, () => [values, row]);
    try {
      if (joint.cursors.length === 0) return createIteratorResult(undefined, true, budget);
      for (let index = 0; index < joint.cursors.length; index++) {
        budget.visitNode();
        const record = joint.cursors[index];
        if (record === null) { values.push(joint.padding[index]); continue; }
        let result: StepResult;
        try { result = await protocol.step(record, context); }
        catch (error) { joint.cursors[index] = null; throw error; }
        if (!result.done) { values.push(result.value); continue; }
        joint.cursors[index] = null;
        if (joint.mode === "shortest") {
          await closeAll(joint.cursors, context);
          return createIteratorResult(undefined, true, budget);
        }
        if (joint.mode === "strict") {
          if (index > 0) throw new TypeError("Joint iterators have different lengths.");
          for (let remaining = 1; remaining < joint.cursors.length; remaining++) {
            budget.visitNode();
            const other = joint.cursors[remaining]!;
            let checked: StepResult;
            try { checked = await protocol.step(other, context, true); }
            catch (error) { joint.cursors[remaining] = null; throw error; }
            if (!checked.done) throw new TypeError("Joint iterators have different lengths.");
            joint.cursors[remaining] = null;
          }
          return createIteratorResult(undefined, true, budget);
        }
        if (joint.cursors.every(cursor => cursor === null)) return createIteratorResult(undefined, true, budget);
        values.push(joint.padding[index]);
      }
      if (joint.keys === undefined) {
        budget.allocateArrayLength(values.length);
        row = values;
        setSandboxPrototype(row, joint.arrayPrototype as SandboxObject, budget);
      } else {
        const keyed: SandboxObject = Object.create(null);
        setSandboxPrototype(keyed, null, budget);
        row = keyed;
        for (let index = 0; index < joint.keys.length; index++) {
          Object.defineProperty(keyed, joint.keys[index], { value: values[index], writable: true, enumerable: true, configurable: true });
        }
      }
      createDataCheckpoint(budget, context)(row, 0, true);
      return createIteratorResult(row, false, budget);
    } catch (error) {
      if (!isFatalSandboxError(error) && !(error instanceof HostCallResumabilityError)) await closeAll(joint.cursors, context, {error});
      throw error;
    } finally { release(); }
  };
}
