import { native } from "./native.js";
import { EventQueue } from "./event-queue.js";
export const calculateBackoffMs = native.spawnBackoff;
export const defaultIsRetryable = (result) => native.spawnRetryable(result.exitCode);
function aborted(signal) {
  if (signal?.aborted) {
    const error = new Error("Agent spawn retry aborted");
    error.name = "AbortError";
    throw error;
  }
}
function sleep(delay, signal) {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      clearTimeout(timer);
      const error = new Error("Agent spawn retry aborted");
      error.name = "AbortError";
      reject(error);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
export function createSpawnRetry(spawnOnce) {
  return (service, options, retryOptions) => {
    const state = new native.NativeSpawnRetry(retryOptions.maxAttempts, retryOptions.backoffMs),
      queue = new EventQueue(),
      isRetryable = retryOptions.isRetryable ?? defaultIsRetryable;
    const execute = async () => {
      while (true) {
        aborted(options.signal);
        const attempt = state.begin(false),
          handle = spawnOnce(service, options);
        const forward = async () => {
          for await (const event of handle.events) {
            const plan = state.prefix(event.event);
            queue.push(
              plan.field === null
                ? {
                    ...event,
                    _meta: {
                      ...(typeof event._meta === "object" && event._meta !== null
                        ? event._meta
                        : {}),
                      attempt
                    }
                  }
                : { ...event, [plan.field]: plan.prefix + String(event[plan.field]) }
            );
          }
        };
        const [value] = await Promise.all([handle.result, forward()]);
        let decision = state.evaluate(value.exitCode);
        if (decision.kind === "check") decision = state.finishCheck(Boolean(isRetryable(value)));
        if (decision.kind === "done") return value;
        queue.push(state.waitEvent(decision.delay));
        await sleep(decision.delay, options.signal);
      }
    };
    const result = execute().then(
      (value) => {
        queue.close();
        return value;
      },
      (error) => {
        queue.fail(error);
        throw error;
      }
    );
    return { events: queue, result };
  };
}
