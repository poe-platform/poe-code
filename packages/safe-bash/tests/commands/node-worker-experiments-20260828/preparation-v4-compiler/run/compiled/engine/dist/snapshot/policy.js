const DEFAULT_PENDING_HOST_CALL_POLICY = "re-issue";
const MODULE_PENDING_HOST_CALL_POLICIES = Object.assign(Object.create(null), {
    agent: Object.assign(Object.create(null), {
        spawn: "read-side-effect"
    }),
    git: Object.assign(Object.create(null), {
        checkpoint: "read-side-effect",
        commit: "read-side-effect",
        diff: "re-issue",
        head: "re-issue",
        revert: "read-side-effect",
        worktreeCreate: "read-side-effect",
        worktreeList: "re-issue",
        worktreeRemove: "read-side-effect"
    })
});
export class HostOperationResumePolicyError extends Error {
    moduleId;
    operation;
    constructor(moduleId, operation) {
        super(`Host operation ${moduleId}.${operation} has no resume policy; declare 're-issue' (idempotent) or 'read-side-effect' (effectful).`);
        this.name = "HostOperationResumePolicyError";
        this.moduleId = moduleId;
        this.operation = operation;
    }
}
export function registerPendingHostCallPolicy(registration) {
    const moduleId = readRequiredString(registration.moduleId, "moduleId");
    const operation = readRequiredString(registration.operation, "operation");
    const policy = readPendingHostCallPolicyModeValue(registration.policy);
    MODULE_PENDING_HOST_CALL_POLICIES[moduleId] ??= Object.create(null);
    MODULE_PENDING_HOST_CALL_POLICIES[moduleId][operation] = policy;
}
export function resolvePendingHostCallIssuePolicy(call) {
    const mode = readPendingHostCallPolicyMode(call);
    if (mode === "re-issue") {
        return {
            kind: "re-issue"
        };
    }
    return {
        kind: "read-side-effect",
        sideEffectTag: createPendingHostCallSideEffectTag(call)
    };
}
export function tagPendingHostCallAtIssue(call) {
    const policy = resolvePendingHostCallIssuePolicy(call);
    if (policy.kind === "re-issue") {
        return { ...call };
    }
    return {
        ...call,
        sideEffectTag: policy.sideEffectTag
    };
}
export function resolvePendingHostCallResumePolicy(call) {
    readPendingHostCallPolicyMode(call);
    if (call.sideEffectTag !== undefined) {
        const expectedTag = createPendingHostCallSideEffectTag(call);
        const sideEffectTag = normalizePendingHostCallSideEffectTag(call.sideEffectTag);
        if (sideEffectTag.callId !== expectedTag.callId) {
            throw new Error("Pending host call side-effect tag callId must match the pending host call id.");
        }
        if (sideEffectTag.moduleId !== expectedTag.moduleId ||
            sideEffectTag.operation !== expectedTag.operation) {
            throw new Error("Pending host call side-effect tag moduleId and operation must match the pending host call.");
        }
        return {
            kind: "read-side-effect",
            sideEffectTag
        };
    }
    return resolvePendingHostCallIssuePolicy(call);
}
export function createPendingHostCallSideEffectTag(call) {
    return {
        kind: "host-call-side-effect",
        callId: readRequiredString(String(call.id), "id"),
        moduleId: readRequiredString(call.moduleId, "moduleId"),
        operation: readRequiredString(call.operation, "operation")
    };
}
export function pendingHostCallResumeIdentityMatches(expected, actual) {
    return (actual.callId === expected.callId &&
        actual.sourceHash === expected.sourceHash &&
        actual.moduleId === expected.moduleId &&
        actual.operation === expected.operation &&
        actual.argumentDigest === expected.argumentDigest);
}
function readPendingHostCallPolicyMode(call) {
    const moduleId = call.moduleId?.trim();
    const operation = call.operation?.trim();
    if (moduleId === undefined ||
        moduleId.length === 0 ||
        operation === undefined ||
        operation.length === 0) {
        return DEFAULT_PENDING_HOST_CALL_POLICY;
    }
    const policy = MODULE_PENDING_HOST_CALL_POLICIES[moduleId]?.[operation];
    if (policy === undefined) {
        throw new HostOperationResumePolicyError(moduleId, operation);
    }
    return policy;
}
function readRequiredString(value, label) {
    const normalizedValue = value?.trim();
    if (normalizedValue === undefined || normalizedValue.length === 0) {
        throw new Error(`Pending host call ${label} must be a non-empty string.`);
    }
    return normalizedValue;
}
function readPendingHostCallPolicyModeValue(value) {
    if (value === "re-issue" || value === "read-side-effect") {
        return value;
    }
    throw new Error("Pending host call policy must be 're-issue' or 'read-side-effect'.");
}
function normalizePendingHostCallSideEffectTag(value) {
    if (value.kind !== "host-call-side-effect") {
        throw new Error("Pending host call side-effect tag kind must be 'host-call-side-effect'.");
    }
    return {
        kind: "host-call-side-effect",
        callId: readRequiredString(value.callId, "side-effect tag callId"),
        moduleId: readRequiredString(value.moduleId, "side-effect tag moduleId"),
        operation: readRequiredString(value.operation, "side-effect tag operation")
    };
}
