import { AsyncLocalStorage } from "node:async_hooks";

import { hashSource } from "./parse/hash.js";
import { withRunResources } from "./interp/resources.js";
import { createReplayableRandom } from "./random.js";
import {
  attachErrorSpan,
  describeThrownValue,
  materializeWrappedErrorCause,
  replaceErrorStack,
  type ErrorSourceSpan
} from "./error/shape.js";
import type { ParseResult } from "./parse.js";
import {
  parseExecutableModule,
  type AwaitExpression,
  type CallExpression,
  type Identifier,
  type Module,
  type SourceSpan,
  type Statement
} from "./parse/parser.js";
import { restore, type SafeJSSnapshot } from "./restore.js";
import { Budget } from "./interp/budget.js";
import {
  PromiseReplay,
  promiseReplayContext,
  type PromiseReplaySnapshot
} from "./interp/promise-replay.js";
import { wrapCancelableBindings } from "./interp/cancel.js";
import { enterSnapshotRun } from "./interp/running-state.js";
import {
  createSandboxPromiseRejectionTracker,
  observeSandboxPromise,
  withSandboxPromiseRejectionTracker,
  type SandboxPromiseRejectionTracker
} from "./interp/promise-tracker.js";
import {
  HostCallJournal,
  type HostCallRecord,
  type HostCallReplay,
  type HostCallResumeProvider
} from "./interp/host-call.js";
import { createConsoleJsonGlobals, type ConsoleSink } from "./interp/globals/console-json.js";
import { createCollectionGlobals } from "./interp/globals/collections.js";
import { createFloat32ArrayGlobal } from "./interp/globals/float32array.js";
import { createErrorGlobals } from "./interp/globals/error.js";
import { createMathGlobals } from "./interp/globals/math.js";
import { createRegexGlobals } from "./interp/globals/regex.js";
import { createMiscGlobals } from "./interp/globals/misc.js";
import { createObjectArrayGlobals } from "./interp/globals/object-array.js";
import {
  declareHostOperation,
  wrapCallerInjectedBindings,
  type CallerInjectedBinding
} from "./interp/host-bridge.js";
import {
  interpret,
  Scope,
  type InterpreterResult,
  type LoopIterationSnapshot
} from "./interp/interpreter.js";
import { consumeSettledHostCall, createPromiseGlobals } from "./interp/promise.js";
import {
  deepCopyToSandbox,
  isSandboxClosure,
  isSandboxPromise,
  measureSandboxData,
  type SandboxValue,
  type SandboxPromise
} from "./interp/values.js";
import { resolveModuleImports, type ModuleRegistry } from "./modules/registry.js";
import {
  activateOtelSink,
  getActiveOtelSpan,
  safeAddEvent,
  type OtelSink
} from "./observability/otel.js";
import type { SnapshotBackend } from "./snapshot/backend.js";
import { attachDumpController, createDumpController } from "./snapshot/dump.js";
import { DUMP_FORMAT_VERSION, EXECUTION_SEMANTICS } from "./snapshot/dump-format.js";
import { createSnapshotScheduler, type SnapshotScheduler } from "./snapshot/scheduler.js";
import { UnsnapshotableValueError } from "./snapshot/serialize.js";
import { prepareReplayInputs } from "./snapshot/replay-inputs.js";
import {
  decodeReplayData,
  MissingReplayCapabilityError,
  type ReplayData
} from "./snapshot/replay-data.js";

export type RunOptions = {
  bindings?: Record<string, CallerInjectedBinding>;
  budget?: Budget;
  clock?: RunClock;
  entryPointArgs?: readonly unknown[];
  filename?: string;
  importMeta?: Record<string, unknown>;
  hostCallResumeProvider?: HostCallResumeProvider;
  modules?: ModuleRegistry;
  random?: RunRandom;
  randomSeed?: number;
  otelSink?: OtelSink;
  signal?: AbortSignal;
  snapshot?: SafeJSSnapshot;
  snapshotBackend?: SnapshotBackend;
  snapshotIntervalMs?: number;
  snapshotPath?: string;
  sink?: ConsoleSink;
};

