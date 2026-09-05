import { commandRuntimeIdentity } from "../../../contracts/command.js";
import type { ShellExtension } from "../../extensions.js";

export function arraysExtension(): ShellExtension {
  return { name: "arrays", runtimeIdentity: commandRuntimeIdentity, syntax: { arrayKeys: true, indexedDeclarations: ["readonly"] }, create: () => ({ builtins: [] }) };
}
