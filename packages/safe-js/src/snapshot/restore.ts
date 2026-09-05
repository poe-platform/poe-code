import { Budget, SandboxError, type CompileOwner } from "../interp/budget.js";
import { executeAsyncFunction } from "../interp/async.js";
import { toPropertyKey } from "../interp/property-key.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { decodeFloat32Storage } from "./float32array.js";
import { restoreDateTime } from "../interp/date.js";
import { sandboxErrorTypes } from "../error/shape.js";
import { SnapshotMismatchError } from "../restore.js";
import { Scope, setSandboxProperty } from "../interp/interpreter.js";
import { getGuestFunctionProperties, getGuestFunctionProperty, getSandboxDataProperty, registerGuestClosure, setSandboxPrototype } from "../interp/object-model.js";
import { functionSources } from "../parse/function-source.js";
import { wrapCallerInjectedBindings, type CallerInjectedBinding } from "../interp/host-bridge.js";
import { restoreSandboxCollectionIterator } from "../interp/collection-iterator.js";
import { isSandboxMap, isSandboxSet } from "../interp/values.js";
import {
  createSandboxArguments,
  createSandboxClosure,
  createSandboxGenerator,
  createSandboxMap,
  createSandboxPromise,
  createSandboxRegex,
  createSandboxSet,
  reconcileCompiledValues,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxGenerator,
  type SandboxPromise,
  type SandboxValue
} from "../interp/values.js";
import {
  createGeneratorChannel,
  restoreGeneratorChannel,
  type GeneratorCompletion
} from "../interp/generator.js";
import { hashSource } from "../parse/hash.js";
import { getFunctionLength } from "../parse/bindings.js";
import {
  parseModule,
  type ArrowFunctionExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type Module,
  type ParseResult
} from "../parse/parser.js";
import {
  createUnknownModuleMessage,
  type ModuleExports,
  type ModuleRegistry
} from "../modules/registry.js";
import { interpret } from "../interp/interpreter.js";
import { bindPattern } from "../interp/patterns.js";
import { resolvePendingHostCallResumePolicy } from "./policy.js";
import { validateInterpreterSnapshot, validateSnapshotSourceHash } from "./validation.js";
import type {
  RuntimeCallFrame,
  RuntimePendingPromise,
  RuntimeScopeFrame,
  SerializedClosureValue,
  SerializedGeneratorValue,
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
  budget?: Budget;
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
  initializeIterators: Array<() => void>;
  budget: Budget;
  compilation: CompileScope;
  heap: Record<string, SerializedHeapValue>;
  heapValueById: Map<number, RuntimeSnapshotValue>;
  moduleBindings: Record<string, SandboxValue>;
  nodeById: Map<number, ParseResult>;
  pendingPromiseById: Map<SnapshotId, RuntimePendingPromise>;
  serializedScopeById: Map<SnapshotId, SerializedScopeFrame>;
  scopeById: Map<SnapshotId, Scope>;
  scopeFrameById: Map<SnapshotId, RuntimeScopeFrame>;
};

