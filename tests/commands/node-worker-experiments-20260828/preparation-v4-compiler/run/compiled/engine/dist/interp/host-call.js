import { createHash, randomUUID } from "node:crypto";
import { createSandboxClosure, deepCopyToSandbox, measureSandboxData } from "./values.js";
import { decodeReplayData, encodeReplayData } from "../snapshot/replay-data.js";
import { validateSnapshotData } from "../snapshot/validation.js";
import { pendingHostCallResumeIdentityMatches } from "../snapshot/policy.js";
export class HostCallResumabilityError extends Error {
    action;
    callId;
    lifecycle;
    constructor(record, action, message) {
        super(message);
        this.name = "HostCallResumabilityError";
        this.action = action;
        this.callId = record.id;
        this.lifecycle = record.lifecycle;
    }
}
export class UnresolvedReplayCapabilityError extends TypeError {
    id;
    constructor(id) {
        super(`Missing replay capability '${id}'.`);
        this.id = id;
        this.name = "UnresolvedReplayCapabilityError";
    }
}
export class HostCallJournal {
    sourceHash;
    resumeProvider;
    budget;
    runId;
    nextCall = 1;
    records;
    restored;
    outcomes = new Map();
    recordedReplay;
    retainedSize = 0;
    outcomeSizes = new Map();
    capabilities = new Map();
    capabilityIds = new WeakMap();
    nativeClosures = new WeakMap();
    encodedOutcomes = new Map();
    callbackSizes = new Map();
    completedCallbackOwners = new Set();
    capabilityWaiters = new Map();
    identifyCapability = this.capabilityIds.get.bind(this.capabilityIds);
    resolveCapability = (id) => {
        const capability = this.capabilities.get(id);
        if (capability === undefined)
            throw new UnresolvedReplayCapabilityError(id);
        return capability;
    };
    constructor(sourceHash, records = [], resumeProvider, replay, budget) {
        this.sourceHash = sourceHash;
        this.resumeProvider = resumeProvider;
        this.budget = budget;
        this.recordedReplay = replay !== undefined;
        if (replay !== undefined) {
            const replayRecords = restoreReplayCalls(replay, this.encodedOutcomes, this.callbackSizes);
            const restoredRunId = replayRecords[0]?.runId ?? records[0]?.runId ?? randomUUID();
            validateRestoredRecords(records, restoredRunId, sourceHash);
            for (const record of records) {
                const replayRecord = replayRecords[readCallOrdinal(record) - 1];
                if (replayRecord === undefined ||
                    !callIdentityMatches(record, replayRecord) ||
                    record.lifecycle !== replayRecord.lifecycle) {
                    throw new HostCallResumabilityError(record, "reset", `Host call ${record.id} conflicts with the replay journal; reset is required.`);
                }
            }
            records = replayRecords;
        }
        this.runId = records[0]?.runId ?? randomUUID();
        this.records = records.map((record) => ({
            ...record,
            ...(record.functions === undefined ? {} : { functions: [...record.functions] }),
            ...(record.callbacks === undefined ? {} : { callbacks: structuredClone(record.callbacks) }),
            ...(record.outcome === undefined ? {} : { outcome: copyOutcome(record.outcome) })
        }));
        validateRestoredRecords(this.records, this.runId, sourceHash);
        this.retainedSize = this.records.length;
        try {
            this.budget?.setRetainedDataUsage(this, this.retainedSize);
            for (const record of this.records) {
                if (record.outcome !== undefined)
                    this.retainOutcome(record, record.outcome);
                for (const [index, callback] of (record.callbacks ?? []).entries()) {
                    this.retainedSize +=
                        1 +
                            (this.callbackSizes.get(`${record.id}/callback/${index + 1}`) ??
                                measureSandboxData([decodeReplayData(callback.arguments)]));
                }
            }
            this.budget?.setRetainedDataUsage(this, this.retainedSize);
        }
        catch (error) {
            this.dispose();
            throw error;
        }
        this.restored = [...this.records];
        this.budget?.setRetainedValues(this, () => this.capabilities.values());
    }
    issue(input) {
        const restored = this.restored[0];
        if (restored !== undefined) {
            const restoredOrdinal = readCallOrdinal(restored);
            if (this.nextCall < restoredOrdinal) {
                return { record: this.createRecord(input), restored: false };
            }
            if (!callIdentityMatches(restored, input)) {
                throw new HostCallResumabilityError(restored, "reset", `Host call ${restored.id} does not match the next restored invocation; reset is required.`);
            }
            this.restored.shift();
            this.nextCall += 1;
            return { record: restored, restored: true };
        }
        return { record: this.createRecord(input), restored: false };
    }
    createRecord(input) {
        this.budget?.setRetainedDataUsage(this, this.retainedSize + 1);
        this.retainedSize += 1;
        const record = {
            id: `${this.runId}:${this.nextCall++}`,
            runId: this.runId,
            sourceHash: this.sourceHash,
            moduleId: input.moduleId,
            operation: input.operation,
            argumentDigest: input.argumentDigest,
            policy: input.policy,
            lifecycle: "created"
        };
        this.records.push(record);
        this.records.sort((left, right) => readCallOrdinal(left) - readCallOrdinal(right));
        return record;
    }
    start(record) {
        record.lifecycle = "running";
    }
    settle(record, outcome) {
        if (record.lifecycle === "cancelled")
            return;
        this.retainOutcome(record, outcome);
        record.lifecycle = "settled";
    }
    consume(record) {
        if (record.lifecycle === "consumed") {
            throw new HostCallResumabilityError(record, "reset", `Host call ${record.id} result was already consumed; reset is required.`);
        }
        if (record.lifecycle !== "settled")
            return;
        record.lifecycle = "consumed";
    }
    cancel(record, reason) {
        if (record.lifecycle === "settled" || record.lifecycle === "consumed")
            return;
        this.retainOutcome(record, { status: "rejected", reason });
        record.lifecycle = "cancelled";
    }
    async reconcile(record, context) {
        if (record.lifecycle === "settled" && record.outcome !== undefined)
            return record.outcome;
        if (record.lifecycle === "consumed") {
            throw new HostCallResumabilityError(record, "reset", `Host call ${record.id} result was already consumed; reset is required.`);
        }
        if (record.lifecycle === "cancelled") {
            throw new HostCallResumabilityError(record, "reset", `Host call ${record.id} was cancelled; reset is required.`);
        }
        if (record.policy === "re-issue") {
            throw new HostCallResumabilityError(record, "reset", `Host call ${record.id} must be re-issued by the runtime.`);
        }
        if (this.resumeProvider === undefined) {
            throw new HostCallResumabilityError(record, "external-reconciliation", `Host call ${record.id} may have executed before process death; external reconciliation is required.`);
        }
        const { id, outcome: ignoredOutcome, ...request } = record;
        void ignoredOutcome;
        const proof = await this.resumeProvider({
            ...request,
            callId: id,
            requirement: "external-reconciliation"
        }, context);
        validateProof(record, proof);
        if (context !== undefined &&
            context.callbacks.size > 0 &&
            proof.callbackDisposition === undefined) {
            throw new HostCallResumabilityError(record, "external-reconciliation", `Host call ${record.id} has sandbox callbacks; its proof must specify callbackDisposition as joined or detached.`);
        }
        if (proof.callbackDisposition === "joined")
            await context?.waitForCallbacks();
        this.settle(record, proof.outcome);
        return proof.outcome;
    }
    snapshot() {
        return this.records
            .filter((record) => record.policy === "read-side-effect" ||
            record.lifecycle === "created" ||
            record.lifecycle === "running" ||
            record.lifecycle === "cancelled")
            .map(({ outcome, ...record }) => ({
            ...structuredClone(record),
            ...(outcome === undefined ? {} : { outcome: copyOutcome(outcome) })
        }));
    }
    dispose() {
        this.budget?.setRetainedDataUsage(this, 0);
        this.budget?.setRetainedValues(this, undefined);
        this.capabilities.clear();
        for (const [id, waiter] of this.capabilityWaiters)
            waiter.reject(new UnresolvedReplayCapabilityError(id));
        this.capabilityWaiters.clear();
        this.budget = undefined;
    }
    registerCallbackFunction(record, id, closure, native) {
        const identity = `${record.id}/function/${id}`;
        const existing = this.capabilities.get(identity);
        if (existing !== undefined && existing !== closure)
            throw new TypeError(`Conflicting replay capability '${identity}'.`);
        if (!(record.functions ?? []).includes(id))
            (record.functions ??= []).push(id);
        this.capabilities.set(identity, closure);
        this.capabilityWaiters.get(identity)?.resolve();
        this.capabilityWaiters.delete(identity);
        if (!this.capabilityIds.has(closure))
            this.capabilityIds.set(closure, identity);
        this.nativeClosures.set(native, closure);
    }
    waitForCapability(id) {
        if (this.capabilities.has(id))
            return Promise.resolve();
        const owner = id.slice(0, id.lastIndexOf("/function/"));
        if (this.completedCallbackOwners.has(owner))
            return Promise.reject(new UnresolvedReplayCapabilityError(id));
        let waiter = this.capabilityWaiters.get(id);
        if (waiter === undefined) {
            let resolve;
            let reject;
            const promise = new Promise((resolveResult, rejectResult) => {
                resolve = resolveResult;
                reject = rejectResult;
            });
            void promise.catch(() => undefined);
            waiter = { promise, resolve, reject };
            this.capabilityWaiters.set(id, waiter);
        }
        return waiter.promise;
    }
    trackCallbackCompletion(record, callbacks) {
        const complete = () => {
            this.completedCallbackOwners.add(record.id);
            for (const [id, waiter] of this.capabilityWaiters) {
                if (!id.startsWith(`${record.id}/function/`))
                    continue;
                waiter.reject(new UnresolvedReplayCapabilityError(id));
                this.capabilityWaiters.delete(id);
            }
        };
        if (callbacks.length === 0)
            complete();
        else
            void Promise.allSettled(callbacks).then(complete);
    }
    recordCallback(record, id, args, step) {
        const retainedSize = this.retainedSize + 1 + measureSandboxData([args], { ignoreClosures: true });
        this.budget?.setRetainedDataUsage(this, retainedSize);
        let data;
        try {
            data = encodeReplayData(args, { identifyCapability: this.identifyCapability });
        }
        catch (error) {
            this.budget?.setRetainedDataUsage(this, this.retainedSize);
            throw error;
        }
        this.retainedSize = retainedSize;
        (record.callbacks ??= []).push({ id, step, arguments: data });
        return `${record.id}/callback/${record.callbacks.length}`;
    }
    callbackPositions() {
        const positions = new Map();
        for (const record of this.records) {
            for (const [index, callback] of (record.callbacks ?? []).entries()) {
                positions.set(`${record.id}/callback/${index + 1}`, callback.step);
            }
        }
        return positions;
    }
    retainOutcome(record, outcome) {
        const size = measureSandboxData([outcome.status === "fulfilled" ? outcome.value : outcome.reason], { ignoreClosures: true });
        const retainedSize = this.retainedSize + size - (this.outcomeSizes.get(record.id) ?? 0);
        this.budget?.setRetainedDataUsage(this, retainedSize);
        let copied;
        try {
            copied = copyOutcome(outcome);
        }
        catch (error) {
            this.budget?.setRetainedDataUsage(this, this.retainedSize);
            throw error;
        }
        this.retainedSize = retainedSize;
        this.outcomeSizes.set(record.id, size);
        this.outcomes.set(record.id, copied);
        record.outcome = copied;
    }
    replayOutcome(record) {
        if (!this.recordedReplay || (record.lifecycle !== "settled" && record.lifecycle !== "consumed"))
            return undefined;
        const encoded = this.encodedOutcomes.get(record.id);
        if (encoded !== undefined) {
            const value = decodeReplayData(encoded.data, { resolveCapability: this.resolveCapability });
            return encoded.status === "fulfilled"
                ? { status: "fulfilled", value }
                : { status: "rejected", reason: value };
        }
        const outcome = this.outcomes.get(record.id);
        return outcome === undefined ? undefined : copyOutcome(outcome);
    }
    snapshotReplay() {
        return structuredClone({
            version: 1,
            calls: this.records.map(({ outcome: ignoredOutcome, asynchronous, ...record }) => {
                void ignoredOutcome;
                const outcome = this.outcomes.get(record.id);
                return {
                    ...record,
                    asynchronous: asynchronous === true,
                    ...(outcome === undefined
                        ? {}
                        : {
                            outcome: {
                                status: outcome.status,
                                data: this.encodedOutcomes.get(record.id)?.data ??
                                    encodeReplayData(outcome.status === "fulfilled" ? outcome.value : outcome.reason, { identifyCapability: this.identifyCapability })
                            }
                        })
                };
            })
        });
    }
}
function copyOutcome(outcome) {
    return outcome.status === "fulfilled"
        ? { status: "fulfilled", value: deepCopyToSandbox(outcome.value) }
        : { status: "rejected", reason: deepCopyToSandbox(outcome.reason) };
}
function restoreReplayCalls(input, encodedOutcomes, callbackSizes) {
    validateSnapshotData(input);
    if (input === null ||
        typeof input !== "object" ||
        !("version" in input) ||
        input.version !== 1 ||
        !("calls" in input) ||
        !Array.isArray(input.calls)) {
        throw new TypeError("Invalid host call replay header.");
    }
    const capabilities = new Map();
    for (const entry of input.calls) {
        if (entry?.functions === undefined)
            continue;
        if (!Array.isArray(entry.functions) ||
            new Set(entry.functions).size !== entry.functions.length ||
            entry.functions.some((id) => !Number.isSafeInteger(id) || Number(id) < 1))
            throw new TypeError("Invalid replay capability declarations.");
        for (const id of entry.functions) {
            capabilities.set(`${entry.id}/function/${id}`, createSandboxClosure({
                call: () => {
                    throw new TypeError("Replay capability has not been reconstructed.");
                }
            }));
        }
    }
    const resolveCapability = (id) => capabilities.get(id);
    return input.calls.map((entry, index) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry))
            throw new TypeError("Invalid replay call.");
        for (const field of ["id", "runId", "sourceHash", "moduleId", "operation", "argumentDigest"]) {
            if (!Object.hasOwn(entry, field) ||
                typeof entry[field] !== "string" ||
                entry[field].length === 0)
                throw new TypeError(`Invalid replay call ${field}.`);
        }
        if (typeof entry.asynchronous !== "boolean" ||
            !["re-issue", "read-side-effect"].includes(entry.policy) ||
            !["created", "running", "settled", "consumed", "cancelled"].includes(entry.lifecycle)) {
            throw new TypeError("Invalid replay call state.");
        }
        if (readCallOrdinal(entry) !== index + 1)
            throw new TypeError("Replay calls must have consecutive ordinals.");
        if (entry.callbacks !== undefined) {
            if (!Array.isArray(entry.callbacks))
                throw new TypeError("Invalid replay callbacks.");
            let previousStep = 0;
            for (const [index, callback] of entry.callbacks.entries()) {
                if (callback === null ||
                    typeof callback !== "object" ||
                    !Number.isSafeInteger(callback.id) ||
                    callback.id < 1 ||
                    !Number.isSafeInteger(callback.step) ||
                    callback.step < previousStep ||
                    !Array.isArray(decodeReplayData(callback.arguments, { resolveCapability })))
                    throw new TypeError("Invalid replay callback.");
                previousStep = callback.step;
                callbackSizes.set(`${entry.id}/callback/${index + 1}`, measureSandboxData([decodeReplayData(callback.arguments, { resolveCapability })]));
            }
        }
        let outcome;
        if (entry.outcome !== undefined) {
            if (entry.outcome === null ||
                typeof entry.outcome !== "object" ||
                !["fulfilled", "rejected"].includes(entry.outcome.status))
                throw new TypeError("Invalid replay call outcome.");
            const value = decodeReplayData(entry.outcome.data, { resolveCapability });
            encodedOutcomes.set(entry.id, structuredClone(entry.outcome));
            outcome =
                entry.outcome.status === "fulfilled"
                    ? { status: "fulfilled", value }
                    : { status: "rejected", reason: value };
        }
        else if (["settled", "consumed", "cancelled"].includes(entry.lifecycle)) {
            throw new TypeError("Missing replay call outcome.");
        }
        return { ...entry, ...(outcome === undefined ? {} : { outcome }) };
    });
}
function validateRestoredRecords(records, runId, sourceHash) {
    const ids = new Set();
    let previousOrdinal = 0;
    for (const record of records) {
        if (record.runId !== runId || !record.id.startsWith(`${runId}:`)) {
            throw new HostCallResumabilityError(record, "reset", `Host call ${record.id} does not belong to restored run ${runId}; reset is required.`);
        }
        if (record.sourceHash !== sourceHash) {
            throw new HostCallResumabilityError(record, "reset", `Host call ${record.id} does not match the restored source; reset is required.`);
        }
        if (ids.has(record.id)) {
            throw new HostCallResumabilityError(record, "reset", `Host call ${record.id} appears more than once; reset is required.`);
        }
        const ordinal = readCallOrdinal(record);
        if (ordinal <= previousOrdinal) {
            throw new HostCallResumabilityError(record, "reset", `Host call ${record.id} is out of order; reset is required.`);
        }
        previousOrdinal = ordinal;
        ids.add(record.id);
    }
}
function readCallOrdinal(record) {
    const ordinal = Number(record.id.slice(record.id.lastIndexOf(":") + 1));
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
        throw new HostCallResumabilityError(record, "reset", `Host call ${record.id} has an invalid ordinal; reset is required.`);
    }
    return ordinal;
}
function callIdentityMatches(record, input) {
    return (record.moduleId === input.moduleId &&
        record.operation === input.operation &&
        record.argumentDigest === input.argumentDigest &&
        record.policy === input.policy);
}
export function digestHostCallArguments(args) {
    return createHash("sha256").update(stableStringify(args)).digest("hex");
}
function validateProof(record, proof) {
    if (proof.callbackDisposition !== undefined &&
        proof.callbackDisposition !== "joined" &&
        proof.callbackDisposition !== "detached") {
        throw new HostCallResumabilityError(record, "external-reconciliation", "Invalid callbackDisposition in external result proof.");
    }
    if (!pendingHostCallResumeIdentityMatches({
        argumentDigest: record.argumentDigest,
        callId: record.id,
        moduleId: record.moduleId,
        operation: record.operation,
        sourceHash: record.sourceHash
    }, proof)) {
        throw new HostCallResumabilityError(record, "external-reconciliation", `External result proof does not match host call ${record.id}.`);
    }
}
function stableStringify(value) {
    const seen = new WeakSet();
    return JSON.stringify(normalize(value, seen));
}
function normalize(value, seen) {
    if (value === undefined)
        return { $type: "undefined" };
    if (typeof value === "number" && !Number.isFinite(value))
        return { $type: "number", value: String(value) };
    if (value === null || typeof value !== "object")
        return value;
    if (seen.has(value))
        throw new TypeError("Host call arguments cannot contain cycles.");
    seen.add(value);
    try {
        if (Array.isArray(value))
            return value.map((entry) => normalize(entry, seen));
        return Object.fromEntries(Object.keys(value)
            .sort()
            .map((key) => [key, normalize(value[key], seen)]));
    }
    finally {
        seen.delete(value);
    }
}
