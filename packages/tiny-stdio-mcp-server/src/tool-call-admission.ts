import { ToolError } from "./types.js";

interface WaitingCall {
  signal: AbortSignal;
  resolve(release: () => void): void;
  abort(): void;
}

export class ToolCallAdmission {
  private active = 0;
  private readonly waiting: WaitingCall[] = [];

  constructor(private readonly maximumActive: number, private readonly maximumQueued: number) {}

  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.active < this.maximumActive) {
      this.active++;
      return Promise.resolve(this.release());
    }
    if (this.waiting.length >= this.maximumQueued) {
      throw new ToolError(-32000, "Too many queued tool calls");
    }
    return new Promise((resolve, reject) => {
      const waiting: WaitingCall = {
        signal,
        resolve,
        abort: () => {
          const index = this.waiting.indexOf(waiting);
          if (index !== -1) this.waiting.splice(index, 1);
          reject(signal.reason);
        }
      };
      this.waiting.push(waiting);
      signal.addEventListener("abort", waiting.abort, { once: true });
    });
  }

  private release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next === undefined) {
        this.active--;
      } else {
        next.signal.removeEventListener("abort", next.abort);
        next.resolve(this.release());
      }
    };
  }
}
