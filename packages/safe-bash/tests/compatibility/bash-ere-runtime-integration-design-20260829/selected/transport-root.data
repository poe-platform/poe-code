import { EreProfileLimitError } from "../errors.js";
import type { EreExpansionBounds, EreLimits, EreUsage } from "../types.js";
import { EngineAccounting, StorageReservation, TransportAccounting, multiply } from "./accounting.js";
import { EreWorkerOwner } from "./owner.js";
import { EreTransportError, EreTransportProfileLimitError, EreTransportSemanticError, operation, profile } from "./protocol.js";
import type { EreCleanupRegistration, EreTransportInput, EreTransportRequest, EreTransportResult, EreTransportSession } from "./protocol.js";
import { copyInput, copyReplyResult, inspectInput, validateReply } from "./validation.js";

interface Ticket {
  readonly session: number;
  readonly id: number;
  readonly input: EreTransportInput;
  readonly patternBytes: number;
  readonly requestUnits: number;
  readonly storage: StorageReservation;
  readonly metadata: StorageReservation;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (result: EreTransportResult) => void;
  readonly reject: (reason: unknown) => void;
  readonly done: Promise<void>;
  readonly finish: () => void;
  cancelled: boolean;
}

export class EreTransportRoot {
  readonly #bounds: EreExpansionBounds;
  readonly #engine: EngineAccounting;
  readonly #transport: TransportAccounting;
  readonly #metadata: StorageReservation;
  #workerMetadata: StorageReservation | undefined;
  #worker: EreWorkerOwner | undefined;
  #queue: Ticket[] = [];
  #active: Ticket | undefined;
  #closed = false;
  #failurePresent = false;
  #failure: unknown;
  #closing: Promise<void> | undefined;
  #nextId = 0;
  #nextSession = 0;
  #sessions = new Map<number, StorageReservation>();