export class UnhandledRejectionError extends Error {
  readonly reason: unknown;

  constructor(reason: unknown, span?: ErrorSourceSpan) {
    super(`Unhandled rejection: ${describeThrownValue(reason)}`);
    this.name = "UnhandledRejectionError";
    this.reason = reason;
    attachErrorSpan(this, span);
    replaceErrorStack(this);
  }
}

export type RunSnapshot = SafeJSSnapshot & {
  bindings: InterpreterResult["snapshot"]["bindings"];
  clock?: RunClockSnapshot;
  hostCalls?: HostCallRecord[];
  replay?: HostCallReplay;
  replayError?: string;
  promiseReplay?: PromiseReplaySnapshot;
  initialInputs?: ReplayData;
  loopIterations?: Record<string, LoopIterationSnapshot>;
  pendingAwaits?: RunPendingAwaitSnapshot[];
  random?: {
    seed: number;
    state: number;
    initialState?: number;
    resumeState?: number;
  };
};

export type RunPendingAwaitSnapshot = {
  nodeId?: number;
  span: SourceSpan;
};

export type RunClockSnapshot = {
  next: number;
};

export type RunClock = {
  snapshot: () => RunClockSnapshot | undefined;
};

export type RunRandom = {
  next: () => number;
  seed: number;
  snapshot: () => number;
};

type WithRunSnapshot<TResult extends InterpreterResult> = TResult extends unknown
  ? Omit<TResult, "snapshot"> & {
      snapshot: RunSnapshot;
    }
  : never;

export type RunResult = WithRunSnapshot<InterpreterResult>;

const DEFAULT_MAX_CALL_DEPTH = 1_000;

