import { Worker } from "node:worker_threads";
import { EreTransportError, operation } from "./protocol.js";
import { record } from "./validation.js";
export class EreWorkerOwner {
    onFailure;
    visit;
    #worker;
    #exited;
    #exitResolve;
    #ready;
    #readyResolve;
    #readyReject;
    #startupTimer;
    #pending;
    #closing;
    #failed = false;
    #failure;
    #readySeen = false;
    #exitListenerInstalled = false;
    constructor(onFailure, visit) {
        this.onFailure = onFailure;
        this.visit = visit;
    }
    #fail(reason) {
        if (this.#failed)
            return;
        this.#failed = true;
        this.#failure = reason;
        clearTimeout(this.#startupTimer);
        this.#readyReject?.(reason);
        const pending = this.#pending;
        this.#pending = undefined;
        if (pending) {
            clearTimeout(pending.timer);
            pending.reject(reason);
        }
        this.onFailure(reason);
    }
    async start() {
        if (this.#failed)
            throw this.#failure;
        if (this.#closing)
            throw new EreTransportError("CLOSED", "ERE Worker is closing");
        if (!this.#ready) {
            this.#ready = new Promise((resolve, reject) => { this.#readyResolve = resolve; this.#readyReject = reject; });
            this.#exited = new Promise(resolve => { this.#exitResolve = resolve; });
            try {
                const worker = new Worker(new URL("./worker-entry.js", import.meta.url), {
                    workerData: { operation, version: 1 }, env: {}, execArgv: [],
                    resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
                });
                this.#worker = worker;
                worker.once("exit", () => {
                    this.#exitResolve?.();
                    if (!this.#closing)
                        this.#fail(new EreTransportError("WORKER_EXIT", "owned ERE Worker exited"));
                });
                this.#exitListenerInstalled = true;
                worker.on("error", (reason) => this.#fail(reason));
                worker.on("messageerror", (reason) => this.#fail(reason));
                worker.on("message", (message) => {
                    try {
                        if (!this.#readySeen) {
                            const ready = record(message, ["version", "operation", "kind"], this.visit);
                            if (ready.version !== 1 || ready.operation !== operation || ready.kind !== "ready")
                                throw new EreTransportError("PROTOCOL", "invalid ERE startup frame");
                            this.visit(14);
                            this.#readySeen = true;
                            clearTimeout(this.#startupTimer);
                            this.#readyResolve?.();
                            return;
                        }
                        const pending = this.#pending;
                        if (!pending)
                            throw new EreTransportError("PROTOCOL", "unsolicited ERE frame");
                        this.#pending = undefined;
                        clearTimeout(pending.timer);
                        pending.resolve(message);
                    }
                    catch (reason) {
                        this.#fail(reason);
                    }
                });
                this.#startupTimer = setTimeout(() => this.#fail(new EreTransportError("STARTUP_TIMEOUT", "ERE startup timeout")), 3000);
            }
            catch (reason) {
                if (!this.#worker)
                    this.#exitResolve?.();
                this.#fail(reason);
            }
        }
        return this.#ready;
    }
    request(request, posted) {
        if (this.#failed)
            return Promise.reject(this.#failure);
        if (!this.#worker || !this.#readySeen || this.#pending || this.#closing)
            return Promise.reject(new EreTransportError("CLOSED", "ERE Worker request unavailable"));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => this.#fail(new EreTransportError("REQUEST_TIMEOUT", "ERE request timeout")), 1000);
            this.#pending = { resolve, reject, timer };
            try {
                posted();
                this.#worker.postMessage(request);
            }
            catch (reason) {
                this.#fail(reason);
            }
        });
    }
    close() {
        if (this.#closing)
            return this.#closing;
        clearTimeout(this.#startupTimer);
        this.#closing = Promise.resolve().then(async () => {
            if (!this.#worker)
                return;
            const termination = Promise.resolve().then(async () => {
                const result = await this.#worker.terminate();
                if (!this.#exitListenerInstalled)
                    this.#exitResolve?.();
                return result;
            });
            const results = await Promise.allSettled([termination, this.#exited]);
            const failed = results.find(result => result.status === "rejected");
            if (failed?.status === "rejected")
                throw failed.reason;
            this.#worker = undefined;
        });
        return this.#closing;
    }
}
