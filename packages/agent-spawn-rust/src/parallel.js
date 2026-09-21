import { native } from "./native.js";
export class SpawnParallelError extends Error {
  constructor(index, result, results) {
    super(`spawn.parallel call ${index} failed with exit code ${result.exitCode}.`);
    this.name = "SpawnParallelError";
    this.index = index;
    this.result = result;
    this.results = results;
  }
}
async function runCall(call, spawnOnce, signal) {
  if (signal.aborted) throw signal.reason;
  let handle, cleanup;
  if (typeof call === "function") handle = call(signal);
  else {
    if (!Array.isArray(call) || call.length !== 2)
      throw Error("spawn.parallel calls must be [service, options] tuples or spawn thunks.");
    const options = call[1],
      controller = options.signal ? new AbortController() : null;
    let forwarded = signal;
    if (controller) {
      const callSignal = options.signal,
        onGroup = () => controller.abort(signal.reason),
        onCall = () => controller.abort(callSignal.reason);
      if (signal.aborted) onGroup();
      else if (callSignal.aborted) onCall();
      else {
        signal.addEventListener("abort", onGroup, { once: true });
        callSignal.addEventListener("abort", onCall, { once: true });
      }
      forwarded = controller.signal;
      cleanup = () => {
        signal.removeEventListener("abort", onGroup);
        callSignal.removeEventListener("abort", onCall);
      };
    }
    try {
      handle = spawnOnce(call[0], { ...options, signal: forwarded });
    } catch (error) {
      cleanup?.();
      throw error;
    }
  }
  try {
    const drain = async () => {
      for await (const event of handle.events) void event;
    };
    const [value] = await Promise.all([handle.result, drain()]);
    return value;
  } finally {
    cleanup?.();
  }
}
export function createSpawnParallel(spawnOnce) {
  return async (calls, options = {}) => {
    const failFast = options.failFast ?? true,
      requested = Object.hasOwn(options, "check") ? options.check : undefined,
      state = new native.NativeSpawnParallel(
        calls.length,
        options.maxConcurrent ?? 4,
        requested === undefined ? failFast : requested,
        Boolean(failFast)
      );
    if (!calls.length) return [];
    const group = new AbortController(),
      results = new Array(calls.length),
      errors = [];
    let primary;
    const parent = options.signal,
      abort = () => {
        if (state.stop()) primary = { reason: parent.reason };
        group.abort(parent.reason);
      };
    if (parent?.aborted) abort();
    else parent?.addEventListener("abort", abort, { once: true });
    const worker = async () => {
      while (true) {
        const index = state.take();
        if (index === null) return;
        try {
          const value = await runCall(calls[index], spawnOnce, group.signal);
          results[index] = value;
          if (state.complete(index, value.exitCode)) {
            const error = new SpawnParallelError(index, value, results);
            primary = { reason: error };
            group.abort(error);
          }
        } catch (error) {
          const action = state.reject(index, group.signal.aborted);
          if (action === "primary") {
            primary = { reason: error };
            group.abort(error);
          } else if (action === "collect") errors.push(error);
        }
      }
    };
    try {
      await Promise.allSettled(Array.from({ length: state.workers }, worker));
    } finally {
      parent?.removeEventListener("abort", abort);
    }
    if (primary) throw primary.reason;
    if (errors.length)
      throw new AggregateError(
        errors,
        "spawn.parallel failed before every call returned a result."
      );
    const failed = state.firstFailed();
    if (failed !== null) throw new SpawnParallelError(failed, results[failed], results);
    return results;
  };
}
