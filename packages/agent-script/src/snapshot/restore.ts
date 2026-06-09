import { Budget } from "../interp/budget.js";
import { SnapshotMismatchError } from "../restore.js";
import { Scope } from "../interp/interpreter.js";
import { wrapCallerInjectedBindings, type CallerInjectedBinding } from "../interp/host-bridge.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  type SandboxClosure,
  type SandboxPromise,
  type SandboxValue
} from "../interp/values.js";
import { hashSource } from "../parse/hash.js";
import {
  parseModule,
  type ArrowFunctionExpression,
  type Module,
  type ParseResult
} from "../parse/parser.js";
import {
  createUnknownModuleMessage,
  type ModuleExports,
  type ModuleRegistry
} from "../modules/registry.js";
import { interpret } from "../interp/interpreter.js";
import { resolvePendingHostCallResumePolicy } from "./policy.js";
import type {
  RuntimeCallFrame,
  RuntimePendingPromise,
  RuntimeScopeFrame,
  SerializedClosureValue,
  SerializedHeapValue,
  SerializedPromiseValue,
  SerializedReferenceValue,
  RuntimeSnapshotValue,
  SerializedPendingPromise,
  SerializedScopeFrame,
  SerializedSnapshot,
  SerializedSnapshotValue
} from "./serialize.js";

type SnapshotId = RuntimeScopeFrame["id"];

export type RestoreOptions = {
  source: string;
  modules?: ModuleRegistry;
  budget: Budget;
  signal?: AbortSignal;
};

export type RestoredCallFrame = RuntimeCallFrame & {
  awaitingPromise?: RuntimePendingPromise;
  node: ParseResult;
  scope: Scope;
};

export type RestoredScopeFrame = RuntimeScopeFrame & {
  scope: Scope;
};

export type RestoredSnapshot = {
  ast: Module;
  budget: Budget;
  callStack: RestoredCallFrame[];
  currentAstNodeId: number;
  currentNode: ParseResult;
  currentScope: Scope;
  moduleBindings: Record<string, SandboxValue>;
  pendingPromises: RuntimePendingPromise[];
  scopeChain: RestoredScopeFrame[];
  signal?: AbortSignal;
  sourceHash: string;
};

type RestoreState = {
  budget: Budget;
  heap: Record<string, SerializedHeapValue>;
  heapValueById: Map<number, RuntimeSnapshotValue>;
  moduleBindings: Record<string, SandboxValue>;
  nodeById: Map<number, ParseResult>;
  pendingPromiseById: Map<SnapshotId, RuntimePendingPromise>;
  serializedScopeById: Map<SnapshotId, SerializedScopeFrame>;
  scopeById: Map<SnapshotId, Scope>;
  scopeFrameById: Map<SnapshotId, RuntimeScopeFrame>;
};

export function restore(snapshot: SerializedSnapshot, options: RestoreOptions): RestoredSnapshot {
  let currentSourceHash: string;
  try {
    currentSourceHash = hashSource(options.source);
  } catch {
    throw new Error(
      `source changed since snapshot was taken (hash ${snapshot.sourceHash} expected, but current source could not be hashed); pass --reset to discard`
    );
  }

  if (snapshot.sourceHash !== currentSourceHash) {
    throw new SnapshotMismatchError(snapshot.sourceHash, currentSourceHash);
  }

  const ast = parseModule(options.source);
  const nodeById = indexAstNodes(ast);
  const currentNode = nodeById.get(snapshot.currentAstNodeId);

  if (currentNode === undefined) {
    throw new Error(`Snapshot references unknown AST node ${snapshot.currentAstNodeId}.`);
  }

  const state: RestoreState = {
    budget: options.budget,
    heap: snapshot.heap ?? {},
    heapValueById: new Map(),
    moduleBindings: restoreModuleBindings(snapshot.moduleBindings, options.modules, {
      budget: options.budget,
      signal: options.signal
    }),
    nodeById,
    pendingPromiseById: new Map(),
    serializedScopeById: new Map(snapshot.scopeChain.map((frame) => [frame.id, frame])),
    scopeById: new Map(),
    scopeFrameById: new Map()
  };

  const pendingPromises = snapshot.pendingPromises.map((entry) =>
    restorePendingPromise(entry, state)
  );
  const scopeChain = snapshot.scopeChain.map((frame) => restoreScopeFrame(frame, state));
  const currentScopeId = snapshot.callStack.at(-1)?.scopeId ?? scopeChain.at(-1)?.id;

  if (currentScopeId === undefined) {
    throw new Error("Snapshot does not contain a scope to resume.");
  }

  const currentScope = state.scopeById.get(currentScopeId);
  if (currentScope === undefined) {
    throw new Error(`Snapshot references unknown scope ${String(currentScopeId)}.`);
  }

  return {
    ast,
    budget: options.budget,
    callStack: snapshot.callStack.map((frame) => restoreCallFrame(frame, state)),
    currentAstNodeId: snapshot.currentAstNodeId,
    currentNode,
    currentScope,
    moduleBindings: state.moduleBindings,
    pendingPromises,
    scopeChain: scopeChain.map((frame) => ({
      ...frame,
      scope: state.scopeById.get(frame.id) ?? currentScope
    })),
    signal: options.signal,
    sourceHash: snapshot.sourceHash
  };
}

