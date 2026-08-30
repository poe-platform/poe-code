import { EreProfileLimitError } from "../errors.js";
import type { EreExpansionBounds, EreLimits, EreUsage } from "../types.js";
import { EngineAccounting, StorageReservation, TransportAccounting, assertBootstrapStorage, metadataUnits, multiply, workerValidationPrepayment } from "./accounting.js";
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
  cancelListener: (() => void) | undefined;
  cancelled: boolean;
  cancelReason: unknown;
}

export class EreTransportRoot {
  readonly #bounds: EreExpansionBounds;
  readonly #engine: EngineAccounting;
  readonly #transport: TransportAccounting;
  readonly #metadata: StorageReservation;
  #workerMetadata: StorageReservation | undefined;
  #worker: EreWorkerOwner | undefined;
  #queue: Ticket[];
  #active: Ticket | undefined;
  #closed = false;
  #failurePresent = false;
  #failure: unknown;
  #closing: Promise<void> | undefined;
  #retiring: Promise<void> | undefined;
  #retired = false;
  #nextId = 0;
  #nextSession = 0;
  #sessions: Map<number, StorageReservation>;

  constructor(bounds: EreExpansionBounds, registerCleanup: EreCleanupRegistration) {
    assertBootstrapStorage(bounds, metadataUnits.root);
    this.#engine = new EngineAccounting(bounds);
    this.#transport = new TransportAccounting(this.#engine.limits);
    this.#metadata = this.#transport.owned(metadataUnits.root);
    this.#bounds = Object.freeze({ maxExpansionBytes: bounds.maxExpansionBytes, maxExpansionFields: bounds.maxExpansionFields });
    this.#queue = []; this.#sessions = new Map();
    try { registerCleanup(() => this.close()); }
    catch (reason) { this.#closed = true; this.#metadata.retire(); throw reason; }
  }

  get usage(): Readonly<{ engine: EreUsage; transport: TransportAccounting["usage"] }> {
    const storage = this.#transport.owned(metadataUnits.usage);
    try { return Object.freeze({ engine: this.#engine.usage, transport: this.#transport.usage }); }
    finally { storage.retire(); }
  }

  openSession(registerCleanup: EreCleanupRegistration): EreTransportSession {
    this.#assertOpen();
    if (this.#nextSession === Number.MAX_SAFE_INTEGER) throw new EreTransportError("CLOSED", "ERE session identity exhausted");
    const metadata = this.#transport.owned(metadataUnits.session);
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
    if (closed || this.#closed) { metadata.retire(); throw new EreTransportError("CLOSED", "ERE session closed during registration"); }
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
    const metadata = this.#transport.owned(metadataUnits.ticket);
    let storage: StorageReservation | undefined;
    let owned: EreTransportInput;
    let patternBytes: number;
    let requestUnits: number;
    try {
      const inspected = inspectInput(input, this.#engine.limits, this.#transport, signal);
      patternBytes = inspected.patternBytes; requestUnits = inspected.units;
      storage = this.#transport.reserve(multiply(inspected.units, 2));
      storage.consume(inspected.units); owned = copyInput(inspected, this.#transport);
    } catch (reason) { storage?.releaseUnused(); storage?.retire(); metadata.retire(); throw reason; }
    const admittedStorage = storage;
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    return new Promise<EreTransportResult>((resolve, reject) => {
      const ticket: Ticket = { session, id: ++this.#nextId, input: owned, patternBytes, requestUnits, storage: admittedStorage, metadata, signal, resolve, reject, done, finish, cancelListener: undefined, cancelled: false, cancelReason: undefined };
      try {
        this.#queue.push(ticket);
        if (signal) {
          ticket.cancelListener = () => this.#cancel(ticket, signal.reason);
          signal.addEventListener("abort", ticket.cancelListener, { once: true });
          if (signal.aborted) this.#cancel(ticket, signal.reason);
        }
        this.#pump();
      } catch (reason) { this.#cancel(ticket, reason); }
    });
  }

  #release(ticket: Ticket): void {
    if (ticket.cancelListener) ticket.signal?.removeEventListener("abort", ticket.cancelListener);
    ticket.cancelListener = undefined;
    ticket.storage.releaseUnused(); ticket.storage.retire(); ticket.metadata.retire();
  }

  #cancel(ticket: Ticket, reason: unknown): void {
    if (ticket.cancelled) return;
    ticket.cancelled = true; ticket.cancelReason = reason;
    const index = this.#queue.indexOf(ticket);
    if (index >= 0) {
      this.#queue.splice(index, 1); this.#release(ticket); ticket.finish(); ticket.reject(reason);
      return;
    }
    if (this.#active === ticket && this.#worker) {
      this.#fail(new EreTransportError("CLOSED", "ERE Worker retired by active request cancellation"));
    }
  }

  #pump(): void {
    if (this.#active || this.#closed || this.#failurePresent) return;
    const ticket = this.#queue.shift();
    if (!ticket) return;
    this.#active = ticket;
    const complete = (outcome: { ok: true; value: EreTransportResult } | { ok: false; reason: unknown }): void => {
      try {
        if (!this.#retiring || this.#retired) this.#release(ticket);
        else if (ticket.cancelListener) { ticket.signal?.removeEventListener("abort", ticket.cancelListener); ticket.cancelListener = undefined; }
      } catch (reason) { this.#fail(reason); if (outcome.ok) outcome = { ok: false, reason }; }
      this.#active = undefined; ticket.finish();
      if (outcome.ok) ticket.resolve(outcome.value); else ticket.reject(outcome.reason);
      this.#pump();
    };
    void this.#execute(ticket).then(value => complete({ ok: true, value }), reason => complete({ ok: false, reason })).catch(reason => this.#fail(reason));
  }

  #check(ticket: Ticket): void {
    if (ticket.signal?.aborted) { this.#cancel(ticket, ticket.signal.reason); throw ticket.signal.reason; }
    if (ticket.cancelled) throw ticket.cancelReason;
    this.#assertOpen();
  }

  #retireWorker(): Promise<void> {
    if (!this.#retiring) {
      this.#retiring = Promise.resolve().then(async () => { await this.#worker?.close(); this.#retired = true; });
      void this.#retiring.catch(() => {});
    }
    return this.#retiring;
  }

  async #execute(ticket: Ticket): Promise<EreTransportResult> {
    let replyStorage: StorageReservation | undefined;
    let grant: EreLimits | undefined;
    let observed = false;
    let reconciled = false;
    try {
      this.#check(ticket);
      grant = this.#engine.reserve(ticket.patternBytes, ticket.input.subject.length);
      if (workerValidationPrepayment(ticket.requestUnits, ticket.input.pattern.length) > grant.work) throw new EreProfileLimitError("work", grant.work);
      replyStorage = this.#transport.reserve(479);
      if (!this.#worker) {
        this.#workerMetadata = this.#transport.owned(metadataUnits.worker);
        this.#worker = new EreWorkerOwner(reason => this.#fail(reason), this.#transport);
        observed = true;
      }
      await this.#worker.start();
      this.#check(ticket);
      const request: EreTransportRequest = { version: 1, operation, id: ticket.id, grantId: ticket.id, profile, bounds: this.#bounds, allowance: grant, pattern: ticket.input.pattern, subject: ticket.input.subject };
      this.#transport.visit(ticket.requestUnits);
      const message = await this.#worker.request(request, () => { ticket.storage.consume(ticket.requestUnits); observed = true; });
      const validated = validateReply(message, request, units => this.#transport.visit(units), this.#transport);
      this.#engine.commit(grant, validated.reply.usage); reconciled = true;
      replyStorage.settle(2 * validated.replyUnits + validated.resultUnits);
      this.#check(ticket);
      const reply = validated.reply;
      if (reply.kind === "failure") {
        if (reply.category === "profile-limit") throw new EreProfileLimitError(reply.resource!, grant[reply.resource!]);
        throw new EreTransportSemanticError(reply.category, reply.offset);
      }
      this.#transport.visit(validated.resultUnits);
      return copyReplyResult(reply, this.#transport);
    } catch (reason) {
      if (grant && !reconciled) {
        this.#engine.abandon(grant, observed);
        if (observed) { replyStorage?.unknown(); this.#fail(reason); }
      }
      if (this.#worker && (this.#failurePresent || ticket.cancelled)) await this.#retireWorker().catch(() => {});
      if (ticket.signal?.aborted) throw ticket.signal.reason;
      if (ticket.cancelled) throw ticket.cancelReason;
      throw reason;
    } finally {
      if (!this.#retiring || this.#retired) { replyStorage?.releaseUnused(); replyStorage?.retire(); }
    }
  }

  #fail(reason: unknown): void {
    if (!this.#failurePresent) { this.#failurePresent = true; this.#failure = reason; }
    this.#rejectQueued();
    if (this.#worker) void this.#retireWorker().catch(() => {});
  }

  #rejectQueued(session?: number): void {
    for (let index = this.#queue.length - 1; index >= 0; index--) {
      const ticket = this.#queue[index]!;
      if (session !== undefined && ticket.session !== session) continue;
      const reason = ticket.signal?.aborted ? ticket.signal.reason : this.#failurePresent ? this.#failure : new EreTransportError("CLOSED", "ERE queued job closed");
      this.#cancel(ticket, reason);
    }
  }

  async #closeSession(id: number): Promise<void> {
    this.#rejectQueued(id);
    const active = this.#active;
    if (active?.session === id) { this.#cancel(active, new EreTransportError("CLOSED", "ERE session closed")); await active.done; }
    if (this.#retiring) await this.#retiring;
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#rejectQueued();
    const active = this.#active;
    if (active) this.#cancel(active, new EreTransportError("CLOSED", "ERE invocation root closed"));
    this.#closing = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([this.#retireWorker(), active?.done]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
      this.#workerMetadata?.retire();
      for (const metadata of this.#sessions.values()) metadata.retire();
      this.#sessions.clear(); this.#metadata.retire();
    });
    void this.#closing.catch(() => {});
    return this.#closing;
  }
}
