import { replaceErrorStack, sandboxErrorNames, type SandboxErrorName } from "../error/shape.js";
import { validateBigIntData } from "./bigint.js";
import { validateRegexProperties, type RegexPropertyData } from "./regexp-properties.js";
import { wellKnownSymbols } from "../interp/symbols.js";
import { types } from "node:util";
import type { Budget } from "../interp/budget.js";
import type { ParseResult } from "../parse/parser.js";
import { DUMP_FORMAT_VERSION } from "./dump-format.js";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { validateFloat32Storage } from "./float32array.js";
import { restoreDateTime } from "../interp/date.js";
import { validateBoxedProperties } from "./boxed.js";
import { hasGuestObjectState } from "../interp/object-model.js";
import { validateGuestHeapNode, validateGuestScopeParents } from "./guest-heap-validation.js";
import { validateGuestFunctionAst } from "./guest-ast-validation.js";

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

export type SnapshotValidationCode =
  | "budgetExceeded"
  | "danglingReference"
  | "duplicateId"
  | "invalidCycle"
  | "invalidState"
  | "invalidType"
  | "invalidValue"
  | "unknownTag"
  | "unsupportedVersion";

export class SnapshotValidationError extends Error {
  readonly code: SnapshotValidationCode;
  readonly path: string;

  constructor(code: SnapshotValidationCode, path: string, detail: string) {
    super(`Invalid snapshot at ${path}: ${detail}`);
    this.name = "SnapshotValidationError";
    this.code = code;
    this.path = path;
    replaceErrorStack(this);
  }
}

type ValidationLimits = {
  maxAggregateEntries: number;
  maxCallDepth: number;
  maxDepth: number;
  maxEntries: number;
  maxStringLength: number;
  maxDataSize: number;
};

type ValidationState = {
  allowFunctions: boolean;
  allowUndefined: boolean;
  entries: number;
  dataSize: number;
  limits: ValidationLimits;
  validateTaggedPayloads: boolean;
  dataPropertiesOnly?: boolean;
};

