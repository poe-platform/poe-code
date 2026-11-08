import { createRequire } from "node:module";
import { validate } from "toolcraft-schema-rust";
import { UserError } from "./index.js";
import { callNative, protect } from "./host-errors.js";

const { NativeManagedStream, streamCatchPhase } = createRequire(import.meta.url)("./toolcraft-rust.node");

export function createManagedStream(options) {
  const controller = new AbortController();
  const state = new NativeManagedStream();
  let iteratorPromise;
  let closePromise;
  const advance = state.advance.bind(state);
  const closeNative = state.close.bind(state);
  const close = (reason) => callNative(closeNative, reason, host);
  const abortFromConsumer = () => { void close(options.signal?.reason).catch(() => undefined); };
  const operations = {
    undefined: () => undefined,
    consumerAborted: () => options.signal?.aborted,
    abortFromConsumer,
    listen: () => options.signal?.addEventListener("abort", abortFromConsumer, { once: true }),
    detach: () => options.signal?.removeEventListener("abort", abortFromConsumer),
    aborted: () => !!controller.signal.aborted,
    reason: () => controller.signal.reason,
    abort: (reason) => controller.abort(reason),
    iteratorPromise: () => iteratorPromise,
    setIteratorPromise: (value) => { iteratorPromise = value; },
    closePromise: () => closePromise,
    setClosePromise: (value) => { closePromise = value; },
    resolvedPromise: () => Promise.resolve(),
    startIterator: () => Promise.resolve()
      .then(() => options.create(controller.signal, (event) => options.onStatus?.(event)))
      .then(iterable => iterable[Symbol.asyncIterator]()),
    closeIterator: (promise) => promise.then(async iterator => { await iterator.return?.(); }, () => undefined),
    next: (iterator) => iterator.next(),
    schema: () => options.eventSchema,
    validate,
    messages: (issues) => issues.map(issue => issue.message).join("; "),
    userError: (message) => new UserError(message),
    event: (value) => ({ done: false, value }),
    complete: () => ({ done: true, value: undefined })
  };
  const host = {
    operate: protect((name, args) => operations[name](...args)),
    get: protect((value, key) => value[key])
  };
  callNative(state.initialize.bind(state), host);
  return {
    signal: controller.signal,
    cancel: close,
    [Symbol.asyncIterator]() {
      return {
        async next() {
          let phase = 0;
          let input;
          let saved;
          for (;;) {
            let action;
            try { action = callNative(advance, phase, input, saved, host); }
            catch (error) { phase = streamCatchPhase(phase); input = error; continue; }
            saved = action.saved;
            if (action.kind === "return") return action.value;
            if (action.kind === "throw") throw action.value;
            if (action.kind === "continue") { phase = action.next; input = action.value; continue; }
            try { input = await action.value; phase = action.next; }
            catch (error) { input = error; phase = action.failure; }
          }
        },
        async return() { await close(); return { done: true, value: undefined }; },
        async throw(error) { await close(error); throw error; }
      };
    }
  };
}
