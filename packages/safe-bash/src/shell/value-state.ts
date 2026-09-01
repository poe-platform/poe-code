import { shellValueRetainedBytes } from "../contracts/value.js";
import type { ByteShellValue, ShellValue, ValueAllocation, ValueReservation } from "../contracts/value.js";
import { ShellLimitError } from "./types.js";

interface AllocationRecord {
  readonly bytes: number;
  readonly slots: number;
  references: number;
  object?: object;
}

export interface HeldValue {
  readonly value: ShellValue;
  release(): void;
}

export class ValueArena {
  readonly #objects = new WeakMap<object, AllocationRecord>();
  readonly #records = new Set<AllocationRecord>();
  #bytes = 0;
  #slots = 0;
  #closed = false;

  constructor(readonly maximumBytes: number, readonly maximumSlots: number, readonly checkpoint: () => void, readonly fail: (limit: "maxExpansionBytes" | "maxExpansionFields") => never = limit => { throw new ShellLimitError(limit); }) {}

  get usage(): { bytes: number; slots: number } { return { bytes: this.#bytes, slots: this.#slots }; }

  assertOpen(): void {
    this.checkpoint();
    this.assertRetained();
  }

  assertRetained(): void {
    if (this.#closed) throw new Error("Shell value arena is closed");
  }

  scope(): ValueScope { this.assertOpen(); return new ValueScope(this); }

  allocate(bytes: number, slots: number): AllocationRecord {
    this.assertOpen();
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(slots) || slots < 0) throw new RangeError("Invalid shell value allocation");
    if (bytes > this.maximumBytes - this.#bytes) this.fail("maxExpansionBytes");
    if (slots > this.maximumSlots - this.#slots) this.fail("maxExpansionFields");
    const record = { bytes, slots, references: 1 };
    this.#bytes += bytes;
    this.#slots += slots;
    this.#records.add(record);
    return record;
  }

  commit(record: AllocationRecord, object: object): void {
    this.assertOpen();
    if (!this.#records.has(record) || record.object || this.#objects.has(object)) throw new Error("Shell value reservation is not fresh");
    record.object = object;
    this.#objects.set(object, record);
  }

  release(record: AllocationRecord): void {
    if (!this.#records.has(record)) return;
    if (--record.references) return;
    this.#records.delete(record);
    if (record.object) this.#objects.delete(record.object);
    this.#bytes -= record.bytes;
    this.#slots -= record.slots;
  }

  hold(value: ByteShellValue): HeldValue {
    this.assertOpen();
    const reference = this.allocate(32, 1);
    let payload: AllocationRecord;
    try {
      const existing = this.#objects.get(value);
      if (existing) { payload = existing; payload.references++; }
      else {
        payload = this.allocate(shellValueRetainedBytes(value), 1);
        try { this.commit(payload, value); }
        catch (error) { this.release(payload); throw error; }
      }
    } catch (error) { this.release(reference); throw error; }
    let released = false;
    return { value, release: () => {
      if (released) return;
      released = true;
      this.release(reference);
      this.release(payload);
    } };
  }

  close(): void {
    this.#closed = true;
    for (const record of this.#records) if (record.object) this.#objects.delete(record.object);
    this.#records.clear();
    this.#bytes = 0;
    this.#slots = 0;
  }
}

export class ValueScope implements ValueAllocation {
  readonly #releases = new Set<() => void>();
  readonly #holds = new Map<HeldValue, { scope: ValueScope }>();
  #closed = false;
  #enrollment: AllocationRecord | undefined;

  constructor(readonly arena: ValueArena) {}

  assertOpen(): void {
    this.arena.assertOpen();
    if (this.#closed) throw new Error("Shell value scope is closed");
  }

  reserve(bytes: number, slots: number): ValueReservation {
    this.assertOpen();
    this.#enrollment ??= this.arena.allocate(64, 1);
    const record = this.arena.allocate(bytes, slots);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.#releases.delete(release);
      this.arena.release(record);
    };
    this.#releases.add(release);
    return { commit: value => { this.assertOpen(); if (released) throw new Error("Shell value reservation is released"); this.arena.commit(record, value); }, release };
  }

  hold(value: ShellValue): HeldValue {
    this.assertOpen();
    if (typeof value === "string") return { value, release() {} };
    this.#enrollment ??= this.arena.allocate(64, 1);
    const held = this.arena.hold(value);
    const owner = { scope: this as ValueScope };
    const result = { value, release: (): void => {
      owner.scope.#holds.delete(result);
      owner.scope.#releases.delete(result.release);
      held.release();
    } };
    const release = result.release;
    this.#releases.add(release);
    this.#holds.set(result, owner);
    return result;
  }

  prepareTransfer(held: HeldValue, destination: ValueScope): () => void {
    const validate = (): { scope: ValueScope } => {
      this.arena.assertRetained();
      const owner = this.#holds.get(held);
      if (!owner || this.#closed || destination.#closed || this.arena !== destination.arena || !destination.#enrollment) throw new Error("Shell value restoration ownership is not prepared");
      return owner;
    };
    validate();
    return () => {
      const owner = validate();
      this.#holds.delete(held);
      this.#releases.delete(held.release);
      owner.scope = destination;
      destination.#holds.set(held, owner);
      destination.#releases.add(held.release);
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const release of this.#releases) release();
    if (this.#enrollment) this.arena.release(this.#enrollment);
  }
}

export class ValueStore {
  readonly #values = new Map<string, HeldValue>();
  readonly scope: ValueScope;

  constructor(readonly arena: ValueArena) { this.scope = arena.scope(); }

  get(name: string, text: string): ShellValue { return this.#values.get(name)?.value ?? text; }

  publish(name: string, value: ShellValue, action: () => boolean): boolean {
    const held = typeof value === "string" ? undefined : this.scope.hold(value);
    try {
      if (!action()) { held?.release(); return false; }
    } catch (error) { held?.release(); throw error; }
    this.invalidate(name);
    if (held) this.#values.set(name, held);
    return true;
  }

  invalidate(name?: string): void {
    if (name === undefined) {
      for (const value of this.#values.values()) value.release();
      this.#values.clear();
    } else {
      this.#values.get(name)?.release();
      this.#values.delete(name);
    }
  }

  clone(): ValueStore {
    const copy = new ValueStore(this.arena);
    try {
      for (const [name, held] of this.#values) copy.publish(name, held.value, () => true);
      return copy;
    } catch (error) { copy.close(); throw error; }
  }

  replace(entries: Iterable<readonly [string, ShellValue]>, action: () => void): void {
    const staged = new Map<string, HeldValue>();
    try {
      for (const [name, value] of entries) {
        if (typeof value !== "string") {
          const held = this.scope.hold(value);
          staged.get(name)?.release();
          staged.set(name, held);
        } else {
          staged.get(name)?.release();
          staged.delete(name);
        }
      }
      action();
    } catch (error) { for (const held of staged.values()) held.release(); throw error; }
    this.invalidate();
    for (const [name, held] of staged) this.#values.set(name, held);
  }

  restore(source: ValueStore, action: () => void): void {
    if (source === this) throw new Error("Shell value restoration requires an independent snapshot");
    const transfers = [...source.#values].map(([name, held]) => ({ name, held, transfer: source.scope.prepareTransfer(held, this.scope) }));
    action();
    this.invalidate();
    for (const { name, held, transfer } of transfers) {
      transfer();
      this.#values.set(name, held);
      source.#values.delete(name);
    }
  }

  restoreHeld(name: string, held: HeldValue, action: () => void): void {
    const transfer = this.scope.prepareTransfer(held, this.scope);
    action();
    this.invalidate(name);
    transfer();
    this.#values.set(name, held);
  }

  close(): void { this.invalidate(); this.scope.close(); }
}