export function validateSnapshotData(value: unknown): void {
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

export function validateDumpEnvelope(
  snapshot: unknown
): asserts snapshot is Record<string, unknown> {
  const limits = defaultLimits();
  const root = requireRecord(snapshot, "$");
  if (root.version !== 1 && root.version !== DUMP_FORMAT_VERSION) {
    fail("unsupportedVersion", "$.version", `expected ${DUMP_FORMAT_VERSION}`);
  }
  requireNonEmptyString(root.sourceHash, "$.sourceHash", limits);
  const replayError = Object.getOwnPropertyDescriptor(root, "replayError");
  if (replayError !== undefined) {
    if (!("value" in replayError)) fail("invalidType", "$.replayError", "must be a data property");
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

function validateDumpHeap(root: Record<string, unknown>, state: ValidationState): void {
  const heap = root.heap === undefined ? Object.create(null) : requireRecord(root.heap, "$.heap");
  const heapIds = new Set<number>();

  for (const [key, value] of Object.entries(heap)) {
    const path = `$.heap${formatKey(key)}`;
    const id = parseHeapId(key, path);
    addUnique(heapIds, id, path);
    const entry = requireRecord(value, path);
    validateErrorType(entry, path);
    validateSymbolEntries(entry, path, state, heap);
    try {
      if (validateGuestHeapNode(entry, heap, state.limits.maxEntries)) {
        if (root.version !== 2) fail("unsupportedVersion", path, "guest heap records require dump version 2");
        continue;
      }
    } catch (error) {
      if (error instanceof SnapshotValidationError) throw error;
      fail("invalidValue", path, error instanceof Error ? error.message : "invalid guest heap record");
    }
    if (entry.kind === "regexp-iterator") {
      validateHeapValue(entry, path, state, heap);
      continue;
    }
    if (entry.kind === "regex-object") {
      validateTaggedValue(entry, path, state);
      continue;
    }
    if (entry.kind === "boxed") {
      validateBoxedRecord(entry, path, heap);
      continue;
    }
    if (entry.kind === "date") {
      validateDateRecord(entry, path);
      continue;
    }
    if (entry.kind === "float32array") {
      validateFloat32Storage(entry);
      requireRecord(entry.entries, `${path}.entries`);
      continue;
    }
    if (entry.kind === "arguments") {
      validateArgumentsProperties(entry, path);
      continue;
    }
    if (entry.kind === "array") {
      validateArrayHeap(entry, path, state);
      continue;
    }
    if (entry.kind === "object") {
      if (Object.hasOwn(entry, "sandboxNullPrototype") && entry.sandboxNullPrototype !== true)
        fail("invalidValue", `${path}.sandboxNullPrototype`, "invalid object prototype");
      requireRecord(entry.entries, `${path}.entries`);
      continue;
    }
    if (entry.kind === "symbol") {
      validateSymbolRecord(entry, path, state);
      continue;
    }
    fail("unknownTag", `${path}.kind`, "unknown dump heap tag");
  }

  validateDumpReferences(root, "$", 0, state, heapIds, heap, "root");
  try { validateGuestScopeParents(heap); }
  catch (error) { fail("invalidCycle", "$.heap", error instanceof Error ? error.message : "invalid guest scope parent graph"); }
}

function validateDumpReferences(
  value: unknown,
  path: string,
  depth: number,
  state: ValidationState,
  heapIds: Set<number>,
  heap: Record<string, unknown>,
  role: "root" | "heap" | "heap-node" | "scope-map" | "data" = "data",
  allowScopeReference = false
): void {
  if (value === null || typeof value !== "object") return;
  if (depth > state.limits.maxDepth)
    fail("budgetExceeded", path, `exceeds nesting limit ${state.limits.maxDepth}`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      validateDumpReferences(entry, `${path}[${index}]`, depth + 1, state, heapIds, heap)
    );
    return;
  }

  const record = value as Record<string, unknown>;
  if (record.kind === "ref") {
    const id = requireSafeInteger(record.id, `${path}.id`, 1);
    if (!heapIds.has(id)) fail("danglingReference", `${path}.id`, `unknown heap value ${id}`);
    if ((heap[String(id)] as Record<string, unknown>).kind === "scope-frame" && !allowScopeReference)
      fail("invalidValue", path, "Internal scopes cannot be guest data");
  }
  for (const [key, entry] of Object.entries(record)) {
    const childRole = role === "root" && key === "heap" ? "heap" : role === "heap" ? "heap-node"
      : role === "heap-node" && record.kind === "guest-generator" && key === "blockScopes" ? "scope-map" : "data";
    const scopeField = role === "scope-map" || role === "heap-node" && (
      (record.kind === "scope-frame" && key === "parent") ||
      (record.kind === "guest-function" && key === "scope") ||
      (record.kind === "guest-generator" && ["scope", "closureScope", "suspendedScope"].includes(key))
    );
    validateDumpReferences(entry, `${path}${formatKey(key)}`, depth + 1, state, heapIds, heap, childRole, scopeField);
  }
}

function validateRunSnapshotState(root: Record<string, unknown>, state: ValidationState): void {
  if (root.clock !== undefined) {
    const clock = requireRecord(root.clock, "$.clock");
    requireSafeInteger(clock.next, "$.clock.next", 0);
  }
  if (root.random !== undefined) {
    const random = requireRecord(root.random, "$.random");
    requireSafeInteger(random.seed, "$.random.seed", 0);
    requireSafeInteger(random.state, "$.random.state", 0);
    for (const field of ["initialState", "resumeState"]) {
      if (random[field] !== undefined) requireSafeInteger(random[field], `$.random.${field}`, 0);
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
      if (pending.nodeId !== undefined) requireSafeInteger(pending.nodeId, `${path}.nodeId`, 0);
      const span = requireRecord(pending.span, `${path}.span`);
      const start = validatePosition(span.start, `${path}.span.start`);
      const end = validatePosition(span.end, `${path}.span.end`);
      if (start > end) {
        fail("invalidValue", `${path}.span`, "start must not exceed end");
      }
    });
  }
}

function validatePosition(value: unknown, path: string): number {
  const position = requireRecord(value, path);
  requireSafeInteger(position.line, `${path}.line`, 1);
  requireSafeInteger(position.column, `${path}.column`, 0);
  return requireSafeInteger(position.offset, `${path}.offset`, 0);
}

export function validateInterpreterSnapshot(
  snapshot: unknown,
  nodeById: ReadonlyMap<number, ParseResult>,
  budget: Budget
): asserts snapshot is Record<string, unknown> {
  const limits = limitsFromBudget(budget);
  const state: ValidationState = {
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

  const scopeIds = new Set<string | number>();
  const parentById = new Map<string | number, string | number>();
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

  const promiseIds = new Set<string | number>();
  promises.forEach((value, index) => {
    const path = `$.pendingPromises[${index}]`;
    const promise = requireRecord(value, path);
    addUnique(promiseIds, requireSnapshotId(promise.id, `${path}.id`), `${path}.id`);
    validateValue(promise, path, 1, state);
    if (
      promise.status !== undefined &&
      !["pending", "fulfilled", "rejected"].includes(String(promise.status))
    ) {
      fail("invalidState", `${path}.status`, "unknown promise state");
    }
    if (
      promise.status === "pending" &&
      (Object.hasOwn(promise, "value") || Object.hasOwn(promise, "reason"))
    ) {
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
        fail(
          "danglingReference",
          `${path}.awaitingPromiseId`,
          `unknown promise ${String(promiseId)}`
        );
    }
  });

  for (const [key, value] of Object.entries(moduleBindings)) {
    requireNonEmptyString(key, `$.moduleBindings${formatKey(key)}`, limits);
    requireNonEmptyString(value, `$.moduleBindings${formatKey(key)}`, limits);
  }

  const heapIds = new Set<number>();
  for (const [key, value] of Object.entries(heap)) {
    const id = parseHeapId(key, `$.heap${formatKey(key)}`);
    addUnique(heapIds, id, `$.heap${formatKey(key)}`);
    validateHeapValue(value, `$.heap${formatKey(key)}`, state, heap);
    validateSymbolEntries(requireRecord(value, `$.heap${formatKey(key)}`), `$.heap${formatKey(key)}`, state, heap);
  }
  validateReferences(root, "$", 0, state, { heapIds, nodeById, promiseIds, scopeIds });
  validateDumpReferences(root, "$", 0, state, heapIds, heap, "root");
  try { validateGuestScopeParents(heap); }
  catch (error) { fail("invalidValue", "$.heap", String(error)); }
  for (const [key, value] of Object.entries(heap)) {
    const record = value as Record<string, unknown>;
    if (record.kind === "guest-function" || record.kind === "guest-generator") {
      const id = requireNodeId(record.astNodeId, `$.heap${formatKey(key)}.astNodeId`, nodeById);
      const node = nodeById.get(id);
      try { validateGuestFunctionAst(record, node); }
      catch (error) { fail("invalidValue", `$.heap${formatKey(key)}`, String(error)); }
    }
  }
}

function validatePendingHostCall(
  promise: Record<string, unknown>,
  path: string,
  state: ValidationState
): void {
  if (promise.sideEffectTag === undefined) return;
  const tag = requireRecord(promise.sideEffectTag, `${path}.sideEffectTag`);
  if (tag.kind !== "host-call-side-effect") {
    fail("unknownTag", `${path}.sideEffectTag.kind`, "unknown host-call tag");
  }
  const callId = requireNonEmptyString(tag.callId, `${path}.sideEffectTag.callId`, state.limits);
  const moduleId = requireNonEmptyString(
    tag.moduleId,
    `${path}.sideEffectTag.moduleId`,
    state.limits
  );
  const operation = requireNonEmptyString(
    tag.operation,
    `${path}.sideEffectTag.operation`,
    state.limits
  );
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

export function validateSnapshotSourceHash(
  snapshot: unknown
): asserts snapshot is { sourceHash: string } {
  const root = requireRecord(snapshot, "$");
  requireNonEmptyString(root.sourceHash, "$.sourceHash", defaultLimits());
}

function validateReferences(
  value: unknown,
  path: string,
  depth: number,
  state: ValidationState,
  refs: {
    heapIds: Set<number>;
    nodeById: ReadonlyMap<number, ParseResult>;
    promiseIds: Set<string | number>;
    scopeIds: Set<string | number>;
  }
): void {
  if (value === null || typeof value !== "object") return;
  if (depth > state.limits.maxDepth)
    fail("budgetExceeded", path, `exceeds nesting limit ${state.limits.maxDepth}`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      validateReferences(entry, `${path}[${index}]`, depth + 1, state, refs)
    );
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.kind === "string") {
    if (record.kind === "ref") {
      const id = requireSafeInteger(record.id, `${path}.id`, 1);
      if (!refs.heapIds.has(id))
        fail("danglingReference", `${path}.id`, `unknown heap value ${id}`);
    } else if (record.kind === "promise") {
      const id = requireSnapshotId(record.id, `${path}.id`);
      if (!refs.promiseIds.has(id))
        fail("danglingReference", `${path}.id`, `unknown promise ${String(id)}`);
    } else if (record.kind === "fn" || record.kind === "generator") {
      if (record.state !== "done") {
        requireNodeId(record.astNodeId, `${path}.astNodeId`, refs.nodeById);
        const scopeId = requireSnapshotId(record.capturedScopeId, `${path}.capturedScopeId`);
        if (!refs.scopeIds.has(scopeId))
          fail("danglingReference", `${path}.capturedScopeId`, `unknown scope ${String(scopeId)}`);
      }
      if (record.kind === "generator") validateGenerator(record, path, refs.nodeById);
    }
  }
  for (const [key, entry] of Object.entries(record))
    validateReferences(entry, `${path}${formatKey(key)}`, depth + 1, state, refs);
}

function validateValue(value: unknown, path: string, depth: number, state: ValidationState): void {
  validateGenericValue(value, path, depth, state);
}

function validateTaggedValue(
  record: Record<string, unknown>,
  path: string,
  state: ValidationState
): void {
  switch (record.kind) {
    case "bigint":
      requireString(record.value, `${path}.value`, state.limits);
      try { validateBigIntData(record.value); }
      catch { fail("invalidValue", `${path}.value`, "invalid BigInt value"); }
      return;
    case "undefined":
      return;
    case "number":
      if (!["-Infinity", "Infinity", "NaN", "-0"].includes(String(record.value))) {
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
    case "regex-object":
      requireString(record.source, `${path}.source`, state.limits);
      requireString(record.flags, `${path}.flags`, state.limits);
      if (!Object.hasOwn(record, "lastIndex")) fail("invalidValue", `${path}.lastIndex`, "missing regex cursor");
      try { validateRegexProperties(record as RegexPropertyData<unknown>); }
      catch { fail("invalidValue", path, "invalid RegExp property data"); }
      return;
    case "array":
    case "arguments":
      return;
    case "object":
      if (Object.hasOwn(record, "sandboxNullPrototype") && record.sandboxNullPrototype !== true)
        fail("invalidValue", `${path}.sandboxNullPrototype`, "invalid object prototype");
      return;
    case "map":
    case "set":
    case "collection-iterator":
    case "regexp-iterator":
      return;
  }
}

function validateGeneratorShape(
  record: Record<string, unknown>,
  path: string,
  state: ValidationState
): void {
  if (record.async !== undefined && typeof record.async !== "boolean") {
    fail("invalidType", `${path}.async`, "generator async flag must be a boolean");
  }
  if (!["start", "suspended", "done"].includes(String(record.state))) {
    fail("invalidState", `${path}.state`, "unknown generator state");
  }
  if (record.state === "done") {
    if (
      record.astNodeId !== undefined ||
      record.capturedScopeId !== undefined ||
      record.sent !== undefined ||
      record.yieldNodeId !== undefined
    ) {
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

function validateHeapValue(value: unknown, path: string, state: ValidationState, heap: Record<string, unknown>): void {
  const record = requireRecord(value, path);
  try {
    if (validateGuestHeapNode(record, heap, state.limits.maxEntries)) {
      const tagged = state.validateTaggedPayloads;
      state.validateTaggedPayloads = false;
      try { validateValue(record, path, 1, state); }
      finally { state.validateTaggedPayloads = tagged; }
      return;
    }
  } catch (error) { fail("invalidValue", path, String(error)); }
  validateErrorType(record, path);
  if (!["symbol", "arguments", "array", "object", "map", "set", "float32array", "date", "boxed", "collection-iterator", "regexp-iterator", "regex-object"].includes(String(record.kind)))
    fail("unknownTag", `${path}.kind`, "unknown heap tag");
  validateValue(record, path, 1, state);
  if (record.kind === "symbol") validateSymbolRecord(record, path, state);
  if (record.kind === "arguments") validateArgumentsProperties(record, path);
  if (record.kind === "array") validateArrayHeap(record, path, state);
  if (record.kind === "object") requireRecord(record.entries, `${path}.entries`);
  if (record.kind === "boxed") validateBoxedRecord(record, path, heap);
  if (record.kind === "date") validateDateRecord(record, path);
  if (record.kind === "float32array") {
    validateFloat32Storage(record);
    requireRecord(record.entries, `${path}.entries`);
  }
  if (record.kind === "map") {
    const entries = requireArray(record.entries, `${path}.entries`, state);
    entries.forEach((entry, index) => {
      if (!Array.isArray(entry) || entry.length !== 2)
        fail("invalidValue", `${path}.entries[${index}]`, "map entry must contain two values");
    });
  }
  if (record.kind === "set") requireArray(record.values, `${path}.values`, state);
  if (record.kind === "regexp-iterator") {
    if ((record.global !== undefined || record.unicode !== undefined) && (typeof record.global !== "boolean" || typeof record.unicode !== "boolean"))
      fail("invalidValue", path, "invalid RegExp iterator modes");
    if (typeof record.exhausted !== "boolean") fail("invalidValue", `${path}.exhausted`, "invalid iterator exhaustion");
    if (!Object.hasOwn(record, "matcher") || !Object.hasOwn(record, "input")) fail("invalidValue", path, "missing RegExp iterator state");
    requireRecord(record.entries, `${path}.entries`);
  }
  if (record.kind === "collection-iterator") {
    if (record.collectionKind !== "map" && record.collectionKind !== "set") fail("invalidValue", `${path}.collectionKind`, "invalid iterator brand");
    if (record.method !== "keys" && record.method !== "values" && record.method !== "entries") fail("invalidValue", `${path}.method`, "invalid iteration method");
    if (typeof record.exhausted !== "boolean") fail("invalidValue", `${path}.exhausted`, "invalid iterator exhaustion");
    requireSafeInteger(record.index, `${path}.index`, 0);
    if (!Object.hasOwn(record, "collection")) fail("invalidValue", `${path}.collection`, "missing iterator source");
    requireRecord(record.entries, `${path}.entries`);
  }
}

function validateSymbolEntries(
  record: Record<string, unknown>,
  path: string,
  state: ValidationState,
  heap: Record<string, unknown>
): void {
  if (record.symbolEntries === undefined) return;
  if (record.kind !== "object" && record.kind !== "array" && record.kind !== "date" && record.kind !== "boxed" && record.kind !== "regex-object" && record.kind !== "regexp-iterator")
    fail("invalidValue", `${path}.symbolEntries`, "symbol properties are unsupported for this heap kind");
  const entries = requireArray(record.symbolEntries, `${path}.symbolEntries`, state);
  const keys = new Set<number>();
  entries.forEach((entry, index) => {
    const entryPath = `${path}.symbolEntries[${index}]`;
    if (!Array.isArray(entry) || entry.length !== 2)
      fail("invalidValue", entryPath, "symbol entry must contain a key and value");
    const reference = requireRecord(entry[0], `${entryPath}[0]`);
    if (reference.kind !== "ref") fail("invalidValue", `${entryPath}[0]`, "expected a symbol heap reference");
    const id = requireSafeInteger(reference.id, `${entryPath}[0].id`, 1);
    const symbol = requireRecord(heap[String(id)], `${entryPath}[0]`);
    if (symbol.kind !== "symbol") fail("invalidValue", `${entryPath}[0]`, "property key must reference a symbol");
    if (keys.has(id)) fail("invalidValue", entryPath, "duplicate symbol property key");
    keys.add(id);
    validateDataDescriptor(requireRecord(entry[1], `${entryPath}[1]`), `${entryPath}[1]`);
  });
}

function validateSymbolRecord(record: Record<string, unknown>, path: string, state: ValidationState): void {
  if (record.description !== undefined)
    requireString(record.description, `${path}.description`, state.limits);
  if (record.wellKnown !== undefined) {
    requireString(record.wellKnown, `${path}.wellKnown`, state.limits);
    if (!Object.hasOwn(wellKnownSymbols, String(record.wellKnown)))
      fail("invalidValue", `${path}.wellKnown`, "unknown well-known symbol");
    if (Object.hasOwn(record, "description"))
      fail("invalidValue", path, "well-known symbol cannot specify a description");
  }
}

function validateBoxedRecord(record: Record<string, unknown>, path: string, heap: Record<string, unknown>): void {
  try { validateBoxedProperties(record); }
  catch { fail("invalidValue", path, "invalid boxed primitive properties"); }
  const value = record.value;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return;
  const number = requireRecord(value, `${path}.value`);
  if (number.kind === "bigint") {
    try { validateBigIntData(number.value); }
    catch { fail("invalidValue", `${path}.value`, "invalid boxed BigInt payload"); }
    return;
  }
  if (number.kind === "ref") {
    const id = requireSafeInteger(number.id, `${path}.value.id`, 1);
    const target = requireRecord(heap[String(id)], `${path}.value`);
    if (target.kind !== "symbol") fail("invalidValue", `${path}.value`, "boxed payload must reference a symbol");
    return;
  }
  if (number.kind !== "number" || !["NaN", "Infinity", "-Infinity", "-0"].includes(String(number.value)))
    fail("invalidValue", `${path}.value`, "invalid boxed primitive payload");
}

function validateDateRecord(record: Record<string, unknown>, path: string): void {
  if (Object.keys(record).some(key => !["kind", "time", "properties", "symbolEntries", "extensible"].includes(key))) fail("invalidValue", path, "invalid Date fields");
  try { restoreDateTime(record.time); }
  catch { fail("invalidValue", `${path}.time`, "invalid Date epoch"); }
  if (record.extensible !== undefined && typeof record.extensible !== "boolean") fail("invalidType", `${path}.extensible`, "invalid Date extensibility");
  if (record.properties !== undefined) {
    for (const [key, value] of Object.entries(requireRecord(record.properties, `${path}.properties`))) {
      const propertyPath = `${path}.properties${formatKey(key)}`;
      validateDataDescriptor(requireRecord(value, propertyPath), propertyPath);
    }
  }
}

function validateDataDescriptor(descriptor: Record<string, unknown>, path: string): void {
  if (!Object.hasOwn(descriptor, "value")) fail("invalidValue", path, "missing property value");
  for (const flag of ["enumerable", "writable", "configurable"]) {
    if (typeof descriptor[flag] !== "boolean") fail("invalidType", `${path}.${flag}`, "property flag must be a boolean");
  }
  if (Object.keys(descriptor).some(key => !["value", "enumerable", "writable", "configurable"].includes(key)))
    fail("invalidValue", path, "unsupported property descriptor field");
}

function validateArrayHeap(
  record: Record<string, unknown>,
  path: string,
  state: ValidationState
): void {
  if (Object.hasOwn(record, "items")) {
    requireArray(record.items, `${path}.items`, state);
    if (Object.hasOwn(record, "length") || Object.hasOwn(record, "entries"))
      fail("invalidValue", path, "array must use either items or length and entries");
    return;
  }

  const length = requireSafeInteger(record.length, `${path}.length`, 0);
  if (length > 0xffff_ffff) fail("invalidValue", `${path}.length`, "exceeds maximum array length");
  if (length > state.limits.maxEntries)
    fail(
      "budgetExceeded",
      `${path}.length`,
      `exceeds collection entry limit ${state.limits.maxEntries}`
    );
  const entries = requireRecord(record.entries, `${path}.entries`);
  for (const key of Object.keys(entries)) {
    if (key === "length")
      fail("invalidValue", `${path}.entries.length`, "array length is stored separately");
    const index = Number(key);
    if (
      String(index) === key &&
      Number.isInteger(index) &&
      index >= 0 &&
      index < 0xffff_ffff &&
      index >= length
    )
      fail("invalidValue", `${path}.entries${formatKey(key)}`, "array index exceeds its length");
  }
}

function validateErrorType(record: Record<string, unknown>, path: string): void {
  if (!Object.hasOwn(record, "errorType")) return;
  if (
    record.kind !== "object" ||
    !sandboxErrorNames.includes(record.errorType as SandboxErrorName)
  ) {
    fail("invalidValue", `${path}.errorType`, "invalid error metadata");
  }
}

export function validateArgumentsProperties(record: Record<string, unknown>, path: string): void {
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
        fail(
          "invalidValue",
          `${path}.iterator${formatKey(key)}`,
          "unknown iterator descriptor field"
        );
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
        fail(
          "invalidValue",
          `${propertyPath}${formatKey(field)}`,
          "unknown property descriptor field"
        );
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

function validateGenerator(
  record: Record<string, unknown>,
  path: string,
  nodeById: ReadonlyMap<number, ParseResult>
): void {
  if (record.state === "suspended") {
    requireNodeId(record.yieldNodeId, `${path}.yieldNodeId`, nodeById);
  }
}

function validateGenericValue(
  value: unknown,
  path: string,
  depth: number,
  state: ValidationState
): void {
  if (typeof value === "object" && value !== null && hasGuestObjectState(value)) {
    fail("invalidState", path, "guest function properties, prototype links and custom descriptors cannot be restored");
  }
  if (state.dataPropertiesOnly && types.isProxy(value)) {
    fail("invalidType", path, "proxy objects are not snapshot data");
  }
  if (depth > state.limits.maxDepth)
    fail("budgetExceeded", path, `exceeds nesting limit ${state.limits.maxDepth}`);
  state.entries += 1;
  if (state.entries > state.limits.maxAggregateEntries)
    fail(
      "budgetExceeded",
      path,
      `exceeds aggregate entry limit ${state.limits.maxAggregateEntries}`
    );
  if (typeof value === "string") {
    requireString(value, path, state.limits);
    state.dataSize += value.length;
  } else if (Array.isArray(value)) {
    if (value.length > state.limits.maxEntries) fail("budgetExceeded", path, "array is too large");
    if (state.dataPropertiesOnly) {
      const entries = snapshotDataEntries(value, path).filter(([key]) => key !== "length");
      if (entries.length !== value.length)
        fail("invalidType", path, "snapshot arrays must be dense");
      for (const [key, entry] of entries) {
        const index = Number(key);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= value.length ||
          String(index) !== key
        ) {
          fail("invalidType", path, "snapshot arrays cannot have named properties");
        }
        validateGenericValue(entry, `${path}[${key}]`, depth + 1, state);
      }
    } else {
      value.forEach((entry, index) =>
        validateGenericValue(entry, `${path}[${index}]`, depth + 1, state)
      );
    }
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
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
  } else if (
    !["boolean", "number"].includes(typeof value) &&
    !(state.allowFunctions && typeof value === "function") &&
    !(state.allowUndefined && value === undefined) &&
    value !== null
  ) {
    fail("invalidType", path, "contains an unsupported value");
  }
  if (state.dataSize > state.limits.maxDataSize)
    fail("budgetExceeded", path, `exceeds aggregate data limit ${state.limits.maxDataSize}`);
}

function snapshotDataEntries(value: object, path: string): Array<[string, unknown]> {
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== null &&
    prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype)
  ) {
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

function validateScopeCycles(
  ids: Set<string | number>,
  parentById: Map<string | number, string | number>
): void {
  for (const id of ids) {
    const seen = new Set<string | number>();
    let current: string | number | undefined = id;
    while (current !== undefined) {
      if (seen.has(current))
        fail("invalidCycle", "$.scopeChain", `scope parent cycle includes ${String(current)}`);
      seen.add(current);
      current = parentById.get(current);
    }
  }
}

function limitsFromBudget(budget: Budget): ValidationLimits {
  return {
    maxAggregateEntries: DEFAULT_MAX_ENTRIES,
    maxCallDepth: budget.limits.maxCallDepth ?? 10_000,
    maxDepth: Math.min(DEFAULT_MAX_DEPTH, budget.limits.maxCallDepth ?? DEFAULT_MAX_DEPTH),
    maxEntries: budget.limits.arrayLength ?? DEFAULT_MAX_ENTRIES,
    maxStringLength: budget.limits.stringLength ?? DEFAULT_MAX_STRING_LENGTH,
    maxDataSize: budget.limits.dataSize ?? DEFAULT_MAX_DATA_SIZE
  };
}

function defaultLimits(): ValidationLimits {
  return {
    maxAggregateEntries: DEFAULT_MAX_ENTRIES,
    maxCallDepth: 10_000,
    maxDepth: DEFAULT_MAX_DEPTH,
    maxEntries: DEFAULT_MAX_ENTRIES,
    maxStringLength: DEFAULT_MAX_STRING_LENGTH,
    maxDataSize: DEFAULT_MAX_DATA_SIZE
  };
}

function requireArray(value: unknown, path: string, state: ValidationState): unknown[] {
  if (!Array.isArray(value)) fail("invalidType", path, "must be an array");
  if (value.length > state.limits.maxEntries)
    fail("budgetExceeded", path, `exceeds collection entry limit ${state.limits.maxEntries}`);
  return value;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("invalidType", path, "must be an object");
  return value as Record<string, unknown>;
}

function requireNodeId(
  value: unknown,
  path: string,
  nodeById: ReadonlyMap<number, ParseResult>
): number {
  const id = requireSafeInteger(value, path, 0);
  if (!nodeById.has(id)) fail("danglingReference", path, `unknown AST node ${id}`);
  return id;
}

function requireSnapshotId(value: unknown, path: string): string | number {
  if (typeof value === "string") {
    if (value.length === 0) fail("invalidValue", path, "id must not be empty");
    return value;
  }
  return requireSafeInteger(value, path, 0);
}

function requireSafeInteger(value: unknown, path: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
    fail("invalidValue", path, `must be a safe integer >= ${minimum}`);
  return value;
}

function requireNonEmptyString(value: unknown, path: string, limits: ValidationLimits): string {
  const text = requireString(value, path, limits);
  if (text.length === 0) fail("invalidValue", path, "must not be empty");
  return text;
}

function requireString(value: unknown, path: string, limits: ValidationLimits): string {
  if (typeof value !== "string") fail("invalidType", path, "must be a string");
  if (value.length > limits.maxStringLength)
    fail("budgetExceeded", path, `exceeds string limit ${limits.maxStringLength}`);
  return value;
}

function addUnique<T>(values: Set<T>, value: T, path: string): void {
  if (values.has(value)) fail("duplicateId", path, `duplicate id ${String(value)}`);
  values.add(value);
}

function parseHeapId(value: string, path: string): number {
  if (String(Number(value)) !== value)
    fail("invalidValue", path, "heap key must be a canonical positive integer");
  return requireSafeInteger(Number(value), path, 1);
}

function scopeParentPath(scopes: unknown[], id: string | number): string {
  const index = scopes.findIndex(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).id === id
  );
  return `$.scopeChain[${index}].parentId`;
}

function formatKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function isTaggedValueShape(value: Record<string, unknown>): boolean {
  return typeof value.kind === "string" && TAGGED_VALUE_KINDS.has(value.kind);
}

function fail(code: SnapshotValidationCode, path: string, detail: string): never {
  throw new SnapshotValidationError(code, path, detail);
}
