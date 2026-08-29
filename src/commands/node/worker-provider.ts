import { Worker } from "node:worker_threads";
import { types } from "node:util";
import { acquire, channel, decodeMetadata, encodeMetadata, phases, publish, stop, type NodeChannel, type NodeFrame } from "./channel.js";
import { readNodeHostRequest } from "./host.js";
import { completion } from "./lifecycle.js";
import { observeNodeFailure } from "./diagnostics.js";
import { integer, record, text } from "./values.js";
import { NODE_PROFILE, NodeProfileError, nodeLimits, type NodeCompletion, type NodeHostRequest, type NodeHostResponse, type NodeHostServices, type NodeReason, type NodeRetirement, type NodeRuntimeProvider, type NodeSession, type NodeSourceRequest } from "./types.js";
import type { NodeWorkerEvent, NodeWorkerProviderOptions } from "./worker-types.js";

const empty = new Uint8Array(0);
class WorkerSession {
  #worker: Worker | undefined;
  #channel: NodeChannel | undefined;
  #started = false;
  #acquisitionAttempted = false;
  #closed = false;
  #exitCode: number | undefined;
  #terminal: NodeCompletion | undefined;
  #primary: NodeReason | undefined;
  #escaping: NodeReason | undefined;
  #cleanup: NodeReason | undefined;
  #resolve!: (value: NodeCompletion) => void;
  #reject!: (reason: unknown) => void;
  #exit!: () => void;
  #exited: Promise<void> | undefined;
  #chain = Promise.resolve();
  #retiring: Promise<NodeRetirement> | undefined;
  #termination: Promise<number> | undefined;
  #nativeJobs: Promise<void>[] = [];
  #nativeBytes = 0;
  #baseRelease: (() => void) | undefined;
  #credits: (() => void)[] = [];
  #incoming: { request: NodeHostRequest; total: number; offset: number; bytes: Uint8Array } | undefined;
  #result: NodeHostResponse | undefined;
  #outgoing: Uint8Array | undefined;
  #copied = 0;
  #sequence = 0;
  #delivered = 0;
  #frame = 0;
  #entries = 0;
  #attempts = 0;
  constructor(readonly request: NodeSourceRequest, readonly services: NodeHostServices, readonly entry: string, readonly identity: string, readonly observer: NodeWorkerProviderOptions["observe"]) {}
  #event(kind: NodeWorkerEvent["kind"], sequence: number | null = null, exitCode: number | null = null): Promise<void> {
    if (!this.observer) return Promise.resolve();
    const event = Object.freeze({ kind, sequence, exitCode });
    const job = this.services.job(() => this.observer!(event));
    void job.catch(error => { this.#failure(error); });
    return job;
  }
  #failure = (reason: unknown): void => {
    this.#escaping ??= { present: true, value: reason };
    this.#reject?.(this.#escaping.value);
    this.services.fail(this.#escaping);
    this.cancel(this.#escaping);
  };
  #protocolFailure = (reason: unknown): void => { this.#resolve?.({ kind: "profileFailure", observation: observeNodeFailure(reason) }); this.services.stopProfile({ present: true, value: reason }); this.cancel({ present: true, value: reason }); };
  #abort = (): void => this.cancel({ present: true, value: this.services.signal.reason });
  #drain(stream: NonNullable<Worker["stdout"]>): void {
    let finish!: () => void;
    let ended = false;
    const job = new Promise<void>(resolve => { finish = resolve; });
    this.#nativeJobs.push(job);
    stream.once("end", () => { ended = true; finish(); });
    stream.once("close", () => {
      if (!ended) this.#cleanup ??= { present: true, value: new Error("node Worker diagnostic channel closed before EOF") };
      finish();
    });
    stream.once("error", reason => { this.#cleanup ??= { present: true, value: reason }; stream.destroy(); });
    stream.on("data", (value: unknown) => {
      if (types.isProxy(value) || !types.isUint8Array(value)) { this.#protocolFailure(new NodeProfileError("native diagnostic chunk")); return; }
      this.#nativeBytes += value.byteLength;
      if (this.#nativeBytes > nodeLimits.diagnosticReserve) this.#protocolFailure(new NodeProfileError("native diagnostic bytes"));
    });
  }
  #finish(result: NodeCompletion): void {
    void Promise.resolve().then(this.retire).then(
      () => this.#resolve(result),
      () => this.#resolve({ kind: "profileFailure", observation: { state: "unknown", fault: true, name: null, message: null, code: null } }),
    );
  }
  #reply(input: NodeFrame, phase: number, total = 0, offset = 0, bytes: Uint8Array = empty): void { publish(this.#channel!, 2, { frame: input.frame, sequence: input.sequence, phase, total, offset, bytes }); }
  #reserve(label: string, bytes: number): void { if (bytes > nodeLimits.memoryBytes) throw new NodeProfileError("transport reservation"); this.#credits.push(this.services.reserve(label + "-" + this.#sequence, bytes)); }
  async #request(input: NodeFrame): Promise<void> {
    if (input.phase === phases.metadata) {
      if (this.#incoming || this.#result || this.#sequence !== this.#delivered || input.sequence !== this.#sequence + 1 || input.offset !== 0 || input.total !== 0) throw new NodeProfileError("request frame order");
      const data = record(decodeMetadata(input.bytes), ["sequence", "op", "authority", "path", "flag", "moduleKey", "hasText", "total"]);
      if (typeof data.hasText !== "boolean") throw new TypeError("wire body presence");
      const total = integer(data.total, nodeLimits.operationBytes, "upload bytes");
      if (!data.hasText && total !== 0) throw new TypeError("null body bytes");
      const request = readNodeHostRequest({ sequence: data.sequence, op: data.op, authority: data.authority, path: data.path, flag: data.flag, moduleKey: data.moduleKey, text: data.hasText ? "" : null });
      if (request.sequence !== input.sequence) throw new NodeProfileError("wire sequence");
      this.#sequence = input.sequence;
      this.#reserve("upload", 65536 + total * 16);
      this.#incoming = { request, total, offset: 0, bytes: new Uint8Array(total) };
      if (total > 0) { this.#reply(input, phases.uploadCredit, total); return; }
      await this.#perform(input); return;
    }
    if (input.sequence !== this.#sequence) throw new NodeProfileError("frame sequence");
    if (input.phase === phases.upload) {
      const incoming = this.#incoming;
      if (!incoming || this.#result || input.total !== incoming.total || input.offset !== incoming.offset || input.bytes.length !== Math.min(65536, incoming.total - incoming.offset) || input.bytes.length === 0) throw new NodeProfileError("upload frame");
      incoming.bytes.set(input.bytes, incoming.offset); incoming.offset += input.bytes.length;
      if (incoming.offset < incoming.total) { this.#reply(input, phases.uploadCredit, incoming.total, incoming.offset); return; }
      await this.#perform(input); return;
    }
    if (input.phase === phases.dataCredit) {
      if (!this.#outgoing || !this.#result || input.bytes.length !== 0 || input.total !== this.#outgoing.length || input.offset !== this.#copied || this.#copied >= this.#outgoing.length) throw new NodeProfileError("result credit");
      const offset = this.#copied; const end = Math.min(offset + 65536, this.#outgoing.length); this.#copied = end;
      this.#reply(input, phases.data, this.#outgoing.length, offset, this.#outgoing.subarray(offset, end)); return;
    }
    if (input.phase === phases.final) {
      if (!this.#result || !this.#outgoing || input.bytes.length !== 0 || input.total !== this.#outgoing.length || input.offset !== this.#copied || this.#copied !== this.#outgoing.length) throw new NodeProfileError("final acknowledgement");
      this.#outgoing = undefined;
      this.#reply(input, phases.final); return;
    }
    throw new NodeProfileError("unexpected frame phase");
  }
  async #perform(input: NodeFrame): Promise<void> {
    const incoming = this.#incoming!;
    const body = incoming.request.text === null ? null : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(incoming.bytes);
    const request = { ...incoming.request, text: body };
    this.#event("request", request.sequence);
    this.#result = await this.services.request(request);
    this.#incoming = undefined;
    const total = this.#result.text === null ? 0 : Buffer.byteLength(this.#result.text);
    this.#reserve("response", 65536 + total * 16);
    this.#outgoing = this.#result.text === null ? empty : new TextEncoder().encode(this.#result.text);
    this.#copied = 0;
    const metadata = encodeMetadata({ sequence: this.#sequence, kind: this.#result.kind, error: this.#result.error, cacheKey: this.#result.cacheKey, total });
    this.#reply(input, phases.result, total, 0, metadata);
  }
  async #message(value: unknown): Promise<void> {
    const item = record(value, ["kind"], ["frame", "sequence", "completion", "observation"]);
    if (item.kind === "entryReturn") {
      if (Object.keys(item).length !== 1 || this.#terminal || this.#entries !== 1 || this.#incoming || this.#result || this.#sequence !== this.#delivered) throw new NodeProfileError("entry-return cutoff ordering");
      this.#terminal = { kind: "entryReturned", observation: { state: "unknown", fault: false, name: null, message: null, code: null } };
      this.services.cutoff(); this.#closed = true; this.#event("entryReturn"); this.#event("terminal"); this.#finish(this.#terminal); return;
    }
    if (item.kind === "observation") {
      if (Object.keys(item).length !== 2) throw new TypeError("observation message shape");
      completion({ kind: "guestFailure", observation: item.observation }); return;
    }
    if (item.kind === "frame") {
      if (Object.keys(item).length !== 3 || this.#closed) throw new NodeProfileError("closed or malformed doorbell");
      const frame = integer(item.frame, nodeLimits.frames, "doorbell frame"); const sequence = integer(item.sequence, nodeLimits.operations, "doorbell sequence");
      if (frame !== this.#frame + 1) throw new NodeProfileError("doorbell ordering");
      this.#frame = frame; await this.#request(acquire(this.#channel!, 1, frame, sequence)); return;
    }
    if (item.kind === "delivered") {
      if (Object.keys(item).length !== 2 || !this.#result || this.#outgoing || item.sequence !== this.#sequence || this.#delivered + 1 !== this.#sequence) throw new NodeProfileError("postcopy ordering");
      this.services.delivered(this.#sequence); this.#delivered = this.#sequence; this.#result = undefined;
      for (const release of this.#credits.splice(0)) release(); this.#event("delivered", this.#sequence); return;
    }
    if (item.kind === "engineAttempt" || item.kind === "engineLimit" || item.kind === "guestEntry" || item.kind === "diagnosticFault") {
      if (Object.keys(item).length !== 1) throw new TypeError("Worker event shape");
      if (item.kind === "engineAttempt" && ++this.#attempts !== 1 || item.kind === "guestEntry" && (++this.#entries !== 1 || this.#attempts !== 1)) throw new NodeProfileError("Worker entry ordering");
      this.#event(item.kind); return;
    }
    if (item.kind === "terminal") {
      if (Object.keys(item).length !== 2 || this.#terminal) throw new NodeProfileError("duplicate terminal");
      const result = completion(item.completion);
      if (result.kind === "entryReturned" && (this.#entries !== 1 || this.#incoming || this.#result || this.#sequence !== this.#delivered)) throw new NodeProfileError("terminal contradicts pending work/entry");
      this.#terminal = result; this.services.cutoff(); this.#closed = true; this.#event("terminal");
      if (result.kind === "profileFailure") this.services.stopProfile({ present: true, value: new NodeProfileError("Worker-selected profile stop") });
      this.#finish(result); return;
    }
    throw new NodeProfileError("unrecognized Worker message");
  }
  start = (): Promise<NodeCompletion> => {
    if (this.#started || this.#closed) return Promise.reject(new NodeProfileError("Worker start state"));
    this.#started = true;
    const result = new Promise<NodeCompletion>((resolve, reject) => { this.#resolve = resolve; this.#reject = reject; });
    try {
      this.services.signal.throwIfAborted();
      const contextBytes = Buffer.byteLength(JSON.stringify({ cwd: this.request.cwd, filename: this.request.filename, argv: this.request.argv, env: this.request.env }));
      this.#baseRelease = this.services.reserve("worker-static", nodeLimits.sabBytes + 65536 + 2 * (Buffer.byteLength(this.request.program) + Buffer.byteLength(this.request.source) + contextBytes));
      const sab = new SharedArrayBuffer(nodeLimits.sabBytes); this.#channel = channel(sab);
      this.#exited = new Promise<void>(resolve => { this.#exit = resolve; });
      this.#acquisitionAttempted = true;
      try { this.#worker = new Worker(new URL("./worker-main.js", import.meta.url), { workerData: { request: this.request, entry: this.entry, identity: this.identity, sab }, env: {}, argv: [], stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: nodeLimits.oldGenerationMiB, maxYoungGenerationSizeMb: nodeLimits.youngGenerationMiB, codeRangeSizeMb: nodeLimits.codeMiB, stackSizeMb: nodeLimits.stackMiB } }); }
      catch (error) { this.#failure(error); return result; }
      this.#worker.once("error", this.#failure);
      this.#worker.once("exit", code => { this.#exitCode = code; this.#exit(); try { this.#event("workerExit", null, code); } catch (error) { this.#failure(error); } void this.#chain.then(() => { if (!this.#terminal && !this.#primary) this.#failure(new NodeProfileError("Worker exited without terminal")); }); });
      this.#worker.on("message", value => { this.#chain = this.#chain.then(() => this.#message(value)).catch(error => { this.#protocolFailure(error); }); });
      this.#drain(this.#worker.stdout); this.#drain(this.#worker.stderr);
      this.services.signal.addEventListener("abort", this.#abort, { once: true });
      void this.#event("workerCreated").then(() => {
        try { this.services.signal.throwIfAborted(); if (!this.#closed) this.#worker!.postMessage({ kind: "start" }); }
        catch (error) { this.#protocolFailure(error); }
      }, () => {});
    } catch (error) { this.#protocolFailure(error); }
    return result;
  };
  cancel = (reason: NodeReason): void => {
    this.#primary ??= reason;
    this.#closed = true;
    if (this.#channel) stop(this.#channel);
    this.#resolve?.({ kind: "profileFailure", observation: { state: "unknown", fault: false, name: null, message: null, code: null } });
    if (this.#worker && this.#exitCode === undefined && !this.#termination) {
      try { this.#termination = this.#worker.terminate(); void this.#termination.catch(error => { this.#cleanup ??= { present: true, value: error }; }); }
      catch (error) { this.#cleanup ??= { present: true, value: error }; }
    }
  };
  retire = (): Promise<NodeRetirement> => {
    if (this.#retiring) return this.#retiring;
    this.#closed = true;
    this.#retiring = Promise.resolve().then(async () => {
      if (this.#channel) stop(this.#channel);
      if (this.#worker && this.#exitCode === undefined && !this.#termination) {
        try { this.#termination = this.#worker.terminate(); } catch (error) { this.#cleanup ??= { present: true, value: error }; }
      }
      if (this.#worker) await this.#exited;
      await Promise.all(this.#nativeJobs);
      if (this.#termination) try { await this.#termination; } catch (error) { this.#cleanup ??= { present: true, value: error }; }
      await this.#chain;
      if (this.#acquisitionAttempted && this.#exitCode === undefined) throw new NodeProfileError("Worker acquisition/exit unconfirmed");
      if (this.#cleanup) throw this.#cleanup.value;
      this.services.signal.removeEventListener("abort", this.#abort);
      this.#incoming = undefined; this.#result = undefined; this.#outgoing = undefined; this.#channel = undefined; this.#worker = undefined;
      this.#nativeJobs = [];
      for (const release of this.#credits.splice(0)) release(); this.#baseRelease?.(); this.#baseRelease = undefined;
      const retirement: NodeRetirement = this.#exitCode === undefined ? { acquisition: "none", exitCode: null } : { acquisition: "exited", exitCode: this.#exitCode };
      await this.#event("retired", null, retirement.exitCode);
      return retirement;
    });
    return this.#retiring;
  };
}
export function createNodeWorkerProvider(options: NodeWorkerProviderOptions): NodeRuntimeProvider {
  const fields = record(options, ["entry", "identity"], ["observe"]);
  const entry = text(fields.entry, nodeLimits.metadataBytes, "trusted adapter URL"); const identity = text(fields.identity, nodeLimits.metadataBytes, "trusted adapter identity");
  const parsed = new URL(entry); if (parsed.protocol !== "file:" || parsed.search || parsed.hash || parsed.href !== entry || identity.length === 0 || Object.hasOwn(fields, "observe") && typeof fields.observe !== "function") throw new TypeError("explicit trusted engine adapter");
  const observe = fields.observe as NodeWorkerProviderOptions["observe"];
  return Object.freeze({ profile: NODE_PROFILE, identity, prepare: (request: NodeSourceRequest, services: NodeHostServices): NodeSession => { const owner = new WorkerSession(request, services, entry, identity, observe); return Object.freeze({ start: owner.start, cancel: owner.cancel, retire: owner.retire }); } });
}
