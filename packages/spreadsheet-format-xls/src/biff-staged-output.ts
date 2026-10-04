import { SsconvertError, type CapabilityContext, type RangeSource, type WorkingStorage } from '@poe-code/spreadsheet-engine/contracts';
import { biffContinuedParts } from './biff-write-binary.js';

export interface BiffRecordOutput {
  readonly length: number;
  readonly maximumRecord: number;
  record(opcode: number, payload?: Uint8Array): number | Promise<number>;
  continuedRecord(opcode: number, payload: Uint8Array, boundaries?: readonly number[],
    strings?: readonly { start: number; end: number }[]): number | Promise<number>;
}

/** An append-only record stream with bounded staging and explicit patch/read phases. */
export class BiffStagedOutput implements BiffRecordOutput, RangeSource {
  private readonly buffer = new Uint8Array(16384);
  private readonly store: WorkingStorage;
  private readonly start: number;
  private buffered = 0;
  private count = 0;
  private closed = false;
  private pending: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;
  length = 0;
  get size(): number { return this.length; }
  constructor(readonly context: CapabilityContext, readonly maximumRecord: number) {
    context.own(() => this.close()); this.check();
    if (!context.createWorkingStorage) throw new SsconvertError('capability-denied', 'BIFF output requires caller working storage');
    this.store = context.createWorkingStorage(); this.check(); this.start = this.store.allocate(0);
  }
  private check(): void {
    this.context.signal.throwIfAborted();
    if (this.closed) throw new SsconvertError('invalid-request', 'BIFF output is closed');
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(() => { this.check(); return operation(); });
    this.pending = result.then(() => undefined, () => undefined); return result;
  }
  private async flush(): Promise<void> {
    if (this.buffered) {
      await this.store.write(this.start + this.length - this.buffered, this.buffer.subarray(0, this.buffered));
      this.check(); this.buffered = 0;
    }
  }
  record(opcode: number, payload: Uint8Array = new Uint8Array()): Promise<number> {
    return this.serial(() => this.append(opcode, payload));
  }
  private async append(opcode: number, payload: Uint8Array): Promise<number> {
    this.check();
    if (payload.length > this.maximumRecord) throw new SsconvertError('unsupported-feature', 'Excel BIFF record is too large');
    if (payload.length + 4 > this.context.limits.outputBytes - this.length)
      throw new SsconvertError('resource-limit', 'ssconvert BIFF output bytes limit exceeded');
    if (this.count >= (this.context.limits.workbookNodes ?? this.context.limits.outputBytes / 4))
      throw new SsconvertError('resource-limit', 'ssconvert BIFF record limit exceeded');
    const at = this.length, header = new Uint8Array(4), view = new DataView(header.buffer);
    view.setUint16(0, opcode, true); view.setUint16(2, payload.length, true);
    const address = this.store.allocate(payload.length + 4);
    if (address !== this.start + at) throw new SsconvertError('io', 'Noncontiguous BIFF output storage');
    this.count++;
    for (const bytes of [header, payload]) for (let offset = 0; offset < bytes.length;) {
      const amount = Math.min(this.buffer.length - this.buffered, bytes.length - offset);
      this.buffer.set(bytes.subarray(offset, offset + amount), this.buffered);
      this.buffered += amount; this.length += amount; offset += amount;
      if (this.buffered === this.buffer.length) await this.flush();
    }
    return at;
  }
  continuedRecord(opcode: number, payload: Uint8Array, boundaries?: readonly number[],
    strings: readonly { start: number; end: number }[] = []): Promise<number> {
    return this.serial(async () => {
      const at = this.length;
      for (const [code, part] of biffContinuedParts(opcode, payload, this.maximumRecord, boundaries, strings)) await this.append(code, part);
      return at;
    });
  }
  patch(position: number, bytes: Uint8Array): Promise<void> {
    return this.serial(async () => {
      if (!Number.isSafeInteger(position) || position < 0 || position > this.length - bytes.length || bytes.length > 16384)
        throw new SsconvertError('invalid-request', 'Invalid BIFF output patch');
      await this.flush(); await this.store.write(this.start + position, bytes); this.check();
    });
  }
  read(position: number, count: number, options?: { readonly signal?: AbortSignal }): Promise<Uint8Array> {
    return this.serial(async () => {
      options?.signal?.throwIfAborted();
      if (!Number.isSafeInteger(position) || position < 0 || position > this.length || !Number.isSafeInteger(count) || count < 0)
        throw new SsconvertError('invalid-request', 'Invalid BIFF output range');
      await this.flush();
      const amount = Math.min(16384, count, this.length - position);
      const bytes = await this.store.read(this.start + position, amount); this.check(); options?.signal?.throwIfAborted();
      if (bytes.length !== amount) throw new SsconvertError('io', 'Truncated BIFF output storage');
      return new Uint8Array(bytes);
    });
  }
  close(): Promise<void> {
    this.closed = true;
    return this.closing ??= this.pending.then(async () => { this.buffer.fill(0); await this.store?.close(); });
  }
}
