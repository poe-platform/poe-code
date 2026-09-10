import { createHash, randomUUID } from "node:crypto";
import { activePromiseTracker, observeSandboxPromise } from "./promise-tracker.js";
import { promiseReplayContext } from "./promise-replay.js";
import { importedPromiseSnapshots } from "./promise-state.js";
import { activeCancellation } from "./cancel.js";
import { runResources } from "./resources.js";
import { typedArrayDataProperties, typedArrayStorage, typedArrayViewLayouts, isNumericTypedArray } from "./typed-array.js";
import { arrayBufferDataProperties, arrayBufferLength, arrayBufferOptions, isSandboxArrayBuffer } from "./array-buffer.js";
import { isSandboxSharedArrayBuffer, sharedArrayBufferStorage, snapshotSharedArrayBufferStorage } from "./shared-array-buffer.js";
import { restoreSharedHostValue } from "./shared-host-storage.js";
import { dataViewBuffer, dataViewDataProperties, dataViewLayout, isSandboxDataView } from "./data-view.js";
import { copyNativeDate, serializedDateTime } from "./date.js";
import {
  allocateProducedSandboxValue,
  cloneSandboxValue,
  createSandboxClosure,
  createSandboxPromise,
  defineOwnDataProperty,
  isArrayIndexKey,
  isSandboxPromise,
  measureSandboxData,
  type SandboxClosure,
  type SandboxPromise,
  type SandboxValue
} from "./values.js";
import type { Budget, CompileOwner, CompileTicket } from "./budget.js";
import { CompileScope } from "./regex/compile-guard.js";
import { createReplayEncodingContext, decodeReplayData, encodeReplayData, type ReplayData } from "../snapshot/replay-data.js";
import { validateSnapshotData } from "../snapshot/validation.js";
import {
  pendingHostCallResumeIdentityMatches,
  type PendingHostCallPolicyMode
} from "../snapshot/policy.js";

export type HostCallLifecycle = "created" | "running" | "settled" | "consumed" | "cancelled";
export type HostCallOutcome =
  | { status: "fulfilled"; value: SandboxValue }
  | { status: "rejected"; reason: SandboxValue };

type EncodedHostOutcome = {status:"fulfilled"|"rejected";data:ReplayData;sharedArguments?:Array<[number,number]>;sharedState?:true};
type HostCallbackRecord = { id: number; step: number; arguments: ReplayData; hasReceiver?: true; sharedState?: ReplayData; sharedOrder?: number };

export type HostCallRecord = {
  id: string;
  runId: string;
  sourceHash: string;
  moduleId: string;
  operation: string;
  argumentDigest: string;
  policy: PendingHostCallPolicyMode;
  lifecycle: HostCallLifecycle;
  outcome?: HostCallOutcome;
  asynchronous?: boolean;
  sharedPrefix?: ReplayData;
  sharedRegistry?: true;
  sharedPrefixOrder?: number;
  sharedEffectOrder?: number;
  callbacks?: HostCallbackRecord[];
  functions?: number[];
};

export type HostCallReplay = {
  version: 1 | 2;
  calls: Array<
    Omit<HostCallRecord, "outcome" | "asynchronous"> & {
      asynchronous: boolean;
      outcome?: EncodedHostOutcome;
    }
  >;
};

export type HostCallResumeProof = {
  callId: string;
  sourceHash: string;
  moduleId: string;
  operation: string;
  argumentDigest: string;
  outcome: HostCallOutcome;
  callbackDisposition?: "joined" | "detached";
};

export type HostCallResumeContext = {
  callbacks: ReadonlyMap<number, (...args: readonly unknown[]) => Promise<unknown>>;
  replayed: ReadonlyArray<{ callbackId: number; result: Promise<unknown> }>;
  waitForCallbacks: () => Promise<void>;
  toSandboxValue: (value: unknown) => SandboxValue;
};

export type HostCallResumeRequest = Omit<HostCallRecord, "id" | "outcome"> & {
  callId: string;
  requirement: "external-reconciliation";
};

export type HostCallResumeProvider = (
  request: HostCallResumeRequest,
  context?: HostCallResumeContext
) => HostCallResumeProof | Promise<HostCallResumeProof>;

type ReconciliationWait<T> = {
  current?: {
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
    cancel: () => void;
    pending: Set<() => void>;
  };
};

function observeReconciliation<T>(work: T | Promise<T>, wait: ReconciliationWait<T>): void {
  // Provider reactions must not retain the journal or settled waiter after disposal.
  runResources.exit(() => activeCancellation.exit(() => activePromiseTracker.exit(() => promiseReplayContext.exit(() => {
    void Promise.resolve(work).then(value => {
      const current = wait.current;
      if (current === undefined) return;
      wait.current = undefined;
      current.pending.delete(current.cancel);
      current.resolve(value);
    }, reason => {
      const current = wait.current;
      if (current === undefined) return;
      wait.current = undefined;
      current.pending.delete(current.cancel);
      current.reject(reason);
    });
  }))));
}

export class HostCallResumabilityError extends Error {
  readonly #nativeInstance = true;
  readonly action: "reset" | "external-reconciliation";
  readonly callId: string;
  readonly lifecycle: HostCallLifecycle;

  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      #nativeInstance in value &&
      Function.prototype[Symbol.hasInstance].call(this, value)
    );
  }

  constructor(
    record: HostCallRecord,
    action: "reset" | "external-reconciliation",
    message: string
  ) {
    super(message);
    this.name = "HostCallResumabilityError";
    this.action = action;
    this.callId = record.id;
    this.lifecycle = record.lifecycle;
  }
}

export class UnresolvedReplayCapabilityError extends TypeError {
  constructor(readonly id: string) {
    super(`Missing replay capability '${id}'.`);
    this.name = "UnresolvedReplayCapabilityError";
  }
}

export class HostCallJournal {
  private disposed = false;
  private readonly pendingReconciliations = new Set<() => void>();
  private readonly promiseReplay = promiseReplayContext.getStore();
  readonly runId: string;
  private nextCall = 1;
  private readonly records: HostCallRecord[];
  private readonly restored: HostCallRecord[];
  private readonly outcomes = new Map<string, HostCallOutcome>();
  private readonly sharedArguments = new Map<string, readonly SharedArrayBuffer[]>();
  private readonly exposedSharedStorage = new Map<object, SharedArrayBuffer>();
  private readonly sharedAppliedOrder = new Map<object, number>();
  private nextSharedOrder = 1;
  private readonly sharedOutcomeArguments = new Map<string, WeakMap<object, number>>();
  private readonly sharedEffects = new Map<string, readonly SharedArrayBuffer[]>();
  private readonly deferredSharedOutcomes = new Map<string, ()=>SandboxValue>();
  private readonly sharedPrefixSizes = new Map<string, number>();
  private readonly recordedReplay: boolean;
  private retainedSize = 0;
  private readonly outcomeSizes = new Map<string, number>();
  private readonly capabilities = new Map<string, SandboxClosure>();
  private readonly inputPromises = new Map<string, SandboxPromise>();
  private readonly inputPromiseIds = new WeakMap<SandboxPromise, string>();
  private readonly importedPromiseMemo = new Map<string, Map<number, SandboxPromise>>();
  private readonly proofImportedPromises = new WeakSet<SandboxPromise>();
  private readonly requiredHostCapabilities = new Set<string>();
  private readonly capabilityIds = new WeakMap<SandboxClosure, string>();
  readonly nativeClosures = new WeakMap<object, SandboxClosure>();
  private readonly hostSources = new WeakMap<SandboxClosure, object>();
  private readonly encodedOutcomes = new Map<
    string,
    EncodedHostOutcome
  >();
  private readonly callbackSizes = new Map<string, number>();
  private readonly completedCallbackOwners = new Set<string>();
  private readonly capabilityWaiters = new Map<
    string,
    {
      promise: Promise<void>;
      resolve: () => void;
      reject: (reason: unknown) => void;
    }
  >();
  readonly identifyCapability = this.capabilityIds.get.bind(this.capabilityIds);
  readonly identifyPromise = this.inputPromiseIds.get.bind(this.inputPromiseIds);
  readonly resolvePromise = (id: string): SandboxPromise => {
    const promise = this.inputPromises.get(id);
    if (promise === undefined) throw new UnresolvedReplayCapabilityError(id);
    return promise;
  };
  readonly resolveCapability = (id: string): SandboxClosure => {
    const capability = this.capabilities.get(id);
    if (capability === undefined) throw new UnresolvedReplayCapabilityError(id);
    return capability;
  };