export function run(source: string, options: RunOptions = {}): Promise<RunResult> {
  const lifecycle = {
    hostCallbackDepth: 0,
    hostCallbackContext: new AsyncLocalStorage<boolean>()
  };
  const dumpController = createDumpController(lifecycle);
  const promiseTracker = createSandboxPromiseRejectionTracker();
  let completedSnapshot: RunSnapshot | undefined;
  const execute = async () => {
    const promiseReplay = new PromiseReplay(options.snapshot?.promiseReplay);
    return promiseReplayContext.run(promiseReplay, async () => {
      const deactivateOtelSink = activateOtelSink(options.otelSink);
      let leaveSnapshotRun: (() => void) | undefined;
      let leaveHostReplay: (() => void) | undefined;
      let leaveInputReplay: (() => void) | undefined;
      let createFailureSnapshot: (() => RunSnapshot) | undefined;
      let cancellationSnapshot: RunSnapshot | undefined;
      let cancellationSnapshotError: { reason: unknown } | undefined;
      let snapshotScheduler: SnapshotScheduler<RunSnapshot> | undefined;
      const captureCancellationSnapshot = () => {
        try {
          cancellationSnapshot = createFailureSnapshot?.();
        } catch (reason) {
          cancellationSnapshotError = { reason };
        }
      };
      options.signal?.addEventListener("abort", captureCancellationSnapshot, { once: true });
      try {
        const restoredSnapshot =
          options.snapshot === undefined ? undefined : restore(options.snapshot, { source });
        const executionSemantics =
          restoredSnapshot?.executionSemantics === "jobs-v6" ? "jobs-v6" : EXECUTION_SEMANTICS;
        const convertInitialInput = <TValue>(convert: () => TValue): TValue =>
          executionSemantics === "jobs-v6" ? convert() : promiseReplayContext.exit(convert);
        if (restoredSnapshot !== undefined) {
          leaveSnapshotRun = enterSnapshotRun(restoredSnapshot);
        }
        const budget = options.budget ?? new Budget({ maxCallDepth: DEFAULT_MAX_CALL_DEPTH });
        budget.reset();
        promiseReplay.attachBudget(budget);
        const filename = options.filename ?? "<input>";
        const module = parseExecutableModule(source, filename);
        promiseReplay.validateNodes(module);
        const sourceHash = hashSource(source);
        const hostCalls = new HostCallJournal(
          sourceHash,
          readHostCallSnapshot(restoredSnapshot),
          options.hostCallResumeProvider,
          restoredSnapshot?.replay,
          budget
        );
        leaveHostReplay = hostCalls.dispose.bind(hostCalls);
        promiseReplay.validateCallbacks(hostCalls.callbackPositions());
        const generator =
          options.random ??
          createReplayableRandom({ seed: options.randomSeed, snapshot: restoredSnapshot });
        const random = { seed: generator.seed, initialState: generator.snapshot(), generator };
        const interpreterSnapshot =
          restoredSnapshot?.replay === undefined && hasLoopIterationSnapshot(restoredSnapshot)
            ? {
                ...(restoredSnapshot as RunSnapshot),
                resumeNodeId: (restoredSnapshot as RunSnapshot).pendingAwaits?.[0]?.nodeId
              }
            : undefined;
        const callerBindings = convertInitialInput(() =>
          options.bindings === undefined
            ? {}
            : wrapCallerInjectedBindings(options.bindings, {
                budget,
                hostCalls,
                moduleId: "<bindings>",
                signal: options.signal,
                lifecycle
              })
        );
        const builtinBindings = {
          ...createConsoleJsonGlobals({
            budget,
            hostCalls,
            sink: options.sink
          }),
          ...createCollectionGlobals({ budget }),
          Float32Array: createFloat32ArrayGlobal(budget),
          ...createErrorGlobals({
            budget
          }),
          ...createMathGlobals({
            random: random?.generator.next
          }),
          ...createObjectArrayGlobals({
            budget
          }),
          ...createMiscGlobals({
            budget
          }),
          ...createPromiseGlobals({
            budget
          }),
          ...createRegexGlobals()
        };
        const importMeta = convertInitialInput(
          () => deepCopyToSandbox(options.importMeta ?? {}) as Record<string, SandboxValue>
        );
        if (restoredSnapshot?.migration !== undefined) {
          if (Object.hasOwn(importMeta, "migration"))
            throw new TypeError("import.meta.migration is reserved for migrated checkpoint state.");
          Object.defineProperty(importMeta, "migration", {
            value: decodeReplayData(restoredSnapshot.migration.state),
            enumerable: true,
            configurable: true,
            writable: true
          });
        }
        const initialInputs = prepareReplayInputs(
          {
            bindings: callerBindings,
            imports: convertInitialInput(() =>
              resolveModuleImports(module, options.modules, {
                budget,
                hostCalls,
                signal: options.signal,
                allowMissing: restoredSnapshot?.initialInputs !== undefined
              })
            ),
            entryPointArgs: convertInitialInput(() =>
              options.entryPointArgs === undefined
                ? undefined
                : (deepCopyToSandbox([...options.entryPointArgs]) as SandboxValue[])
            ),
            importMeta
          },
          restoredSnapshot?.initialInputs,
          (promise, id) => {
            if (promise !== undefined) observeSandboxPromise(promise);
            const operation = declareHostOperation(() => {
              if (promise === undefined) throw new TypeError(`Missing initial promise '${id}'.`);
              return promise.promise;
            }, "read-side-effect");
            const binding = wrapCallerInjectedBindings(
              { [id]: operation },
              {
                budget,
                hostCalls,
                moduleId: "<inputs>",
                signal: options.signal,
                lifecycle
              }
            )[id]!;
            if (!isSandboxClosure(binding))
              throw new TypeError("Invalid initial promise operation.");
            return binding.call([]) as SandboxPromise;
          },
          hostCalls.rebindHostCapability.bind(hostCalls)
        );
        hostCalls.validateHostCapabilities();
        budget.setRetainedDataUsage(
          initialInputs,
          measureSandboxData(
            [
              ...Object.values(initialInputs.values.bindings),
              ...Object.values(initialInputs.values.imports),
              ...(initialInputs.values.entryPointArgs ?? []),
              initialInputs.values.importMeta
            ],
            { ignoreClosureCaptures: true }
          )
        );
        leaveInputReplay = () => budget.setRetainedDataUsage(initialInputs, 0);
        const entryPointArgs = initialInputs.values.entryPointArgs;
        const cancelableCallerBindings = wrapCancelableBindings(
          initialInputs.values.bindings,
          options.signal
        );

        const scope = new Scope(
          builtinBindings,
          undefined,
          undefined,
          { chargeData: false },
          interpreterSnapshot?.bindings as Record<string, SandboxValue> | undefined
        );
        const callerScope = scope.child(cancelableCallerBindings);
        const executionScope = new Scope(
          initialInputs.values.imports,
          callerScope,
          initialInputs.values.importMeta,
          { functionBoundary: true }
        );
        const activeSnapshotScheduler = createSnapshotScheduler<RunSnapshot>({
          snapshotBackend: options.snapshotBackend,
          snapshotIntervalMs: options.snapshotIntervalMs,
          snapshotPath: options.snapshotPath
        });
        snapshotScheduler = activeSnapshotScheduler;
        createFailureSnapshot = () =>
          createRunSnapshot({
            executionSemantics,
            migration: restoredSnapshot?.migration,
            bindings: executionScope.snapshot().bindings,
            clock: options.clock,
            hostCalls: hostCalls.snapshot(),
            replay: hostCalls.snapshotReplay(),
            initialInputs: initialInputs.snapshot,
            promiseReplay: promiseReplay.snapshot(),
            random,
            sourceHash
          });
        let snapshotIteration = 0;

        const topLevelResult = await interpret(createExecutableNode(module), {
          budget,
          captureReplayState: random.generator.snapshot,
          onYield: (yieldPoint) => {
            snapshotIteration += 1;
            safeAddEvent(yieldPoint.otelSpan ?? getActiveOtelSpan(), "snapshot.saved", {
              iteration: snapshotIteration
            });
            let snapshot: RunSnapshot | undefined;
            const createSnapshot = () => {
              if (snapshot !== undefined) {
                return snapshot;
              }
              const interpreterSnapshot = yieldPoint.snapshot();
              snapshot = createRunSnapshot({
                executionSemantics,
                migration: restoredSnapshot?.migration,
                bindings: interpreterSnapshot.bindings,
                clock: options.clock,
                hostCalls: hostCalls.snapshot(),
                loopIterations: interpreterSnapshot.loopIterations,
                pendingAwaits: [createPendingAwaitSnapshot(yieldPoint)],
                replay: hostCalls.snapshotReplay(),
                initialInputs: initialInputs.snapshot,
                promiseReplay: promiseReplay.snapshot(),
                random,
                randomResumeState:
                  typeof yieldPoint.replayState === "number" ? yieldPoint.replayState : undefined,
                sourceHash
              });
              return snapshot;
            };

            activeSnapshotScheduler.onYield(createSnapshot);
            dumpController.onYield(createSnapshot);
          },
          scope: executionScope,
          signal: options.signal,
          snapshot: interpreterSnapshot,
          surfaceUnhandledThrows: true,
          useScopeDirectly: true
        });
        const result =
          entryPointArgs === undefined || !topLevelResult.ok
            ? topLevelResult
            : await callEntryPoint({
                args: entryPointArgs,
                budget,
                captureReplayState: random.generator.snapshot,
                filename,
                module,
                onYield: (yieldPoint) => {
                  snapshotIteration += 1;
                  safeAddEvent(yieldPoint.otelSpan ?? getActiveOtelSpan(), "snapshot.saved", {
                    iteration: snapshotIteration
                  });
                  let snapshot: RunSnapshot | undefined;
                  const createSnapshot = () => {
                    if (snapshot !== undefined) {
                      return snapshot;
                    }
                    const interpreterSnapshot = yieldPoint.snapshot();
                    snapshot = createRunSnapshot({
                      executionSemantics,
                      migration: restoredSnapshot?.migration,
                      bindings: interpreterSnapshot.bindings,
                      clock: options.clock,
                      hostCalls: hostCalls.snapshot(),
                      loopIterations: interpreterSnapshot.loopIterations,
                      pendingAwaits: [createPendingAwaitSnapshot(yieldPoint)],
                      replay: hostCalls.snapshotReplay(),
                      initialInputs: initialInputs.snapshot,
                      promiseReplay: promiseReplay.snapshot(),
                      random,
                      randomResumeState:
                        typeof yieldPoint.replayState === "number"
                          ? yieldPoint.replayState
                          : undefined,
                      sourceHash
                    });
                    return snapshot;
                  };

                  activeSnapshotScheduler.onYield(createSnapshot);
                  dumpController.onYield(createSnapshot);
                },
                scope: executionScope,
                signal: options.signal,
                snapshot: interpreterSnapshot
              });
        await throwIfReturnedPromiseRejected(result);
        await throwIfUnhandledPromiseRejected(promiseTracker);
        await activeSnapshotScheduler.finish();

        let replay: HostCallReplay | undefined;
        let replayError: string | undefined;
        try {
          replay = hostCalls.snapshotReplay();
        } catch (error) {
          if (!(error instanceof MissingReplayCapabilityError)) throw error;
          replayError = error.message;
        }
        const snapshot = createRunSnapshot({
          executionSemantics,
          migration: restoredSnapshot?.migration,
          bindings: executionScope.snapshot().bindings,
          clock: options.clock,
          hostCalls: hostCalls.snapshot(),
          replay,
          initialInputs: initialInputs.snapshot,
          promiseReplay: promiseReplay.snapshot(),
          random,
          sourceHash
        });
        if (replayError !== undefined) snapshot.replayError = replayError;
        dumpController.finalize(snapshot);
        completedSnapshot = snapshot;

        return {
          ...result,
          snapshot
        };
      } catch (error) {
        promiseReplay.fail(error);
        materializeWrappedErrorCause(error);
        if (createFailureSnapshot !== undefined && snapshotScheduler !== undefined) {
          try {
            if (cancellationSnapshotError !== undefined) throw cancellationSnapshotError.reason;
            const snapshot = cancellationSnapshot ?? createFailureSnapshot();
            dumpController.finalize(snapshot);
            await snapshotScheduler.write(snapshot);
          } catch (snapshotError) {
            if (snapshotError instanceof UnsnapshotableValueError) {
              console.warn(`Skipping failure snapshot: ${snapshotError.message}`);
            } else {
              console.warn("Failed to write failure snapshot.", snapshotError);
            }
          }
        }
        dumpController.fail(error);
        throw error;
      } finally {
        lifecycle.hostCallbackContext.disable();
        options.signal?.removeEventListener("abort", captureCancellationSnapshot);
        leaveInputReplay?.();
        leaveHostReplay?.();
        promiseReplay.dispose();
        leaveSnapshotRun?.();
        deactivateOtelSink();
      }
    });
  };
  const result = withRunResources(options.signal, () =>
    withSandboxPromiseRejectionTracker(promiseTracker, execute)
  ).catch(async (error: unknown) => {
    if (completedSnapshot !== undefined) {
      try {
        await createSnapshotScheduler<RunSnapshot>(options).write(completedSnapshot);
      } catch (snapshotError) {
        console.warn("Failed to write failure snapshot.", snapshotError);
      }
    }
    dumpController.fail(error);
    throw error;
  });

  return attachDumpController(result, dumpController);
}

