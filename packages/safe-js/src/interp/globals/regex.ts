import {
  createSandboxClosure,
  createSandboxRegex,
  isSandboxRegex,
  reconcileCompiledValues,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxValue
} from "../values.js";
import { CompileScope } from "../regex/compile-guard.js";
import { SandboxError, type Budget, type CompileOwner } from "../budget.js";
import { sandboxString } from "../string-coercion.js";
import { getSandboxPropertyDescriptor } from "../object-model.js";
import { readPropertyDescriptor } from "../accessors.js";

export function createRegexGlobals(options: { budget: Budget; compileOwner?: CompileOwner }): { RegExp: SandboxClosure } {
  const invoke = (construct: boolean) => async (args: readonly SandboxValue[], context?: SandboxCallContext) => {
    const selected = options.compileOwner ?? context?.compilation?.owner;
    if (context?.compilation?.owner !== undefined && selected !== context.compilation.owner) {
      throw new SandboxError("reentry");
    }
    const operation = options.budget.acquireCompileOwner(false, selected);
    const compilation = context?.compilation?.owner === operation.owner
      ? context.compilation : new CompileScope(operation.owner);
    let source = "";
    let retainedSource: SandboxValue;
    let retainedFlags: SandboxValue;
    const retained = {};
    options.budget.setRetainedValues(retained, () => [...args, source, retainedSource, retainedFlags]);
    try {
      const pattern = args[0];
      const flags = args[1];
      const read = (key: PropertyKey) => {
        const descriptor = getSandboxPropertyDescriptor(pattern, key, options.budget);
        // Until the full RegExp prototype graph is exposed, preserve its constructor default.
        if (key === "constructor" && descriptor === undefined && isSandboxRegex(pattern)) return constructor;
        if (context?.getProperty !== undefined) return context.getProperty(pattern, key);
        return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, pattern, context);
      };
      let regexLike = false;
      if (pattern !== null && typeof pattern === "object") {
        const match = await read(Symbol.match);
        regexLike = match === undefined ? isSandboxRegex(pattern) : Boolean(match);
      }
      if (!construct && regexLike && flags === undefined && await read("constructor") === constructor) return pattern;
      let sourceValue: SandboxValue = pattern;
      let flagsValue: SandboxValue = flags;
      if (isSandboxRegex(pattern)) {
        sourceValue = pattern.source;
        if (flags === undefined) flagsValue = pattern.flags;
      } else if (regexLike) {
        sourceValue = retainedSource = await read("source");
        if (flags === undefined) flagsValue = retainedFlags = await read("flags");
      }
      source = sourceValue === undefined ? "" : await sandboxString(sourceValue, options.budget, context);
      retainedSource = undefined;
      const flagText = flagsValue === undefined ? "" : await sandboxString(flagsValue, options.budget, context);
      retainedFlags = undefined;
      const regex = createSandboxRegex(
        source,
        flagText,
        0,
        compilation
      );
      if (compilation !== context?.compilation) {
        reconcileCompiledValues(options.budget, [regex], compilation);
      }
      return regex;
    } finally {
      options.budget.setRetainedValues(retained, undefined);
      if (compilation !== context?.compilation) compilation.dispose();
      operation.release();
    }
  };
  const constructor = createSandboxClosure({ sandbox: true, name: "RegExp", call: invoke(false), construct: invoke(true) });
  return { RegExp: constructor };
}
