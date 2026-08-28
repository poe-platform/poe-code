import { createSubsetErrorValue } from "./exceptions.js";
import { runPromiseJob } from "./jobs.js";
import { observeSandboxPromise } from "./promise-tracker.js";
import { createSandboxClosure, createSandboxPromise, isSandboxClosure, isSandboxPromise } from "./values.js";
export function createPromiseGlobals(options) {
    return {
        Promise: {
            all: createSandboxClosure({
                async: true,
                call: ([values]) => createSandboxPromise(settleIterable(values, (entries) => Promise.all(entries), options.budget)),
                name: "all"
            }),
            race: createSandboxClosure({
                async: true,
                call: ([values]) => createSandboxPromise(settleIterable(values, (entries) => Promise.race(entries), options.budget)),
                name: "race"
            }),
            allSettled: createSandboxClosure({
                async: true,
                call: ([values]) => createSandboxPromise(settleIterable(values, (entries) => Promise.allSettled(entries).then((results) => budgetSandboxValue(results.map((result) => result.status === "fulfilled"
                    ? {
                        status: "fulfilled",
                        value: result.value
                    }
                    : {
                        reason: result.reason,
                        status: "rejected"
                    }), options.budget)), options.budget)),
                name: "allSettled"
            }),
            any: createSandboxClosure({
                async: true,
                call: ([values]) => createSandboxPromise(settleIterable(values, (entries) => Promise.any(entries).catch((error) => {
                    const aggregate = createSubsetErrorValue("AggregateError", "All promises were rejected", [], options.budget);
                    aggregate.errors = Array.isArray(error.errors)
                        ? error.errors
                        : [];
                    throw budgetSandboxValue(aggregate, options.budget);
                }), options.budget)),
                name: "any"
            }),
            resolve: createSandboxClosure({
                async: true,
                call: ([value]) => isSandboxPromise(value)
                    ? value
                    : createSandboxPromise(resolveSandboxValue(value, { budget: options.budget })),
                name: "resolve"
            }),
            reject: createSandboxClosure({
                async: true,
                call: ([reason], context) => createRejectedSandboxPromise(reason, options.budget, context?.span),
                name: "reject"
            })
        }
    };
}
export function getPromiseMember(target, property, budget) {
    if (property === "then") {
        return createSandboxClosure({
            async: true,
            call: ([onFulfilled, onRejected]) => {
                observeSandboxPromise(target);
                const chained = createSandboxPromise(target.promise.then((value) => runPromiseReaction(onFulfilled, value, "fulfilled", budget, chained), (reason) => runPromiseReaction(onRejected, reason, "rejected", budget, chained)));
                return chained;
            },
            name: "then"
        });
    }
    if (property === "catch") {
        return createSandboxClosure({
            async: true,
            call: ([onRejected]) => {
                observeSandboxPromise(target);
                const chained = createSandboxPromise(target.promise.then((value) => runPromiseReaction(undefined, value, "fulfilled", budget, chained), (reason) => runPromiseReaction(onRejected, reason, "rejected", budget, chained)));
                return chained;
            },
            name: "catch"
        });
    }
    if (property === "finally") {
        return createSandboxClosure({
            async: true,
            call: ([onFinally]) => {
                observeSandboxPromise(target);
                const chained = createSandboxPromise(target.promise.then((value) => runPromiseFinally(onFinally, value, "fulfilled", budget, chained), (reason) => runPromiseFinally(onFinally, reason, "rejected", budget, chained)));
                return chained;
            },
            name: "finally"
        });
    }
    return undefined;
}
function settleIterable(iterable, settle, budget) {
    return Promise.resolve().then(() => settle(toHostPromiseArray(iterable, budget)).then((value) => budgetSandboxValue(value, budget)));
}
function toHostPromiseArray(iterable, budget) {
    const iterator = getPromiseIterator(iterable);
    if (iterator === undefined) {
        throw new TypeError("Promise helpers require an iterable.");
    }
    const entries = [];
    while (true) {
        const next = readIteratorNext(iterator);
        if (next.done === true) {
            return entries;
        }
        entries.push(resolveSandboxValue(next.value, { budget }));
    }
}
function getPromiseIterator(iterable) {
    if (typeof iterable === "string") {
        return iterable[Symbol.iterator]();
    }
    if ((typeof iterable !== "object" && typeof iterable !== "function") || iterable === null) {
        return undefined;
    }
    const iteratorMethod = iterable[Symbol.iterator];
    if (typeof iteratorMethod !== "function") {
        return undefined;
    }
    const iterator = Reflect.apply(iteratorMethod, iterable, []);
    if ((typeof iterator !== "object" && typeof iterator !== "function") || iterator === null) {
        throw new TypeError("Promise helper iterable returned a non-object iterator.");
    }
    return iterator;
}
function readIteratorNext(iterator) {
    const nextMethod = iterator.next;
    if (typeof nextMethod !== "function") {
        throw new TypeError("Promise helper iterator requires a next method.");
    }
    const next = Reflect.apply(nextMethod, iterator, []);
    if (typeof next !== "object" || next === null) {
        throw new TypeError("Iterator result must be an object.");
    }
    return next;
}
function schedulePromise(promise, budget) {
    return Promise.resolve().then(() => promise.then((value) => resolveSandboxValue(value, { budget }), (reason) => Promise.reject(budgetSandboxValue(reason, budget))));
}
function createRejectedSandboxPromise(reason, budget, span) {
    const promise = schedulePromise(Promise.reject(reason), budget);
    // Mark the host promise as handled immediately while preserving its rejected state for sandbox await.
    promise.catch(() => undefined);
    return createSandboxPromise(promise, { span });
}
function budgetSandboxValue(value, budget) {
    allocateSandboxValue(value, budget, new WeakSet());
    return value;
}
export function resolveSandboxValue(value, options = {}) {
    return Promise.resolve().then(() => resolveSandboxValueNow(value, options, new WeakSet()));
}
// A host call result is consumed once, when it settles. Observing the same promise
// again is ordinary JavaScript and must not be reported as a double consumption.
export function consumeSettledHostCall(value) {
    if (value.hostCall?.lifecycle !== "settled") {
        return;
    }
    value.hostCallJournal?.consume(value.hostCall);
}
function resolveSandboxValueNow(value, options, seenThenables) {
    if (isPromiseLike(value)) {
        return Promise.resolve(value).then((resolved) => resolveSandboxValueNow(resolved, options, seenThenables), (reason) => Promise.reject(budgetIfNeeded(reason, options.budget)));
    }
    if (isSandboxPromise(value)) {
        observeSandboxPromise(value);
        return value.promise.then((resolved) => {
            consumeSettledHostCall(value);
            return resolveSandboxValueNow(resolved, options, seenThenables);
        }, (reason) => {
            consumeSettledHostCall(value);
            return Promise.reject(budgetIfNeeded(reason, options.budget));
        });
    }
    const then = getThenable(value);
    if (then !== undefined) {
        return resolveThenable(value, then, options, seenThenables);
    }
    return Promise.resolve(budgetIfNeeded(value, options.budget));
}
function resolveThenable(value, then, options, seenThenables) {
    if (typeof value !== "object" || value === null) {
        return Promise.resolve(budgetIfNeeded(value, options.budget));
    }
    if (seenThenables.has(value)) {
        return Promise.reject({
            message: "Promise cannot resolve to itself.",
            name: "TypeError"
        });
    }
    seenThenables.add(value);
    return new Promise((resolve, reject) => {
        let settlement;
        let completed = false;
        let invocationPending = true;
        const complete = () => {
            if (completed || invocationPending || settlement === undefined)
                return;
            completed = true;
            try {
                if (settlement.state === "fulfilled") {
                    resolve(resolveSandboxValueNow(settlement.value, options, seenThenables));
                }
                else {
                    reject(budgetIfNeeded(settlement.value, options.budget));
                }
            }
            catch (error) {
                reject(error);
            }
        };
        const recordSettlement = (state, settledValue) => {
            if (settlement !== undefined) {
                return;
            }
            settlement = { state, value: settledValue };
            queueMicrotask(complete);
        };
        callInPromiseJob(then, [
            createSandboxClosure({
                call: ([resolved]) => {
                    recordSettlement("fulfilled", resolved);
                    return undefined;
                },
                name: "resolve"
            }),
            createSandboxClosure({
                call: ([reason]) => {
                    recordSettlement("rejected", reason);
                    return undefined;
                },
                name: "reject"
            })
        ], value).then(() => {
            invocationPending = false;
            complete();
        }, (error) => {
            invocationPending = false;
            recordSettlement("rejected", error);
            complete();
        });
    }).then((resolved) => budgetIfNeeded(resolved, options.budget));
}
function runPromiseReaction(handler, value, state, budget, self) {
    if (!isSandboxClosure(handler)) {
        return state === "fulfilled"
            ? Promise.resolve(value)
            : Promise.reject(budgetSandboxValue(value, budget));
    }
    return callInPromiseJob(handler, [value]).then(({ value: result }) => resolveReactionResult(result, budget, self));
}
function runPromiseFinally(handler, value, state, budget, self) {
    if (!isSandboxClosure(handler)) {
        return runPromiseReaction(undefined, value, state, budget);
    }
    return callInPromiseJob(handler, []).then(({ value: result }) => resolveReactionResult(result, budget, self).then(() => runPromiseReaction(undefined, value, state, budget)));
}
function callInPromiseJob(handler, args, thisValue = undefined) {
    return runPromiseJob(async () => {
        let result = handler.call(args, { stack: [], thisValue });
        if (handler.async !== true)
            result = await result;
        if (isSandboxPromise(result) && result.synchronousPrefix !== undefined) {
            await result.synchronousPrefix;
        }
        return { value: result };
    });
}
function resolveReactionResult(result, budget, self) {
    return Promise.resolve(result).then((resolved) => {
        if (isSelfResolution(resolved, self)) {
            return Promise.reject({
                message: "Promise cannot resolve to itself.",
                name: "TypeError"
            });
        }
        return resolveSandboxValue(resolved, { budget });
    });
}
function isSelfResolution(result, self) {
    return (self !== undefined &&
        (result === self || (isSandboxPromise(result) && result.promise === self.promise)));
}
export function getThenable(value) {
    if (typeof value !== "object" || value === null || isSandboxPromise(value)) {
        return undefined;
    }
    const then = isSandboxClosure(value)
        ? value.properties?.then
        : value.then;
    return isSandboxClosure(then) ? then : undefined;
}
function budgetIfNeeded(value, budget) {
    return budget === undefined ? value : budgetSandboxValue(value, budget);
}
function allocateSandboxValue(value, budget, seen) {
    if (typeof value === "string") {
        budget.allocateString(value);
        return;
    }
    if (Array.isArray(value)) {
        budget.allocateArrayLength(value.length);
        if (seen.has(value)) {
            return;
        }
        seen.add(value);
        for (const entry of value) {
            allocateSandboxValue(entry, budget, seen);
        }
        return;
    }
    if (typeof value !== "object" ||
        value === null ||
        isSandboxClosure(value) ||
        isSandboxPromise(value)) {
        return;
    }
    if (seen.has(value)) {
        return;
    }
    seen.add(value);
    for (const entry of Object.values(value)) {
        allocateSandboxValue(entry, budget, seen);
    }
}
function isPromiseLike(value) {
    return (typeof value === "object" &&
        value !== null &&
        "then" in value &&
        typeof value.then === "function" &&
        !isSandboxClosure(value) &&
        !isSandboxPromise(value));
}
