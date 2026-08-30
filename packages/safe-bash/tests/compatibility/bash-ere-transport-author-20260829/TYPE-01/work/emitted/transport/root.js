import { EreProfileLimitError } from "../errors.js";
import { EngineAccounting, StorageReservation, TransportAccounting, multiply } from "./accounting.js";
import { EreWorkerOwner } from "./owner.js";
import { EreTransportError, EreTransportProfileLimitError, EreTransportSemanticError, operation, profile } from "./protocol.js";
import { copyInput, copyReplyResult, inspectInput, validateReply } from "./validation.js";
export class EreTransportRoot {
    #bounds;
    #engine;
    #transport;
    #metadata;
    #workerMetadata;
    #worker;
    #queue = [];
    #active;
    #closed = false;
    #failurePresent = false;
    #failure;
    #closing;
    #nextId = 0;
    #nextSession = 0;
    #sessions = new Map();
    constructor(bounds, registerCleanup) {
        this.#engine = new EngineAccounting(bounds);
        this.#transport = new TransportAccounting(this.#engine.limits);
        this.#metadata = this.#transport.metadata(18);
        this.#bounds = Object.freeze({ maxExpansionBytes: bounds.maxExpansionBytes, maxExpansionFields: bounds.maxExpansionFields });
        try {
            registerCleanup(() => this.close());
        }
        catch (reason) {
            this.#closed = true;
            this.#metadata.retire();
            throw reason;
        }
    }
    get usage() {
        return Object.freeze({ engine: this.#engine.usage, transport: this.#transport.usage });
    }
    openSession(registerCleanup) {
        this.#assertOpen();
        if (this.#nextSession === Number.MAX_SAFE_INTEGER)
            throw new EreTransportError("CLOSED", "ERE session identity exhausted");
        const metadata = this.#transport.metadata(5);
        const id = ++this.#nextSession;
        let closed = false;
        let closing;
        const close = () => {
            if (closing)
                return closing;
            closed = true;
            closing = this.#closeSession(id).finally(() => { this.#sessions.delete(id); metadata.retire(); });
            return closing;
        };
        try {
            registerCleanup(close);
        }
        catch (reason) {
            closed = true;
            metadata.retire();
            throw reason;
        }
        this.#sessions.set(id, metadata);
        return Object.freeze({
            execute: (input, signal) => closed ? Promise.reject(new EreTransportError("CLOSED", "ERE session closed")) : this.#submit(id, input, signal),
            close,
        });
    }
    #assertOpen() {
        if (this.#failurePresent)
            throw this.#failure;
        if (this.#closed)
            throw new EreTransportError("CLOSED", "ERE invocation root closed");
    }
    async #submit(session, input, signal) {
        if (signal?.aborted)
            throw signal.reason;
        this.#assertOpen();
        if (this.#queue.length >= 64)
            throw new EreTransportProfileLimitError("queueTickets", 64);
        if (this.#nextId === Number.MAX_SAFE_INTEGER)
            throw new EreTransportError("CLOSED", "ERE job identity exhausted");
        const inspected = inspectInput(input, this.#engine.limits, this.#transport, signal);
        const metadata = this.#transport.metadata(13);
        let storage;
        try {
            storage = this.#transport.reserve(multiply(inspected.units, 2));
        }
        catch (reason) {
            metadata.retire();
            throw reason;
        }
        let owned;
        try {
            storage.consume(inspected.units);
            owned = copyInput(inspected, this.#transport);
        }
        catch (reason) {
            storage.releaseUnused();
            storage.retire();
            metadata.retire();
            throw reason;
        }
        let finish;
        const done = new Promise(resolve => { finish = resolve; });
        return new Promise((resolve, reject) => {
            const ticket = { session, id: ++this.#nextId, input: owned, patternBytes: inspected.patternBytes, requestUnits: inspected.units, storage, metadata, signal, resolve, reject, done, finish, cancelled: false };
            this.#queue.push(ticket);
            this.#pump();
        });
    }
    #pump() {
        if (this.#active || this.#closed || this.#failurePresent)
            return;
        const ticket = this.#queue.shift();
        if (!ticket)
            return;
        this.#active = ticket;
        const complete = (outcome) => {
            try {
                ticket.storage.releaseUnused();
                ticket.storage.retire();
                ticket.metadata.retire();
            }
            catch (reason) {
                this.#fail(reason);
                if (outcome.ok)
                    outcome = { ok: false, reason };
            }
            this.#active = undefined;
            ticket.finish();
            if (outcome.ok)
                ticket.resolve(outcome.value);
            else
                ticket.reject(outcome.reason);
            this.#pump();
        };
        void this.#execute(ticket).then(value => complete({ ok: true, value }), reason => complete({ ok: false, reason })).catch(reason => this.#fail(reason));
    }
    async #execute(ticket) {
        let replyStorage;
        let grant;
        let sent = false;
        let reconciled = false;
        try {
            if (ticket.signal?.aborted)
                throw ticket.signal.reason;
            if (ticket.cancelled)
                throw new EreTransportError("CLOSED", "ERE job cancelled");
            replyStorage = this.#transport.reserve(479);
            if (!this.#worker) {
                this.#workerMetadata = this.#transport.metadata(21);
                this.#worker = new EreWorkerOwner(reason => this.#fail(reason), units => this.#transport.visit(units));
            }
            await this.#worker.start();
            if (ticket.signal?.aborted)
                throw ticket.signal.reason;
            if (ticket.cancelled)
                throw new EreTransportError("CLOSED", "ERE job cancelled");
            grant = this.#engine.reserve(ticket.patternBytes, ticket.input.subject.length);
            const request = { version: 1, operation, id: ticket.id, grantId: ticket.id, profile, bounds: this.#bounds, allowance: grant, pattern: ticket.input.pattern, subject: ticket.input.subject };
            this.#transport.visit(ticket.requestUnits);
            const message = await this.#worker.request(request, () => { ticket.storage.consume(ticket.requestUnits); sent = true; });
            const validated = validateReply(message, request, units => this.#transport.visit(units));
            this.#engine.commit(grant, validated.reply.usage);
            reconciled = true;
            replyStorage.settle(2 * validated.replyUnits + validated.resultUnits);
            if (ticket.signal?.aborted)
                throw ticket.signal.reason;
            if (ticket.cancelled || this.#closed)
                throw new EreTransportError("CLOSED", "ERE job cancelled");
            const reply = validated.reply;
            if (reply.kind === "failure") {
                if (reply.category === "profile-limit")
                    throw new EreProfileLimitError(reply.resource, grant[reply.resource]);
                throw new EreTransportSemanticError(reply.category, reply.offset);
            }
            this.#transport.visit(validated.resultUnits);
            return copyReplyResult(reply);
        }
        catch (reason) {
            if (grant && !reconciled) {
                this.#engine.abandon(grant, sent);
                if (sent) {
                    replyStorage?.unknown();
                    this.#fail(reason);
                }
            }
            if (this.#failurePresent) {
                try {
                    await this.#worker?.close();
                }
                catch (cleanupReason) {
                    if (!this.#closing)
                        this.#closing = Promise.reject(cleanupReason);
                    this.#closing.catch(() => { });
                }
            }
            if (ticket.signal?.aborted)
                throw ticket.signal.reason;
            throw reason;
        }
        finally {
            replyStorage?.releaseUnused();
            replyStorage?.retire();
        }
    }
    #fail(reason) {
        if (!this.#failurePresent) {
            this.#failurePresent = true;
            this.#failure = reason;
        }
        this.#rejectQueued();
    }
    #rejectQueued(session) {
        for (let index = this.#queue.length - 1; index >= 0; index--) {
            const ticket = this.#queue[index];
            if (session !== undefined && ticket.session !== session)
                continue;
            this.#queue.splice(index, 1);
            ticket.storage.releaseUnused();
            ticket.storage.retire();
            ticket.metadata.retire();
            ticket.reject(ticket.signal?.aborted ? ticket.signal.reason : this.#failurePresent ? this.#failure : new EreTransportError("CLOSED", "ERE queued job closed"));
            ticket.finish();
        }
    }
    async #closeSession(id) {
        this.#rejectQueued(id);
        if (this.#active?.session === id) {
            this.#active.cancelled = true;
            await this.#active.done;
        }
    }
    close() {
        if (this.#closing)
            return this.#closing;
        this.#closed = true;
        this.#rejectQueued();
        if (this.#active)
            this.#active.cancelled = true;
        this.#closing = Promise.resolve().then(async () => {
            await this.#active?.done;
            await this.#worker?.close();
            this.#workerMetadata?.retire();
            for (const metadata of this.#sessions.values())
                metadata.retire();
            this.#sessions.clear();
            this.#metadata.retire();
        });
        return this.#closing;
    }
}