  constructor(bounds: EreExpansionBounds, registerCleanup: EreCleanupRegistration) {
    this.#engine = new EngineAccounting(bounds);
    this.#transport = new TransportAccounting(this.#engine.limits);
    this.#metadata = this.#transport.metadata(18);
    this.#bounds = Object.freeze({ maxExpansionBytes: bounds.maxExpansionBytes, maxExpansionFields: bounds.maxExpansionFields });
    try { registerCleanup(() => this.close()); }
    catch (reason) { this.#closed = true; this.#metadata.retire(); throw reason; }
  }

  get usage(): Readonly<{ engine: EreUsage; transport: TransportAccounting["usage"] }> {
    return Object.freeze({ engine: this.#engine.usage, transport: this.#transport.usage });
  }

  openSession(registerCleanup: EreCleanupRegistration): EreTransportSession {
    this.#assertOpen();
    if (this.#nextSession === Number.MAX_SAFE_INTEGER) throw new EreTransportError("CLOSED", "ERE session identity exhausted");
    const metadata = this.#transport.metadata(5);
    const id = ++this.#nextSession;
    let closed = false; let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (closing) return closing;
      closed = true;
      closing = this.#closeSession(id).finally(() => { this.#sessions.delete(id); metadata.retire(); });
      return closing;
    };
    try { registerCleanup(close); }
    catch (reason) { closed = true; metadata.retire(); throw reason; }
    this.#sessions.set(id, metadata);
    return Object.freeze({
      execute: (input: EreTransportInput, signal?: AbortSignal) => closed ? Promise.reject(new EreTransportError("CLOSED", "ERE session closed")) : this.#submit(id, input, signal),
      close,
    });
  }

  #assertOpen(): void {
    if (this.#failurePresent) throw this.#failure;
    if (this.#closed) throw new EreTransportError("CLOSED", "ERE invocation root closed");
  }

  async #submit(session: number, input: EreTransportInput, signal?: AbortSignal): Promise<EreTransportResult> {
    if (signal?.aborted) throw signal.reason;
    this.#assertOpen();
    if (this.#queue.length >= 64) throw new EreTransportProfileLimitError("queueTickets", 64);
    if (this.#nextId === Number.MAX_SAFE_INTEGER) throw new EreTransportError("CLOSED", "ERE job identity exhausted");
    const inspected = inspectInput(input, this.#engine.limits, this.#transport, signal);
    const metadata = this.#transport.metadata(13);
    let storage: StorageReservation;
    try { storage = this.#transport.reserve(multiply(inspected.units, 2)); }
    catch (reason) { metadata.retire(); throw reason; }
    let owned: EreTransportInput;
    try { storage.consume(inspected.units); owned = copyInput(inspected, this.#transport); }
    catch (reason) { storage.releaseUnused(); storage.retire(); metadata.retire(); throw reason; }
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    return new Promise<EreTransportResult>((resolve, reject) => {
      const ticket: Ticket = { session, id: ++this.#nextId, input: owned, patternBytes: inspected.patternBytes, requestUnits: inspected.units, storage, metadata, signal, resolve, reject, done, finish, cancelled: false };
      this.#queue.push(ticket);
      this.#pump();
    });
  }

  #pump(): void {
    if (this.#active || this.#closed || this.#failurePresent) return;
    const ticket = this.#queue.shift();
    if (!ticket) return;
    this.#active = ticket;
    const complete = (outcome: { ok: true; value: EreTransportResult } | { ok: false; reason: unknown }): void => {
      try { ticket.storage.releaseUnused(); ticket.storage.retire(); ticket.metadata.retire(); }
      catch (reason) { this.#fail(reason); if (outcome.ok) outcome = { ok: false, reason }; }
      this.#active = undefined; ticket.finish();
      if (outcome.ok) ticket.resolve(outcome.value); else ticket.reject(outcome.reason);
      this.#pump();
    };
    void this.#execute(ticket).then(value => complete({ ok: true, value }), reason => complete({ ok: false, reason })).catch(reason => this.#fail(reason));
  }

  async #execute(ticket: Ticket): Promise<EreTransportResult> {
    let replyStorage: StorageReservation | undefined;
    let grant: EreLimits | undefined;
    let sent = false;
    let reconciled = false;
    try {
      if (ticket.signal?.aborted) throw ticket.signal.reason;
      if (ticket.cancelled) throw new EreTransportError("CLOSED", "ERE job cancelled");
      replyStorage = this.#transport.reserve(479);
      if (!this.#worker) {
        this.#workerMetadata = this.#transport.metadata(21);
        this.#worker = new EreWorkerOwner(reason => this.#fail(reason), units => this.#transport.visit(units));
      }
      await this.#worker.start();
      if (ticket.signal?.aborted) throw ticket.signal.reason;
      if (ticket.cancelled) throw new EreTransportError("CLOSED", "ERE job cancelled");
      grant = this.#engine.reserve(ticket.patternBytes, ticket.input.subject.length);
      const request: EreTransportRequest = { version: 1, operation, id: ticket.id, grantId: ticket.id, profile, bounds: this.#bounds, allowance: grant, pattern: ticket.input.pattern, subject: ticket.input.subject };
      this.#transport.visit(ticket.requestUnits);
      const message = await this.#worker.request(request, () => { ticket.storage.consume(ticket.requestUnits); sent = true; });
      const validated = validateReply(message, request, units => this.#transport.visit(units));
      this.#engine.commit(grant, validated.reply.usage); reconciled = true;
      replyStorage.settle(2 * validated.replyUnits + validated.resultUnits);
      if (ticket.signal?.aborted) throw ticket.signal.reason;
      if (ticket.cancelled || this.#closed) throw new EreTransportError("CLOSED", "ERE job cancelled");
      const reply = validated.reply;
      if (reply.kind === "failure") {
        if (reply.category === "profile-limit") throw new EreProfileLimitError(reply.resource!, grant[reply.resource!]);
        throw new EreTransportSemanticError(reply.category, reply.offset);
      }
      this.#transport.visit(validated.resultUnits);
      return copyReplyResult(reply);
    } catch (reason) {
      if (grant && !reconciled) {
        this.#engine.abandon(grant, sent);
        if (sent) { replyStorage?.unknown(); this.#fail(reason); }
      }
      if (this.#failurePresent) {
        try { await this.#worker?.close(); }
        catch (cleanupReason) { if (!this.#closing) this.#closing = Promise.reject(cleanupReason); this.#closing.catch(() => {}); }
      }
      if (ticket.signal?.aborted) throw ticket.signal.reason;
      throw reason;
    } finally { replyStorage?.releaseUnused(); replyStorage?.retire(); }
  }

  #fail(reason: unknown): void {
    if (!this.#failurePresent) { this.#failurePresent = true; this.#failure = reason; }
    this.#rejectQueued();
  }

  #rejectQueued(session?: number): void {
    for (let index = this.#queue.length - 1; index >= 0; index--) {
      const ticket = this.#queue[index]!;
      if (session !== undefined && ticket.session !== session) continue;
      this.#queue.splice(index, 1);
      ticket.storage.releaseUnused(); ticket.storage.retire(); ticket.metadata.retire();
      ticket.reject(ticket.signal?.aborted ? ticket.signal.reason : this.#failurePresent ? this.#failure : new EreTransportError("CLOSED", "ERE queued job closed"));
      ticket.finish();
    }
  }

  async #closeSession(id: number): Promise<void> {
    this.#rejectQueued(id);
    if (this.#active?.session === id) { this.#active.cancelled = true; await this.#active.done; }
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#rejectQueued();
    if (this.#active) this.#active.cancelled = true;
    this.#closing = Promise.resolve().then(async () => {
      await this.#active?.done;
      await this.#worker?.close();
      this.#workerMetadata?.retire();
      for (const metadata of this.#sessions.values()) metadata.retire();
      this.#sessions.clear(); this.#metadata.retire();
    });
    return this.#closing;
  }
}