async function throwIfReturnedPromiseRejected(result: InterpreterResult): Promise<void> {
  if (!result.ok || !isSandboxPromise(result.returnValue)) {
    return;
  }

  observeSandboxPromise(result.returnValue);

  let rejected = false;
  let rejectionReason: unknown;
  result.returnValue.promise.then(
    () => undefined,
    (reason) => {
      rejected = true;
      rejectionReason = reason;
    }
  );

  await Promise.resolve();
  await Promise.resolve();

  if (rejected) {
    consumeSettledHostCall(result.returnValue);
    throw new UnhandledRejectionError(rejectionReason, result.returnValue.span);
  }
}

async function throwIfUnhandledPromiseRejected(
  tracker: SandboxPromiseRejectionTracker
): Promise<void> {
  const unhandled = await tracker.findUnhandledRejection();
  if (unhandled !== undefined) {
    throw new UnhandledRejectionError(unhandled.reason, unhandled.span);
  }
}

async function callEntryPoint(input: {
  args: readonly SandboxValue[];
  budget: Budget;
  captureReplayState: () => number;
  filename: string;
  module: Module;
  onYield: NonNullable<Parameters<typeof interpret>[1]>["onYield"];
  scope: Scope;
  signal?: AbortSignal;
  snapshot?: RunSnapshot;
}): Promise<InterpreterResult> {
  const defaultExport = input.scope.lookup("default");

  if (!defaultExport.found) {
    throw new Error(`Script ${input.filename} does not export a default function.`);
  }

  if (!isSandboxClosure(defaultExport.value)) {
    throw new TypeError(`Default export in ${input.filename} must be callable.`);
  }

  const argumentBindings = Object.fromEntries(
    input.args.map((value, index) => [createEntryPointArgName(index), value])
  ) as Record<string, SandboxValue>;
  const entryScope = input.scope.child({
    __agentScriptEntryPoint: defaultExport.value,
    ...argumentBindings
  });

  return interpret(createEntryPointAwait(input.args.length, input.module.span), {
    signal: input.signal,
    budget: input.budget,
    captureReplayState: input.captureReplayState,
    onYield: input.onYield,
    scope: entryScope,
    snapshot: input.snapshot,
    surfaceUnhandledThrows: true,
    useScopeDirectly: true
  });
}

