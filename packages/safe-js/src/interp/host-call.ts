import { createHash, randomUUID } from "node:crypto";
import { float32DataProperties, float32Storage, isFloat32Array } from "./float32.js";
import { copyNativeDate, serializedDateTime } from "./date.js";
import {
  cloneSandboxValue,
  createSandboxClosure,
  defineOwnDataProperty,
  isArrayIndexKey,
  measureSandboxData,
  type SandboxClosure,
  type SandboxValue
} from "./values.js";
import type { Budget, CompileOwner, CompileTicket } from "./budget.js";
import { CompileScope } from "./regex/compile-guard.js";
import { decodeReplayData, encodeReplayData, type ReplayData } from "../snapshot/replay-data.js";
import { validateSnapshotData } from "../snapshot/validation.js";
import {
  pendingHostCallResumeIdentityMatches,
  type PendingHostCallPolicyMode
} from "../snapshot/policy.js";

export type HostCallLifecycle = "created" | "running" | "settled" | "consumed" | "cancelled";
export type HostCallOutcome =
  | { status: "fulfilled"; value: SandboxValue }
  | { status: "rejected"; reason: SandboxValue };

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
  callbacks?: Array<{ id: number; step: number; arguments: ReplayData }>;
  functions?: number[];
};

export type HostCallReplay = {
  version: 1;
  calls: Array<
    Omit<HostCallRecord, "outcome" | "asynchronous"> & {
      asynchronous: boolean;
      outcome?: { status: "fulfilled" | "rejected"; data: ReplayData };
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
  readonly runId: string;
  private nextCall = 1;
  private readonly records: HostCallRecord[];
  private readonly restored: HostCallRecord[];
  private readonly outcomes = new Map<string, HostCallOutcome>();
  private readonly recordedReplay: boolean;
  private retainedSize = 0;
  private readonly outcomeSizes = new Map<string, number>();
  private readonly capabilities = new Map<string, SandboxClosure>();
  private readonly requiredHostCapabilities = new Set<string>();
  private readonly capabilityIds = new WeakMap<SandboxClosure, string>();
  readonly nativeClosures = new WeakMap<object, SandboxClosure>();
  private readonly hostSources = new WeakMap<SandboxClosure, object>();
  private readonly encodedOutcomes = new Map<
    string,
    { status: "fulfilled" | "rejected"; data: ReplayData }
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
        const replayRecords = restoreReplayCalls(
          replay,
          this.encodedOutcomes,
          this.callbackSizes,
          this.requiredHostCapabilities,
          compilation
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
          if (record.outcome !== undefined) this.retainOutcome(record, record.outcome);
          for (const [index, callback] of (record.callbacks ?? []).entries()) {
            let size = this.callbackSizes.get(`${record.id}/callback/${index + 1}`);
            if (size === undefined) {
              const validation = new CompileScope(operation?.owner);
              try {
                size = measureSandboxData([decodeReplayData(callback.arguments, {}, validation)]);
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
      this.budget?.setRetainedValues(this, () => this.capabilities.values());
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

  settle(record: HostCallRecord, outcome: HostCallOutcome): void {
    if (record.lifecycle === "cancelled") return;
    this.retainOutcome(record, outcome);
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
    const proof = await this.resumeProvider(
      {
        ...request,
        callId: id,
        requirement: "external-reconciliation"
      },
      context
    );
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
    if (proof.callbackDisposition === "joined") await context?.waitForCallbacks();
    this.settle(record, proof.outcome);
    return proof.outcome;
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
    this.budget?.setRetainedDataUsage(this, 0);
    this.budget?.setRetainedValues(this, undefined);
    this.capabilities.clear();
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
    if (this.capabilities.has(id)) return Promise.resolve();
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

  recordCallback(record: HostCallRecord, id: number, args: SandboxValue[], step: number): string {
    const retainedSize =
      this.retainedSize + 1 + measureSandboxData([args], { ignoreClosures: true });
    this.budget?.setRetainedDataUsage(this, retainedSize);
    let data: ReplayData;
    try {
      data = encodeReplayData(args, { identifyCapability: this.identifyCapability });
    } catch (error) {
      this.budget?.setRetainedDataUsage(this, this.retainedSize);
      throw error;
    }
    this.retainedSize = retainedSize;
    (record.callbacks ??= []).push({ id, step, arguments: data });
    return `${record.id}/callback/${record.callbacks.length}`;
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
    budget = this.budget
  ): void {
    const included = new Set<CompileTicket>();
    const size = measureSandboxData(
      [outcome.status === "fulfilled" ? outcome.value : outcome.reason],
      { ignoreClosures: true, compileTickets: included }
    );
    const retainedSize = this.retainedSize + size - (this.outcomeSizes.get(record.id) ?? 0);
    budget?.reconcileCompileData(retainedSize, included, included, this);
    let copied: HostCallOutcome;
    try {
      copied = copyOutcome(outcome);
    } catch (error) {
      budget?.setRetainedDataUsage(this, this.retainedSize);
      throw error;
    }
    this.retainedSize = retainedSize;
    this.outcomeSizes.set(record.id, size);
    this.outcomes.set(record.id, copied);
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
        const value = decodeReplayData(
          encoded.data,
          { resolveCapability: this.resolveCapability },
          compilation
        );
        const outcome: HostCallOutcome =
          encoded.status === "fulfilled"
            ? { status: "fulfilled", value }
            : { status: "rejected", reason: value };
        this.retainOutcome(record, outcome, budget);
        return outcome;
      } finally {
        compilation.dispose();
        operation?.release();
      }
    }
    const outcome = this.outcomes.get(record.id);
    return outcome === undefined ? undefined : copyOutcome(outcome);
  }

  snapshotReplay(): HostCallReplay {
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
                  data:
                    this.encodedOutcomes.get(record.id)?.data ??
                    encodeReplayData(
                      outcome.status === "fulfilled" ? outcome.value : outcome.reason,
                      { identifyCapability: this.identifyCapability }
                    )
                }
              })
        };
      })
    });
  }
}

