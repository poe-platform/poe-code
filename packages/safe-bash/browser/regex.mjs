import { EreTransportError } from "../src/commands/regex-execution/ere/transport/protocol.ts";
import { executeWireRequest } from "../src/commands/regex-execution/ere/transport/wire-engine.ts";

// Keep the shared root's admission, accounting and reply validation. Only the
// execution backend differs: portable hosts use cooperative JS, not a Worker.
export class EreWorkerOwner {
  #controller = new AbortController();
  #pending;
  #closing;
  #retirementState = "NOT_ACQUIRED";

  get retirementState() { return this.#retirementState; }

  async start() {
    this.#controller.signal.throwIfAborted();
    this.#retirementState = "PENDING";
  }

  async request(request, onDispatch) {
    this.#controller.signal.throwIfAborted();
    if (this.#pending) throw new EreTransportError("PROTOCOL", "concurrent ERE request");
    onDispatch();
    const pending = executeWireRequest(request, 0, this.#controller.signal);
    this.#pending = pending;
    try { return await pending; }
    finally { this.#pending = undefined; }
  }

  close() {
    if (!this.#closing) {
      this.#controller.abort(new EreTransportError("CLOSED", "ERE execution closed"));
      this.#closing = Promise.resolve(this.#pending).catch(() => {}).then(() => {
        this.#retirementState = "RETIRED";
      });
    }
    return this.#closing;
  }
}
