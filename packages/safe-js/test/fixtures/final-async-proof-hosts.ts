import {
  declareHostOperation,
  deepCopyFromSandbox,
  deepCopyToSandbox,
  type HostCallRecord,
  type HostCallResumeProvider,
  type HostCallResumeProof,
  type HostCallResumeRequest,
  type run
} from "@poe-code/safe-js";
import { bounded, deferred } from "./final-async-proof.js";
import { lifecycleCases, promiseProfiles } from "./final-async-proof-cases.js";

export type LifecycleCase = (typeof lifecycleCases)[number];
export type CompletionReceipt = {
  record: HostCallRecord;
  status: "fulfilled" | "rejected";
  value: unknown;
};

export function completionReceipts(result: Awaited<ReturnType<typeof run>>): CompletionReceipt[] {
  return (result.snapshot.hostCalls ?? []).flatMap((record) => {
    if (!record.outcome || record.operation === "visit" || record.operation === "host") return [];
    const outcome = record.outcome;
    return [
      {
        record: { ...record, outcome: undefined },
        status: outcome.status,
        value: deepCopyFromSandbox(outcome.status === "fulfilled" ? outcome.value : outcome.reason)
      }
    ];
  });
}

export function graph(value: unknown): unknown {
  const seen = new Map<object, number>();
  const nodes: unknown[] = [];
  function visit(item: unknown): unknown {
    if (item === undefined) return { tag: "undefined" };
    if (typeof item === "number" && !Number.isFinite(item))
      return { tag: "number", value: String(item) };
    if (typeof item === "number" && Object.is(item, -0)) return { tag: "number", value: "-0" };
    if (typeof item === "bigint") return { tag: "bigint", value: String(item) };
    if (item === null || (typeof item !== "object" && typeof item !== "function")) return item;
    const existing = seen.get(item);
    if (existing !== undefined) return { ref: existing };
    const identity = nodes.length;
    seen.set(item, identity);
    const properties: unknown[] = [];
    const node = {
      kind: typeof item === "function" ? "function" : Array.isArray(item) ? "array" : "object",
      properties
    };
    nodes.push(node);
    if (typeof item !== "function") {
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
        if (!("value" in descriptor)) throw new TypeError("Fixture graph contains an accessor");
        node.properties.push({
          key,
          value: visit(descriptor.value),
          enumerable: descriptor.enumerable,
          writable: descriptor.writable,
          configurable: descriptor.configurable
        });
      }
    }
    return { ref: identity };
  }
  const root = visit(value);
  return { root, nodes };
}

export class LifecycleRig {
  readonly calls: unknown[] = [];
  readonly events: unknown[] = [];
  readonly hostTrace: unknown[] = [];
  readonly proofReturns: HostCallResumeProof[] = [];
  readonly providerRequests: HostCallResumeRequest[] = [];
  readonly gates = new Map<string, ReturnType<typeof deferred<unknown>>>();
  readonly inputs = { left: deferred<unknown>(), right: deferred<unknown>() };
  readonly profile;
  readonly entryPointArgs: readonly unknown[] | undefined;
  readonly bindings;