function restoreCallFrame(frame: RuntimeCallFrame, state: RestoreState): RestoredCallFrame {
  const node = state.nodeById.get(frame.astNodeId);
  if (node === undefined) {
    throw new Error(`Snapshot references unknown AST node ${frame.astNodeId}.`);
  }

  const scope = state.scopeById.get(frame.scopeId);
  if (scope === undefined) {
    throw new Error(`Snapshot references unknown scope ${String(frame.scopeId)}.`);
  }

  const awaitingPromise =
    frame.awaitingPromiseId === undefined
      ? undefined
      : state.pendingPromiseById.get(frame.awaitingPromiseId);

  if (frame.awaitingPromiseId !== undefined && awaitingPromise === undefined) {
    throw new Error(
      `Snapshot references unknown pending promise ${String(frame.awaitingPromiseId)}.`
    );
  }

  return awaitingPromise === undefined
    ? {
        ...frame,
        node,
        scope
      }
    : {
        ...frame,
        awaitingPromise,
        node,
        scope
      };
}

function restorePendingPromise(
  entry: SerializedPendingPromise,
  state: RestoreState
): RuntimePendingPromise {
  const existing = state.pendingPromiseById.get(entry.id);
  if (existing !== undefined) {
    return existing;
  }

  const runtime = Object.assign(
    Object.create(createSandboxPromise(new Promise<SandboxValue>(() => undefined))),
    {
      id: entry.id
    }
  ) as RuntimePendingPromise;

  state.pendingPromiseById.set(entry.id, runtime);

  for (const [key, value] of Object.entries(entry)) {
    if (key === "id") {
      continue;
    }

    runtime[key] = deserializeValue(value as SerializedSnapshotValue, state);
  }

  runtime.resumePolicy = resolvePendingHostCallResumePolicy(runtime);

  return runtime;
}

function restoreScopeFrame(frame: SerializedScopeFrame, state: RestoreState): RuntimeScopeFrame {
  const existing = state.scopeFrameById.get(frame.id);
  if (existing !== undefined) {
    return existing;
  }

  const bindings = Object.create(null) as Record<string, RuntimeSnapshotValue>;

  const runtimeFrame =
    frame.parentId === undefined
      ? {
          id: frame.id,
          bindings
        }
      : {
          id: frame.id,
          parentId: frame.parentId,
          bindings
        };

  state.scopeFrameById.set(frame.id, runtimeFrame);

  for (const [name, value] of Object.entries(frame.bindings)) {
    bindings[name] = deserializeValue(value, state);
  }

  if (frame.parentId === undefined) {
    for (const [name, value] of Object.entries(state.moduleBindings)) {
      if (Object.hasOwn(bindings, name)) {
        throw new Error(`Snapshot tried to restore module binding '${name}' twice.`);
      }

      bindings[name] = value as RuntimeSnapshotValue;
    }
  }

  const parentScope =
    frame.parentId === undefined
      ? undefined
      : (state.scopeById.get(frame.parentId) ?? restoreParentScope(frame.parentId, state));
  const scope =
    parentScope === undefined
      ? new Scope(bindings as Record<string, SandboxValue>)
      : parentScope.child(bindings as Record<string, SandboxValue>);

  state.scopeById.set(frame.id, scope);
  return runtimeFrame;
}