function copyOutcome(outcome: HostCallOutcome): HostCallOutcome {
  return outcome.status === "fulfilled"
    ? { status: "fulfilled", value: cloneSandboxValue(outcome.value) }
    : { status: "rejected", reason: cloneSandboxValue(outcome.reason) };
}

function restoreReplayCalls(
  input: unknown,
  encodedOutcomes: Map<string, { status: "fulfilled" | "rejected"; data: ReplayData }>,
  callbackSizes: Map<string, number>,
  requiredHostCapabilities = new Set<string>(),
  compilation?: CompileScope
): HostCallRecord[] {
  validateSnapshotData(input);
  if (
    input === null ||
    typeof input !== "object" ||
    !("version" in input) ||
    input.version !== 1 ||
    !("calls" in input) ||
    !Array.isArray(input.calls)
  ) {
    throw new TypeError("Invalid host call replay header.");
  }
  const capabilities = new Map<string, SandboxClosure>();
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
          if (!Array.isArray(args)) throw new TypeError("Invalid replay callback.");
          callbackSizes.set(`${entry.id}/callback/${index + 1}`, measureSandboxData([args]));
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
      const value = decodeReplayData(entry.outcome.data, { resolveCapability }, compilation);
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
  let previousOrdinal = 0;
  for (const record of records) {
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

export function digestHostCallArguments(args: readonly unknown[]): string {
  return createHash("sha256").update(stableStringify(args)).digest("hex");
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

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(normalize(value, seen));
}

function normalize(value: unknown, seen: WeakSet<object>): unknown {
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
    if (isFloat32Array(value)) {
      const storage = float32Storage(value);
      const properties = Object.create(null) as Record<string, unknown>;
      for (const [key, descriptor] of float32DataProperties(value).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0
      )) {
        defineOwnDataProperty(properties, key, normalize(descriptor.value, seen));
      }
      return Object.assign(Object.create(null), {
        $type: "float32array",
        bytes: normalize(Array.from(new Uint8Array(storage.buffer)), seen),
        byteOffset: storage.byteOffset,
        length: storage.length,
        properties
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
        defineOwnDataProperty(normalized, key, normalize(descriptor.value, seen));
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
      defineOwnDataProperty(normalized, key, normalize(descriptor.value, seen));
    }
    return normalized;
  } finally {
    seen.delete(value);
  }
}
