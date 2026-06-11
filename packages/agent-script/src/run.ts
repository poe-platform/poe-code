import { hashSource } from "./parse/hash.js";
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
import { restore, type AgentScriptSnapshot } from "./restore.js";
import { Budget } from "./interp/budget.js";
import { wrapCancelableBindings } from "./interp/cancel.js";
import { enterSnapshotRun } from "./interp/running-state.js";
import {
  HostCallJournal,
  type HostCallRecord,
  type HostCallResumeProvider
} from "./interp/host-call.js";
import { createConsoleJsonGlobals, type ConsoleSink } from "./interp/globals/console-json.js";
import { createCollectionGlobals } from "./interp/globals/collections.js";
import { createErrorGlobals } from "./interp/globals/error.js";
import { createMathGlobals, createSeededRandom } from "./interp/globals/math.js";
import { createRegexGlobals } from "./interp/globals/regex.js";
import { createMiscGlobals } from "./interp/globals/misc.js";
import { createObjectArrayGlobals } from "./interp/globals/object-array.js";
import { wrapCallerInjectedBindings, type CallerInjectedBinding } from "./interp/host-bridge.js";
import {
  interpret,
  Scope,
  type InterpreterResult,
  type LoopIterationSnapshot
} from "./interp/interpreter.js";
import { createPromiseGlobals } from "./interp/promise.js";
import {
  deepCopyToSandbox,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxValue
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
import { DUMP_FORMAT_VERSION } from "./snapshot/dump-format.js";
import { createSnapshotScheduler, type SnapshotScheduler } from "./snapshot/scheduler.js";
import { UnsnapshotableValueError } from "./snapshot/serialize.js";

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
  snapshot?: AgentScriptSnapshot;
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

export type RunSnapshot = AgentScriptSnapshot & {
  bindings: InterpreterResult["snapshot"]["bindings"];
  clock?: RunClockSnapshot;
  hostCalls?: HostCallRecord[];
  loopIterations?: Record<string, LoopIterationSnapshot>;
  pendingAwaits?: RunPendingAwaitSnapshot[];
  random?: {
    seed: number;
    state: number;
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

export function run(source: string, options: RunOptions = {}): Promise<RunResult> {
  const lifecycle = { hostCallbackDepth: 0 };
  const dumpController = createDumpController(lifecycle);
  const result = (async () => {
    const deactivateOtelSink = activateOtelSink(options.otelSink);
    let leaveSnapshotRun: (() => void) | undefined;
    let createFailureSnapshot: (() => RunSnapshot) | undefined;
    let snapshotScheduler: SnapshotScheduler<RunSnapshot> | undefined;
    try {
      const restoredSnapshot =
        options.snapshot === undefined ? undefined : restore(options.snapshot, { source });
      if (restoredSnapshot !== undefined) {
        leaveSnapshotRun = enterSnapshotRun(restoredSnapshot);
      }
      const budget = options.budget ?? new Budget();
      budget.reset();
      const filename = options.filename ?? "<input>";
      const module = parseExecutableModule(source, filename);
      const sourceHash = hashSource(source);
      const hostCalls = new HostCallJournal(
        sourceHash,
        readHostCallSnapshot(restoredSnapshot),
        options.hostCallResumeProvider
      );
      const random = createRandomState(restoredSnapshot, options.randomSeed, options.random);
      const interpreterSnapshot = hasLoopIterationSnapshot(restoredSnapshot)
        ? (restoredSnapshot as RunSnapshot)
        : undefined;
      const entryPointArgs = options.entryPointArgs?.map((value) => deepCopyToSandbox(value));
      const callerBindings =
        options.bindings === undefined
          ? {}
          : wrapCallerInjectedBindings(options.bindings, {
              budget,
              hostCalls,
              moduleId: "<bindings>",
              signal: options.signal,
              lifecycle
            });
      const builtinBindings = {
        ...createConsoleJsonGlobals({
          budget,
          sink: options.sink
        }),
        ...createCollectionGlobals({ budget }),
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
      const bindings = wrapCancelableBindings(builtinBindings, options.signal);
      const cancelableCallerBindings = wrapCancelableBindings(callerBindings, options.signal);

      const scope = new Scope(
        bindings,
        undefined,
        undefined,
        { chargeData: false },
        interpreterSnapshot?.bindings as Record<string, SandboxValue> | undefined
      );
      const callerScope = scope.child(cancelableCallerBindings);
      const executionScope = new Scope(
        resolveModuleImports(module, options.modules, {
          budget,
          hostCalls,
          signal: options.signal
        }),
        callerScope,
        deepCopyToSandbox(options.importMeta ?? {}),
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
          bindings: executionScope.snapshot().bindings,
          clock: options.clock,
          hostCalls: hostCalls.snapshot(),
          random,
          sourceHash
        });
      let snapshotIteration = 0;

      const topLevelResult = await interpret(createExecutableNode(module), {
        budget,
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
              bindings: interpreterSnapshot.bindings,
              clock: options.clock,
              hostCalls: hostCalls.snapshot(),
              loopIterations: interpreterSnapshot.loopIterations,
              pendingAwaits: [createPendingAwaitSnapshot(yieldPoint)],
              random,
              sourceHash
            });
            return snapshot;
          };

          activeSnapshotScheduler.onYield(createSnapshot);
          dumpController.onYield(createSnapshot);
        },
        scope: executionScope,
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
                    bindings: interpreterSnapshot.bindings,
                    clock: options.clock,
                    hostCalls: hostCalls.snapshot(),
                    loopIterations: interpreterSnapshot.loopIterations,
                    pendingAwaits: [createPendingAwaitSnapshot(yieldPoint)],
                    random,
                    sourceHash
                  });
                  return snapshot;
                };

                activeSnapshotScheduler.onYield(createSnapshot);
                dumpController.onYield(createSnapshot);
              },
              scope: executionScope,
              snapshot: interpreterSnapshot
            });
      await activeSnapshotScheduler.finish();

      const snapshot = createRunSnapshot({
        bindings: executionScope.snapshot().bindings,
        clock: options.clock,
        hostCalls: hostCalls.snapshot(),
        random,
        sourceHash
      });
      dumpController.finalize(snapshot);
      await throwIfReturnedPromiseRejected(result);

      return {
        ...result,
        snapshot
      };
    } catch (error) {
      materializeWrappedErrorCause(error);
      if (createFailureSnapshot !== undefined && snapshotScheduler !== undefined) {
        try {
          const snapshot = createFailureSnapshot();
          await snapshotScheduler.write(snapshot);
          dumpController.finalize(snapshot);
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
      leaveSnapshotRun?.();
      deactivateOtelSink();
    }
  })();

  return attachDumpController(result, dumpController);
}