function restoreParentScope(scopeId: SnapshotId, state: RestoreState): Scope {
  const existing = state.scopeById.get(scopeId);
  if (existing !== undefined) {
    return existing;
  }

  const frame = state.serializedScopeById.get(scopeId);
  if (frame !== undefined) {
    restoreScopeFrame(frame, state);
    const restored = state.scopeById.get(scopeId);
    if (restored !== undefined) {
      return restored;
    }
  }

  throw new Error(`Snapshot references unknown scope ${String(scopeId)}.`);
}

function deserializeValue(
  value: SerializedSnapshotValue,
  state: RestoreState
): RuntimeSnapshotValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => deserializeValue(entry, state));
  }

  if (isSerializedUndefinedValue(value)) {
    return undefined;
  }

  if (isSerializedNonFiniteNumberValue(value)) {
    switch (value.value) {
      case "NaN":
        return Number.NaN;
      case "Infinity":
        return Number.POSITIVE_INFINITY;
      case "-Infinity":
        return Number.NEGATIVE_INFINITY;
    }
  }

  if (isSerializedReferenceValue(value)) {
    return restoreHeapValue(value.id, state);
  }

  if (isSerializedPromiseValue(value)) {
    return restorePromiseValue(value.id, state);
  }

  if (isSerializedClosureValue(value)) {
    return restoreClosureValue(value.astNodeId, value.capturedScopeId, state);
  }

  const object = Object.create(null) as Record<string, RuntimeSnapshotValue>;
  for (const [key, entry] of Object.entries(value)) {
    object[key] = deserializeValue(entry, state);
  }

  return object;
}

function restoreHeapValue(id: number, state: RestoreState): RuntimeSnapshotValue {
  const existing = state.heapValueById.get(id);
  if (existing !== undefined) {
    return existing;
  }

  const serialized = state.heap[String(id)];
  if (serialized === undefined) {
    throw new Error(`Snapshot references unknown heap value ${id}.`);
  }

  if (serialized.kind === "array") {
    const array: RuntimeSnapshotValue[] = [];
    state.heapValueById.set(id, array);

    for (const entry of serialized.items) {
      array.push(deserializeValue(entry, state));
    }

    return array;
  }

  const object = Object.create(null) as Record<string, RuntimeSnapshotValue>;
  state.heapValueById.set(id, object);

  for (const [key, entry] of Object.entries(serialized.entries)) {
    object[key] = deserializeValue(entry, state);
  }

  return object;
}

function restoreClosureValue(
  astNodeId: number,
  capturedScopeId: SnapshotId,
  state: RestoreState
): SandboxClosure & {
  astNodeId: number;
  capturedScopeId: SnapshotId;
} {
  const node = state.nodeById.get(astNodeId);
  if (node?.type !== "ArrowFunctionExpression") {
    throw new Error(`Snapshot references unknown closure AST node ${astNodeId}.`);
  }

  const baseClosure = createSandboxClosure({
    async: true,
    call: (args) => createSandboxPromise(executeRestoredClosure(node, capturedScopeId, args, state))
  });

  return Object.defineProperties(Object.create(baseClosure), {
    astNodeId: {
      enumerable: true,
      value: astNodeId
    },
    capturedScopeId: {
      enumerable: true,
      value: capturedScopeId
    },
    kind: {
      enumerable: true,
      value: "fn"
    }
  }) as SandboxClosure & {
    astNodeId: number;
    capturedScopeId: SnapshotId;
  };
}

