const __v9 = globalThis.__gitAdapterV9;
import { writeBytes } from "./io.js";
export function createOutputOperation(context, destination) {
    const controller = new AbortController();
    const signal = controller.signal;
    const capability = destination.ownedOutput;
    const callbacks = [];
    const children = [];
    const closedReason = new Error("Output operation is closed");
    let accepting = true;
    let drain;
    const assertOpen = () => {
        context.signal.throwIfAborted();
        signal.throwIfAborted();
        if (!accepting)
            throw closedReason;
    };
    const close = () => {
        if (drain)
            return drain;
        accepting = false;
        __v9("output-close-begin", close);
        drain = Promise.resolve().then(async () => {
            try {
                const results = await Promise.allSettled(callbacks.map(async (cleanup) => cleanup()));
                __v9("output-close-results", close, results);
                __v9("output-close-joined", close);
                const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
                if (failures.length === 1)
                    throw failures[0];
                if (failures.length)
                    throw new AggregateError(failures, "Output operation cleanup failed");
            }
            finally {
                context.signal.removeEventListener("abort", callerAbort);
                capability?.consumerClosed.removeEventListener("abort", outputAbort);
            }
        });
        void drain.catch(() => { });
        for (const child of children)
            void child.close().catch(() => { });
        return drain;
    };
    const abort = (reason) => {
        controller.abort(reason);
        void close().catch(() => { });
    };
    const callerAbort = () => abort(context.signal.reason);
    const outputAbort = () => abort(capability?.consumerClosed.reason);
    const registerCleanup = (cleanup) => {
        assertOpen();
        if (typeof cleanup !== "function")
            throw new TypeError("Cleanup must be callable");
        callbacks.push(cleanup);
    };
    const wait = (pending) => new Promise((resolve, reject) => {
        const aborted = () => reject(signal.reason);
        if (signal.aborted)
            aborted();
        else
            signal.addEventListener("abort", aborted, { once: true });
        pending.then(value => {
            signal.removeEventListener("abort", aborted);
            resolve(value);
        }, error => {
            signal.removeEventListener("abort", aborted);
            reject(error);
        });
    });
    __v9("output-open", context, close);
    __v9(typeof context.registerCleanup === "function" ? "hook-present" : "hook-absent", context, close);
    context.registerCleanup?.(close);
    if (context.signal.aborted)
        callerAbort();
    else if (capability?.consumerClosed.aborted)
        outputAbort();
    else {
        context.signal.addEventListener("abort", callerAbort, { once: true });
        capability?.consumerClosed.addEventListener("abort", outputAbort, { once: true });
    }
    return {
        signal,
        output: {
            async write(chunk) {
                assertOpen();
                await writeBytes(capability ?? destination, chunk, signal);
            },
        },
        registerCleanup,
        child(destination) {
            assertOpen();
            const child = createOutputOperation({ signal, registerCleanup }, destination);
            children.push(child);
            return child;
        },
        async acquire(start, release) {
            assertOpen();
            let resource;
            let settled;
            const admitted = new Promise(resolve => { settled = resolve; });
            let released;
            const dispose = () => {
                released ??= admitted.then(async () => { if (resource)
                    await release(resource.value); });
                return released;
            };
            registerCleanup(dispose);
            let acquisition;
            try {
                acquisition = Promise.resolve(start(signal));
            }
            catch (error) {
                acquisition = Promise.reject(error);
            }
            const pending = acquisition.then(async (value) => {
                resource = { value };
                settled();
                if (!accepting) {
                    await dispose();
                    throw signal.aborted ? signal.reason : closedReason;
                }
                return value;
            }, error => {
                settled();
                throw error;
            });
            return wait(pending);
        },
        close,
    };
}
