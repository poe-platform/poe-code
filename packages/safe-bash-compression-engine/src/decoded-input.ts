import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { type ByteSource, type CommandContext, type FileSystem } from "safe-bash-contracts";
import { posixPath } from "safe-bash-contracts/path";
import { collect, input, pathOf } from "safe-bash-io-engine/internal";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { gunzipMembers } from "./gunzip.js";
import { DecodedBudget, type CompressionCommandOptions } from "./stream.js";

export interface GzipHelperOptions extends CompressionCommandOptions { readonly replace?: boolean; }

/** One invocation budget, including plain files and all gzip members. */
export function decodedInput(context: CommandContext, options: CompressionCommandOptions) {
  const limit = options.maxDecodedBytes;
  if (limit !== undefined && limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0)) {
    throw new RangeError("maxDecodedBytes must be a nonnegative safe integer or Infinity");
  }
  const budget = new DecodedBudget(limit);
  return async function* (name: string): ByteSource {
    let warned = false;
    for await (const chunk of gunzipMembers(input(context, name), context.signal, true, () => { warned = true; })) {
      budget.admit(chunk.byteLength);
      yield chunk;
    }
    if (warned) throw new PublicDiagnostic(`${name}: decompression OK, trailing garbage ignored`);
  };
}

/** Read-only decoded files for utilities that need seekable inputs (cmp/diff/pagers). */
export function decodedContext(context: CommandContext, options: CompressionCommandOptions): CommandContext {
  const memory = createMemoryFileSystem();
  const decode = decodedInput(context, options);
  const loaded = new Map<string, Promise<void>>();
  const load = (path: string): Promise<void> => {
    path = pathOf(context, path);
    let pending = loaded.get(path);
    if (!pending) {
      pending = (async () => {
        const bytes = await collect(decode(path), context.signal);
        await memory.mkdir(posixPath.dirname(path), { recursive: true });
        await memory.writeFile(path, bytes);
      })();
      loaded.set(path, pending);
    }
    return pending;
  };
  const fs = new Proxy(context.fs, {
    get(target, key) {
      if (key === "readStream") return async function* (path: string) {
        await load(path);
        yield* memory.readStream!(pathOf(context, path), { signal: context.signal });
      };
      if (key === "readFile" || key === "stat" || key === "lstat" || key === "openReadFile") {
        return async (path: string) => {
          if (key === "stat" || key === "lstat") {
            const stat = await target[key](pathOf(context, path), { signal: context.signal });
            if (stat.type !== "file") return stat;
          }
          await load(path);
          return memory[key]!(pathOf(context, path), { signal: context.signal });
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as FileSystem;
  const { stdinInput: ignoredStdinInput, ...rest } = context;
  return { ...rest, fs, stdin: decode("-") };
}