async function executeRestoredClosure(
  node: ArrowFunctionExpression,
  capturedScopeId: SnapshotId,
  args: readonly SandboxValue[],
  state: RestoreState
): Promise<SandboxValue> {
  const capturedScope =
    state.scopeById.get(capturedScopeId) ?? restoreParentScope(capturedScopeId, state);
  const scope = capturedScope.child();

  for (let index = 0; index < node.params.length; index += 1) {
    const param = node.params[index];
    if (param.type !== "Identifier") {
      throw new TypeError(`Unsupported async arrow parameter pattern '${param.type}'.`);
    }

    scope.declare(param.name, "const", args[index]);
  }

  const result = await interpret(node.body, {
    budget: state.budget,
    scope
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.returnValue;
}

function restorePromiseValue(
  id: SnapshotId,
  state: RestoreState
): RuntimePendingPromise & SandboxPromise {
  return (state.pendingPromiseById.get(id) ??
    restorePendingPromise({ id }, state)) as RuntimePendingPromise & SandboxPromise;
}

function restoreModuleBindings(
  moduleBindings: SerializedSnapshot["moduleBindings"],
  modules: ModuleRegistry | undefined,
  options: { budget: Budget; signal?: AbortSignal }
): Record<string, SandboxValue> {
  const bindings = Object.create(null) as Record<string, SandboxValue>;
  const registry = normalizeModuleRegistry(modules);

  for (const [localName, moduleName] of Object.entries(moduleBindings)) {
    const moduleExports = registry.get(moduleName);
    if (moduleExports === undefined) {
      throw new Error(createUnknownModuleMessage(moduleName, [...registry.keys()]));
    }

    bindings[localName] = createModuleNamespace(
      wrapCallerInjectedBindings(Object.fromEntries(moduleExports), options)
    );
  }

  return bindings;
}

function createModuleNamespace(bindings: Record<string, SandboxValue>): SandboxValue {
  return Object.assign(Object.create(null) as Record<string, SandboxValue>, bindings);
}

function normalizeModuleRegistry(
  modules: ModuleRegistry | undefined
): Map<string, Map<string, CallerInjectedBinding>> {
  if (modules === undefined) {
    return new Map();
  }

  const entries = modules instanceof Map ? [...modules.entries()] : Object.entries(modules);
  return new Map(
    entries
      .map(
        ([moduleName, moduleExports]) =>
          [moduleName, normalizeModuleExports(moduleExports)] as const
      )
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function normalizeModuleExports(moduleExports: ModuleExports): Map<string, CallerInjectedBinding> {
  const entries =
    moduleExports instanceof Map ? [...moduleExports.entries()] : Object.entries(moduleExports);

  return new Map(
    entries.filter(([name]) => name.length > 0).sort(([left], [right]) => left.localeCompare(right))
  );
}

function indexAstNodes(root: Module): Map<number, ParseResult> {
  const nodeById = new Map<number, ParseResult>();
  visit(root);
  return nodeById;

  function visit(value: unknown): void {
    if (typeof value !== "object" || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }

      return;
    }

    if (
      "type" in value &&
      typeof value.type === "string" &&
      value.type !== "Module" &&
      "nodeId" in value &&
      typeof value.nodeId === "number"
    ) {
      nodeById.set(value.nodeId, value as ParseResult);
    }

    for (const entry of Object.values(value)) {
      visit(entry);
    }
  }
}

function isSerializedUndefinedValue(
  value: SerializedSnapshotValue
): value is { kind: "undefined" } {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "undefined"
  );
}

function isSerializedNonFiniteNumberValue(
  value: SerializedSnapshotValue
): value is { kind: "number"; value: "-Infinity" | "Infinity" | "NaN" } {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "number" &&
    hasOwnProperty(value, "value")
  );
}

function isSerializedReferenceValue(
  value: SerializedSnapshotValue
): value is SerializedReferenceValue {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "ref" &&
    hasOwnProperty(value, "id")
  );
}

function isSerializedPromiseValue(value: SerializedSnapshotValue): value is SerializedPromiseValue {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "promise" &&
    hasOwnProperty(value, "id")
  );
}

function isSerializedClosureValue(value: SerializedSnapshotValue): value is SerializedClosureValue {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "fn" &&
    hasOwnProperty(value, "astNodeId") &&
    hasOwnProperty(value, "capturedScopeId")
  );
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}
