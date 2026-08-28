const __v9 = globalThis.__gitAdapterV9;
export const invocationScope = Symbol("invocation cleanup scope");
export class InvocationScope {
    callerSignal;
    failures;
    parent;
    #children = new Set();
    #callbacks = [];
    #controller = new AbortController();
    #closed = false;
    #drain;
    constructor(callerSignal, failures = [], parent) {
        this.callerSignal = callerSignal;
        this.failures = failures;
        this.parent = parent;
    }
    get signal() { return this.#controller.signal; }
    assertOpen() {
        this.callerSignal?.throwIfAborted();
        if (this.#closed)
            throw this.signal.reason;
        this.parent?.assertOpen();
    }
    child() {
        this.assertOpen();
        const child = new InvocationScope(this.callerSignal, this.failures, this);
        this.#children.add(child);
        return child;
    }
    register(cleanup) {
        this.assertOpen();
        if (typeof cleanup !== "function")
            throw new TypeError("Cleanup must be callable");
        this.#callbacks.push(cleanup);
        __v9("scope-registered", this, cleanup);
    }
    #seal() {
        if (this.#closed)
            return;
        this.#closed = true;
        for (const child of this.#children)
            child.#seal();
        this.#controller.abort(new Error("Invocation is closed"));
    }
    close() {
        if (!this.#drain) {
            this.#drain = Promise.resolve().then(async () => {
                await Promise.all([
                    ...this.#callbacks.map(async (cleanup) => {
                        __v9("cleanup-start", cleanup);
                        try {
                            await cleanup();
                            __v9("cleanup-fulfilled", cleanup);
                        }
                        catch (error) {
                            __v9("cleanup-rejected", cleanup, error);
                            this.failures.push(error);
                        }
                    }),
                    ...[...this.#children].map((child) => child.close()),
                ]);
            });
            this.#seal();
        }
        return this.#drain;
    }
}
export function throwCleanupFailures(failures) {
    if (failures.length === 1)
        throw failures[0];
    if (failures.length)
        throw new AggregateError(failures, "Invocation cleanup failed");
}
