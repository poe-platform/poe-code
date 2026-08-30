import {
  createSandboxClosure,
  createSandboxRegex,
  reconcileCompiledValues,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxValue
} from "../values.js";
import { CompileScope } from "../regex/compile-guard.js";
import { SandboxError, type CompileOwner } from "../budget.js";

export function createRegexGlobals(owner?: CompileOwner): { RegExp: SandboxClosure } {
  const construct = (args: readonly SandboxValue[], context?: SandboxCallContext) => {
    const selected = owner ?? context?.compilation?.owner;
    if (context?.compilation?.owner !== undefined && selected !== context.compilation.owner) {
      throw new SandboxError("reentry");
    }
    const operation = selected?.budget.acquireCompileOwner(false, selected);
    const compilation = context?.compilation ?? new CompileScope(selected);
    try {
      const regex = createSandboxRegex(
        String(args[0] ?? ""),
        String(args[1] ?? ""),
        0,
        compilation
      );
      if (context?.compilation === undefined && selected !== undefined) {
        reconcileCompiledValues(selected.budget, [regex], compilation);
      }
      return regex;
    } finally {
      if (context?.compilation === undefined) compilation.dispose();
      operation?.release();
    }
  };
  return {
    RegExp: createSandboxClosure({ sandbox: true, name: "RegExp", call: construct, construct })
  };
}