async function throwIfReturnedPromiseRejected(result: InterpreterResult): Promise<void> {
  if (!result.ok || !isSandboxPromise(result.returnValue)) {
    return;
  }

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
    if (result.returnValue.hostCall !== undefined) {
      result.returnValue.hostCallJournal?.consume(result.returnValue.hostCall);
    }
    throw new UnhandledRejectionError(rejectionReason, result.returnValue.span);
  }
}

async function callEntryPoint(input: {
  args: readonly SandboxValue[];
  budget: Budget;
  filename: string;
  module: Module;
  onYield: NonNullable<Parameters<typeof interpret>[1]>["onYield"];
  scope: Scope;
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
    budget: input.budget,
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

function createRandomState(
  snapshot: AgentScriptSnapshot | undefined,
  randomSeed: number | undefined,
  random: RunRandom | undefined
) {
  if (random !== undefined) {
    return {
      seed: random.seed,
      generator: random
    };
  }

  if (snapshot?.random !== undefined) {
    return {
      seed: snapshot.random.seed,
      generator: createSeededRandom(snapshot.random.state)
    };
  }

  if (randomSeed === undefined) {
    return undefined;
  }

  return {
    seed: Math.trunc(randomSeed),
    generator: createSeededRandom(randomSeed)
  };
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
  bindings: InterpreterResult["snapshot"]["bindings"];
  clock: RunClock | undefined;
  hostCalls?: HostCallRecord[];
  loopIterations?: Record<string, LoopIterationSnapshot>;
  pendingAwaits?: RunPendingAwaitSnapshot[];
  random:
    | {
        seed: number;
        generator: ReturnType<typeof createSeededRandom>;
      }
    | undefined;
  sourceHash: string;
}): RunSnapshot {
  return {
    version: DUMP_FORMAT_VERSION,
    sourceHash: input.sourceHash,
    bindings: input.bindings,
    clock: input.clock?.snapshot(),
    ...(input.hostCalls === undefined || input.hostCalls.length === 0
      ? {}
      : { hostCalls: input.hostCalls }),
    ...(input.loopIterations === undefined ? {} : { loopIterations: input.loopIterations }),
    ...(input.pendingAwaits === undefined || input.pendingAwaits.length === 0
      ? {}
      : { pendingAwaits: input.pendingAwaits }),
    random:
      input.random === undefined
        ? undefined
        : {
            seed: input.random.seed,
            state: input.random.generator.snapshot()
          }
  };
}

function readHostCallSnapshot(snapshot: AgentScriptSnapshot | undefined): HostCallRecord[] {
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

function hasLoopIterationSnapshot(
  snapshot: AgentScriptSnapshot | undefined
): snapshot is RunSnapshot {
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