  constructor(
    readonly selected: LifecycleCase,
    readonly phase: "capture" | "resume",
    readonly stopAt?: string
  ) {
    this.profile = promiseProfiles.find((profile) => profile.id === selected.inputProfile);
    if (this.profile) {
      const left = this.inputs.left.promise;
      const right = this.inputs.right.promise;
      this.entryPointArgs = [
        {
          ...structuredClone(this.profile.fixtureData),
          primary: left,
          again: left,
          nested: { promise: left },
          remote: right,
          remoteAgain: right
        }
      ];
      if (phase === "capture" && selected.inputProfile === "prefulfilled") {
        this.releaseInput("left");
        this.releaseInput("right");
      }
    }
    const policy = selected.proofDelivery === "reissue" ? "re-issue" : "read-side-effect";
    this.bindings = {
      payload: {
        jobs: [
          { id: "a", value: 2 },
          { id: "b", value: 3 },
          { id: "c", value: 5 }
        ],
        started: 0,
        completed: 0
      },
      checkpoint: declareHostOperation(async (label: string) => {
        this.calls.push(["checkpoint", label]);
      }, "re-issue"),
      lookup: declareHostOperation(async (value: number) => {
        this.calls.push(["lookup", value]);
        return value === 3 && phase === "capture" ? this.hold("lookup:3") : value * 10;
      }, "re-issue"),
      visit: declareHostOperation(
        async (
          items: readonly number[],
          callback: (item: number, index: number) => Promise<unknown>
        ) => {
          this.calls.push(["visit", [...items]]);
          const values: unknown[] = [];
          for (let index = 0; index < items.length; index++) {
            this.events.push({ phase: "host-callback-invocation", item: items[index], index });
            const value = await callback(items[index], index);
            this.events.push({
              phase: "host-callback-return",
              item: items[index],
              index,
              graph: graph(value)
            });
            values.push(value);
          }
          return values;
        },
        "read-side-effect"
      ),
      operation: declareHostOperation(async (job: string, attempt: number, value: number) => {
        this.calls.push(["operation", job, attempt, value]);
        if (job === "b" && attempt === 1) throw new Error("transient:b");
        if ((job === "c" && attempt === 1) || (job === "b" && attempt === 2))
          return this.hold("operation:" + job + ":" + attempt);
        return value * 10 + attempt;
      }, policy),
      boundary: declareHostOperation(async (label: string) => {
        this.calls.push(label);
        this.hostTrace.push(["call", "boundary", label]);
        if (phase === "capture" || stopAt === label) return this.hold("boundary:" + label);
        this.hostTrace.push(["ack", "boundary", label]);
        return { boundary: label };
      }, "re-issue")
    };
  }

  hold(label: string): Promise<unknown> {
    if (this.gates.has(label)) throw new Error("Duplicate gate: " + label);
    const gate = deferred<unknown>();
    this.gates.set(label, gate);
    return gate.promise;
  }

  release(label: string, value: unknown): void {
    const gate = this.gates.get(label);
    if (!gate) throw new Error("Missing gate: " + label);
    this.gates.delete(label);
    this.events.push({ phase: "release", label, graph: graph(value) });
    gate.release(value);
  }

  async wait(label: string): Promise<void> {
    for (let turn = 0; turn < 8192; turn++) {
      if (this.gates.has(label)) return;
      await Promise.resolve();
    }
    throw new Error("Finite notification budget exhausted: " + label);
  }

  releaseInput(key: "left" | "right"): void {
    if (!this.profile) throw new Error("Missing scan profile");
    this.hostTrace.push(["ack", "input", key, "fulfilled"]);
    this.inputs[key].release(structuredClone(this.profile.receipts[key].value));
  }

  async boundary(label: string): Promise<void> {
    await this.wait("boundary:" + label);
    this.hostTrace.push(["ack", "boundary", label]);
    this.release("boundary:" + label, { boundary: label });
  }

  async reachCapture(): Promise<void> {
    if (this.selected.sourceKey === "retry") {
      await this.wait("operation:c:1");
      await this.wait("operation:b:2");
    } else if (this.selected.sourceKey !== "scan") await this.wait("lookup:3");
    else {
      await this.wait("boundary:both-pending");
      if (this.selected.captureBoundary === "after:left") {
        await this.boundary("both-pending");
        if (this.selected.inputProfile === "pending") this.releaseInput("left");
        await this.wait("boundary:after:left");
      }
    }
    this.events.push({
      phase: "capture-ready",
      calls: structuredClone(this.calls),
      pending: [...this.gates.keys()]
    });
  }

  async finishOriginal(): Promise<void> {
    if (this.selected.sourceKey === "retry") {
      this.release("operation:b:2", 32);
      for (let turn = 0; turn < 32; turn++) await Promise.resolve();
      this.release("operation:c:1", 51);
    } else if (this.selected.sourceKey !== "scan") this.release("lookup:3", 30);
    else {
      if (this.selected.captureBoundary === "both-pending") {
        await this.boundary("both-pending");
        if (this.selected.inputProfile === "pending") this.releaseInput("left");
      }
      await this.boundary("after:left");
      if (this.selected.inputProfile === "pending") this.releaseInput("right");
      await this.boundary("after:right");
    }
  }

