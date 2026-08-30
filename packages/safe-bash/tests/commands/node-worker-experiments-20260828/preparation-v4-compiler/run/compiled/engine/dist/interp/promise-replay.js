import { AsyncLocalStorage } from "node:async_hooks";
import { validateSnapshotData } from "../snapshot/validation.js";
export class PromiseReplay {
    steps = 0;
    nextPromise = 1;
    position = 0;
    replaying;
    restored;
    restoredEvents;
    events;
    ready = new Map();
    callbackTasks = new Map();
    completedCallbacks = new Set();
    rejectors = new Map();
    failure;
    callbackCount = 0;
    waiting = new Set();
    liveWaiters = new Set();
    budget;
    executionTrace;
    constructor(snapshot) {
        this.replaying = snapshot !== undefined;
        this.restored =
            snapshot === undefined
                ? { version: 1, steps: 0, promises: 0, settlements: [] }
                : validateReplay(snapshot);
        this.restoredEvents =
            this.restored.events ??
                this.restored.settlements.map((entry) => ({ kind: "promise", ...entry }));
        this.events = [...this.restoredEvents];
        this.callbackCount = this.events.filter((entry) => entry.kind === "callback-start").length;
        this.executionTrace =
            this.restored.executionTrace === undefined
                ? undefined
                : structuredClone(this.restored.executionTrace);
    }
    get currentStep() {
        return this.steps;
    }
    beforeNode(nodeId) {
        this.assertHealthy();
        this.drain();
        this.assertHealthy();
        const expected = this.restoredEvents[this.position];
        if (expected !== undefined && expected.step <= this.steps) {
            if (expected.kind === "promise" && expected.id >= this.nextPromise) {
                throw new TypeError("Promise replay references work not created at this position.");
            }
            return new Promise((resolve) => this.waiting.add(resolve)).then(() => this.beforeNode(nodeId));
        }
        const expectedNode = this.restored.executionTrace?.nodes[this.steps - this.restored.executionTrace.start];
        if (expectedNode !== undefined && expectedNode !== nodeId) {
            return new Promise((resolve) => this.waiting.add(resolve)).then(() => this.beforeNode(nodeId));
        }
        if (nodeId !== undefined && this.callbackCount > 0) {
            this.executionTrace ??= { start: this.steps, nodes: [] };
            if (this.steps >= this.executionTrace.start + this.executionTrace.nodes.length) {
                this.budget?.setRetainedDataUsage(this, Math.max(this.nextPromise - 1, this.restored.promises) * 3 +
                    this.callbackCount * 4 +
                    this.executionTrace.nodes.length +
                    1);
                this.executionTrace.nodes.push(nodeId);
            }
        }
        this.steps += 1;
        this.drain();
        for (const wake of this.waiting)
            wake();
        this.waiting.clear();
    }
    track(promise) {
        if (this.failure !== undefined) {
            void promise.catch(() => undefined);
            return Promise.reject(this.failure.reason);
        }
        try {
            this.budget?.setRetainedDataUsage(this, Math.max(this.nextPromise, this.restored.promises) * 3 +
                this.callbackCount * 4 +
                (this.executionTrace?.nodes.length ?? 0));
        }
        catch (error) {
            void promise.catch(() => undefined);
            throw error;
        }
        const id = this.nextPromise++;
        if (!this.replaying) {
            const settled = () => {
                this.events.push({ kind: "promise", id, step: this.steps });
            };
            void promise.then(settled, settled);
            return promise;
        }
        const tracked = new Promise((resolve, reject) => {
            this.rejectors.set(id, reject);
            promise.then((value) => {
                if (this.failure !== undefined)
                    return;
                this.ready.set(id, () => {
                    this.rejectors.delete(id);
                    resolve(value);
                });
                this.drain();
            }, (reason) => {
                if (this.failure !== undefined)
                    return;
                this.ready.set(id, () => {
                    this.rejectors.delete(id);
                    reject(reason);
                });
                this.drain();
            });
        });
        this.drain();
        return tracked;
    }
    beginCallback(token) {
        const expected = this.restoredEvents[this.position];
        if (expected !== undefined) {
            if (expected.kind !== "callback-start" ||
                expected.token !== token ||
                expected.step !== this.steps) {
                throw new TypeError("Host callback does not match its recorded invocation.");
            }
            this.position += 1;
            return;
        }
        this.budget?.setRetainedDataUsage(this, Math.max(this.nextPromise - 1, this.restored.promises) * 3 +
            (this.callbackCount + 1) * 4 +
            (this.executionTrace?.nodes.length ?? 0));
        this.callbackCount += 1;
        this.events.push({
            kind: "callback-start",
            token,
            step: this.steps,
            promises: this.nextPromise - 1
        });
    }
    completeCallback(token) {
        if (this.failure !== undefined)
            return;
        this.completedCallbacks.add(token);
        this.drain();
    }
    waitForLiveExecution() {
        this.assertHealthy();
        if (this.position >= this.restoredEvents.length &&
            this.steps >= this.restored.steps &&
            this.nextPromise - 1 >= this.restored.promises)
            return;
        return new Promise((resolve, reject) => this.liveWaiters.add({ resolve, reject }));
    }
    registerCallbacks(callbacks) {
        this.assertHealthy();
        for (const callback of callbacks) {
            if (this.callbackTasks.has(callback.token))
                throw new TypeError("Duplicate replay callback registration.");
            this.callbackTasks.set(callback.token, callback.start);
        }
        this.drain();
        this.assertHealthy();
    }
    assertHealthy() {
        if (this.failure !== undefined)
            throw this.failure.reason;
    }
    fail(reason) {
        if (this.failure !== undefined)
            return;
        this.failure = { reason };
        for (const reject of this.rejectors.values())
            reject(reason);
        this.rejectors.clear();
        this.ready.clear();
        this.callbackTasks.clear();
        this.completedCallbacks.clear();
        for (const wake of this.waiting)
            wake();
        this.waiting.clear();
        for (const waiter of this.liveWaiters)
            waiter.reject(reason);
        this.liveWaiters.clear();
    }
    validateCallbacks(positions) {
        const callbacks = this.restoredEvents.filter((entry) => entry.kind === "callback-start");
        if (callbacks.length !== positions.size ||
            callbacks.some((entry) => positions.get(entry.token) !== entry.step)) {
            throw new TypeError("Callback trace does not match the host call journal.");
        }
    }
    validateNodes(root) {
        if (this.restored.executionTrace === undefined)
            return;
        const nodes = new Set();
        const seen = new WeakSet();
        const pending = [root];
        while (pending.length > 0) {
            const value = pending.pop();
            if (value === null || typeof value !== "object" || seen.has(value))
                continue;
            seen.add(value);
            if ("nodeId" in value && typeof value.nodeId === "number")
                nodes.add(value.nodeId);
            for (const child of Object.values(value)) {
                if (child !== null && typeof child === "object")
                    pending.push(child);
            }
        }
        if (this.restored.executionTrace.nodes.some((id) => !nodes.has(id)))
            throw new TypeError("Replay execution trace references a missing source node.");
    }
    snapshot() {
        return {
            version: 1,
            steps: Math.max(this.steps, this.restored.steps),
            promises: Math.max(this.nextPromise - 1, this.restored.promises),
            settlements: this.events
                .filter((entry) => entry.kind === "promise")
                .map(({ id, step }) => ({ id, step })),
            ...(this.callbackCount === 0 ? {} : { events: this.events.map((entry) => ({ ...entry })) }),
            ...(this.executionTrace === undefined
                ? {}
                : { executionTrace: structuredClone(this.executionTrace) })
        };
    }
    attachBudget(budget) {
        if (this.budget !== undefined)
            throw new TypeError("Promise replay already has a budget.");
        budget.setRetainedDataUsage(this, Math.max(this.nextPromise - 1, this.restored.promises) * 3 +
            this.callbackCount * 4 +
            (this.executionTrace?.nodes.length ?? 0));
        this.budget = budget;
    }
    dispose() {
        this.budget?.setRetainedDataUsage(this, 0);
        this.budget = undefined;
    }
    drain() {
        if (this.failure !== undefined)
            return;
        while (this.position < this.restoredEvents.length) {
            const expected = this.restoredEvents[this.position];
            if (expected.step > this.steps)
                return;
            if (expected.kind === "promise") {
                const settle = this.ready.get(expected.id);
                if (settle === undefined)
                    return;
                this.ready.delete(expected.id);
                this.position += 1;
                settle();
            }
            else if (expected.kind === "callback-start") {
                if (expected.promises >= this.nextPromise)
                    return;
                const start = this.callbackTasks.get(expected.token);
                if (start === undefined)
                    return;
                this.callbackTasks.delete(expected.token);
                this.position += 1;
                try {
                    start();
                }
                catch (error) {
                    this.fail(error);
                    return;
                }
                if (this.failure !== undefined)
                    return;
            }
            else {
                if (!this.completedCallbacks.delete(expected.token))
                    return;
                this.position += 1;
            }
            for (const wake of this.waiting)
                wake();
            this.waiting.clear();
        }
        if (this.steps < this.restored.steps || this.nextPromise - 1 < this.restored.promises)
            return;
        for (const [id, settle] of this.ready) {
            this.ready.delete(id);
            this.events.push({ kind: "promise", id, step: this.steps });
            settle();
        }
        for (const token of this.completedCallbacks) {
            this.completedCallbacks.delete(token);
            this.events.push({ kind: "callback-end", token, step: this.steps });
        }
        for (const waiter of this.liveWaiters)
            waiter.resolve();
        this.liveWaiters.clear();
    }
}
export const promiseReplayContext = new AsyncLocalStorage();
function validateReplay(value) {
    validateSnapshotData(value);
    if (value === null ||
        typeof value !== "object" ||
        !("version" in value) ||
        value.version !== 1 ||
        !("steps" in value) ||
        !isCounter(value.steps) ||
        !("promises" in value) ||
        !isCounter(value.promises) ||
        !("settlements" in value) ||
        !Array.isArray(value.settlements)) {
        throw new TypeError("Invalid promise replay header.");
    }
    const seen = new Set();
    const { promises, steps } = value;
    let previousStep = 0;
    const settlements = value.settlements.map((entry) => {
        if (entry === null ||
            typeof entry !== "object" ||
            !("id" in entry) ||
            !isCounter(entry.id) ||
            entry.id === 0 ||
            entry.id > promises ||
            seen.has(entry.id) ||
            !("step" in entry) ||
            !isCounter(entry.step) ||
            entry.step < previousStep ||
            entry.step > steps) {
            throw new TypeError("Invalid promise replay settlement.");
        }
        previousStep = entry.step;
        seen.add(entry.id);
        return { id: entry.id, step: entry.step };
    });
    const events = "events" in value ? validateEvents(value.events, steps, promises, settlements) : undefined;
    let executionTrace;
    if ("executionTrace" in value) {
        const trace = value.executionTrace;
        if (trace === null ||
            typeof trace !== "object" ||
            !("start" in trace) ||
            !isCounter(trace.start) ||
            !("nodes" in trace) ||
            !Array.isArray(trace.nodes) ||
            trace.start + trace.nodes.length !== steps ||
            trace.nodes.some((node) => !isCounter(node)))
            throw new TypeError("Invalid replay execution trace.");
        executionTrace = { start: trace.start, nodes: [...trace.nodes] };
    }
    return {
        version: 1,
        steps,
        promises,
        settlements,
        ...(events === undefined ? {} : { events }),
        ...(executionTrace === undefined ? {} : { executionTrace })
    };
}
function validateEvents(value, steps, promises, settlements) {
    if (!Array.isArray(value))
        throw new TypeError("Invalid replay event trace.");
    const started = new Set();
    const completed = new Set();
    let previousStep = 0;
    let promisePosition = 0;
    const events = value.map((entry) => {
        if (entry === null ||
            typeof entry !== "object" ||
            !("step" in entry) ||
            !isCounter(entry.step) ||
            entry.step < previousStep ||
            entry.step > steps ||
            !("kind" in entry)) {
            throw new TypeError("Invalid replay event position.");
        }
        previousStep = entry.step;
        if (entry.kind === "promise") {
            const settlement = settlements[promisePosition++];
            if (!("id" in entry) || settlement?.id !== entry.id || settlement.step !== entry.step)
                throw new TypeError("Replay events disagree with promise settlements.");
            return { kind: "promise", id: settlement.id, step: entry.step };
        }
        if (!("token" in entry) || typeof entry.token !== "string" || entry.token.length === 0)
            throw new TypeError("Invalid replay callback token.");
        if (entry.kind === "callback-start") {
            if (started.has(entry.token) ||
                !("promises" in entry) ||
                !isCounter(entry.promises) ||
                entry.promises > promises)
                throw new TypeError("Invalid callback start event.");
            started.add(entry.token);
            return {
                kind: "callback-start",
                token: entry.token,
                step: entry.step,
                promises: entry.promises
            };
        }
        if (entry.kind !== "callback-end" || !started.has(entry.token) || completed.has(entry.token))
            throw new TypeError("Invalid callback completion event.");
        completed.add(entry.token);
        return { kind: "callback-end", token: entry.token, step: entry.step };
    });
    if (promisePosition !== settlements.length)
        throw new TypeError("Replay events omit promise settlements.");
    return events;
}
function isCounter(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