function createEntryPointAwait(argCount: number, span: SourceSpan): AwaitExpression {
  return {
    type: "AwaitExpression",
    argument: createEntryPointCall(argCount, span),
    span
  };
}

function createEntryPointCall(argCount: number, span: SourceSpan): CallExpression {
  return {
    type: "CallExpression",
    callee: createIdentifier("__agentScriptEntryPoint", span),
    arguments: Array.from({ length: argCount }, (_value, index) =>
      createIdentifier(createEntryPointArgName(index), span)
    ),
    optional: false,
    span
  };
}

function createIdentifier(name: string, span: SourceSpan): Identifier {
  return {
    type: "Identifier",
    name,
    span
  };
}

function createEntryPointArgName(index: number): string {
  return `__agentScriptEntryPointArg${index}`;
}

function createExecutableNode(module: Module): ParseResult {
  const executableStatements = module.body.filter(
    (statement): statement is Exclude<Statement, { type: "ImportDeclaration" }> =>
      statement.type !== "ImportDeclaration"
  );

  if (executableStatements.length === 0) {
    return {
      type: "BlockStatement",
      body: [],
      span: module.span
    };
  }

  if (executableStatements.length === 1) {
    const [statement] = executableStatements;
    return statement.type === "ExpressionStatement" ? statement.expression : statement;
  }

  return {
    type: "BlockStatement",
    body: executableStatements,
    span: module.span
  };
}

