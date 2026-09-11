import type { OutputOperation } from "../../contracts/output.js";
import { Budget, GetoptError } from "./internal.js";

export class Writer {
  private readonly pending = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;
  constructor(readonly budget: Budget, output: OutputOperation) { output.registerCleanup(() => this.close()); }
  assertOpen(): void {
    this.budget.signal.throwIfAborted();
    if (this.closing) throw new GetoptError("command is closed");
  }
  close(): Promise<void> {
    return this.closing ??= Promise.resolve().then(async () => {
      while (this.pending.size) await Promise.allSettled([...this.pending]);
    });
  }
  private async publish(length: number, diagnostic: boolean, fill: (buffer: Uint8Array) => Promise<void>): Promise<void> {
    this.assertOpen();
    this.budget.emitted(length, diagnostic);
    this.budget.retain(length, diagnostic);
    const pending = Promise.resolve().then(async () => {
      this.assertOpen();
      const buffer = new Uint8Array(length);
      await fill(buffer);
      this.assertOpen();
      const sink = diagnostic ? this.budget.context.stderr : this.budget.context.stdout;
      this.assertOpen();
      const destination = sink.ownedOutput ?? sink;
      this.assertOpen();
      const write = destination.write;
      this.assertOpen();
      await Reflect.apply(write, destination, [buffer]);
    });
    this.pending.add(pending);
    try { await pending; this.assertOpen(); }
    finally { this.pending.delete(pending); this.budget.retain(-length, diagnostic); }
  }
  async send(parts: readonly string[], diagnostic = false): Promise<void> {
    let length = 0;
    for (const part of parts) { await this.budget.step(1, diagnostic); length += part.length; this.budget.room(length, diagnostic); }
    await this.publish(length, diagnostic, async buffer => {
      let offset = 0;
      for (const part of parts) for (let index = 0; index < part.length; index++) {
        await this.budget.step(1, diagnostic);
        buffer[offset++] = part.charCodeAt(index);
      }
    });
  }
  async normalized(value: string, quote: boolean, tcsh: boolean): Promise<void> {
    if (!quote) { await this.send([" ", value]); return; }
    let length = 3;
    for (let offset = 0; offset < value.length; offset++) {
      await this.budget.step();
      const code = value.charCodeAt(offset);
      length += code === 39 || (tcsh && (code === 33 || code === 9 || code === 11 || code === 12 || code === 13 || code === 32)) ? 4
        : tcsh && (code === 92 || code === 10) ? 2 : 1;
      this.budget.room(length);
    }
    await this.publish(length, false, async buffer => {
      let offset = 0;
      buffer[offset++] = 32;
      buffer[offset++] = 39;
      for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        await this.budget.step();
        if (code === 39 || (tcsh && (code === 33 || code === 9 || code === 11 || code === 12 || code === 13 || code === 32))) {
          buffer[offset++] = 39; buffer[offset++] = 92; buffer[offset++] = code; buffer[offset++] = 39;
        } else if (tcsh && (code === 92 || code === 10)) {
          buffer[offset++] = 92; buffer[offset++] = code === 10 ? 110 : 92;
        } else buffer[offset++] = code;
      }
      buffer[offset] = 39;
    });
  }
}
