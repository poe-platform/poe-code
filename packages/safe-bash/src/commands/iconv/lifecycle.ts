import type { OutputOperation } from "../../contracts/output.js";
import type { ByteSink } from "../../contracts/io.js";
import { Budget, IconvError } from "./internal.js";

export class Lifecycle {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly cleanups = new Set<() => Promise<void>>();
  private closing: Promise<void> | undefined;
  private diagnosticDestination: { destination: ByteSink; consumer: AbortSignal | undefined } | undefined;
  diagnosticCancellation: { reason: unknown } | undefined;
  constructor(readonly budget: Budget, output: OutputOperation, private readonly stdout: ByteSink) { output.registerCleanup(() => this.close()); }
  cleanup(action: () => Promise<void>): void { this.assertOpen(); this.cleanups.add(action); }
  forget(action: () => Promise<void>): void { this.cleanups.delete(action); }
  assertOpen(): void {
    this.budget.assertOpen();
    if (this.closing) throw new IconvError("command is closed");
  }
  private assertDiagnosticOpen(): void {
    this.budget.callerSignal.throwIfAborted();
    const consumer = this.diagnosticDestination?.consumer;
    if (consumer?.aborted) {
      this.diagnosticCancellation = { reason: consumer.reason };
      consumer.throwIfAborted();
    }
  }
  async operation<Value>(action: () => Value | Promise<Value>, diagnostic = false): Promise<Value> {
    if (diagnostic) this.assertDiagnosticOpen();
    else this.assertOpen();
    if (this.closing || this.budget.admission.closed) throw new IconvError("command is closed");
    if (!diagnostic) this.budget.charge();
    const pending = Promise.resolve().then(() => {
      if (diagnostic) this.assertDiagnosticOpen();
      else this.assertOpen();
      return action();
    });
    this.pending.add(pending);
    try {
      const value = await pending;
      if (diagnostic) this.assertDiagnosticOpen();
      else this.assertOpen();
      return value;
    }
    finally { this.pending.delete(pending); }
  }
  close(): Promise<void> {
    return this.closing ??= Promise.resolve().then(async () => {
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      const failures: unknown[] = [];
      for (const cleanup of this.cleanups) { try { await cleanup(); } catch (error) { failures.push(error); } }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "iconv cleanup failed");
    });
  }
  async write(value: Uint8Array, diagnostic = false): Promise<void> {
    this.budget.emitted(value.length, diagnostic);
    await this.operation(async () => {
      let destination: ByteSink;
      if (diagnostic) {
        if (!this.diagnosticDestination) {
          const sink = this.budget.context.stderr;
          this.assertDiagnosticOpen();
          const capability = sink.ownedOutput;
          this.assertDiagnosticOpen();
          const consumer = capability?.consumerClosed;
          this.diagnosticDestination = { destination: capability ?? sink, consumer };
        }
        this.assertDiagnosticOpen();
        destination = this.diagnosticDestination.destination;
      } else {
        destination = this.stdout;
        this.assertOpen();
      }
      const write = destination.write;
      if (diagnostic) this.assertDiagnosticOpen();
      else this.assertOpen();
      await Reflect.apply(write, destination, [value]);
    }, diagnostic);
  }
  async diagnostic(message: string): Promise<void> {
    this.budget.check(message.length * 3 + 8, this.budget.limits.maxDiagnosticBytes, "diagnostic bytes");
    await this.write(new TextEncoder().encode(`iconv: ${message}\n`), true);
  }
}
