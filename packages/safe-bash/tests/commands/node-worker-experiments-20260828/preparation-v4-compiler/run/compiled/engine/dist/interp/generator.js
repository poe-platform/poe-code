import { enterRunningState } from "./running-state.js";
export function createGeneratorChannel(body) {
    let state = "unstarted";
    let signal = deferred();
    let resume;
    const start = deferred();
    const sent = [];
    let yieldNodeId;
    const bodyPromise = start.promise.then(() => body(yieldValue));
    void bodyPromise.then((value) => {
        if (state === "done") {
            return;
        }
        state = "done";
        signal.resolve({ type: "complete", value });
    }, (error) => {
        if (state === "done") {
            return;
        }
        state = "done";
        signal.resolve({ type: "error", error });
    });
    void bodyPromise.catch(() => undefined);
    async function yieldValue(value, nodeId) {
        resume = deferred();
        yieldNodeId = nodeId;
        state = "suspended";
        signal.resolve({ type: "yield", value });
        return resume.promise;
    }
    async function deliver(completion) {
        const leaveRunning = enterRunningState(channelIdentity);
        try {
            if (state === "done") {
                if (completion.type === "return") {
                    return { value: completion.value, done: true };
                }
                if (completion.type === "throw") {
                    throw completion.value;
                }
                return { value: undefined, done: true };
            }
            if (state === "unstarted") {
                if (completion.type === "return") {
                    state = "done";
                    return { value: completion.value, done: true };
                }
                if (completion.type === "throw") {
                    state = "done";
                    throw completion.value;
                }
                state = "running";
                sent.push(completion);
                start.resolve();
            }
            else {
                state = "running";
                sent.push(completion);
                signal = deferred();
                const pendingResume = resume;
                resume = undefined;
                pendingResume?.resolve(completion);
            }
            const settled = await signal.promise;
            if (settled.type === "yield") {
                return { value: settled.value, done: false };
            }
            if (settled.type === "error") {
                throw settled.error;
            }
            return { value: settled.value, done: true };
        }
        finally {
            leaveRunning();
        }
    }
    const channelIdentity = {};
    return {
        next: (value) => deliver({ type: "normal", value }),
        return: (value) => deliver({ type: "return", value }),
        throw: (error) => deliver({ type: "throw", value: error }),
        snapshot: () => ({
            ...(yieldNodeId === undefined ? {} : { yieldNodeId }),
            sent: sent.map((completion) => ({ ...completion }))
        })
    };
}
export function restoreGeneratorChannel(body, snapshot) {
    const channel = createGeneratorChannel(body);
    const sent = snapshot.sent.map((completion) => ({ ...completion }));
    let restored = false;
    let restoring;
    const ensureRestored = () => {
        if (restored) {
            return Promise.resolve();
        }
        restoring ??= replay();
        return restoring;
    };
    const deliver = async (method, value) => {
        await ensureRestored();
        sent.push({
            type: method === "next" ? "normal" : method,
            value
        });
        return channel[method](value);
    };
    return {
        next: (value) => deliver("next", value),
        return: (value) => deliver("return", value),
        throw: (error) => deliver("throw", error),
        snapshot: () => ({
            yieldNodeId: restored ? channel.snapshot().yieldNodeId : snapshot.yieldNodeId,
            sent: sent.map((completion) => ({ ...completion }))
        })
    };
    async function replay() {
        const result = await channel.next();
        if (result.done) {
            throw new TypeError("Cannot restore a suspended generator that completed during replay.");
        }
        if (channel.snapshot().yieldNodeId !== snapshot.yieldNodeId) {
            throw new TypeError("Cannot restore generator at the recorded yield expression.");
        }
        restored = true;
    }
}
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });
    return { promise, reject, resolve };
}
