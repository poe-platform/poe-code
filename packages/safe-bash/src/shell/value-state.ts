import { shellValueRetainedBytes } from "../contracts/value.js";
import type { ShellValue, ValueAllocation, ValueReservation } from "../contracts/value.js";
import { ShellLimitError } from "./types.js";

interface AllocationRecord {
  readonly arena: ValueArena;
  bytes: number;
  slots: number;
  references: number;
  epoch: number;
  object?: object | undefined;
}

export interface HeldValue {
  readonly value: ShellValue;
  release(): void;
}

const DEFAULT_VALUE_ARENA_FAIL = (limit: "maxExpansionBytes" | "maxExpansionFields"): never => {
  throw new ShellLimitError(limit);
};

export class ValueArena {
  #objects: WeakMap<object, AllocationRecord> | undefined;
  #freeScopes: ValueScope[] | undefined;
  #freeStores: ValueStore[] | undefined;
  #freeRecords: AllocationRecord[] | undefined;
  #epoch = 1;
  #bytes = 0;
  #slots = 0;
  #closed = false;

  constructor(readonly maximumBytes: number, readonly maximumSlots: number, readonly checkpoint: () => void, readonly fail: (limit: "maxExpansionBytes" | "maxExpansionFields") => never = DEFAULT_VALUE_ARENA_FAIL) {}

