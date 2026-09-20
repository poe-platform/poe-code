import { createRequire } from "node:module";

const { NativeStdioInput, NativeStdioOutput } = createRequire(import.meta.url)(
  "./tiny-stdio-mcp-server-rust.node"
);

class OutputAdapter {
  constructor(writable, maxBytes, onFailure, onIdle) {
    this.writable = writable;
    this.native = new NativeStdioOutput(maxBytes);
    this.onFailure = onFailure;
    this.onIdle = onIdle;
    this.waiters = new Map();
    this.actions = [];
    this.processing = false;
    this.stopped = false;
    this.activeToken = undefined;
    this.activeCompleted = false;
    this.awaitingError = false;
    this.onDrain = () => this.apply(this.native.drain());
    this.onError = (error) => {
      this.awaitingError = false;
      this.activeToken = undefined;
      this.abort(error);
      this.detach();
    };
    this.onClose = () => {
      this.activeToken = undefined;
      this.awaitingError = false;
      this.abort(new Error("Stdio output closed before connection completion"));
      this.detach();
    };
    writable.on("drain", this.onDrain);
    writable.on("error", this.onError);
    writable.on("close", this.onClose);
  }

  write(data) {
    if (this.stopped) return Promise.reject(this.failure);
    let submitted;
    try {
      submitted = this.native.enqueue(data);
    } catch (error) {
      this.abort(error);
      return Promise.reject(error);
    }
    const operation = new Promise((resolve, reject) =>
      this.waiters.set(submitted.token, { resolve, reject })
    );
    this.apply(submitted.actions);
    return operation;
  }

  apply(actions) {
    this.actions.push(...actions);
    if (this.processing) return;
    this.processing = true;
    try {
      while (!this.stopped && this.actions.length > 0) {
        const action = this.actions.shift();
        if (action.kind === "complete") {
          this.activeToken = undefined;
          this.waiters.get(action.token)?.resolve();
          this.waiters.delete(action.token);
          continue;
        }
        this.activeToken = action.token;
        this.activeCompleted = false;
        try {
          const accepted = this.writable.write(action.data, "utf8", (error) => {
            if (error != null) {
              this.activeToken = undefined;
              this.awaitingError = true;
              this.abort(error);
            } else if (this.stopped) {
              this.activeToken = undefined;
              if (!this.awaitingError) this.detach();
            } else {
              this.activeCompleted = true;
              this.apply(this.native.completed(action.token));
            }
          });
          this.apply(this.native.returned(action.token, accepted));
        } catch (error) {
          this.activeToken = undefined;
          this.abort(error);
        }
      }
    } finally {
      this.processing = false;
      if (this.native.pending === 0) this.onIdle();
    }
  }

  abort(error) {
    if (!this.stopped) {
      this.stopped = true;
      this.failure = error;
      this.actions.length = 0;
      this.native.abort();
      // Commands for a frame just completed in Rust can still be waiting in
      // this adapter during a reentrant stream callback.
      for (const waiter of this.waiters.values()) waiter.reject(error);
      this.waiters.clear();
      if (this.activeCompleted) this.activeToken = undefined;
      this.onFailure(error);
    }
    // Observe errors from an already submitted write after connection failure.
    if (this.activeToken === undefined && !this.awaitingError) this.detach();
  }

  close() {
    this.stopped = true;
    this.failure = new Error("Stdio output is closed");
    this.detach();
  }

  detach() {
    this.writable.off("drain", this.onDrain);
    this.writable.off("error", this.onError);
    this.writable.off("close", this.onClose);
  }
}

export function connectStreams({ readable, writable }, createSession, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let inputClosed = false;
    const pending = new Set();
    const input = new NativeStdioInput(options.maxLineBytes, options.maxPendingMessages);
    const output = new OutputAdapter(writable, options.maxOutputBytes, fail, finish);
    const session = createSession((notification) =>
      output.write(`${JSON.stringify(notification)}\n`)
    );

    function detachInput() {
      readable.off("data", onData);
      readable.off("end", onEnd);
      readable.off("error", fail);
      readable.off("close", onInputClose);
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      input.abort();
      session.close();
      detachInput();
      readable.pause();
      output.abort(error);
      pending.clear();
      reject(error);
    }

    function finish() {
      if (settled || !inputClosed || pending.size > 0 || output.native.pending > 0) return;
      settled = true;
      session.close();
      detachInput();
      output.close();
      resolve();
    }

    function batch(frames) {
      for (const line of frames.lines) {
        if (settled) break;
        if (pending.size >= options.maxPendingMessages) {
          fail(new Error("Stdio pending message limit exceeded"));
          return;
        }
        const operation = session.handleLine(line, (response) => {
          if (!settled) return output.write(response);
          return Promise.resolve();
        });
        if (!settled) pending.add(operation);
        operation.then(() => {
          pending.delete(operation);
          finish();
        }, fail);
      }
      if (frames.error != null) fail(new Error(frames.error));
    }

    function onData(chunk) {
      try {
        batch(input.push(chunk));
      } catch (error) {
        fail(error);
      }
    }

    function onEnd() {
      if (settled) return;
      try {
        batch(input.finish());
      } catch (error) {
        fail(error);
      }
      inputClosed = true;
      session.endInput();
      finish();
    }

    function onInputClose() {
      if (!inputClosed) fail(new Error("Stdio input closed before connection completion"));
    }

    readable.on("error", fail);
    readable.on("close", onInputClose);
    readable.on("end", onEnd);
    readable.on("data", onData);
    readable.resume();
  });
}
