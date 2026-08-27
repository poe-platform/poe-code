import { createSandboxClosure, createSandboxRegex, type SandboxClosure } from "../values.js";

export function createRegexGlobals(): { RegExp: SandboxClosure } {
  const construct = (args: readonly import("../values.js").SandboxValue[]) =>
    createSandboxRegex(String(args[0] ?? ""), String(args[1] ?? ""));
  return {
    RegExp: createSandboxClosure({ sandbox: true, name: "RegExp", call: construct, construct })
  };
}
