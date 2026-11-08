import { replaceErrorStack } from "../error/shape.js";
import { types } from "node:util";
import { DUMP_FORMAT_VERSION } from "./dump-format.js";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
const DEFAULT_MAX_DEPTH = MAX_DATA_DEPTH;
const DEFAULT_MAX_ENTRIES = 100_000;
const DEFAULT_MAX_STRING_LENGTH = 1_000_000;
const DEFAULT_MAX_DATA_SIZE = 16_000_000;
const TAGGED_VALUE_KINDS = new Set([
    "arguments",
    "array",
    "fn",
    "generator",
    "host-call-side-effect",
    "map",
    "number",
    "object",
    "promise",
    "ref",
    "regex",
    "set",
    "undefined"
]);
export class SnapshotValidationError extends Error {
    code;
    path;
    constructor(code, path, detail) {
        super(`Invalid snapshot at ${path}: ${detail}`);
        this.name = "SnapshotValidationError";
        this.code = code;
        this.path = path;
        replaceErrorStack(this);
    }
}
export function validateSnapshotData(value) {
    validateGenericValue(value, "$", 0, {
        allowFunctions: false,
        allowUndefined: false,
        entries: 0,
        dataSize: 0,
        limits: defaultLimits(),
        validateTaggedPayloads: false,
        dataPropertiesOnly: true
    });
}
export function validateDumpEnvelope(snapshot) {
    const limits = defaultLimits();
    const root = requireRecord(snapshot, "$");
    if (root.version !== DUMP_FORMAT_VERSION) {
        fail("unsupportedVersion", "$.version", `expected ${DUMP_FORMAT_VERSION}`);
    }
    requireNonEmptyString(root.sourceHash, "$.sourceHash", limits);
    const replayError = Object.getOwnPropertyDescriptor(root, "replayError");
    if (replayError !== undefined) {
        if (!("value" in replayError))
            fail("invalidType", "$.replayError", "must be a data property");
        const reason = requireNonEmptyString(replayError.value, "$.replayError", limits);
        fail("invalidState", "$.replayError", `snapshot is not replayable: ${reason}`);
    }
    const state = {
        allowFunctions: true,
        allowUndefined: true,
        entries: 0,
        dataSize: 0,
        limits,
        validateTaggedPayloads: false
    };
    validateGenericValue(root, "$", 0, state);
    validateRunSnapshotState(root, state);
    validateDumpHeap(root, state);
}
function validateDumpHeap(root, state) {
    const heap = root.heap === undefined ? Object.create(null) : requireRecord(root.heap, "$.heap");
    const heapIds = new Set();
    for (const [key, value] of Object.entries(heap)) {
        const path = `$.heap${formatKey(key)}`;
        const id = parseHeapId(key, path);
        addUnique(heapIds, id, path);
        const entry = requireRecord(value, path);
        if (entry.kind === "arguments") {
            validateArgumentsProperties(entry, path);
            continue;
        }
        if (entry.kind === "array") {
            requireArray(entry.items, `${path}.items`, state);
            continue;
        }
        if (entry.kind === "object") {
            requireRecord(entry.entries, `${path}.entries`);
            continue;
        }
        fail("unknownTag", `${path}.kind`, "unknown dump heap tag");
    }
    validateDumpReferences(root, "$", 0, state, heapIds);
}
function validateDumpReferences(value, path, depth, state, heapIds) {
    if (value === null || typeof value !== "object")
        return;
    if (depth > state.limits.maxDepth)
        fail("budgetExceeded", path, `exceeds nesting limit ${state.limits.maxDepth}`);
    if (Array.isArray(value)) {
        value.forEach((entry, index) => validateDumpReferences(entry, `${path}[${index}]`, depth + 1, state, heapIds));
        return;
    }
    const record = value;
    if (record.kind === "ref") {
        const id = requireSafeInteger(record.id, `${path}.id`, 1);
        if (!heapIds.has(id))
            fail("danglingReference", `${path}.id`, `unknown heap value ${id}`);
    }
    for (const [key, entry] of Object.entries(record)) {
        validateDumpReferences(entry, `${path}${formatKey(key)}`, depth + 1, state, heapIds);
    }
}
function validateRunSnapshotState(root, state) {
    if (root.clock !== undefined) {
        const clock = requireRecord(root.clock, "$.clock");
        requireSafeInteger(clock.next, "$.clock.next", 0);
    }
    if (root.random !== undefined) {
        const random = requireRecord(root.random, "$.random");
        requireSafeInteger(random.seed, "$.random.seed", 0);
        requireSafeInteger(random.state, "$.random.state", 0);
        for (const field of ["initialState", "resumeState"]) {
            if (random[field] !== undefined)
                requireSafeInteger(random[field], `$.random.${field}`, 0);
        }
    }
    if (root.loopIterations !== undefined) {
        const iterations = requireRecord(root.loopIterations, "$.loopIterations");
        for (const [nodeId, value] of Object.entries(iterations)) {
            const path = `$.loopIterations${formatKey(nodeId)}`;
            requireSafeInteger(Number(nodeId), `${path}#key`, 0);
            if (typeof value === "number") {
                requireSafeInteger(value, path, 0);
                continue;
            }
            const iteration = requireRecord(value, path);
            requireSafeInteger(iteration.index, `${path}.index`, 0);
            requireArray(iteration.values, `${path}.values`, state);
        }
    }
    if (root.pendingAwaits !== undefined) {
        const pendingAwaits = requireArray(root.pendingAwaits, "$.pendingAwaits", state);
        pendingAwaits.forEach((value, index) => {
            const path = `$.pendingAwaits[${index}]`;
            const pending = requireRecord(value, path);
            if (pending.nodeId !== undefined)
                requireSafeInteger(pending.nodeId, `${path}.nodeId`, 0);
            const span = requireRecord(pending.span, `${path}.span`);
            const start = validatePosition(span.start, `${path}.span.start`);
            const end = validatePosition(span.end, `${path}.span.end`);
            if (start > end) {
                fail("invalidValue", `${path}.span`, "start must not exceed end");
            }
        });
    }
}
function validatePosition(value, path) {
    const position = requireRecord(value, path);
    requireSafeInteger(position.line, `${path}.line`, 1);
    requireSafeInteger(position.column, `${path}.column`, 0);
    return requireSafeInteger(position.offset, `${path}.offset`, 0);
}
export function validateInterpreterSnapshot(snapshot, nodeById, budget) {
    const limits = limitsFromBudget(budget);
    const state = {
        allowFunctions: false,
        allowUndefined: false,
        entries: 0,
        dataSize: 0,
        limits,
        validateTaggedPayloads: true
    };
    const root = requireRecord(snapshot, "$");
    requireNonEmptyString(root.sourceHash, "$.sourceHash", limits);
    requireNodeId(root.currentAstNodeId, "$.currentAstNodeId", nodeById);
    const scopes = requireArray(root.scopeChain, "$.scopeChain", state);
    const calls = requireArray(root.callStack, "$.callStack", state);
    const promises = requireArray(root.pendingPromises, "$.pendingPromises", state);
    const moduleBindings = requireRecord(root.moduleBindings, "$.moduleBindings");
    const heap = root.heap === undefined ? Object.create(null) : requireRecord(root.heap, "$.heap");
    if (calls.length > limits.maxCallDepth) {
        fail("budgetExceeded", "$.callStack", `exceeds call-depth limit ${limits.maxCallDepth}`);
    }
    const scopeIds = new Set();
    const parentById = new Map();
    scopes.forEach((value, index) => {
        const path = `$.scopeChain[${index}]`;
        const scope = requireRecord(value, path);
        const id = requireSnapshotId(scope.id, `${path}.id`);
        addUnique(scopeIds, id, `${path}.id`);
        if (scope.parentId !== undefined) {
            parentById.set(id, requireSnapshotId(scope.parentId, `${path}.parentId`));
        }
        validateValue(requireRecord(scope.bindings, `${path}.bindings`), `${path}.bindings`, 1, state);
    });
    for (const [id, parentId] of parentById) {
        if (!scopeIds.has(parentId))
            fail("danglingReference", scopeParentPath(scopes, id), `unknown scope ${String(parentId)}`);
    }
    validateScopeCycles(scopeIds, parentById);
    const promiseIds = new Set();
    promises.forEach((value, index) => {
        const path = `$.pendingPromises[${index}]`;
        const promise = requireRecord(value, path);
        addUnique(promiseIds, requireSnapshotId(promise.id, `${path}.id`), `${path}.id`);
        validateValue(promise, path, 1, state);
        if (promise.status !== undefined &&
            !["pending", "fulfilled", "rejected"].includes(String(promise.status))) {
            fail("invalidState", `${path}.status`, "unknown promise state");
        }
        if (promise.status === "pending" &&
            (Object.hasOwn(promise, "value") || Object.hasOwn(promise, "reason"))) {
            fail("invalidState", path, "pending promise cannot contain a settled value");
        }
        if (promise.status === "fulfilled") {
            if (!Object.hasOwn(promise, "value")) {
                fail("invalidState", `${path}.value`, "fulfilled promise must contain a value");
            }
            if (Object.hasOwn(promise, "reason")) {
                fail("invalidState", path, "fulfilled promise cannot contain a rejection reason");
            }
        }
        if (promise.status === "rejected") {
            if (!Object.hasOwn(promise, "reason")) {
                fail("invalidState", `${path}.reason`, "rejected promise must contain a reason");
            }
            if (Object.hasOwn(promise, "value")) {
                fail("invalidState", path, "rejected promise cannot contain a fulfilled value");
            }
        }
        validatePendingHostCall(promise, path, state);
    });
    calls.forEach((value, index) => {
        const path = `$.callStack[${index}]`;
        const frame = requireRecord(value, path);
        requireNodeId(frame.astNodeId, `${path}.astNodeId`, nodeById);
        const scopeId = requireSnapshotId(frame.scopeId, `${path}.scopeId`);
        if (!scopeIds.has(scopeId))
            fail("danglingReference", `${path}.scopeId`, `unknown scope ${String(scopeId)}`);
        if (frame.awaitingPromiseId !== undefined) {
            const promiseId = requireSnapshotId(frame.awaitingPromiseId, `${path}.awaitingPromiseId`);
            if (!promiseIds.has(promiseId))
                fail("danglingReference", `${path}.awaitingPromiseId`, `unknown promise ${String(promiseId)}`);
        }
    });
    for (const [key, value] of Object.entries(moduleBindings)) {
        requireNonEmptyString(key, `$.moduleBindings${formatKey(key)}`, limits);
        requireNonEmptyString(value, `$.moduleBindings${formatKey(key)}`, limits);
    }
    const heapIds = new Set();
    for (const [key, value] of Object.entries(heap)) {
        const id = parseHeapId(key, `$.heap${formatKey(key)}`);
        addUnique(heapIds, id, `$.heap${formatKey(key)}`);
        validateHeapValue(value, `$.heap${formatKey(key)}`, state);
    }
    validateReferences(root, "$", 0, state, { heapIds, nodeById, promiseIds, scopeIds });
}
function validatePendingHostCall(promise, path, state) {
    if (promise.sideEffectTag === undefined)
        return;
    const tag = requireRecord(promise.sideEffectTag, `${path}.sideEffectTag`);
    if (tag.kind !== "host-call-side-effect") {
        fail("unknownTag", `${path}.sideEffectTag.kind`, "unknown host-call tag");
    }
    const callId = requireNonEmptyString(tag.callId, `${path}.sideEffectTag.callId`, state.limits);
    const moduleId = requireNonEmptyString(tag.moduleId, `${path}.sideEffectTag.moduleId`, state.limits);
    const operation = requireNonEmptyString(tag.operation, `${path}.sideEffectTag.operation`, state.limits);
    if (String(promise.id) !== callId) {
        fail("invalidState", `${path}.sideEffectTag.callId`, "must match pending promise id");
    }
    if (promise.moduleId !== moduleId) {
        fail("invalidState", `${path}.sideEffectTag.moduleId`, "must match pending module id");
    }
    if (promise.operation !== operation) {
        fail("invalidState", `${path}.sideEffectTag.operation`, "must match pending operation");
    }
}
export function validateSnapshotSourceHash(snapshot) {
    const root = requireRecord(snapshot, "$");
    requireNonEmptyString(root.sourceHash, "$.sourceHash", defaultLimits());
}
function validateReferences(value, path, depth, state, refs) {
    if (value === null || typeof value !== "object")
        return;
    if (depth > state.limits.maxDepth)
        fail("budgetExceeded", path, `exceeds nesting limit ${state.limits.maxDepth}`);
    if (Array.isArray(value)) {
        value.forEach((entry, index) => validateReferences(entry, `${path}[${index}]`, depth + 1, state, refs));
        return;
    }
    const record = value;
    if (typeof record.kind === "string") {
        if (record.kind === "ref") {
            const id = requireSafeInteger(record.id, `${path}.id`, 1);
            if (!refs.heapIds.has(id))
                fail("danglingReference", `${path}.id`, `unknown heap value ${id}`);
        }
        else if (record.kind === "promise") {
            const id = requireSnapshotId(record.id, `${path}.id`);
            if (!refs.promiseIds.has(id))
                fail("danglingReference", `${path}.id`, `unknown promise ${String(id)}`);
        }
        else if (record.kind === "fn" || record.kind === "generator") {
            if (record.state !== "done") {
                requireNodeId(record.astNodeId, `${path}.astNodeId`, refs.nodeById);
                const scopeId = requireSnapshotId(record.capturedScopeId, `${path}.capturedScopeId`);
                if (!refs.scopeIds.has(scopeId))
                    fail("danglingReference", `${path}.capturedScopeId`, `unknown scope ${String(scopeId)}`);
            }
            if (record.kind === "generator")
                validateGenerator(record, path, refs.nodeById);
        }
    }
    for (const [key, entry] of Object.entries(record))
        validateReferences(entry, `${path}${formatKey(key)}`, depth + 1, state, refs);
}
function validateValue(value, path, depth, state) {
    validateGenericValue(value, path, depth, state);
}
function validateTaggedValue(record, path, state) {
    switch (record.kind) {
        case "undefined":
            return;
        case "number":
            if (!["-Infinity", "Infinity", "NaN"].includes(String(record.value))) {
                fail("invalidValue", `${path}.value`, "unknown non-finite number value");
            }
            return;
        case "fn":
            requireSafeInteger(record.astNodeId, `${path}.astNodeId`, 0);
            requireSnapshotId(record.capturedScopeId, `${path}.capturedScopeId`);
            return;
        case "generator":
            validateGeneratorShape(record, path, state);
            return;
        case "promise":
            requireSnapshotId(record.id, `${path}.id`);
            return;
        case "ref":
            requireSafeInteger(record.id, `${path}.id`, 1);
            return;
        case "regex":
            requireString(record.source, `${path}.source`, state.limits);
            requireString(record.flags, `${path}.flags`, state.limits);
            requireSafeInteger(record.lastIndex, `${path}.lastIndex`, 0);
            return;
        case "array":
        case "arguments":
        case "object":
        case "map":
        case "set":
            return;
    }
}
function validateGeneratorShape(record, path, state) {
    if (!["start", "suspended", "done"].includes(String(record.state))) {
        fail("invalidState", `${path}.state`, "unknown generator state");
    }
    if (record.state === "done") {
        if (record.astNodeId !== undefined ||
            record.capturedScopeId !== undefined ||
            record.sent !== undefined ||
            record.yieldNodeId !== undefined) {
            fail("invalidState", path, "done generator cannot contain resume state");
        }
        return;
    }
    requireSafeInteger(record.astNodeId, `${path}.astNodeId`, 0);
    requireSnapshotId(record.capturedScopeId, `${path}.capturedScopeId`);
    if (record.state === "start") {
        if (record.sent !== undefined || record.yieldNodeId !== undefined) {
            fail("invalidState", path, "unstarted generator cannot contain a resume cursor");
        }
        return;
    }
    requireSafeInteger(record.yieldNodeId, `${path}.yieldNodeId`, 0);
    const sent = requireArray(record.sent, `${path}.sent`, state);
    sent.forEach((completion, index) => {
        const completionPath = `${path}.sent[${index}]`;
        const candidate = requireRecord(completion, completionPath);
        if (!Object.hasOwn(candidate, "type")) {
            fail("invalidValue", `${completionPath}.type`, "completion type is required");
        }
        if (!["normal", "return", "throw"].includes(String(candidate.type))) {
            fail("invalidState", `${completionPath}.type`, "unknown generator completion type");
        }
        if (!Object.hasOwn(candidate, "value")) {
            fail("invalidValue", `${completionPath}.value`, "completion value is required");
        }
    });
}
function validateHeapValue(value, path, state) {
    const record = requireRecord(value, path);
    if (!["arguments", "array", "object", "map", "set"].includes(String(record.kind)))
        fail("unknownTag", `${path}.kind`, "unknown heap tag");
    validateValue(record, path, 1, state);
    if (record.kind === "arguments")
        validateArgumentsProperties(record, path);
    if (record.kind === "array")
        requireArray(record.items, `${path}.items`, state);
    if (record.kind === "object")
        requireRecord(record.entries, `${path}.entries`);
    if (record.kind === "map") {
        const entries = requireArray(record.entries, `${path}.entries`, state);
        entries.forEach((entry, index) => {
            if (!Array.isArray(entry) || entry.length !== 2)
                fail("invalidValue", `${path}.entries[${index}]`, "map entry must contain two values");
        });
    }
    if (record.kind === "set")
        requireArray(record.values, `${path}.values`, state);
}
export function validateArgumentsProperties(record, path) {
    if (typeof record.extensible !== "boolean") {
        fail("invalidType", `${path}.extensible`, "expected boolean");
    }
    if (typeof record.lengthBeforeCallee !== "boolean") {
        fail("invalidType", `${path}.lengthBeforeCallee`, "expected boolean");
    }
    const properties = requireRecord(record.properties, `${path}.properties`);
    if (record.iterator !== null) {
        const iterator = requireRecord(record.iterator, `${path}.iterator`);
        for (const key of Object.keys(iterator)) {
            if (!["configurable", "enumerable", "writable"].includes(key)) {
                fail("invalidValue", `${path}.iterator${formatKey(key)}`, "unknown iterator descriptor field");
            }
        }
        for (const flag of ["configurable", "enumerable", "writable"]) {
            if (typeof iterator[flag] !== "boolean")
                fail("invalidType", `${path}.iterator.${flag}`, "expected boolean");
        }
    }
    if (record.lengthBeforeCallee && !Object.hasOwn(properties, "length")) {
        fail("invalidValue", `${path}.properties`, "initial length property is required");
    }
    for (const [key, value] of Object.entries(properties)) {
        const propertyPath = `${path}.properties${formatKey(key)}`;
        if (key === "callee")
            fail("invalidValue", propertyPath, "strict callee accessor cannot be replaced");
        const descriptor = requireRecord(value, propertyPath);
        for (const field of Object.keys(descriptor)) {
            if (!["value", "configurable", "enumerable", "writable"].includes(field)) {
                fail("invalidValue", `${propertyPath}${formatKey(field)}`, "unknown property descriptor field");
            }
        }
        if (!Object.hasOwn(descriptor, "value"))
            fail("invalidValue", propertyPath, "property value is required");
        for (const flag of ["configurable", "enumerable", "writable"]) {
            if (typeof descriptor[flag] !== "boolean")
                fail("invalidType", `${propertyPath}.${flag}`, "expected boolean");
        }
    }
}
function validateGenerator(record, path, nodeById) {
    if (record.state === "suspended") {
        requireNodeId(record.yieldNodeId, `${path}.yieldNodeId`, nodeById);
    }
}
function validateGenericValue(value, path, depth, state) {
    if (state.dataPropertiesOnly && types.isProxy(value)) {
        fail("invalidType", path, "proxy objects are not snapshot data");
    }
    if (depth > state.limits.maxDepth)
        fail("budgetExceeded", path, `exceeds nesting limit ${state.limits.maxDepth}`);
    state.entries += 1;
    if (state.entries > state.limits.maxAggregateEntries)
        fail("budgetExceeded", path, `exceeds aggregate entry limit ${state.limits.maxAggregateEntries}`);
    if (typeof value === "string") {
        requireString(value, path, state.limits);
        state.dataSize += value.length;
    }
    else if (typeof value === "number") {
        if (Number.isInteger(value) && !Number.isSafeInteger(value))
            fail("invalidValue", path, "integer must be safe");
    }
    else if (Array.isArray(value)) {
        if (value.length > state.limits.maxEntries)
            fail("budgetExceeded", path, "array is too large");
        if (state.dataPropertiesOnly) {
            const entries = snapshotDataEntries(value, path).filter(([key]) => key !== "length");
            if (entries.length !== value.length)
                fail("invalidType", path, "snapshot arrays must be dense");
            for (const [key, entry] of entries) {
                const index = Number(key);
                if (!Number.isInteger(index) ||
                    index < 0 ||
                    index >= value.length ||
                    String(index) !== key) {
                    fail("invalidType", path, "snapshot arrays cannot have named properties");
                }
                validateGenericValue(entry, `${path}[${key}]`, depth + 1, state);
            }
        }
        else {
            value.forEach((entry, index) => validateGenericValue(entry, `${path}[${index}]`, depth + 1, state));
        }
    }
    else if (value !== null && typeof value === "object") {
        const record = value;
        if (state.validateTaggedPayloads && isTaggedValueShape(record)) {
            validateTaggedValue(record, path, state);
        }
        const entries = state.dataPropertiesOnly
            ? snapshotDataEntries(value, path)
            : Object.entries(value);
        for (const [key, entry] of entries) {
            requireString(key, `${path}${formatKey(key)}`, state.limits);
            state.dataSize += key.length;
            validateGenericValue(entry, `${path}${formatKey(key)}`, depth + 1, state);
        }
    }
    else if (!["boolean", "number"].includes(typeof value) &&
        !(state.allowFunctions && typeof value === "function") &&
        !(state.allowUndefined && value === undefined) &&
        value !== null) {
        fail("invalidType", path, "contains an unsupported value");
    }
    if (state.dataSize > state.limits.maxDataSize)
        fail("budgetExceeded", path, `exceeds aggregate data limit ${state.limits.maxDataSize}`);
}
function snapshotDataEntries(value, path) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null &&
        prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype)) {
        fail("invalidType", path, "snapshot data must not have a custom prototype");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        fail("invalidType", path, "snapshot data must not have symbol properties");
    }
    return Object.entries(Object.getOwnPropertyDescriptors(value)).map(([key, descriptor]) => {
        if (!("value" in descriptor))
            fail("invalidType", `${path}${formatKey(key)}`, "snapshot data must not have accessors");
        return [key, descriptor.value];
    });
}
function validateScopeCycles(ids, parentById) {
    for (const id of ids) {
        const seen = new Set();
        let current = id;
        while (current !== undefined) {
            if (seen.has(current))
                fail("invalidCycle", "$.scopeChain", `scope parent cycle includes ${String(current)}`);
            seen.add(current);
            current = parentById.get(current);
        }
    }
}
function limitsFromBudget(budget) {
    return {
        maxAggregateEntries: DEFAULT_MAX_ENTRIES,
        maxCallDepth: budget.limits.maxCallDepth ?? 10_000,
        maxDepth: Math.min(DEFAULT_MAX_DEPTH, budget.limits.maxCallDepth ?? DEFAULT_MAX_DEPTH),
        maxEntries: budget.limits.arrayLength ?? DEFAULT_MAX_ENTRIES,
        maxStringLength: budget.limits.stringLength ?? DEFAULT_MAX_STRING_LENGTH,
        maxDataSize: budget.limits.dataSize ?? DEFAULT_MAX_DATA_SIZE
    };
}
function defaultLimits() {
    return {
        maxAggregateEntries: DEFAULT_MAX_ENTRIES,
        maxCallDepth: 10_000,
        maxDepth: DEFAULT_MAX_DEPTH,
        maxEntries: DEFAULT_MAX_ENTRIES,
        maxStringLength: DEFAULT_MAX_STRING_LENGTH,
        maxDataSize: DEFAULT_MAX_DATA_SIZE
    };
}
function requireArray(value, path, state) {
    if (!Array.isArray(value))
        fail("invalidType", path, "must be an array");
    if (value.length > state.limits.maxEntries)
        fail("budgetExceeded", path, `exceeds collection entry limit ${state.limits.maxEntries}`);
    return value;
}
function requireRecord(value, path) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        fail("invalidType", path, "must be an object");
    return value;
}
function requireNodeId(value, path, nodeById) {
    const id = requireSafeInteger(value, path, 0);
    if (!nodeById.has(id))
        fail("danglingReference", path, `unknown AST node ${id}`);
    return id;
}
function requireSnapshotId(value, path) {
    if (typeof value === "string") {
        if (value.length === 0)
            fail("invalidValue", path, "id must not be empty");
        return value;
    }
    return requireSafeInteger(value, path, 0);
}
function requireSafeInteger(value, path, minimum) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
        fail("invalidValue", path, `must be a safe integer >= ${minimum}`);
    return value;
}
function requireNonEmptyString(value, path, limits) {
    const text = requireString(value, path, limits);
    if (text.length === 0)
        fail("invalidValue", path, "must not be empty");
    return text;
}
function requireString(value, path, limits) {
    if (typeof value !== "string")
        fail("invalidType", path, "must be a string");
    if (value.length > limits.maxStringLength)
        fail("budgetExceeded", path, `exceeds string limit ${limits.maxStringLength}`);
    return value;
}
function addUnique(values, value, path) {
    if (values.has(value))
        fail("duplicateId", path, `duplicate id ${String(value)}`);
    values.add(value);
}
function parseHeapId(value, path) {
    if (String(Number(value)) !== value)
        fail("invalidValue", path, "heap key must be a canonical positive integer");
    return requireSafeInteger(Number(value), path, 1);
}
function scopeParentPath(scopes, id) {
    const index = scopes.findIndex((entry) => typeof entry === "object" &&
        entry !== null &&
        !Array.isArray(entry) &&
        entry.id === id);
    return `$.scopeChain[${index}].parentId`;
}
function formatKey(key) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}
function isTaggedValueShape(value) {
    return typeof value.kind === "string" && TAGGED_VALUE_KINDS.has(value.kind);
}
function fail(code, path, detail) {
    throw new SnapshotValidationError(code, path, detail);
}