function createRunSnapshot(input: {
  executionSemantics: "jobs-v6" | typeof EXECUTION_SEMANTICS;
  migration?: SafeJSSnapshot["migration"];
  bindings: InterpreterResult["snapshot"]["bindings"];
  clock: RunClock | undefined;
  hostCalls?: HostCallRecord[];
  replay?: HostCallReplay;
  promiseReplay?: PromiseReplaySnapshot;
  initialInputs?: ReplayData;
  loopIterations?: Record<string, LoopIterationSnapshot>;
  pendingAwaits?: RunPendingAwaitSnapshot[];
  randomResumeState?: number;
  random:
    | {
        seed: number;
        initialState: number;
        generator: RunRandom;
      }
    | undefined;
  sourceHash: string;
}): RunSnapshot {
  return {
    version: DUMP_FORMAT_VERSION,
    executionSemantics: input.executionSemantics,
    sourceHash: input.sourceHash,
    ...(input.migration === undefined ? {} : { migration: structuredClone(input.migration) }),
    bindings: input.bindings,
    clock: input.clock?.snapshot(),
    ...(input.hostCalls === undefined || input.hostCalls.length === 0
      ? {}
      : { hostCalls: input.hostCalls }),
    ...(input.loopIterations === undefined ? {} : { loopIterations: input.loopIterations }),
    ...(input.replay === undefined ? {} : { replay: input.replay }),
    ...(input.initialInputs === undefined ? {} : { initialInputs: input.initialInputs }),
    ...(input.promiseReplay === undefined ? {} : { promiseReplay: input.promiseReplay }),
    ...(input.pendingAwaits === undefined || input.pendingAwaits.length === 0
      ? {}
      : { pendingAwaits: input.pendingAwaits }),
    random:
      input.random === undefined
        ? undefined
        : {
            seed: input.random.seed,
            initialState: input.random.initialState,
            ...(input.randomResumeState === undefined
              ? {}
              : { resumeState: input.randomResumeState }),
            state: input.random.generator.snapshot()
          }
  };
}

