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
    const retained = {};
    options.budget.setRetainedValues(retained, () => [...args, source]);
    try {
      const pattern = args[0];
      const flags = args[1];
      if (!construct && isSandboxRegex(pattern) && flags === undefined) return pattern;
      const sourceValue = isSandboxRegex(pattern) ? pattern.source : pattern;
      const flagsValue = isSandboxRegex(pattern) && flags === undefined ? pattern.flags : flags;
      source = sourceValue === undefined ? "" : await sandboxString(sourceValue, options.budget, context);
      const flagText = flagsValue === undefined ? "" : await sandboxString(flagsValue, options.budget, context);
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
  return {
    RegExp: createSandboxClosure({ sandbox: true, name: "RegExp", call: invoke(false), construct: invoke(true) })
  };
}