  constructor(
    private readonly sourceHash: string,
    records: readonly HostCallRecord[] = [],
    private readonly resumeProvider?: HostCallResumeProvider,
    replay?: unknown,
    private budget?: Budget,
    private compileOwner?: CompileOwner
  ) {
    const operation = budget?.acquireCompileOwner(false, compileOwner);
    this.compileOwner = operation?.owner;
    const compilation = new CompileScope(operation?.owner);
    try {
      this.recordedReplay = replay !== undefined;
      if (replay !== undefined) {
        const reachableSchedulingIds = new Set<number>();
        const replayRecords = restoreReplayCalls(
          replay,
          this.encodedOutcomes,
          this.callbackSizes,
          this.requiredHostCapabilities,
          compilation,
          reachableSchedulingIds
        );
        const restoredRunId = replayRecords[0]?.runId ?? records[0]?.runId ?? randomUUID();
        validateRestoredRecords(records, restoredRunId, sourceHash);
        for (const record of records) {
          const replayRecord = replayRecords[readCallOrdinal(record) - 1];
          if (
            replayRecord === undefined ||
            !callIdentityMatches(record, replayRecord) ||
            record.lifecycle !== replayRecord.lifecycle
          ) {
            throw new HostCallResumabilityError(
              record,
              "reset",
              `Host call ${record.id} conflicts with the replay journal; reset is required.`
            );
          }
        }
        records = replayRecords;
        this.promiseReplay?.validateImportedPromises(reachableSchedulingIds);
        for (const outcome of this.encodedOutcomes.values()) {
          for (const node of outcome.data.nodes) {
            if ((node.kind === "settled-imported-promise" || node.kind === "pending-imported-promise") && node.scheduleId !== undefined) {
              if (!reachableSchedulingIds.has(node.scheduleId))
                throw new TypeError("Unreachable imported Promise scheduling identity.");
              this.promiseReplay?.reserveImportedPromise(node.scheduleId);
            }
          }
        }
      }
      this.runId = records[0]?.runId ?? randomUUID();
      this.records = records.map((record) => ({
        ...record,
        ...(record.functions === undefined ? {} : { functions: [...record.functions] }),
        ...(record.callbacks === undefined ? {} : { callbacks: structuredClone(record.callbacks) }),
        ...(record.sharedPrefix === undefined ? {} : { sharedPrefix: structuredClone(record.sharedPrefix) }),
        ...(record.outcome === undefined ? {} : { outcome: copyOutcome(record.outcome) })
      }));
      validateRestoredRecords(this.records, this.runId, sourceHash);
      for (const record of this.records) {
        this.nextSharedOrder = Math.max(this.nextSharedOrder, (record.sharedEffectOrder ?? 0) + 1, (record.sharedPrefixOrder ?? 0) + 1);
        for (const callback of record.callbacks ?? []) this.nextSharedOrder = Math.max(this.nextSharedOrder, (callback.sharedOrder ?? 0) + 1);
      }
      this.retainedSize = this.records.length;
      try {
        this.budget?.setRetainedDataUsage(this, this.retainedSize);
        for (const record of this.records) {
          if (record.sharedPrefix!==undefined) {
            if (record.asynchronous!==true) throw new TypeError("Shared invocation prefixes require async host calls.");
            const size=measureSandboxData([decodeSharedPrefix(record.sharedPrefix,compilation)]);
            this.sharedPrefixSizes.set(record.id,size);
            this.retainedSize+=size;
          }
          if (record.outcome !== undefined) this.retainOutcome(record, record.outcome);
          for (const [index, callback] of (record.callbacks ?? []).entries()) {
            let size = this.callbackSizes.get(`${record.id}/callback/${index + 1}`);
            if (size === undefined) {
              const validation = new CompileScope(operation?.owner);
              try {
                size = measureSandboxData([decodeReplayData(callback.arguments, {}, validation)]);
                if (callback.sharedState !== undefined)
                  size += measureSandboxData([decodeSharedCallback(callback.sharedState, this.resolveCapability, validation)]);
              } finally {
                validation.dispose();
              }
            }
            this.retainedSize += 1 + size;
          }
        }
        this.budget?.setRetainedDataUsage(this, this.retainedSize);
      } catch (error) {
        this.dispose();
        throw error;
      }
      this.restored = [...this.records];
      const capabilities = this.capabilities;
      const inputPromises = this.inputPromises;
      const importedPromises = this.importedPromiseMemo;
      const sharedStorage = this.exposedSharedStorage;
      this.budget?.setRetainedValues(this, function* () {
        yield* capabilities.values();
        yield* inputPromises.values();
        for (const entries of importedPromises.values()) yield* entries.values();
        yield* sharedStorage.values();
      });
    } finally {
      compilation.dispose();
      operation?.release();
    }
  }

  issue(input: {
    moduleId: string;
    operation: string;
    argumentDigest: string;
    policy: PendingHostCallPolicyMode;
  }): { record: HostCallRecord; restored: boolean } {
    const restored = this.restored[0];
    if (restored !== undefined) {
      const restoredOrdinal = readCallOrdinal(restored);
      if (this.nextCall < restoredOrdinal) {
        return { record: this.createRecord(input), restored: false };
      }
      if (!callIdentityMatches(restored, input)) {
        throw new HostCallResumabilityError(
          restored,
          "reset",
          `Host call ${restored.id} does not match the next restored invocation; reset is required.`
        );
      }
      this.restored.shift();
      this.nextCall += 1;
      return { record: restored, restored: true };
    }

    return { record: this.createRecord(input), restored: false };
  }

