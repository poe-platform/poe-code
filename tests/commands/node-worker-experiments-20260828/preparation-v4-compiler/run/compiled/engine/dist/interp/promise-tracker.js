import { AsyncLocalStorage } from "node:async_hooks";
export class SandboxPromiseRejectionTracker {
    records = new Set();
    recordsByPromise = new WeakMap();
    observe(promise) {
        const record = this.recordsByPromise.get(promise);
        if (record !== undefined) {
            record.observed = true;
        }
    }
    track(promise) {
        if (this.recordsByPromise.has(promise)) {
            return;
        }
        const record = {
            observed: false,
            promise,
            rejected: false
        };
        this.records.add(record);
        this.recordsByPromise.set(promise, record);
        promise.promise.then(() => undefined, (reason) => {
            record.rejected = true;
            record.rejectionReason = reason;
        });
        promise.promise.catch(() => undefined);
    }
    async findUnhandledRejection() {
        await flushPromiseJobs();
        for (const record of this.records) {
            if (record.rejected && !record.observed) {
                return {
                    reason: record.rejectionReason,
                    span: record.promise.span
                };
            }
        }
        return undefined;
    }
}
const activePromiseTracker = new AsyncLocalStorage();
export function createSandboxPromiseRejectionTracker() {
    return new SandboxPromiseRejectionTracker();
}
export function observeSandboxPromise(promise) {
    activePromiseTracker.getStore()?.observe(promise);
}
export function trackSandboxPromise(promise) {
    activePromiseTracker.getStore()?.track(promise);
}
export function withSandboxPromiseRejectionTracker(tracker, callback) {
    return activePromiseTracker.run(tracker, callback);
}
async function flushPromiseJobs() {
    for (let index = 0; index < 20; index += 1) {
        await Promise.resolve();
    }
}