export function restore(
  snapshot: SerializedSnapshot,
  options: RestoreOptions,
  owner?: CompileOwner
): RestoredSnapshot {
  const budget = options.budget ?? new Budget();
  const operation = budget.acquireCompileOwner(false, owner);
  const compilation = new CompileScope(operation.owner);
  try {
    validateSnapshotSourceHash(snapshot);
    let currentSourceHash: string;
    try {
      currentSourceHash = hashSource(options.source, operation.owner);
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      throw new Error(
        `source changed since snapshot was taken (hash ${snapshot.sourceHash} expected, but current source could not be hashed); pass --reset to discard`
      );
    }

    if (snapshot.sourceHash !== currentSourceHash) {
      throw new SnapshotMismatchError(snapshot.sourceHash, currentSourceHash);
    }

    const ast = parseModule(options.source, "<input>", operation.owner);
    const nodeById = indexAstNodes(ast);
    validateInterpreterSnapshot(snapshot, nodeById, budget);
    const currentNode = nodeById.get(snapshot.currentAstNodeId);

    if (currentNode === undefined) {
      throw new Error(`Snapshot references unknown AST node ${snapshot.currentAstNodeId}.`);
    }

    const state: RestoreState = {
      initializeIterators: [],
      budget,
      compilation,
      heap: snapshot.heap ?? {},
      heapValueById: new Map(),
      moduleBindings: restoreModuleBindings(snapshot.moduleBindings, options.modules, {
        budget,
        compileOwner: operation.owner,
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

    const callStack = snapshot.callStack.map((frame) => restoreCallFrame(frame, state));
    for (const initialize of state.initializeIterators) initialize();
    reconcileCompiledValues(
      budget,
      [
        ...currentScope.retainedValues(),
        ...pendingPromises.flatMap((pending) =>
          Object.values(pending).filter(isSandboxSnapshotValue)
        )
      ],
      compilation
    );

    return {
      ast,
      budget,
      callStack,
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
  } finally {
    compilation.dispose();
    operation.release();
  }
}

function isSandboxSnapshotValue(value: unknown): value is SandboxValue {
  return value !== undefined && !(value instanceof Promise);
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

  const pending: SerializedScopeFrame[] = [];
  let current: SerializedScopeFrame | undefined = frame;
  while (current !== undefined && !state.scopeFrameById.has(current.id)) {
    pending.push(current);
    current =
      current.parentId === undefined ? undefined : state.serializedScopeById.get(current.parentId);
  }

  while (pending.length > 0) {
    createScopeFrame(pending.pop() as SerializedScopeFrame, state);
  }

  return state.scopeFrameById.get(frame.id) as RuntimeScopeFrame;
}

function createScopeFrame(frame: SerializedScopeFrame, state: RestoreState): void {
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
    frame.parentId === undefined ? undefined : state.scopeById.get(frame.parentId);
  if (frame.parentId !== undefined && parentScope === undefined) {
    throw new Error(`Snapshot references unknown scope ${String(frame.parentId)}.`);
  }
  const scope =
    parentScope === undefined
      ? new Scope(bindings as Record<string, SandboxValue>)
      : parentScope.child(bindings as Record<string, SandboxValue>);

  state.scopeById.set(frame.id, scope);
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
      case "-0":
        return -0;
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

  if (isSerializedGeneratorValue(value)) {
    return restoreGeneratorValue(value, state);
  }

  if (isSerializedRegexValue(value)) {
    return createSandboxRegex(value.source, value.flags, value.lastIndex, state.compilation);
  }

  const object = Object.create(null) as Record<string, RuntimeSnapshotValue>;
  for (const [key, entry] of Object.entries(value)) {
    object[key] = deserializeValue(entry, state);
  }

  return object;
}

function restoreGeneratorValue(
  value: SerializedGeneratorValue,
  state: RestoreState
): SandboxGenerator {
  if (value.state === "done") {
    const generator = createSandboxGenerator(createGeneratorChannel(async () => undefined));
    generator.state = "done";
    return generator;
  }

  const node = state.nodeById.get(value.astNodeId);
  if (node?.type !== "FunctionDeclaration" && node?.type !== "FunctionExpression") {
    throw new Error(`Snapshot references unknown generator AST node ${value.astNodeId}.`);
  }
  if (!node.generator) {
    throw new Error(`Snapshot references non-generator AST node ${value.astNodeId}.`);
  }

  const createBody: Parameters<typeof createGeneratorChannel>[0] = async (generatorYield) => {
    const capturedScope =
      state.scopeById.get(value.capturedScopeId) ??
      restoreParentScope(value.capturedScopeId, state);
    const result = await interpret(node.body, {
      budget: state.budget,
      compileOwner: state.compilation.owner,
      ...(value.state === "suspended"
        ? {
            generatorResume: {
              sent: deserializeGeneratorCompletions(value.sent, state),
              yieldNodeId: value.yieldNodeId
            }
          }
        : {}),
      generatorYield,
      scope: capturedScope,
      useScopeDirectly: true
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return result.returnValue;
  };
  const channel =
    value.state === "suspended"
      ? restoreGeneratorChannel(createBody, {
          yieldNodeId: value.yieldNodeId,
          sent: deserializeGeneratorCompletions(value.sent, state)
        })
      : createGeneratorChannel(createBody);

  const generator = createSandboxGenerator(channel, {
    astNodeId: value.astNodeId,
    capturedScopeId: value.capturedScopeId
  });
  generator.state = value.state;
  return generator;
}

function deserializeGeneratorCompletions(
  value: SerializedSnapshotValue,
  state: RestoreState
): GeneratorCompletion[] {
  const sent = deserializeValue(value, state);
  if (!Array.isArray(sent)) {
    throw new TypeError("Snapshot generator sent state must be an array.");
  }
  return sent.map((completion) => {
    const candidate = completion as { type?: unknown; value?: unknown };
    if (
      typeof completion !== "object" ||
      completion === null ||
      Array.isArray(completion) ||
      !Object.hasOwn(completion, "type") ||
      !["normal", "return", "throw"].includes(String(candidate.type)) ||
      !Object.hasOwn(completion, "value")
    ) {
      throw new TypeError("Snapshot generator sent state contains an invalid completion.");
    }
    return candidate as GeneratorCompletion;
  });
}

function isSerializedRegexValue(
  value: SerializedSnapshotValue
): value is { kind: "regex"; source: string; flags: string; lastIndex: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "kind") &&
    value.kind === "regex" &&
    typeof value.source === "string" &&
    typeof value.flags === "string" &&
    typeof value.lastIndex === "number"
  );
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

  if (serialized.kind === "date") {
    const value = restoreDateTime(serialized.time);
    state.heapValueById.set(id, value);
    return value;
  }
  if (serialized.kind === "regex-object") {
    const value = createSandboxRegex(serialized.source, serialized.flags, 0, state.compilation);
    state.heapValueById.set(id, value);
    value.lastIndex = deserializeValue(serialized.lastIndex, state) as SandboxValue;
    return value;
  }
  if (serialized.kind === "float32array") {
    const value = decodeFloat32Storage(serialized, (reference) =>
      deserializeValue(reference as SerializedSnapshotValue, state)
    );
    state.heapValueById.set(id, value);
    for (const [key, entry] of Object.entries(serialized.entries)) {
      Object.defineProperty(value, key, {
        value: deserializeValue(entry, state),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return value;
  }

  if (serialized.kind === "array") {
    const array = new Array<RuntimeSnapshotValue>(
      "items" in serialized ? serialized.items.length : serialized.length
    );
    state.heapValueById.set(id, array);

    const entries =
      "items" in serialized ? Object.entries(serialized.items) : Object.entries(serialized.entries);
    for (const [key, entry] of entries) {
      Object.defineProperty(array, key, {
        value: deserializeValue(entry, state),
        configurable: true,
        enumerable: true,
        writable: true
      });
    }

    return array;
  }

  if (serialized.kind === "arguments") {
    const args = createSandboxArguments([]);
    if (!serialized.lengthBeforeCallee) delete args.length;
    state.heapValueById.set(id, args as RuntimeSnapshotValue);
    for (const [key, descriptor] of Object.entries(serialized.properties)) {
      Object.defineProperty(args, key, {
        ...descriptor,
        value: deserializeValue(descriptor.value, state)
      });
    }
    if (serialized.iterator === null) {
      Reflect.deleteProperty(args, Symbol.iterator);
    } else {
      Object.defineProperty(args, Symbol.iterator, {
        ...serialized.iterator,
        value: Array.prototype.values
      });
    }
    if (!serialized.extensible) Object.preventExtensions(args);
    return args as RuntimeSnapshotValue;
  }

  if (serialized.kind === "collection-iterator") {
    const iterator = restoreSandboxCollectionIterator({ collection: undefined, collectionKind: serialized.collectionKind, method: serialized.method, index: 0, exhausted: true });
    state.heapValueById.set(id, iterator);
    const collection = deserializeValue(serialized.collection, state);
    if (collection !== undefined && !isSandboxMap(collection) && !isSandboxSet(collection)) throw new TypeError("Invalid collection iterator source.");
    state.initializeIterators.push(() => { restoreSandboxCollectionIterator({ ...serialized, collection }, iterator); });
    for (const [key, entry] of Object.entries(serialized.entries)) Object.defineProperty(iterator, key, { value: deserializeValue(entry, state), enumerable: true, configurable: true, writable: true });
    return iterator;
  }

  if (serialized.kind === "map") {
    const map = createSandboxMap();
    state.heapValueById.set(id, map);
    for (const [key, entry] of serialized.entries) {
      map.entries.set(
        deserializeValue(key, state) as SandboxValue,
        deserializeValue(entry, state) as SandboxValue
      );
    }
    return map;
  }

  if (serialized.kind === "set") {
    const set = createSandboxSet();
    state.heapValueById.set(id, set);
    for (const entry of serialized.values) {
      set.values.add(deserializeValue(entry, state) as SandboxValue);
    }
    return set;
  }

  const object = Object.create(null) as Record<string, RuntimeSnapshotValue>;
  state.heapValueById.set(id, object);
  if (serialized.errorType !== undefined) sandboxErrorTypes.set(object, serialized.errorType);

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
  if (
    node?.type !== "ArrowFunctionExpression" &&
    node?.type !== "FunctionDeclaration" &&
    node?.type !== "FunctionExpression"
  ) {
    throw new Error(`Snapshot references unknown closure AST node ${astNodeId}.`);
  }

  const baseClosure = createSandboxClosure({
    sourceRange: functionSources.get(node),
    async: node.async,
    sandbox: true,
    length: getFunctionLength(node.params),
    ...(node.type === "ArrowFunctionExpression" || node.id === undefined ? {} : { name: node.id.name }),
    ...(node.type !== "ArrowFunctionExpression" &&
    !(node.type === "FunctionExpression" && node.method === true) &&
    !node.generator &&
    !node.async
      ? {
          construct: async (args: readonly SandboxValue[], callContext?: SandboxCallContext) => {
            const thisValue = {};
            const prototype = getGuestFunctionProperty(restoredClosure, "prototype");
            if (typeof prototype === "object" && prototype !== null) {
              setSandboxPrototype(thisValue, prototype, state.budget);
            }
            const result = await executeRestoredClosure(
              node,
              capturedScopeId,
              restoredClosure,
              args,
              thisValue,
              state,
              callContext
            );
            return typeof result === "object" && result !== null ? result : thisValue;
          }
        }
      : {}),
    call: (args, callContext) => {
      if (node.async) {
        return executeAsyncFunction(
          (onSuspend) =>
            executeRestoredClosure(
              node,
              capturedScopeId,
              restoredClosure,
              args,
              callContext?.thisValue,
              state,
              callContext,
              onSuspend
            ),
          state.budget
        );
      }
      return executeRestoredClosure(
        node,
        capturedScopeId,
        restoredClosure,
        args,
        callContext?.thisValue,
        state,
        callContext
      );
    }
  });

  const restoredClosure: SandboxClosure & {
    astNodeId: number;
    capturedScopeId: SnapshotId;
  } = Object.defineProperties(Object.create(baseClosure), {
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
  registerGuestClosure(restoredClosure);
  Object.defineProperty(restoredClosure, "properties", { get: () => getGuestFunctionProperties(restoredClosure) });
  return restoredClosure;
}

async function executeRestoredClosure(
  node: ArrowFunctionExpression | FunctionDeclaration | FunctionExpression,
  capturedScopeId: SnapshotId,
  closure: SandboxClosure,
  args: readonly SandboxValue[],
  thisValue: SandboxValue,
  state: RestoreState,
  callContext?: SandboxCallContext,
  onSuspend?: () => void
): Promise<SandboxValue> {
  const parent = callContext?.compilation ?? state.compilation;
  const operation = state.budget.acquireCompileOwner(false, parent.owner);
  const compilation = new CompileScope(operation.owner, parent);
  state = { ...state, compilation };
  try {
    const capturedScope =
      state.scopeById.get(capturedScopeId) ?? restoreParentScope(capturedScopeId, state);
    const wrapperScope =
      node.type === "FunctionExpression" && node.id !== undefined
        ? capturedScope.child()
        : capturedScope;
    const scope = wrapperScope.child();

    if (node.type === "FunctionExpression" && node.id !== undefined) {
      wrapperScope.declare(node.id.name, "const", closure);
    }
    if (node.type !== "ArrowFunctionExpression") {
      scope.declare("this", "const", thisValue);
      state.budget.allocateArrayLength(args.length);
      scope.declare("arguments", "let", createSandboxArguments(args));
    }

    for (let index = 0; index < node.params.length; index += 1) {
      const param = node.params[index];
      if (param.type === "RestElement") {
        const rest = args.slice(index);
        state.budget.allocateArrayLength(rest.length);
        const binding = await bindPattern(param, rest, { kind: "let" }, scope, {
          toPropertyKey: value => toPropertyKey(value, state.budget, { ...callContext, stack: callContext?.stack ?? [], thisValue, compilation }),
          getProperty: (value, key) => getSandboxDataProperty(value, key, state.budget),
          setProperty: (target, key, value) => setSandboxProperty(target, key, value, state.budget),
          evaluate: async (defaultNode) => {
            const result = await interpret(defaultNode, {
              budget: state.budget,
              compilation,
              scope,
              nested: true,
              useScopeDirectly: true
            });
            return result.ok
              ? {
                  kind: "normal",
                  hasValue: "returnValue" in result,
                  value: result.returnValue
                }
              : { kind: "error", error: result.error };
          }
        });
        if (!binding.ok) {
          if (binding.result.kind === "error") {
            throw binding.result.error;
          }
          if (binding.result.kind === "throw") {
            throw binding.result.value;
          }
        }
        break;
      }
      const binding = await bindPattern(param, args[index], { kind: "let" }, scope, {
        toPropertyKey: value => toPropertyKey(value, state.budget, { ...callContext, stack: callContext?.stack ?? [], thisValue, compilation }),
        getProperty: (value, key) => getSandboxDataProperty(value, key, state.budget),
        setProperty: (target, key, value) => setSandboxProperty(target, key, value, state.budget),
        evaluate: async (defaultNode) => {
          const result = await interpret(defaultNode, {
            budget: state.budget,
            compilation,
            scope,
            nested: true,
            useScopeDirectly: true
          });
          return result.ok
            ? {
                kind: "normal",
                hasValue: "returnValue" in result,
                value: result.returnValue
              }
            : { kind: "error", error: result.error };
        }
      });
      if (!binding.ok) {
        if (binding.result.kind === "error") {
          throw binding.result.error;
        }
        if (binding.result.kind === "throw") {
          throw binding.result.value;
        }
      }
    }

    const result = await interpret(node.body, {
      budget: state.budget,
      compilation,
      nested: true,
      onSuspend,
      scope
    });

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    reconcileCompiledValues(
      state.budget,
      [...scope.retainedValues(), result.returnValue],
      compilation,
      parent,
      [result.returnValue]
    );
    return result.returnValue;
  } finally {
    compilation.dispose();
    operation.release();
  }
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
  options: { budget: Budget; compileOwner?: CompileOwner; signal?: AbortSignal }
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
      hasOwnProperty(value, "type") &&
      typeof value.type === "string" &&
      value.type !== "Module" &&
      hasOwnProperty(value, "nodeId") &&
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
): value is { kind: "number"; value: "-Infinity" | "Infinity" | "NaN" | "-0" } {
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

function isSerializedGeneratorValue(
  value: SerializedSnapshotValue
): value is SerializedGeneratorValue {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "kind") &&
    value.kind === "generator" &&
    hasOwnProperty(value, "state") &&
    (value.state === "done" ||
      (value.state === "start" &&
        hasOwnProperty(value, "astNodeId") &&
        typeof value.astNodeId === "number" &&
        hasOwnProperty(value, "capturedScopeId") &&
        (typeof value.capturedScopeId === "number" || typeof value.capturedScopeId === "string")) ||
      (value.state === "suspended" &&
        hasOwnProperty(value, "astNodeId") &&
        typeof value.astNodeId === "number" &&
        hasOwnProperty(value, "capturedScopeId") &&
        (typeof value.capturedScopeId === "number" || typeof value.capturedScopeId === "string") &&
        hasOwnProperty(value, "yieldNodeId") &&
        typeof value.yieldNodeId === "number" &&
        hasOwnProperty(value, "sent")))
  );
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}
