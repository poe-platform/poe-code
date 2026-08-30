import type { CommandContext } from "../../contracts/command.js";
import { NodeProfileError, nodeLimits, type NodeCompletion, type NodeObservation, type NodeReason, type NodeRetirement, type NodeSession } from "./types.js";
import { integer, NodeLedger, record, text } from "./values.js";
import { NodeHost, type HostOwner } from "./host.js";

export function completion(value: unknown): NodeCompletion {
  const result = record(value, ["kind", "observation"]);
  if (!["entryReturned", "guestFailure", "profileFailure"].includes(result.kind as string)) throw new TypeError("node provider completion kind");
  const observation = record(result.observation, ["state", "fault", "name", "message", "code"]);
  if (!["captured", "unknown"].includes(observation.state as string) || typeof observation.fault !== "boolean") throw new TypeError("node provider observation");
  for (const field of ["name", "message", "code"] as const) if (observation[field] !== null) text(observation[field], nodeLimits.errorBytes, "observation");
  const empty = observation.name === null && observation.message === null && observation.code === null;
  if ((observation.state === "unknown") !== empty || result.kind === "entryReturned" && (!empty || observation.fault)) throw new TypeError("node provider contradictory observation");
  return { kind: result.kind as NodeCompletion["kind"], observation: observation as unknown as NodeObservation };
}
function retirement(value: unknown): NodeRetirement {
  const result = record(value, ["acquisition", "exitCode"]);
  if (result.acquisition === "none" && result.exitCode === null) return { acquisition: "none", exitCode: null };
  if (result.acquisition === "exited") return { acquisition: "exited", exitCode: integer(result.exitCode, 255, "Worker exit code") };
  throw new TypeError("node provider retirement is unconfirmed");
}
export class NodeOwner implements HostOwner {
  readonly ledger = new NodeLedger();
  readonly #controller = new AbortController();
  readonly #jobs = new Set<Promise<unknown>>();
  #session: NodeSession | undefined;
  #host: NodeHost | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #deadline = 0;
  #started = false;
  #closed = false;
  #cutoff = false;
  #close: Promise<void> | undefined;
  #cancelled = false;
  #primary: NodeReason | undefined;
  #primaryOrigin: "profile" | "execution" = "profile";
  #cleanup: NodeReason | undefined;
  #listening = false;
  #retired: NodeRetirement | undefined;
  #completion: NodeCompletion | undefined;
  constructor(readonly context: CommandContext) {}
  get signal(): AbortSignal { return this.#controller.signal; }
  isClosed = (): boolean => this.#closed || this.#cutoff;
  get started(): boolean { return this.#started; }
  get retiring(): boolean { return this.#closed; }
  get primary(): NodeReason | undefined { return this.#primary; }
  get primaryIsProfile(): boolean { return this.#primaryOrigin === "profile"; }
  get cleanupFailure(): NodeReason | undefined { return this.#cleanup; }
  #onAbort = (): void => { this.capture(this.context.signal.reason, "execution"); this.#abort(this.context.signal.reason); };
  open(): void {
    if (this.#closed) throw new NodeProfileError("closed before admission");
    this.context.signal.throwIfAborted();
    this.#deadline = performance.now() + nodeLimits.admissionMs;
    this.#listening = true;
    this.context.signal.addEventListener("abort", this.#onAbort, { once: true });
    this.#timer = setTimeout(() => { const reason = new NodeProfileError("admission deadline"); this.capture(reason, "profile"); this.#abort(reason); }, nodeLimits.admissionMs);
    this.context.signal.throwIfAborted();
  }
  check(): void {
    this.context.signal.throwIfAborted(); this.signal.throwIfAborted();
    if (this.#closed || this.#cutoff) throw new NodeProfileError("closed admission");
    if (performance.now() >= this.#deadline) { const reason = new NodeProfileError("admission deadline"); this.capture(reason, "profile"); this.#abort(reason); throw reason; }
  }
  cutoff = (): void => {
    const expired = !this.#cutoff && !this.#closed && this.#deadline > 0 && performance.now() >= this.#deadline;
    this.#cutoff = true;
    if (this.#timer !== undefined) { clearTimeout(this.#timer); this.#timer = undefined; }
    if (expired) {
      const reason = new NodeProfileError("admission deadline");
      this.capture(reason, "profile");
      if (!this.signal.aborted) this.#controller.abort(reason);
      this.#cancel(reason);
    }
  };
  attachHost(host: NodeHost): void { this.#host = host; }
  attachSession(value: unknown): void {
    const session = record(value, ["start", "cancel", "retire"]);
    if (typeof session.start !== "function" || typeof session.cancel !== "function" || typeof session.retire !== "function") throw new TypeError("node provider session callbacks");
    this.#session = session as unknown as NodeSession;
  }
  async start(): Promise<NodeCompletion> {
    this.check(); if (!this.#session || this.#started) throw new TypeError("node provider session start");
    this.#started = true;
    const start = this.#session.start;
    let value: unknown;
    try { value = await this.job(start); }
    catch (error) { this.failure(error, "execution"); throw error; }
    this.#completion = completion(value);
    if (this.#completion.kind === "profileFailure") this.failure(new NodeProfileError("provider-selected profile stop"), "profile");
    if (this.#retired?.acquisition === "none" && this.#completion.kind !== "profileFailure") throw new TypeError("node provider completion without acquired Worker");
    return this.#completion;
  }
  job = <Value>(start: () => Value | PromiseLike<Value>): Promise<Value> => {
    const task = Promise.resolve().then(start);
    this.#jobs.add(task);
    void task.then(() => { this.#jobs.delete(task); }, () => { this.#jobs.delete(task); });
    return task;
  };
  #cancel(reason: unknown): void {
    if (!this.#session || this.#cancelled) return;
    this.#cancelled = true;
    try { const cancel = this.#session.cancel; cancel({ present: true, value: reason }); }
    catch (error) { this.#cleanup ??= { present: true, value: error }; }
  }
  #abort(reason: unknown): void {
    this.cutoff();
    if (!this.signal.aborted) this.#controller.abort(reason);
    this.#cancel(reason);
    void this.close().catch(() => {});
  }
  failure = (reason: unknown, origin: "profile" | "execution" = "execution"): void => {
    this.capture(reason, origin);
    this.cutoff();
    if (!this.signal.aborted) this.#controller.abort(reason);
    this.#cancel(reason);
    void this.close().catch(() => {});
  };
  capture(reason: unknown, origin: "profile" | "execution"): void {
    if (!this.#primary || this.#primaryOrigin === "profile" && origin === "execution") {
      this.#primary = { present: true, value: reason };
      this.#primaryOrigin = origin;
    }
  }
  close = (): Promise<void> => {
    if (this.#close) return this.#close;
    this.#closed = true; this.cutoff();
    this.#close = Promise.resolve().then(async () => {
      if (this.#session) {
        if (this.#primary) {
          if (!this.signal.aborted) this.#controller.abort(this.#primary.value);
          this.#cancel(this.#primary.value);
        }
        try { const retire = this.#session.retire; this.#retired = retirement(await retire()); }
        catch (error) { this.#cleanup ??= { present: true, value: error }; }
      } else this.#retired = { acquisition: "none", exitCode: null };
      while (this.#jobs.size > 0) await Promise.allSettled([...this.#jobs]);
      const undelivered = this.#host?.retire();
      if (undelivered) this.capture(undelivered.value, "execution");
      this.#host = undefined; this.#session = undefined;
      if (this.#listening) { this.context.signal.removeEventListener("abort", this.#onAbort); this.#listening = false; }
      if (this.#cleanup) throw this.#cleanup.value;
      if (!this.#retired) throw new NodeProfileError("unknown retirement");
      if (this.#completion && this.#completion.kind !== "profileFailure" && this.#retired.acquisition === "none") throw new TypeError("node provider completion without acquired Worker");
    });
    return this.#close;
  };
}
