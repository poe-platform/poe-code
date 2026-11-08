import { createSandboxClosure, createSandboxRegex } from "../values.js";
export function createRegexGlobals() {
    const construct = (args) => createSandboxRegex(String(args[0] ?? ""), String(args[1] ?? ""));
    return {
        RegExp: createSandboxClosure({ name: "RegExp", call: construct, construct })
    };
}