  private createRecord(input: {
    moduleId: string;
    operation: string;
    argumentDigest: string;
    policy: PendingHostCallPolicyMode;
  }): HostCallRecord {
    this.budget?.setRetainedDataUsage(this, this.retainedSize + 1);
    this.retainedSize += 1;
    const record: HostCallRecord = {
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

  start(record: HostCallRecord): void {
    record.lifecycle = "running";
  }

  registerSharedArguments(record:HostCallRecord, values:readonly SharedArrayBuffer[]):void {
    for (const value of values) this.registerSharedStorage(value);
    const tracked = !this.recordedReplay || record.sharedRegistry === true
      ? [...this.exposedSharedStorage.values()] : [...values];
    if (tracked.length > 0) {
      this.sharedArguments.set(record.id, tracked);
      if (!this.recordedReplay) record.sharedRegistry = true;
    }
  }

  registerSharedStorage(value: SharedArrayBuffer): void {
    const { block } = sharedArrayBufferStorage(value);
    if (this.exposedSharedStorage.has(block)) return;
    this.budget?.setRetainedDataUsage(this.exposedSharedStorage, this.exposedSharedStorage.size + 1);
    this.exposedSharedStorage.set(block, value);
  }

  captureSharedPrefix(record:HostCallRecord):void {
    const arguments_=this.sharedArguments.get(record.id);
    if (arguments_===undefined) return;
    const snapshots=new WeakMap<object,SharedArrayBuffer>();
    const size=1+arguments_.reduce((total,value)=>total+sharedArrayBufferStorage(value).byteLength+1,0);
    const retained=this.retainedSize+size-(this.sharedPrefixSizes.get(record.id)??0);
    this.budget?.setRetainedDataUsage(this,retained);
    try {
      record.sharedPrefix=encodeReplayData(arguments_.map(value=>snapshotSharedArrayBufferStorage(value,snapshots)));
    } catch (error) {
      this.budget?.setRetainedDataUsage(this,this.retainedSize);
      throw error;
    }
    this.retainedSize=retained;
    this.sharedPrefixSizes.set(record.id,size);
    record.sharedPrefixOrder = this.nextSharedOrder++;
  }

  replaySharedPrefix(record:HostCallRecord):void {
    if (record.sharedPrefix===undefined) return;
    const budget=this.compileOwner?.budget??this.budget;
    const operation=budget?.acquireCompileOwner(false,this.compileOwner);
    const compilation=new CompileScope(operation?.owner);
    try {
      const prefix=decodeSharedPrefix(record.sharedPrefix,compilation);
      const arguments_=this.sharedArguments.get(record.id)??[];
      if (record.asynchronous!==true||prefix.length!==arguments_.length)
        throw new TypeError("Invalid shared invocation prefix.");
      this.restoreSharedEffects(undefined,prefix.map((source,index)=>({source,target:arguments_[index]})),record.sharedPrefixOrder,budget);
    } finally {
      compilation.dispose();
      operation?.release();
    }
  }

  settle(record: HostCallRecord, outcome: HostCallOutcome): void {
    if (record.lifecycle === "cancelled") return;
    this.retainOutcome(record, outcome);
    if (record.sharedRegistry) record.sharedEffectOrder = this.nextSharedOrder++;
    record.lifecycle = "settled";
  }

  consume(record: HostCallRecord): void {
    if (record.lifecycle === "consumed") {
      throw new HostCallResumabilityError(
        record,
        "reset",
        `Host call ${record.id} result was already consumed; reset is required.`
      );
    }
    if (record.lifecycle !== "settled") return;
    record.lifecycle = "consumed";
  }

  cancel(record: HostCallRecord, reason: SandboxValue): void {
    if (record.lifecycle === "settled" || record.lifecycle === "consumed") return;
    this.retainOutcome(record, { status: "rejected", reason });
    record.lifecycle = "cancelled";
  }

  async reconcile(
    record: HostCallRecord,
    context?: HostCallResumeContext
  ): Promise<HostCallOutcome> {
    if (this.disposed) throw new TypeError("Host call journal is disposed.");
    if (record.lifecycle === "settled" && record.outcome !== undefined) return record.outcome;
    if (record.lifecycle === "consumed") {
      throw new HostCallResumabilityError(
        record,
        "reset",
        `Host call ${record.id} result was already consumed; reset is required.`
      );
    }
    if (record.lifecycle === "cancelled") {
      throw new HostCallResumabilityError(
        record,
        "reset",
        `Host call ${record.id} was cancelled; reset is required.`
      );
    }
    if (record.policy === "re-issue") {
      throw new HostCallResumabilityError(
        record,
        "reset",
        `Host call ${record.id} must be re-issued by the runtime.`
      );
    }
    if (this.resumeProvider === undefined) {
      throw new HostCallResumabilityError(
        record,
        "external-reconciliation",
        `Host call ${record.id} may have executed before process death; external reconciliation is required.`
      );
    }
    const { id, outcome: ignoredOutcome, ...request } = record;
    void ignoredOutcome;
    const proof = await this.awaitReconciliation(this.resumeProvider(
      {
        ...request,
        callId: id,
        requirement: "external-reconciliation"
      },
      context
    ));
    if (this.disposed) throw new TypeError("Host call journal is disposed.");
    validateProof(record, proof);
    if (
      context !== undefined &&
      context.callbacks.size > 0 &&
      proof.callbackDisposition === undefined
    ) {
      throw new HostCallResumabilityError(
        record,
        "external-reconciliation",
        `Host call ${record.id} has sandbox callbacks; its proof must specify callbackDisposition as joined or detached.`
      );
    }
    if (proof.callbackDisposition === "joined" && context !== undefined)
      await this.awaitReconciliation(context.waitForCallbacks());
    if (this.disposed) throw new TypeError("Host call journal is disposed.");
    const budget = this.compileOwner?.budget ?? this.budget;
    if (budget !== undefined)
      allocateProducedSandboxValue(proof.outcome.status === "fulfilled" ? proof.outcome.value : proof.outcome.reason, budget);
    this.settle(record, proof.outcome);
    return proof.outcome;
  }

  private awaitReconciliation<T>(work: T | Promise<T>): Promise<T> {
    if (this.disposed) {
      observeReconciliation(work, {});
      return Promise.reject(new TypeError("Host call journal is disposed."));
    }
    const pending = this.pendingReconciliations;
    return new Promise<T>((resolve, reject) => {
      const wait: ReconciliationWait<T> = {};
      const cancel = () => {
        const current = wait.current;
        if (current === undefined) return;
        wait.current = undefined;
        current.reject(new TypeError("Host call journal is disposed."));
      };
      wait.current = { resolve, reject, cancel, pending };
      pending.add(cancel);
      observeReconciliation(work, wait);
    });
  }

  snapshot(): HostCallRecord[] {
    return this.records
      .filter(
        (record) =>
          record.policy === "read-side-effect" ||
          record.lifecycle === "created" ||
          record.lifecycle === "running" ||
          record.lifecycle === "cancelled"
      )
      .map(({ outcome, ...record }) => ({
        ...structuredClone(record),
        ...(outcome === undefined ? {} : { outcome: copyOutcome(outcome) })
      }));
  }

  dispose(): void {
    this.disposed = true;
    for (const cancel of this.pendingReconciliations) cancel();
    this.pendingReconciliations.clear();
    this.budget?.setRetainedDataUsage(this, 0);
    this.budget?.setRetainedValues(this, undefined);
    this.capabilities.clear();
    this.budget?.setRetainedDataUsage(this.exposedSharedStorage, 0);
    this.exposedSharedStorage.clear();
    this.inputPromises.clear();
    this.importedPromiseMemo.clear();
    this.sharedAppliedOrder.clear();
    this.sharedArguments.clear();
    this.deferredSharedOutcomes.clear();
    for (const [id, waiter] of this.capabilityWaiters)
      waiter.reject(new UnresolvedReplayCapabilityError(id));
    this.capabilityWaiters.clear();
    this.budget = undefined;
  }

  registerCallbackFunction(
    record: HostCallRecord,
    id: number,
    closure: SandboxClosure,
    native: object
  ): void {
    const identity = `${record.id}/function/${id}`;
    const existing = this.capabilities.get(identity);
    if (existing !== undefined && existing !== closure)
      throw new TypeError(`Conflicting replay capability '${identity}'.`);
    if (!(record.functions ?? []).includes(id)) (record.functions ??= []).push(id);
    this.capabilities.set(identity, closure);
    this.capabilityWaiters.get(identity)?.resolve();
    this.capabilityWaiters.delete(identity);
    if (!this.capabilityIds.has(closure)) this.capabilityIds.set(closure, identity);
    this.nativeClosures.set(native, closure);
  }

  registerHostCapability(path: string, closure: SandboxClosure, native: object): void {
    const identity = `host:${path}`;
    const existing = this.capabilities.get(identity);
    if (existing !== undefined && existing !== closure)
      throw new TypeError(`Conflicting replay capability '${identity}'.`);
    this.capabilities.set(identity, closure);
    if (!this.capabilityIds.has(closure)) this.capabilityIds.set(closure, identity);
    if (!this.nativeClosures.has(native)) this.nativeClosures.set(native, closure);
    this.hostSources.set(closure, native);
  }

  registerInputPromise(promise: SandboxPromise): void {
    const record = promise.hostCall;
    if (record === undefined || promise.hostCallJournal !== this ||
        record.moduleId !== "<inputs>" || !this.records.includes(record))
      throw new TypeError("Invalid input Promise capability.");
    const id = `${record.id}/promise`;
    const existing = this.inputPromises.get(id);
    if (existing !== undefined && existing !== promise)
      throw new TypeError(`Conflicting input Promise capability '${id}'.`);
    this.inputPromises.set(id, promise);
    this.inputPromiseIds.set(promise, id);
    this.capabilityWaiters.get(id)?.resolve();
    this.capabilityWaiters.delete(id);
  }

  rebindHostCapability(original: SandboxClosure, restored: SandboxClosure): void {
    const identity = this.capabilityIds.get(original);
    const source = this.hostSources.get(original);
    if (identity === undefined || source === undefined) return;
    this.capabilities.set(identity, restored);
    this.capabilityIds.set(restored, identity);
    this.nativeClosures.set(source, restored);
    this.hostSources.set(restored, source);
  }

  validateHostCapabilities(): void {
    for (const identity of this.requiredHostCapabilities) {
      if (!this.capabilities.has(identity)) throw new UnresolvedReplayCapabilityError(identity);
    }
  }

  waitForCapability(id: string): Promise<void> {
    if (this.capabilities.has(id) || this.inputPromises.has(id)) return Promise.resolve();
    const owner = id.slice(0, id.lastIndexOf("/function/"));
    if (this.completedCallbackOwners.has(owner))
      return Promise.reject(new UnresolvedReplayCapabilityError(id));
    let waiter = this.capabilityWaiters.get(id);
    if (waiter === undefined) {
      let resolve!: () => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<void>((resolveResult, rejectResult) => {
        resolve = resolveResult;
        reject = rejectResult;
      });
      void promise.catch(() => undefined);
      waiter = { promise, resolve, reject };
      this.capabilityWaiters.set(id, waiter);
    }
    return waiter.promise;
  }

  trackCallbackCompletion(record: HostCallRecord, callbacks: readonly Promise<unknown>[]): void {
    const complete = () => {
      this.completedCallbackOwners.add(record.id);
      for (const [id, waiter] of this.capabilityWaiters) {
        if (!id.startsWith(`${record.id}/function/`)) continue;
        waiter.reject(new UnresolvedReplayCapabilityError(id));
        this.capabilityWaiters.delete(id);
      }
    };
    if (callbacks.length === 0) complete();
    else void Promise.allSettled(callbacks).then(complete);
  }

  recordCallback(record: HostCallRecord, id: number, args: SandboxValue[], step: number, hasReceiver = false): string {
    const sharedValues = this.exposedSharedStorage.size === 0 ? undefined : [args, ...this.exposedSharedStorage.values()];
    const retainedSize =
      this.retainedSize + 1 + measureSandboxData([args], { ignoreClosures: true }) +
      (sharedValues === undefined ? 0 : measureSandboxData([sharedValues], { ignoreClosures: true }));
    this.budget?.setRetainedDataUsage(this, retainedSize);
    let data: ReplayData;
    let sharedState: ReplayData | undefined;
    try {
      data = encodeReplayData(args, { identifyCapability: this.identifyCapability });
      if (sharedValues !== undefined) sharedState = encodeReplayData(sharedValues, { identifyCapability: this.identifyCapability });
    } catch (error) {
      this.budget?.setRetainedDataUsage(this, this.retainedSize);
      throw error;
    }
    this.retainedSize = retainedSize;
    (record.callbacks ??= []).push({ id, step, arguments: data, ...(hasReceiver ? { hasReceiver: true as const } : {}),
      ...(sharedState === undefined ? {} : { sharedState, sharedOrder: this.nextSharedOrder++ }) });
    return `${record.id}/callback/${record.callbacks.length}`;
  }

  replayCallbackArguments(callback: HostCallbackRecord, compilation: CompileScope): SandboxValue[] {
    if (callback.sharedState === undefined)
      return decodeReplayData(callback.arguments, { resolveCapability: this.resolveCapability }, compilation) as SandboxValue[];
    const [args, ...buffers] = decodeSharedCallback(callback.sharedState, this.resolveCapability, compilation);
    const targets = [...this.exposedSharedStorage.values()];
    if (buffers.length < targets.length) throw new TypeError("Missing shared callback storage.");
    const bindings = buffers.map((source, index) => ({ source, target: targets[index] ?? source }));
    for (const { target } of bindings) this.registerSharedStorage(target);
    const result = this.restoreSharedEffects(args, bindings, callback.sharedOrder, compilation.owner?.budget ?? this.budget);
    return result as SandboxValue[];
  }

  callbackPositions(): ReadonlyMap<string, number> {
    const positions = new Map<string, number>();
    for (const record of this.records) {
      for (const [index, callback] of (record.callbacks ?? []).entries()) {
        positions.set(`${record.id}/callback/${index + 1}`, callback.step);
      }
    }
    return positions;
  }

  private retainOutcome(
    record: HostCallRecord,
    outcome: HostCallOutcome,
    budget = this.budget,
    recordedArguments?:readonly SharedArrayBuffer[]
  ): void {
    const included = new Set<CompileTicket>();
    const arguments_=recordedArguments??this.sharedArguments.get(record.id)??[];
    const size = measureSandboxData(
      [outcome.status === "fulfilled" ? outcome.value : outcome.reason,...arguments_],
      { ignoreClosures: true, compileTickets: included }
    );
    const retainedSize = this.retainedSize + size - (this.outcomeSizes.get(record.id) ?? 0);
    budget?.reconcileCompileData(retainedSize, included, included, this);
    let copied: HostCallOutcome;
    let effects:SharedArrayBuffer[];
    const snapshots=new WeakMap<object,SharedArrayBuffer>();
    try {
      copied = copyOutcome(outcome,snapshots);
      effects=arguments_.map(argument=>snapshots.get(sharedArrayBufferStorage(argument).block)??
        snapshotSharedArrayBufferStorage(argument,snapshots));
    } catch (error) {
      budget?.setRetainedDataUsage(this, this.retainedSize);
      throw error;
    }
    this.retainedSize = retainedSize;
    this.outcomeSizes.set(record.id, size);
    this.outcomes.set(record.id, copied);
    this.sharedEffects.set(record.id,effects);
    const associations=new WeakMap<object,number>();
    for (const [index,argument] of arguments_.entries()) {
      const snapshot=snapshots.get(sharedArrayBufferStorage(argument).block);
      if (snapshot!==undefined) associations.set(sharedArrayBufferStorage(snapshot).block,index);
    }
    this.sharedOutcomeArguments.set(record.id,associations);
    this.sharedArguments.delete(record.id);
    record.outcome = copied;
  }

  replayOutcome(record: HostCallRecord): HostCallOutcome | undefined {
    if (!this.recordedReplay || (record.lifecycle !== "settled" && record.lifecycle !== "consumed"))
      return undefined;
    const encoded = this.encodedOutcomes.get(record.id);
    if (encoded !== undefined) {
      const budget = this.compileOwner?.budget ?? this.budget;
      const operation = budget?.acquireCompileOwner(false, this.compileOwner);
      const compilation = new CompileScope(operation?.owner);
      try {
        const memo={nodes:encoded.data.nodes,values:new Map<number,SandboxValue>()};
        let value = decodeReplayData(
          encoded.data,
          { resolveCapability: this.resolveCapability, resolvePromise: this.resolvePromise, memo,
            graphId: record.id, importedPromiseMemo: this.importedPromiseMemo,
            resumePendingImportedPromise: (id, node) => this.reconcileImportedPromise(id, node),
            restoreScheduledPromise: this.promiseReplay === undefined ? undefined
              : (id, promise, value) => this.promiseReplay!.restoreImportedPromise(id, promise, value),
            resolvePromiseGraph: id => this.encodedOutcomes.get(id)?.data },
          compilation
        );
        let recordedArguments:SharedArrayBuffer[]|undefined;
        let applyPrefix:(()=>void)|undefined;
        let applyShared:(()=>SandboxValue)|undefined;
        if (encoded.sharedState===true) {
          if (!Array.isArray(value)||value.length===0) throw new TypeError("Invalid shared host outcome state.");
          recordedArguments=value.slice(1) as SharedArrayBuffer[];
          value=value[0];
        }
        if (encoded.sharedArguments!==undefined) {
          const arguments_=this.sharedArguments.get(record.id)??[];
          const bindings=encoded.sharedArguments.map(([id,index])=>{
            const source=memo.values.get(id);
            const target=arguments_[index];
            if (!isSandboxSharedArrayBuffer(source)||!isSandboxSharedArrayBuffer(target))
              throw new TypeError("Invalid shared host argument reference.");
            return {source,target};
          });
          if (record.sharedPrefix!==undefined) {
            const prefix=decodeSharedPrefix(record.sharedPrefix,compilation);
            if (!record.asynchronous||prefix.length!==arguments_.length)
              throw new TypeError("Invalid shared invocation prefix.");
            for (const [id,index] of encoded.sharedArguments) {
              const final=sharedArrayBufferStorage(memo.values.get(id) as SharedArrayBuffer);
              const initial=sharedArrayBufferStorage(prefix[index]);
              if (final.growable!==initial.growable||final.maxByteLength!==initial.maxByteLength||final.byteLength<initial.byteLength)
                throw new TypeError("Shared outcome contradicts invocation prefix.");
            }
            applyPrefix=()=>{this.restoreSharedEffects(undefined,prefix.map((source,index)=>({source,target:arguments_[index]})),record.sharedPrefixOrder,budget);};
          }
          const captured=value;
          applyShared=()=>this.restoreSharedEffects(captured,bindings,record.sharedEffectOrder,budget);
        }
        const outcome: HostCallOutcome =
          encoded.status === "fulfilled"
            ? { status: "fulfilled", value }
            : { status: "rejected", reason: value };
        this.retainOutcome(record, outcome, budget, recordedArguments);
        applyPrefix?.();
        if ([...memo.values.values()].some(isSandboxSharedArrayBuffer)) {
          const restore = applyShared;
          const captured = value;
          applyShared = () => {
            const result = restore === undefined ? captured : restore();
            encodeReplayData(result, { identifyCapability: this.identifyCapability, onValueEncoded: (_id, entry) => {
              if (isSandboxSharedArrayBuffer(entry)) this.registerSharedStorage(entry);
            } });
            return result;
          };
        }
        if (applyShared!==undefined) {
          if (record.asynchronous) this.deferredSharedOutcomes.set(record.id,applyShared);
          else value=applyShared();
        }
        return encoded.status==="fulfilled"?{status:"fulfilled",value}:{status:"rejected",reason:value};
      } finally {
        compilation.dispose();
        operation?.release();
      }
    }
    const outcome = this.outcomes.get(record.id);
    return outcome === undefined ? undefined : copyOutcome(outcome);
  }

  private async reconcileImportedPromise(callId: string, node: number): Promise<SandboxValue> {
    const parent = this.records.find(record => record.id === callId);
    const encoded = this.encodedOutcomes.get(callId);
    if (parent === undefined || encoded?.data.nodes[node]?.kind !== "pending-imported-promise")
      throw new TypeError("Missing pending imported Promise declaration.");
    const record: HostCallRecord = {
      id: `${callId}/promise/${node}`, runId: parent.runId, sourceHash: parent.sourceHash,
      moduleId: parent.moduleId, operation: `${parent.operation}/promise/${node}`,
      argumentDigest: digestHostCallArguments([parent.argumentDigest, node]),
      policy: "read-side-effect", lifecycle: "running", asynchronous: true
    };
    const outcome = await this.reconcile(record);
    const value = outcome.status === "fulfilled" ? outcome.value : outcome.reason;
    this.recordImportedPromiseOutcome(callId, node, outcome);
    if (outcome.status === "rejected") throw value;
    return value;
  }

  private recordImportedPromiseOutcome(callId: string, node: number, outcome: HostCallOutcome): void {
    const encoded = this.encodedOutcomes.get(callId);
    if (encoded?.data.nodes[node]?.kind !== "pending-imported-promise")
      throw new TypeError("Missing pending imported Promise declaration.");
    const scheduleId = encoded.data.nodes[node].scheduleId;
    const value = outcome.status === "fulfilled" ? outcome.value : outcome.reason;
    const context = createReplayEncodingContext();
    context.nodes = [...encoded.data.nodes];
    const added = new Map<number, SandboxPromise>();
    const data = encodeReplayData(value, {
      context, identifyCapability: this.identifyCapability, identifyPromise: this.identifyPromise,
      captureSettledImportedPromises: true, capturePendingImportedPromises: true,
      identifyScheduledPromise: promise => this.promiseReplay?.identifyPromise(promise),
      onValueEncoded: (index, value) => { if (isSandboxPromise(value)) added.set(index, value); },
      identifyImportedPromise: promise => {
        for (const [id, entries] of this.importedPromiseMemo)
          for (const [index, existing] of entries)
            if (existing === promise) return { callId: id, node: index };
        return undefined;
      }
    });
    data.nodes[node] = { kind: "settled-imported-promise", status: outcome.status, outcome: data.root,
      ...(scheduleId === undefined ? {} : { scheduleId }) };
    encoded.data = { ...encoded.data, nodes: data.nodes };
    if (added.size > 0) {
      let entries = this.importedPromiseMemo.get(callId);
      if (entries === undefined) this.importedPromiseMemo.set(callId, entries = new Map());
      for (const [index, promise] of added) {
        entries.set(index, promise);
        this.proofImportedPromises.add(promise);
      }
    }
  }

  snapshotReplay(): HostCallReplay {
    for (const [callId, entries] of this.importedPromiseMemo) {
      for (const [node, promise] of entries) {
        if (!this.proofImportedPromises.has(promise)) continue;
        if (this.encodedOutcomes.get(callId)?.data.nodes[node]?.kind !== "pending-imported-promise") continue;
        const snapshot = importedPromiseSnapshots.get(promise);
        if (snapshot?.ok === false) throw snapshot.error;
        if (snapshot?.ok === true) this.recordImportedPromiseOutcome(callId, node,
          snapshot.state.status === "fulfilled" ? { status: "fulfilled", value: snapshot.state.value }
            : { status: "rejected", reason: snapshot.state.value });
      }
    }
    const importedIdentities = new WeakMap<SandboxPromise, { callId: string; node: number }>();
    for (const [callId, entries] of this.importedPromiseMemo)
      for (const [node, promise] of entries) importedIdentities.set(promise, { callId, node });
    const replay: HostCallReplay = structuredClone({
      version: this.records.some(record => record.callbacks?.some(callback => callback.hasReceiver)) ? 2 : 1,
      calls: this.records.map(({ outcome: ignoredOutcome, asynchronous, ...record }) => {
        void ignoredOutcome;
        const outcome = this.outcomes.get(record.id);
        const sharedArguments:Array<[number,number]>=[];
        const capturedBlocks=new Set<object>();
        const associations=this.sharedOutcomeArguments.get(record.id);
        const encoded=this.encodedOutcomes.get(record.id);
        const effects=this.sharedEffects.get(record.id)??[];
        const outcomeValue=outcome?.status==="fulfilled"?outcome.value:outcome?.reason;
        const data=outcome===undefined?undefined:encoded?.data??encodeReplayData(
          effects.length===0?outcomeValue:[outcomeValue,...effects],
          {identifyCapability:this.identifyCapability,identifyPromise:this.identifyPromise,captureSettledImportedPromises:true,
            capturePendingImportedPromises:true,
            identifyScheduledPromise: value => this.promiseReplay?.identifyPromise(value),
            identifyImportedPromise: value => importedIdentities.get(value),onValueEncoded:(id,value)=>{
            if (isSandboxPromise(value)) importedIdentities.set(value, { callId: record.id, node: id });
            if (!isSandboxSharedArrayBuffer(value)) return;
            const block=sharedArrayBufferStorage(value).block;
            const index=associations?.get(block);
            if (index===undefined||capturedBlocks.has(block)) return;
            capturedBlocks.add(block);
            sharedArguments.push([id,index]);
          }});
        return {
          ...record,
          asynchronous: asynchronous === true,
          ...(outcome === undefined
            ? {}
            : {
                outcome: {
                  status: outcome.status,
                  data:data!,
                  ...(encoded?.sharedState===true||encoded===undefined&&effects.length>0?{sharedState:true as const}:{}),
                  ...((encoded?.sharedArguments??sharedArguments).length===0?{}:
                    {sharedArguments:encoded?.sharedArguments??sharedArguments})
                }
              })
        };
      })
    });
    const schedulingIds: number[] = [];
    for (const call of replay.calls) {
      for (const node of call.outcome?.data.nodes ?? []) {
        if ((node.kind === "settled-imported-promise" || node.kind === "pending-imported-promise") && node.scheduleId !== undefined)
          schedulingIds.push(node.scheduleId);
      }
    }
    this.promiseReplay?.recordSerializedImportedPromises(schedulingIds);
    return replay;
  }

  private restoreSharedEffects(
    value: SandboxValue,
    bindings: ReadonlyArray<{source:SharedArrayBuffer;target:SharedArrayBuffer}>,
    order: number | undefined,
    budget?: Budget
  ): SandboxValue {
    const ordered = bindings.map(binding => ({ ...binding,
      write: order === undefined || order > (this.sharedAppliedOrder.get(sharedArrayBufferStorage(binding.target).block) ?? 0)
    }));
    const result = restoreSharedHostValue(value, ordered, budget);
    if (order !== undefined) {
      for (const binding of ordered)
        if (binding.write) this.sharedAppliedOrder.set(sharedArrayBufferStorage(binding.target).block, order);
    }
    return result;
  }

  replaySettlement(record:HostCallRecord, value:SandboxValue):SandboxValue {
    const restore=this.deferredSharedOutcomes.get(record.id);
    if (restore===undefined) return value;
    this.deferredSharedOutcomes.delete(record.id);
    return restore();
  }
}

function copyOutcome(outcome: HostCallOutcome, sharedBufferSnapshots=new WeakMap<object,SharedArrayBuffer>()): HostCallOutcome {
  return outcome.status === "fulfilled"
    ? { status: "fulfilled", value: cloneSandboxValue(outcome.value, {sharedBufferSnapshots}) }
    : { status: "rejected", reason: cloneSandboxValue(outcome.reason, {sharedBufferSnapshots}) };
}

function decodeSharedPrefix(data:ReplayData, compilation?:CompileScope):SharedArrayBuffer[] {
  const values=decodeReplayData(data,{},compilation);
  if (!Array.isArray(values)||values.length===0) throw new TypeError("Invalid shared invocation prefix.");
  const blocks=new Set<object>();
  return values.map(value=>{
    if (!isSandboxSharedArrayBuffer(value)) throw new TypeError("Invalid shared invocation prefix storage.");
    const block=sharedArrayBufferStorage(value).block;
    if (blocks.has(block)) throw new TypeError("Duplicate shared invocation prefix storage.");
    blocks.add(block);
    return value;
  });
}

function decodeSharedCallback(data: ReplayData, resolveCapability: (id: string) => SandboxClosure | undefined, compilation?: CompileScope): [SandboxValue[], ...SharedArrayBuffer[]] {
  const values = decodeReplayData(data, { resolveCapability }, compilation);
  if (!Array.isArray(values) || values.length < 2 || !Array.isArray(values[0]))
    throw new TypeError("Invalid shared callback state.");
  const blocks = new Set<object>();
  for (const value of values.slice(1)) {
    if (!isSandboxSharedArrayBuffer(value)) throw new TypeError("Invalid shared callback storage.");
    const { block } = sharedArrayBufferStorage(value);
    if (blocks.has(block)) throw new TypeError("Duplicate shared callback storage.");
    blocks.add(block);
  }
  return values as [SandboxValue[], ...SharedArrayBuffer[]];
}

function restoreReplayCalls(
  input: unknown,
  encodedOutcomes: Map<string, EncodedHostOutcome>,
  callbackSizes: Map<string, number>,
  requiredHostCapabilities = new Set<string>(),
  compilation?: CompileScope,
  reachableSchedulingIds = new Set<number>()
): HostCallRecord[] {
  validateSnapshotData(input);
  if (
    input === null ||
    typeof input !== "object" ||
    !("version" in input) ||
    (input.version !== 1 && input.version !== 2) ||
    !("calls" in input) ||
    !Array.isArray(input.calls)
  ) {
    throw new TypeError("Invalid host call replay header.");
  }
  const capabilities = new Map<string, SandboxClosure>();
  const importedPromiseMemo = new Map<string, Map<number, SandboxPromise>>();
  const replayCalls = input.calls;
  const inputPromises = new Map<string, SandboxPromise>();
  for (const entry of input.calls) {
    if (entry?.moduleId === "<inputs>" && entry.asynchronous === true &&
        entry.policy === "read-side-effect" && typeof entry.id === "string")
      inputPromises.set(`${entry.id}/promise`, createSandboxPromise(Promise.resolve(undefined), { trackReplay: false }));
  }
  for (const entry of input.calls) {
    if (entry?.functions === undefined) continue;
    if (
      !Array.isArray(entry.functions) ||
      new Set(entry.functions).size !== entry.functions.length ||
      entry.functions.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) < 1)
    )
      throw new TypeError("Invalid replay capability declarations.");
    for (const id of entry.functions) {
      capabilities.set(
        `${entry.id}/function/${id}`,
        createSandboxClosure({
          call: () => {
            throw new TypeError("Replay capability has not been reconstructed.");
          }
        })
      );
    }
  }
  const resolveCapability = (id: string) => {
    if (!capabilities.has(id) && id.startsWith("host:")) {
      const path: unknown = JSON.parse(id.slice(5));
      if (
        !Array.isArray(path) ||
        path.length < 2 ||
        path.some((value) => typeof value !== "string")
      )
        throw new TypeError("Invalid host capability identity.");
      requiredHostCapabilities.add(id);
      capabilities.set(
        id,
        createSandboxClosure({
          call: () => {
            throw new TypeError("Host capability has not been reconstructed.");
          }
        })
      );
    }
    return capabilities.get(id);
  };
  return input.calls.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry))
      throw new TypeError("Invalid replay call.");
    for (const field of ["id", "runId", "sourceHash", "moduleId", "operation", "argumentDigest"]) {
      if (
        !Object.hasOwn(entry, field) ||
        typeof entry[field] !== "string" ||
        entry[field].length === 0
      )
        throw new TypeError(`Invalid replay call ${field}.`);
    }
    if (
      typeof entry.asynchronous !== "boolean" ||
      !["re-issue", "read-side-effect"].includes(entry.policy) ||
      !["created", "running", "settled", "consumed", "cancelled"].includes(entry.lifecycle)
    ) {
      throw new TypeError("Invalid replay call state.");
    }
    if (readCallOrdinal(entry) !== index + 1)
      throw new TypeError("Replay calls must have consecutive ordinals.");
    if (entry.callbacks !== undefined) {
      if (!Array.isArray(entry.callbacks)) throw new TypeError("Invalid replay callbacks.");
      let previousStep = 0;
      for (const [index, callback] of entry.callbacks.entries()) {
        if (
          callback === null ||
          typeof callback !== "object" ||
          (callback.hasReceiver !== undefined && (callback.hasReceiver !== true || input.version !== 2)) ||
          !Number.isSafeInteger(callback.id) ||
          callback.id < 1 ||
          !Number.isSafeInteger(callback.step) ||
          callback.step < previousStep
        )
          throw new TypeError("Invalid replay callback.");
        previousStep = callback.step;
        const validation = new CompileScope(compilation?.owner);
        try {
          const args = decodeReplayData(callback.arguments, { resolveCapability }, validation);
          if (!Array.isArray(args) || (callback.hasReceiver && (args.length === 0 || args[0] === undefined)))
            throw new TypeError("Invalid replay callback.");
          const shared = callback.sharedState === undefined ? undefined : decodeSharedCallback(callback.sharedState, resolveCapability, validation);
          if (shared !== undefined && (shared[0].length !== args.length || (callback.hasReceiver && shared[0][0] === undefined)))
            throw new TypeError("Contradictory shared callback arguments.");
          callbackSizes.set(`${entry.id}/callback/${index + 1}`, measureSandboxData([args]) + (shared === undefined ? 0 : measureSandboxData([shared])));
        } finally {
          validation.dispose();
        }
      }
    }
    let outcome: HostCallOutcome | undefined;
    if (entry.outcome !== undefined) {
      if (
        entry.outcome === null ||
        typeof entry.outcome !== "object" ||
        !["fulfilled", "rejected"].includes(entry.outcome.status)
      )
        throw new TypeError("Invalid replay call outcome.");
      const memo={nodes:entry.outcome.data.nodes,values:new Map<number,SandboxValue>()};
      let value = decodeReplayData(entry.outcome.data, {
        resolveCapability, resolvePromise: id => inputPromises.get(id), memo,
        graphId: entry.id, importedPromiseMemo,
        resolvePromiseGraph: id => replayCalls.find(call => call?.id === id)?.outcome?.data,
        resumePendingImportedPromise: () => new Promise(() => undefined),
        onImportedPromiseRestored: (promise, scheduleId) => {
          observeSandboxPromise(promise, true);
          if (scheduleId !== undefined) reachableSchedulingIds.add(scheduleId);
        }
      }, compilation);
      const blocks=new Set<object>();
      const indices=new Set<number>();
      if (entry.outcome.sharedArguments!==undefined) {
        if (!Array.isArray(entry.outcome.sharedArguments)) throw new TypeError("Invalid shared host argument associations.");
        for (const pair of entry.outcome.sharedArguments) {
          if (!Array.isArray(pair)||pair.length!==2||!Number.isSafeInteger(pair[0])||pair[0]<0||
              !Number.isSafeInteger(pair[1])||pair[1]<0) throw new TypeError("Invalid shared host argument association.");
          const source=memo.values.get(pair[0]);
          if (!isSandboxSharedArrayBuffer(source)) throw new TypeError("Invalid shared host storage reference.");
          const block=sharedArrayBufferStorage(source).block;
          if (blocks.has(block)||indices.has(pair[1])) throw new TypeError("Duplicate shared host storage association.");
          blocks.add(block);
          indices.add(pair[1]);
        }
      }
      if (entry.outcome.sharedState!==undefined) {
        if (entry.outcome.sharedState!==true||!Array.isArray(value)||value.length<2||blocks.size!==value.length-1)
          throw new TypeError("Invalid shared host outcome state.");
        for (let index=1;index<value.length;index++) {
          const buffer=value[index];
          if (!isSandboxSharedArrayBuffer(buffer)||!blocks.has(sharedArrayBufferStorage(buffer).block)||!indices.has(index-1))
            throw new TypeError("Invalid shared host outcome effects.");
        }
        value=value[0];
      }
      encodedOutcomes.set(entry.id, structuredClone(entry.outcome));
      outcome =
        entry.outcome.status === "fulfilled"
          ? { status: "fulfilled", value }
          : { status: "rejected", reason: value };
    } else if (["settled", "consumed", "cancelled"].includes(entry.lifecycle)) {
      throw new TypeError("Missing replay call outcome.");
    }
    return { ...entry, ...(outcome === undefined ? {} : { outcome }) } as HostCallRecord;
  });
}