  get usage(): { bytes: number; slots: number } { return { bytes: this.#bytes, slots: this.#slots }; }

  assertOpen(): void {
    this.checkpoint();
    this.assertRetained();
  }

  assertRetained(): void {
    if (this.#closed) throw new Error("Shell value arena is closed");
  }

  scope(): ValueScope {
    this.assertOpen();
    const pooled = this.#freeScopes?.pop();
    if (pooled) {
      pooled._reopen();
      return pooled;
    }
    return new ValueScope(this);
  }

  recycleScope(scope: ValueScope): void {
    if (!this.#closed) {
      const list = this.#freeScopes ??= [];
      if (list.length < 64) list.push(scope);
    }
  }

  createStore(): ValueStore {
    const pooled = this.#freeStores?.pop();
    if (pooled) {
      this.assertOpen();
      pooled._reopen();
      return pooled;
    }
    return new ValueStore(this);
  }

  recycleStore(store: ValueStore): void {
    if (!this.#closed) {
      const list = this.#freeStores ??= [];
      if (list.length < 64) list.push(store);
    }
  }

  allocate(bytes: number, slots: number): AllocationRecord {
    this.assertOpen();
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(slots) || slots < 0) throw new RangeError("Invalid shell value allocation");
    if (bytes > this.maximumBytes - this.#bytes) this.fail("maxExpansionBytes");
    if (slots > this.maximumSlots - this.#slots) this.fail("maxExpansionFields");
    let record = this.#freeRecords?.pop();
    if (record) {
      record.bytes = bytes;
      record.slots = slots;
      record.references = 1;
      record.epoch = this.#epoch;
      record.object = undefined;
    } else {
      record = { arena: this, bytes, slots, references: 1, epoch: this.#epoch };
    }
    this.#bytes += bytes;
    this.#slots += slots;
    return record;
  }

  grow(record: AllocationRecord, bytes: number): void {
    this.assertOpen();
    if (record.arena !== this || record.epoch !== this.#epoch || record.object) throw new Error("Shell value reservation cannot grow");
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("Invalid shell value allocation");
    if (bytes > this.maximumBytes - this.#bytes) this.fail("maxExpansionBytes");
    record.bytes += bytes;
    this.#bytes += bytes;
  }

  resizeStringRecord(record: AllocationRecord, newBytes: number): void {
    this.assertOpen();
    if (record.arena !== this || record.epoch !== this.#epoch || record.object || record.slots !== 0) throw new Error("Invalid string record resize");
    if (!Number.isSafeInteger(newBytes) || newBytes < 0) throw new RangeError("Invalid shell value allocation");
    const delta = newBytes - record.bytes;
    if (delta > this.maximumBytes - this.#bytes) this.fail("maxExpansionBytes");
    this.#bytes += delta;
    record.bytes = newBytes;
  }

  shrinkStringRecord(record: AllocationRecord, removedBytes: number): void {
    if (record.arena !== this || record.epoch !== this.#epoch || record.object || record.slots !== 0) return;
    record.bytes -= removedBytes;
    this.#bytes -= removedBytes;
  }

  commit(record: AllocationRecord, object: object): void {
    this.assertOpen();
    const objects = (this.#objects ??= new WeakMap());
    if (record.arena !== this || record.epoch !== this.#epoch || record.object || objects.has(object)) throw new Error("Shell value reservation is not fresh");
    record.object = object;
    objects.set(object, record);
  }

  release(record: AllocationRecord): void {
    if (record.arena !== this || record.epoch !== this.#epoch) return;
    if (--record.references) return;
    record.epoch = 0;
    if (record.object) this.#objects?.delete(record.object);
    else {
      const list = this.#freeRecords ??= [];
      if (list.length < 128) list.push(record);
    }
    this.#bytes -= record.bytes;
    this.#slots -= record.slots;
  }

  hold(value: ShellValue): HeldValue {
    this.assertOpen();
    if (typeof value === "string") {
      const payload = this.allocate(value.length * 2, 0);
      let released = false;
      const held: HeldValue & { __stringRecord?: AllocationRecord; value: ShellValue } = { value, __stringRecord: payload, release: () => {
        if (released) return;
        released = true;
        this.release(payload);
      } };
      return held;
    }
    const reference = this.allocate(32, 1);
    let payload: AllocationRecord;
    try {
      const existing = this.#objects?.get(value);
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
    this.#epoch++;
    this.#objects = undefined;
    if (this.#freeScopes) this.#freeScopes.length = 0;
    if (this.#freeScopes) this.#freeScopes = undefined;
    if (this.#freeStores) this.#freeStores.length = 0;
    if (this.#freeStores) this.#freeStores = undefined;
    if (this.#freeRecords) this.#freeRecords.length = 0;
    if (this.#freeRecords) this.#freeRecords = undefined;
    this.#bytes = 0;
    this.#slots = 0;
  }
}

export class ValueScope implements ValueAllocation {
  #releases: Set<() => void> | undefined;
  #holds: Map<HeldValue, { scope: ValueScope }> | undefined;
  #closed = false;
  #enrollment: AllocationRecord | undefined;
  #bytesReservation: AllocationRecord | undefined;

  constructor(readonly arena: ValueArena) {}

  _reopen(): void {
    this.#closed = false;
  }

  assertOpen(): void {
    this.arena.assertOpen();
    if (this.#closed) throw new Error("Shell value scope is closed");
  }

  reserveBytes(bytes: number): void {
    this.assertOpen();
    this.#enrollment ??= this.arena.allocate(64, 1);
    if (this.#bytesReservation) this.arena.grow(this.#bytesReservation, bytes);
    else this.#bytesReservation = this.arena.allocate(bytes, 0);
  }

  reserve(bytes: number, slots: number): ValueReservation {
    this.assertOpen();
    this.#enrollment ??= this.arena.allocate(64, 1);
    const record = this.arena.allocate(bytes, slots);
    let released = false;
    const releases = this.#releases ??= new Set();
    const release = (): void => {
      if (released) return;
      released = true;
      releases.delete(release);
      this.arena.release(record);
    };
    releases.add(release);
    return { commit: value => { this.assertOpen(); if (released) throw new Error("Shell value reservation is released"); this.arena.commit(record, value); }, release };
  }

  hold(value: ShellValue): HeldValue {
    this.assertOpen();
    if (typeof value !== "string") this.#enrollment ??= this.arena.allocate(64, 1);
    const held = this.arena.hold(value) as HeldValue & { __stringRecord?: AllocationRecord };
    const owner = { scope: this as ValueScope };
    const result: HeldValue & { __stringRecord?: AllocationRecord; value: ShellValue } = {
      value,
      ...(held.__stringRecord ? { __stringRecord: held.__stringRecord } : {}),
      release: (): void => {
      owner.scope.#holds?.delete(result);
      owner.scope.#releases?.delete(result.release);
      held.release();
    } };
    const release = result.release;
    (this.#releases ??= new Set()).add(release);
    (this.#holds ??= new Map()).set(result, owner);
    return result;
  }

  prepareTransfer(held: HeldValue, destination: ValueScope): () => void {
    const validate = (): { scope: ValueScope } => {
      this.arena.assertRetained();
      const owner = this.#holds?.get(held);
      if (!owner || this.#closed || destination.#closed || this.arena !== destination.arena || typeof held.value !== "string" && !destination.#enrollment) throw new Error("Shell value restoration ownership is not prepared");
      return owner;
    };
    validate();
    return () => {
      const owner = validate();
      this.#holds?.delete(held);
      this.#releases?.delete(held.release);
      owner.scope = destination;
      (destination.#holds ??= new Map()).set(held, owner);
      (destination.#releases ??= new Set()).add(held.release);
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#releases) {
      for (const release of this.#releases) release();
    }
    if (this.#bytesReservation) this.arena.release(this.#bytesReservation);
    if (this.#enrollment) this.arena.release(this.#enrollment);
    if (!this.#releases?.size && !this.#holds?.size) {
      this.#bytesReservation = undefined;
      this.#enrollment = undefined;
      this.arena.recycleScope(this);
    }
  }

  closeForStoreRecycle(): boolean {
    if (this.#closed) return false;
    this.#closed = true;
    if (this.#releases) {
      for (const release of this.#releases) release();
    }
    if (this.#bytesReservation) this.arena.release(this.#bytesReservation);
    if (this.#enrollment) this.arena.release(this.#enrollment);
    if (!this.#releases?.size && !this.#holds?.size) {
      this.#bytesReservation = undefined;
      this.#enrollment = undefined;
      return true;
    }
    return false;
  }
}

export class ValueStore {
  #values: Map<string, HeldValue> | undefined;
  #strings: Map<string, string> | undefined;
  #stringsShared = false;
  #stringBytes = 0;
  #stringRecord: AllocationRecord | undefined;
  #closed = false;
  #scope: ValueScope | undefined;

  constructor(readonly arena: ValueArena) {
    arena.assertOpen();
  }

  get scope(): ValueScope {
    return this.#scope ??= new ValueScope(this.arena);
  }

  _reopen(): void {
    this.#closed = false;
    this.#scope?._reopen();
  }

  get(name: string, text: string): ShellValue { return this.#values?.get(name)?.value ?? this.#strings?.get(name) ?? text; }

  publishString(name: string, value: string, rawVariables: Record<string, string | undefined>): void {
    const newBytes = value.length * 2;
    const held = this.#values?.get(name);
    const oldStr = this.#strings?.get(name);
    const oldBytes = oldStr !== undefined ? oldStr.length * 2 : 0;
    const delta = newBytes - oldBytes;
    const previousRecord = this.#stringRecord;
    if (this.#stringRecord) {
      if (delta !== 0) this.arena.resizeStringRecord(this.#stringRecord, this.#stringRecord.bytes + delta);
      else this.arena.assertOpen();
    } else {
      this.#stringRecord = this.arena.allocate(newBytes, 0);
    }
    try { rawVariables[name] = value; }
    catch (error) {
      if (previousRecord) this.arena.shrinkStringRecord(previousRecord, delta);
      else {
        this.arena.release(this.#stringRecord!);
        this.#stringRecord = undefined;
      }
      throw error;
    }
    if (held) {
      held.release();
      this.#values!.delete(name);
    }
    if (this.#stringsShared && this.#strings) {
      this.#strings = new Map(this.#strings);
      this.#stringsShared = false;
    }
    (this.#strings ??= new Map()).set(name, value);
    this.#stringBytes += delta;
  }

  publish(name: string, value: ShellValue, action: () => boolean): boolean {
    if (typeof value === "string") {
      const newBytes = value.length * 2;
      const hadRecord = this.#stringRecord !== undefined;
      if (this.#stringRecord) this.arena.resizeStringRecord(this.#stringRecord, this.#stringRecord.bytes + newBytes);
      else this.#stringRecord = this.arena.allocate(newBytes, 0);
      try {
        if (!action()) {
          if (hadRecord) this.arena.shrinkStringRecord(this.#stringRecord!, newBytes);
          else { this.arena.release(this.#stringRecord!); this.#stringRecord = undefined; }
          return false;
        }
      } catch (error) {
        if (hadRecord) this.arena.shrinkStringRecord(this.#stringRecord!, newBytes);
        else { this.arena.release(this.#stringRecord!); this.#stringRecord = undefined; }
        throw error;
      }
      this.invalidate(name);
      if (this.#stringsShared && this.#strings) {
        this.#strings = new Map(this.#strings);
        this.#stringsShared = false;
      }
      (this.#strings ??= new Map()).set(name, value);
      this.#stringBytes += newBytes;
      return true;
    }
    const held = this.scope.hold(value);
    try {
      if (!action()) { held.release(); return false; }
    } catch (error) { held.release(); throw error; }
    this.invalidate(name);
    (this.#values ??= new Map()).set(name, held);
    return true;
  }

  invalidate(name?: string): void {
    if (name === undefined) {
      if (this.#values) {
        for (const value of this.#values.values()) value.release();
        this.#values.clear();
      }
      if (this.#stringsShared) {
        this.#strings = undefined;
        this.#stringsShared = false;
      } else if (this.#strings) {
        this.#strings.clear();
      }
      this.#stringBytes = 0;
      if (this.#stringRecord) {
        this.arena.release(this.#stringRecord);
        this.#stringRecord = undefined;
      }
    } else {
      if (this.#values) {
        this.#values.get(name)?.release();
        this.#values.delete(name);
      }
      const oldStr = this.#strings?.get(name);
      if (oldStr !== undefined) {
        if (this.#stringsShared) {
          this.#strings = new Map(this.#strings);
          this.#stringsShared = false;
        }
        this.#strings!.delete(name);
        const delta = oldStr.length * 2;
        this.#stringBytes -= delta;
        if (this.#stringRecord) this.arena.shrinkStringRecord(this.#stringRecord, delta);
      }
    }
  }

  clone(): ValueStore {
    const copy = this.arena.createStore();
    try {
      if (this.#stringRecord) {
        copy.#stringRecord = this.arena.allocate(this.#stringBytes, 0);
        copy.#stringBytes = this.#stringBytes;
        if (this.#strings && this.#strings.size > 0) {
          this.#stringsShared = true;
          copy.#strings = this.#strings;
          copy.#stringsShared = true;
        }
      }
      if (this.#values) {
        for (const [name, held] of this.#values) copy.publish(name, held.value, () => true);
      }
      return copy;
    } catch (error) { copy.close(); throw error; }
  }

  replace(entries: Iterable<readonly [string, ShellValue]>, action: () => void): void {
    const staged = new Map<string, HeldValue>();
    try {
      for (const [name, value] of entries) {
        const held = this.scope.hold(value);
        staged.get(name)?.release();
        staged.set(name, held);
      }
      action();
    } catch (error) { for (const held of staged.values()) held.release(); throw error; }
    this.invalidate();
    if (staged.size > 0) {
      const values = this.#values ??= new Map();
      for (const [name, held] of staged) values.set(name, held);
    }
  }

  restore(source: ValueStore, action: () => void): void {
    if (source === this) throw new Error("Shell value restoration requires an independent snapshot");
    this.arena.assertRetained();
    if (this.#closed || source.#closed || this.arena !== source.arena) throw new Error("Shell value restoration ownership is not prepared");
    const transfers = source.#values ? [...source.#values].map(([name, held]) => ({ name, held, transfer: source.scope.prepareTransfer(held, this.scope) })) : [];
    action();
    this.invalidate();
    if (source.#stringRecord) {
      this.#stringRecord = source.#stringRecord;
      this.#stringBytes = source.#stringBytes;
      this.#strings = source.#strings;
      this.#stringsShared = source.#stringsShared;
      source.#stringRecord = undefined;
      source.#stringBytes = 0;
      source.#strings = undefined;
      source.#stringsShared = false;
    }
    if (transfers.length > 0) {
      const values = this.#values ??= new Map();
      for (const { name, held, transfer } of transfers) {
        transfer();
        values.set(name, held);
        source.#values!.delete(name);
      }
    }
  }

  restoreHeld(name: string, held: HeldValue, action: () => void): void {
    const transfer = this.scope.prepareTransfer(held, this.scope);
    action();
    this.invalidate(name);
    transfer();
    (this.#values ??= new Map()).set(name, held);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.invalidate();
    if (!this.#scope || this.#scope.closeForStoreRecycle()) {
      this.arena.recycleStore(this);
    }
  }
}