function readHostCallSnapshot(snapshot: SafeJSSnapshot | undefined): HostCallRecord[] {
  if (snapshot === undefined || !Array.isArray(snapshot.hostCalls)) {
    return [];
  }

  return snapshot.hostCalls.map((value, index) => {
    if (typeof value !== "object" || value === null) {
      throw new TypeError(`Snapshot hostCalls[${index}] must be an object.`);
    }

    const record = value as Partial<HostCallRecord>;
    const requiredStrings = [
      "id",
      "runId",
      "sourceHash",
      "moduleId",
      "operation",
      "argumentDigest"
    ] as const;
    for (const key of requiredStrings) {
      if (typeof record[key] !== "string" || record[key].length === 0) {
        throw new TypeError(`Snapshot hostCalls[${index}].${key} must be a non-empty string.`);
      }
    }
    if (record.sourceHash !== snapshot.sourceHash) {
      throw new TypeError(`Snapshot hostCalls[${index}].sourceHash must match the snapshot.`);
    }
    if (record.policy !== "re-issue" && record.policy !== "read-side-effect") {
      throw new TypeError(`Snapshot hostCalls[${index}].policy is invalid.`);
    }
    if (
      record.lifecycle !== "created" &&
      record.lifecycle !== "running" &&
      record.lifecycle !== "settled" &&
      record.lifecycle !== "consumed" &&
      record.lifecycle !== "cancelled"
    ) {
      throw new TypeError(`Snapshot hostCalls[${index}].lifecycle is invalid.`);
    }
    if (
      (record.lifecycle === "settled" || record.lifecycle === "cancelled") &&
      record.outcome === undefined
    ) {
      throw new TypeError(`Snapshot hostCalls[${index}].outcome is required.`);
    }

    return record as HostCallRecord;
  });
}

function hasLoopIterationSnapshot(snapshot: SafeJSSnapshot | undefined): snapshot is RunSnapshot {
  return (
    snapshot !== undefined &&
    typeof snapshot.loopIterations === "object" &&
    snapshot.loopIterations !== null &&
    Object.keys(snapshot.loopIterations).length > 0
  );
}

function createPendingAwaitSnapshot(yieldPoint: ResumeBreakpoint): RunPendingAwaitSnapshot {
  return {
    ...(yieldPoint.nodeId === undefined ? {} : { nodeId: yieldPoint.nodeId }),
    span: yieldPoint.span
  };
}

type ResumeBreakpoint = Parameters<
  NonNullable<NonNullable<Parameters<typeof interpret>[1]>["onYield"]>
>[0];