function validateRestoredRecords(
  records: readonly HostCallRecord[],
  runId: string,
  sourceHash: string
): void {
  const ids = new Set<string>();
  const sharedOrders = new Set<number>();
  let previousOrdinal = 0;
  for (const record of records) {
    if (record.sharedRegistry !== undefined && record.sharedRegistry !== true)
      throw new TypeError("Invalid shared host registry marker.");
    for (const order of [record.sharedPrefixOrder, record.sharedEffectOrder, ...(record.callbacks ?? []).map(callback => callback.sharedOrder)]) {
      if (order === undefined) continue;
      if (!Number.isSafeInteger(order) || order < 1 || order >= Number.MAX_SAFE_INTEGER || sharedOrders.has(order))
        throw new TypeError("Invalid shared host event order.");
      sharedOrders.add(order);
    }
    for (const callback of record.callbacks ?? []) {
      if ((callback.sharedState === undefined) !== (callback.sharedOrder === undefined))
        throw new TypeError("Missing shared callback event metadata.");
    }
    if ((record.sharedPrefixOrder !== undefined && record.sharedPrefix === undefined) ||
        (record.sharedEffectOrder !== undefined && record.sharedRegistry !== true) ||
        (record.sharedPrefixOrder !== undefined && record.sharedEffectOrder !== undefined && record.sharedEffectOrder <= record.sharedPrefixOrder))
      throw new TypeError("Contradictory shared host event order.");
    if (record.runId !== runId || !record.id.startsWith(`${runId}:`)) {
      throw new HostCallResumabilityError(
        record,
        "reset",
        `Host call ${record.id} does not belong to restored run ${runId}; reset is required.`
      );
    }
    if (record.sourceHash !== sourceHash) {
      throw new HostCallResumabilityError(
        record,
        "reset",
        `Host call ${record.id} does not match the restored source; reset is required.`
      );
    }
    if (ids.has(record.id)) {
      throw new HostCallResumabilityError(
        record,
        "reset",
        `Host call ${record.id} appears more than once; reset is required.`
      );
    }
    const ordinal = readCallOrdinal(record);
    if (ordinal <= previousOrdinal) {
      throw new HostCallResumabilityError(
        record,
        "reset",
        `Host call ${record.id} is out of order; reset is required.`
      );
    }
    previousOrdinal = ordinal;
    ids.add(record.id);
  }
}

