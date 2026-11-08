import { hashSource } from "./parse/hash.js";
import { createReplayableRandom } from "./random.js";
import { attachErrorSpan, describeThrownValue, materializeWrappedErrorCause, replaceErrorStack } from "./error/shape.js";
import { parseExecutableModule } from "./parse/parser.js";
import { restore } from "./restore.js";
import { Budget } from "./interp/budget.js";
import { PromiseReplay, promiseReplayContext } from "./interp/promise-replay.js";
import { wrapCancelableBindings } from "./interp/cancel.js";
import { enterSnapshotRun } from "./interp/running-state.js";
import { createSandboxPromiseRejectionTracker, observeSandboxPromise, withSandboxPromiseRejectionTracker } from "./interp/promise-tracker.js";
import { HostCallJournal } from "./interp/host-call.js";
import { createConsoleJsonGlobals } from "./interp/globals/console-json.js";
import { createCollectionGlobals } from "./interp/globals/collections.js";
import { createErrorGlobals } from "./interp/globals/error.js";
import { createMathGlobals } from "./interp/globals/math.js";
import { createRegexGlobals } from "./interp/globals/regex.js";
import { createMiscGlobals } from "./interp/globals/misc.js";
import { createObjectArrayGlobals } from "./interp/globals/object-array.js";
import { declareHostOperation, wrapCallerInjectedBindings } from "./interp/host-bridge.js";
import { interpret, Scope } from "./interp/interpreter.js";
import { consumeSettledHostCall, createPromiseGlobals } from "./interp/promise.js";
import { deepCopyToSandbox, isSandboxClosure, isSandboxPromise, measureSandboxData } from "./interp/values.js";
import { resolveModuleImports } from "./modules/registry.js";
import { activateOtelSink, getActiveOtelSpan, safeAddEvent } from "./observability/otel.js";
import { attachDumpController, createDumpController } from "./snapshot/dump.js";
import { DUMP_FORMAT_VERSION, EXECUTION_SEMANTICS } from "./snapshot/dump-format.js";
import { createSnapshotScheduler } from "./snapshot/scheduler.js";
import { UnsnapshotableValueError } from "./snapshot/serialize.js";
import { prepareReplayInputs } from "./snapshot/replay-inputs.js";
import { MissingReplayCapabilityError } from "./snapshot/replay-data.js";
export class UnhandledRejectionError extends Error {
    reason;
    constructor(reason, span) {
        super(`Unhandled rejection: ${describeThrownValue(reason)}`);
        this.name = "UnhandledRejectionError";
        this.reason = reason;
        attachErrorSpan(this, span);
        replaceErrorStack(this);
    }
}
const DEFAULT_MAX_CALL_DEPTH = 1_000;
export function run(source, options = {}) {
    const lifecycle = { hostCallbackDepth: 0 };
    const dumpController = createDumpController(lifecycle);
    const promiseTracker = createSandboxPromiseRejectionTracker();
    const result = withSandboxPromiseRejectionTracker(promiseTracker, async () => {
        const promiseReplay = new PromiseReplay(options.snapshot?.promiseReplay);
        return promiseReplayContext.run(promiseReplay, async () => {
            const deactivateOtelSink = activateOtelSink(options.otelSink);
            let leaveSnapshotRun;
            let leaveHostReplay;
            let leaveInputReplay;
            let createFailureSnapshot;
            let lastCheckpoint;
            let snapshotScheduler;
            try {
                const restoredSnapshot = options.snapshot === undefined ? undefined : restore(options.snapshot, { source });
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
                const hostCalls = new HostCallJournal(sourceHash, readHostCallSnapshot(restoredSnapshot), options.hostCallResumeProvider, restoredSnapshot?.replay, budget);
                leaveHostReplay = hostCalls.dispose.bind(hostCalls);
                promiseReplay.validateCallbacks(hostCalls.callbackPositions());
                const generator = options.random ??
                    createReplayableRandom({ seed: options.randomSeed, snapshot: restoredSnapshot });
                const random = { seed: generator.seed, initialState: generator.snapshot(), generator };
                const interpreterSnapshot = restoredSnapshot?.replay === undefined && hasLoopIterationSnapshot(restoredSnapshot)
                    ? {
                        ...restoredSnapshot,
                        resumeNodeId: restoredSnapshot.pendingAwaits?.[0]?.nodeId
                    }
                    : undefined;
                const callerBindings = options.bindings === undefined
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
                        hostCalls,
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
                const initialInputs = prepareReplayInputs({
                    bindings: callerBindings,
                    imports: resolveModuleImports(module, options.modules, {
                        budget,
                        hostCalls,
                        signal: options.signal,
                        allowMissing: restoredSnapshot?.initialInputs !== undefined
                    }),
                    entryPointArgs: options.entryPointArgs === undefined
                        ? undefined
                        : deepCopyToSandbox([...options.entryPointArgs]),
                    importMeta: deepCopyToSandbox(options.importMeta ?? {})
                }, restoredSnapshot?.initialInputs, (promise, id) => {
                    if (promise !== undefined)
                        observeSandboxPromise(promise);
                    const operation = declareHostOperation(() => {
                        if (promise === undefined)
                            throw new TypeError(`Missing initial promise '${id}'.`);
                        return promise.promise;
                    }, "read-side-effect");
                    const binding = wrapCallerInjectedBindings({ [id]: operation }, {
                        budget,
                        hostCalls,
                        moduleId: "<inputs>",
                        signal: options.signal,
                        lifecycle
                    })[id];
                    if (!isSandboxClosure(binding))
                        throw new TypeError("Invalid initial promise operation.");
                    return binding.call([]);
                });
                budget.setRetainedDataUsage(initialInputs, measureSandboxData([
                    ...Object.values(initialInputs.values.bindings),
                    ...Object.values(initialInputs.values.imports),
                    ...(initialInputs.values.entryPointArgs ?? []),
                    initialInputs.values.importMeta
                ], { ignoreClosureCaptures: true }));
                leaveInputReplay = () => budget.setRetainedDataUsage(initialInputs, 0);
                const entryPointArgs = initialInputs.values.entryPointArgs;
                const cancelableCallerBindings = wrapCancelableBindings(initialInputs.values.bindings, options.signal);
                const scope = new Scope(builtinBindings, undefined, undefined, { chargeData: false }, interpreterSnapshot?.bindings);
                const callerScope = scope.child(cancelableCallerBindings);
                const executionScope = new Scope(initialInputs.values.imports, callerScope, initialInputs.values.importMeta, { functionBoundary: true });
                const activeSnapshotScheduler = createSnapshotScheduler({
                    snapshotBackend: options.snapshotBackend,
                    snapshotIntervalMs: options.snapshotIntervalMs,
                    snapshotPath: options.snapshotPath
                });
                snapshotScheduler = activeSnapshotScheduler;
                createFailureSnapshot = () => createRunSnapshot({
                    bindings: executionScope.snapshot().bindings,
                    clock: options.clock,
                    hostCalls: hostCalls.snapshot(),
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
                        let snapshot;
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
                                replay: hostCalls.snapshotReplay(),
                                initialInputs: initialInputs.snapshot,
                                promiseReplay: promiseReplay.snapshot(),
                                random,
                                randomResumeState: typeof yieldPoint.replayState === "number" ? yieldPoint.replayState : undefined,
                                sourceHash
                            });
                            lastCheckpoint = snapshot;
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
                const result = entryPointArgs === undefined || !topLevelResult.ok
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
                            let snapshot;
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
                                    replay: hostCalls.snapshotReplay(),
                                    initialInputs: initialInputs.snapshot,
                                    promiseReplay: promiseReplay.snapshot(),
                                    random,
                                    randomResumeState: typeof yieldPoint.replayState === "number"
                                        ? yieldPoint.replayState
                                        : undefined,
                                    sourceHash
                                });
                                lastCheckpoint = snapshot;
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
                let replay;
                let replayError;
                try {
                    replay = hostCalls.snapshotReplay();
                }
                catch (error) {
                    if (!(error instanceof MissingReplayCapabilityError))
                        throw error;
                    replayError = error.message;
                }
                const snapshot = createRunSnapshot({
                    bindings: executionScope.snapshot().bindings,
                    clock: options.clock,
                    hostCalls: hostCalls.snapshot(),
                    replay,
                    initialInputs: initialInputs.snapshot,
                    promiseReplay: promiseReplay.snapshot(),
                    random,
                    sourceHash
                });
                if (replayError !== undefined)
                    snapshot.replayError = replayError;
                dumpController.finalize(snapshot);
                return {
                    ...result,
                    snapshot
                };
            }
            catch (error) {
                promiseReplay.fail(error);
                materializeWrappedErrorCause(error);
                if (createFailureSnapshot !== undefined && snapshotScheduler !== undefined) {
                    try {
                        const snapshot = lastCheckpoint ?? createFailureSnapshot();
                        await snapshotScheduler.write(snapshot);
                        dumpController.finalize(snapshot);
                    }
                    catch (snapshotError) {
                        if (snapshotError instanceof UnsnapshotableValueError) {
                            console.warn(`Skipping failure snapshot: ${snapshotError.message}`);
                        }
                        else {
                            console.warn("Failed to write failure snapshot.", snapshotError);
                        }
                    }
                }
                dumpController.fail(error);
                throw error;
            }
            finally {
                leaveInputReplay?.();
                leaveHostReplay?.();
                promiseReplay.dispose();
                leaveSnapshotRun?.();
                deactivateOtelSink();
            }
        });
    });
    return attachDumpController(result, dumpController);
}
async function throwIfReturnedPromiseRejected(result) {
    if (!result.ok || !isSandboxPromise(result.returnValue)) {
        return;
    }
    observeSandboxPromise(result.returnValue);
    let rejected = false;
    let rejectionReason;
    result.returnValue.promise.then(() => undefined, (reason) => {
        rejected = true;
        rejectionReason = reason;
    });
    await Promise.resolve();
    await Promise.resolve();
    if (rejected) {
        consumeSettledHostCall(result.returnValue);
        throw new UnhandledRejectionError(rejectionReason, result.returnValue.span);
    }
}
async function throwIfUnhandledPromiseRejected(tracker) {
    const unhandled = await tracker.findUnhandledRejection();
    if (unhandled !== undefined) {
        throw new UnhandledRejectionError(unhandled.reason, unhandled.span);
    }
}
async function callEntryPoint(input) {
    const defaultExport = input.scope.lookup("default");
    if (!defaultExport.found) {
        throw new Error(`Script ${input.filename} does not export a default function.`);
    }
    if (!isSandboxClosure(defaultExport.value)) {
        throw new TypeError(`Default export in ${input.filename} must be callable.`);
    }
    const argumentBindings = Object.fromEntries(input.args.map((value, index) => [createEntryPointArgName(index), value]));
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
function createEntryPointAwait(argCount, span) {
    return {
        type: "AwaitExpression",
        argument: createEntryPointCall(argCount, span),
        span
    };
}
function createEntryPointCall(argCount, span) {
    return {
        type: "CallExpression",
        callee: createIdentifier("__agentScriptEntryPoint", span),
        arguments: Array.from({ length: argCount }, (_value, index) => createIdentifier(createEntryPointArgName(index), span)),
        optional: false,
        span
    };
}
function createIdentifier(name, span) {
    return {
        type: "Identifier",
        name,
        span
    };
}
function createEntryPointArgName(index) {
    return `__agentScriptEntryPointArg${index}`;
}
function createExecutableNode(module) {
    const executableStatements = module.body.filter((statement) => statement.type !== "ImportDeclaration");
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
function createRunSnapshot(input) {
    return {
        version: DUMP_FORMAT_VERSION,
        executionSemantics: EXECUTION_SEMANTICS,
        sourceHash: input.sourceHash,
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
        random: input.random === undefined
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
function readHostCallSnapshot(snapshot) {
    if (snapshot === undefined || !Array.isArray(snapshot.hostCalls)) {
        return [];
    }
    return snapshot.hostCalls.map((value, index) => {
        if (typeof value !== "object" || value === null) {
            throw new TypeError(`Snapshot hostCalls[${index}] must be an object.`);
        }
        const record = value;
        const requiredStrings = [
            "id",
            "runId",
            "sourceHash",
            "moduleId",
            "operation",
            "argumentDigest"
        ];
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
        if (record.lifecycle !== "created" &&
            record.lifecycle !== "running" &&
            record.lifecycle !== "settled" &&
            record.lifecycle !== "consumed" &&
            record.lifecycle !== "cancelled") {
            throw new TypeError(`Snapshot hostCalls[${index}].lifecycle is invalid.`);
        }
        if ((record.lifecycle === "settled" || record.lifecycle === "cancelled") &&
            record.outcome === undefined) {
            throw new TypeError(`Snapshot hostCalls[${index}].outcome is required.`);
        }
        return record;
    });
}
function hasLoopIterationSnapshot(snapshot) {
    return (snapshot !== undefined &&
        typeof snapshot.loopIterations === "object" &&
        snapshot.loopIterations !== null &&
        Object.keys(snapshot.loopIterations).length > 0);
}
function createPendingAwaitSnapshot(yieldPoint) {
    return {
        ...(yieldPoint.nodeId === undefined ? {} : { nodeId: yieldPoint.nodeId }),
        span: yieldPoint.span
    };
}
