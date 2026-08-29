import { posix } from "node:path";
import { NodeUsageError, nodeLimits, type NodeSelector } from "./types.js";
import { strings, text } from "./values.js";

export interface NodeInvocation { readonly selector: NodeSelector; readonly source: string | null; readonly filename: string; readonly argv: readonly string[]; }
export function invocation(values: readonly string[], cwd: string): NodeInvocation {
  const args = strings(values, 132, nodeLimits.sourceBytes + nodeLimits.contextBytes + 128);
  text(cwd, nodeLimits.pathBytes, "cwd");
  if (!cwd.startsWith("/") || cwd.includes("\0")) throw new NodeUsageError("cwd must be an absolute virtual path");
  let selector: "eval" | "print" | undefined;
  let source: string | null = null;
  let inputType = false;
  let index = 0;
  for (; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") { index += 1; break; }
    if (argument === "--input-type" || argument.startsWith("--input-type=")) {
      if (inputType) throw new NodeUsageError("duplicate input type");
      const value = argument === "--input-type" ? args[++index] : argument.slice(13);
      if (value !== "commonjs") throw new NodeUsageError("only commonjs input type is supported");
      inputType = true; continue;
    }
    const mode = argument === "-e" || argument === "--eval" || argument.startsWith("--eval=") ? "eval"
      : argument === "-p" || argument === "--print" || argument.startsWith("--print=") ? "print" : null;
    if (mode !== null) {
      if (selector) throw new NodeUsageError("conflicting source selectors");
      selector = mode;
      const equal = argument.indexOf("=");
      const value = equal >= 0 ? argument.slice(equal + 1) : args[++index];
      if (value === undefined) throw new NodeUsageError("missing source operand");
      source = text(value, nodeLimits.sourceBytes, "source bytes"); continue;
    }
    if (argument.startsWith("-") && argument !== "-") throw new NodeUsageError("unsupported node option");
    break;
  }
  if (selector) return { selector, source, filename: selector === "eval" ? "/[eval]" : "/[print]", argv: Object.freeze(["/virtual/bin/node", ...args.slice(index)]) };
  const file = args[index];
  if (file === undefined || file === "-") return { selector: "stdin", source: null, filename: "/[stdin]", argv: Object.freeze(["/virtual/bin/node", "-", ...args.slice(file === undefined ? index : index + 1)]) };
  if (inputType || !file.endsWith(".cjs") || file.includes("\0")) throw new NodeUsageError("only explicit .cjs file entries are supported");
  const filename = text(posix.resolve(cwd, file), nodeLimits.pathBytes, "entry path");
  return { selector: "file", source: null, filename, argv: Object.freeze(["/virtual/bin/node", filename, ...args.slice(index + 1)]) };
}