function readCallOrdinal(record: HostCallRecord): number {
  const ordinal = Number(record.id.slice(record.id.lastIndexOf(":") + 1));
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new HostCallResumabilityError(
      record,
      "reset",
      `Host call ${record.id} has an invalid ordinal; reset is required.`
    );
  }
  return ordinal;
}

function callIdentityMatches(
  record: HostCallRecord,
  input: {
    moduleId: string;
    operation: string;
    argumentDigest: string;
    policy: PendingHostCallPolicyMode;
  }
): boolean {
  return (
    record.moduleId === input.moduleId &&
    record.operation === input.operation &&
    record.argumentDigest === input.argumentDigest &&
    record.policy === input.policy
  );
}

export function digestHostCallArguments(args: readonly unknown[], sharedArguments?:SharedArrayBuffer[]): string {
  return createHash("sha256").update(stableStringify(args,sharedArguments)).digest("hex");
}

function validateProof(record: HostCallRecord, proof: HostCallResumeProof): void {
  if (
    proof.callbackDisposition !== undefined &&
    proof.callbackDisposition !== "joined" &&
    proof.callbackDisposition !== "detached"
  ) {
    throw new HostCallResumabilityError(
      record,
      "external-reconciliation",
      "Invalid callbackDisposition in external result proof."
    );
  }
  if (
    !pendingHostCallResumeIdentityMatches(
      {
        argumentDigest: record.argumentDigest,
        callId: record.id,
        moduleId: record.moduleId,
        operation: record.operation,
        sourceHash: record.sourceHash
      },
      proof
    )
  ) {
    throw new HostCallResumabilityError(
      record,
      "external-reconciliation",
      `External result proof does not match host call ${record.id}.`
    );
  }
}

