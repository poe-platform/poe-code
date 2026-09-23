import { commandLimits } from "../safejs/options.js";
import { SafeJsCommandLimitError, type SafeJsHostFunction, type SafeJsModule } from "../safejs/types.js";
import type { NodeSafeJsCommandOptions } from "./types.js";

export function nodeReadFile<Budget>(options: NodeSafeJsCommandOptions<Budget>, fs: SafeJsModule, signal: AbortSignal, fail: (error: unknown) => void, pending: Set<Promise<void>>): SafeJsHostFunction {
  const read = fs.readFile as SafeJsHostFunction;
  const limits = commandLimits(options.limits);
  return options.runtime.declareHostOperation((path: unknown, encoding: unknown, callback?: unknown) => {
    signal.throwIfAborted();
    // Retain the existing Promise-based text API when no callback is supplied.
    if (callback === undefined && typeof encoding !== "function") return read(path, encoding);
    if (typeof encoding === "function") { callback = encoding; encoding = undefined; }
    if (typeof callback !== "function") throw new TypeError("readFile callback must be a function");
    if (pending.size >= limits.arrayLength) {
      const error = new SafeJsCommandLimitError("arrayLength");
      fail(error);
      throw error;
    }
    const done = callback;
    const completion = Promise.resolve().then(() => read(path, encoding)).then(
      text => { signal.throwIfAborted(); return done(null, text); },
      error => { signal.throwIfAborted(); return done(error); },
    ).then(() => undefined).catch(fail).finally(() => pending.delete(completion));
    pending.add(completion);
    return undefined;
  }, "read-side-effect");
}
