import { yieldTurn } from "safe-bash-contracts/yield";
import { resolvePath } from "@poe-code/safe-fs/core";
import { readBytes, type CommandContext } from "safe-bash-contracts";
import type { GhLimits } from "./types.js";

/** One invocation's aggregate budget, shared by file inputs and lazy stdin. */
export function createGhInput(context: CommandContext, limits: GhLimits) {
  let inputBytes = 0;
  const files = new Set<string>();
  let failure: Error | undefined;
  const assertWithinLimits = () => {
    if (failure) throw failure;
  };
  const chargeBytes = (count: number) => {
    assertWithinLimits();
    inputBytes += count;
    if (inputBytes > limits.maxInputBytes) {
      failure = new Error("gh input byte limit exceeded");
      throw failure;
    }
  };
  const readFile: CommandContext["fs"]["readFile"] = async (path, options) => {
    assertWithinLimits();
    const resolved = resolvePath(context.cwd, path);
    const stat = await context.fs.stat(resolved, options);
    if (!files.has(resolved)) {
      if (files.size >= limits.maxFiles) {
        failure = new Error("gh file limit exceeded");
        throw failure;
      }
      files.add(resolved);
    }
    // Reject oversized files before materializing their contents.
    chargeBytes(stat.size);
    const bytes = await context.fs.readFile(resolved, options);
    if (bytes.length > stat.size) chargeBytes(bytes.length - stat.size);
    assertWithinLimits();
    return bytes;
  };
  const fs = new Proxy(context.fs, {
    get(target, property) {
      if (property === "readFile") return readFile;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  let stdin: Promise<Uint8Array> | undefined;
  const readStdinBytes = () => stdin ??= (async () => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let turnBytes = 0;
    let turnChunks = 0;
    for await (const chunk of readBytes(context.stdin, context.signal)) {
      chargeBytes(chunk.length);
      chunks.push(chunk);
      size += chunk.length;
      turnBytes += chunk.length;
      if (++turnChunks >= 128 || turnBytes >= 16 * 1024) {
        await yieldTurn(context.signal);
        turnBytes = 0;
        turnChunks = 0;
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  })();
  return { fs, readStdinBytes, assertWithinLimits };
}