function stableStringify(value: unknown, sharedArguments?:SharedArrayBuffer[]): string {
  const seen = new WeakSet<object>();
  const blocks=new Map<object,number>();
  return JSON.stringify(normalize(value, seen, blocks, sharedArguments));
}

function normalize(value: unknown, seen: WeakSet<object>, sharedBlocks: Map<object, number>, sharedArguments?:SharedArrayBuffer[]): unknown {
  if (typeof value === "function") return undefined;
  if (typeof value === "bigint") throw new TypeError("Do not know how to serialize a BigInt");
  if (value === undefined) return Object.assign(Object.create(null), { $type: "undefined" });
  if (typeof value === "number" && !Number.isFinite(value))
    return Object.assign(Object.create(null), { $type: "number", value: String(value) });
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new TypeError("Host call arguments cannot contain cycles.");
  seen.add(value);
  try {
    const date = copyNativeDate(value);
    if (date !== undefined) return Object.assign(Object.create(null), { $type: "date", time: serializedDateTime(date) });
    if (isSandboxDataView(value)) {
      const properties = Object.create(null) as Record<string, unknown>;
      const entries = dataViewDataProperties(value);
      if (entries.some(([key]) => typeof key !== "string")) throw new TypeError("DataView symbol properties require an explicit host-call identity.");
      for (const [key, descriptor] of entries.sort(([left], [right]) => String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0))
        defineOwnDataProperty(properties, String(key), normalize(descriptor.value, seen, sharedBlocks, sharedArguments));
      const layout = dataViewLayout(value);
      return Object.assign(Object.create(null), { $type: "dataview", byteOffset: layout.byteOffset,
        byteLength: layout.byteLength ?? null, buffer: normalize(dataViewBuffer(value), seen, sharedBlocks, sharedArguments), properties });
    }
    if (isSandboxArrayBuffer(value) || isSandboxSharedArrayBuffer(value)) {
      arrayBufferLength(value);
      const properties = Object.create(null) as Record<string, unknown>;
      const entries: Array<[string, PropertyDescriptor]> = [];
      for (const [key, descriptor] of arrayBufferDataProperties(value)) {
        if (typeof key === "symbol") throw new TypeError("ArrayBuffer symbol properties require an explicit host-call identity.");
        entries.push([key, descriptor]);
      }
      for (const [key, descriptor] of entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
        defineOwnDataProperty(properties, key, normalize(descriptor.value, seen, sharedBlocks, sharedArguments));
      const shared = isSandboxSharedArrayBuffer(value) ? sharedArrayBufferStorage(value) : undefined;
      if (shared !== undefined && !sharedBlocks.has(shared.block)) {
        sharedBlocks.set(shared.block, sharedBlocks.size);
        sharedArguments?.push(value as SharedArrayBuffer);
      }
      return Object.assign(Object.create(null), { $type: shared === undefined ? "arraybuffer" : "sharedarraybuffer",
        bytes: normalize(Array.from(new Uint8Array(value)), seen, sharedBlocks, sharedArguments), ...arrayBufferOptions(value), properties,
        ...(shared === undefined ? {} : { block: sharedBlocks.get(shared.block) }) });
    }
    if (isNumericTypedArray(value)) {
      const storage = typedArrayStorage(value);
      const resizable = arrayBufferOptions(storage.buffer) !== undefined;
      const layout = resizable ? typedArrayViewLayouts.get(value) : undefined;
      if (resizable && layout === undefined)
        throw new TypeError("Resizable Float32Array host-call identity requires known view layout.");
      const properties = Object.create(null) as Record<string, unknown>;
      for (const [key, descriptor] of typedArrayDataProperties(value).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0
      )) {
        defineOwnDataProperty(properties, key, normalize(descriptor.value, seen, sharedBlocks, sharedArguments));
      }
      return Object.assign(Object.create(null), {
        $type: storage.Native === Float32Array ? "float32array" : storage.Native.name,
        bytes: normalize(Array.from(new Uint8Array(storage.buffer)), seen, sharedBlocks, sharedArguments),
        byteOffset: storage.byteOffset,
        length: storage.length,
        properties,
        ...(resizable || isSandboxSharedArrayBuffer(storage.buffer) || Reflect.ownKeys(storage.buffer).length > 0
          ? { buffer: normalize(storage.buffer, seen, sharedBlocks, sharedArguments) } : {}),
        ...(layout === undefined ? {} : { viewLayout: {
          byteOffset: layout.byteOffset, length: layout.length ?? null
        } })
      });
    }
    if (Array.isArray(value)) {
      const normalized = new Array<unknown>(value.length);
      Object.setPrototypeOf(normalized, null);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!isArrayIndexKey(key)) continue;
        if (!("value" in descriptor)) {
          throw new TypeError("Host call arguments cannot contain accessor properties.");
        }
        defineOwnDataProperty(normalized, key, normalize(descriptor.value, seen, sharedBlocks, sharedArguments));
      }
      return normalized;
    }
    const normalized = Object.create(null) as Record<string, unknown>;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) {
        throw new TypeError("Host call arguments cannot contain accessor properties.");
      }
      defineOwnDataProperty(normalized, key, normalize(descriptor.value, seen, sharedBlocks, sharedArguments));
    }
    return normalized;
  } finally {
    seen.delete(value);
  }
}
