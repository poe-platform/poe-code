import { createHash, randomUUID } from "node:crypto";
import type { SandboxValue } from "./values.js";
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
};

export type HostCallResumeProof = {
  callId: string;
  sourceHash: string;
  moduleId: string;
  operation: string;
  argumentDigest: string;
  outcome: HostCallOutcome;
};

export type HostCallResumeRequest = Omit<HostCallRecord, "id" | "outcome"> & {
  callId: string;
  requirement: "external-reconciliation";
};

export type HostCallResumeProvider = (
  request: HostCallResumeRequest
) => HostCallResumeProof | Promise<HostCallResumeProof>;

export class HostCallResumabilityError extends Error {
  readonly action: "reset" | "external-reconciliation";
  readonly callId: string;
  readonly lifecycle: HostCallLifecycle;

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

export class HostCallJournal {
  readonly runId: string;
  private nextCall = 1;
  private readonly records: HostCallRecord[];
  private readonly restored: HostCallRecord[];

  constructor(
    private readonly sourceHash: string,
    records: readonly HostCallRecord[] = [],
    private readonly resumeProvider?: HostCallResumeProvider
  ) {
    this.runId = records[0]?.runId ?? randomUUID();
    this.records = records.map((record) => structuredClone(record));
    validateRestoredRecords(this.records, this.runId, sourceHash);
    this.restored = [...this.records];
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
    record.outcome = outcome;
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
    record.outcome = { status: "rejected", reason };
    record.lifecycle = "cancelled";
  }

  async reconcile(record: HostCallRecord): Promise<HostCallOutcome> {
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
    const proof = await this.resumeProvider({
      ...request,
      callId: id,
      requirement: "external-reconciliation"
    });
    validateProof(record, proof);
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
      .map((record) => structuredClone(record));
  }
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
  if (value === undefined) return { $type: "undefined" };
  if (typeof value === "number" && !Number.isFinite(value))
    return { $type: "number", value: String(value) };
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new TypeError("Host call arguments cannot contain cycles.");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => normalize(entry, seen));
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((key) => [key, normalize((value as Record<string, unknown>)[key], seen)])
    );
  } finally {
    seen.delete(value);
  }
}