  async driveRetryResume(): Promise<void> {
    if (this.selected.sourceKey !== "retry") return;
    const prefix = this.selected.proofDelivery === "reissue" ? "operation:" : "proof:";
    const first = prefix + (prefix === "operation:" ? "b:2" : "32");
    const second = prefix + (prefix === "operation:" ? "c:1" : "51");
    await this.wait(first);
    await this.wait(second);
    this.release(first, 32);
    for (let turn = 0; turn < 32; turn++) await Promise.resolve();
    this.release(second, 51);
  }

  provider(
    capture: { hostCalls?: readonly HostCallRecord[] },
    receipts: readonly CompletionReceipt[]
  ): HostCallResumeProvider | undefined {
    if (this.selected.proofDelivery === "missing") return undefined;
    return async (request, context) => {
      const matches = (record: HostCallRecord) =>
        record.id === request.callId &&
        record.sourceHash === request.sourceHash &&
        record.moduleId === request.moduleId &&
        record.operation === request.operation &&
        record.argumentDigest === request.argumentDigest;
      if (!capture.hostCalls?.some(matches))
        throw new Error("Provider request has no matching captured identity");
      this.providerRequests.push(structuredClone(request));
      this.events.push({
        phase: "provider-invoked",
        request: structuredClone(request),
        callbacks: context ? [...context.callbacks.keys()] : []
      });
      let value: unknown;
      let status: "fulfilled" | "rejected" = "fulfilled";
      if (request.operation === "visit") {
        if (!context || context.replayed.length !== request.callbacks?.length)
          throw new Error("Reconstructed invocation count mismatch");
        const values: unknown[] = [];
        for (let index = 0; index < context.replayed.length; index++) {
          const invocation = context.replayed[index];
          if (invocation.callbackId !== request.callbacks[index].id)
            throw new Error("Callback order mismatch");
          const result = await bounded(invocation.result, "reconstructed callback");
          this.events.push({
            phase: "replayed-result",
            callbackId: invocation.callbackId,
            invocationIndex: index,
            graph: graph(result)
          });
          values.push(result);
        }
        await context.waitForCallbacks();
        value = values;
      } else {
        const receipt = receipts.find((entry) => matches(entry.record));
        if (!receipt) throw new Error("No actual completed original receipt for requested call");
        value = structuredClone(receipt.value);
        status = receipt.status;
        if (this.selected.proofDelivery === "host-released-after-request") {
          this.events.push({ phase: "proof-held", callId: request.callId, turns: 32 });
          for (let turn = 0; turn < 32; turn++) await Promise.resolve();
          this.events.push({ phase: "proof-released", callId: request.callId });
        }
        if (this.selected.sourceKey === "retry") value = await this.hold("proof:" + String(value));
      }
      this.events.push({
        phase: "proof-candidate",
        request: structuredClone(request),
        graph: graph(value)
      });
      const proof: HostCallResumeProof = {
        callId: request.callId,
        sourceHash: request.sourceHash,
        moduleId: request.moduleId,
        operation: request.operation,
        argumentDigest: request.argumentDigest,
        ...(request.operation === "visit" ? { callbackDisposition: "joined" } : {}),
        outcome:
          status === "fulfilled"
            ? { status, value: context ? context.toSandboxValue(value) : deepCopyToSandbox(value) }
            : { status, reason: context ? context.toSandboxValue(value) : deepCopyToSandbox(value) }
      };
      this.proofReturns.push(proof);
      this.events.push({
        phase: "proof-returned",
        callId: request.callId,
        status,
        graph: graph(value)
      });
      return proof;
    };
  }

  cleanup(): void {
    for (const [label, gate] of this.gates) {
      this.events.push({ phase: "cleanup-only", label });
      gate.release(undefined);
    }
    this.gates.clear();
    this.inputs.left.release(undefined);
    this.inputs.right.release(undefined);
  }
}
