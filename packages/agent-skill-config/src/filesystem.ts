import { createFsBridge } from "@poe-code/safe-fs/bridge";
import type { SkillRuntimeOptions } from "./resolve-skill-reference-async.js";

export function skillOperations(options: SkillRuntimeOptions) {
  return createFsBridge(options.fs, { cwd: options.cwd, root: "/", signal: options.signal, codec: {
    isEncoding: encoding => encoding === "utf8" || encoding === "utf-8",
    encode: text => new TextEncoder().encode(text),
    decode: bytes => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
  } });
}
