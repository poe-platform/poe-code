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

export type ValueArenaHost = {
  _aborted: boolean;
  readonly _hasExternalSignal: boolean;
  readonly signal: AbortSignal;
  fail(limit: "maxExpansionBytes" | "maxExpansionFields"): never;
};

export class ValueArena {
  declare readonly maximumBytes: number;
  declare readonly maximumSlots: number;
  declare readonly checkpoint: (() => void) | ValueArenaHost;
  declare readonly fail: (limit: "maxExpansionBytes" | "maxExpansionFields") => never;
  declare private _objects: WeakMap<object, AllocationRecord> | undefined;
  declare private _freeScopes: ValueScope[] | undefined;
  declare private _freeStores: ValueStore[] | undefined;
  declare private _freeRecords: AllocationRecord[] | undefined;
  declare private _epoch: number;
  declare private _bytes: number;
  declare private _slots: number;
  declare private _closed: boolean;

  constructor(maximumBytes: number, maximumSlots: number, checkpoint: (() => void) | ValueArenaHost, fail: (limit: "maxExpansionBytes" | "maxExpansionFields") => never = DEFAULT_VALUE_ARENA_FAIL) {
    this.maximumBytes = maximumBytes;
    this.maximumSlots = maximumSlots;
    this.checkpoint = checkpoint;
    this.fail = fail;
    this._objects = undefined;
    this._freeScopes = undefined;
    this._freeStores = undefined;
    this._freeRecords = undefined;
    this._epoch = 1;
    this._bytes = 0;
    this._slots = 0;
    this._closed = false;
  }

  get usage(): { bytes: number; slots: number } { return { bytes: this._bytes, slots: this._slots }; }

  private _failLimit(limit: "maxExpansionBytes" | "maxExpansionFields"): never {
    if (typeof this.checkpoint === "function") return this.fail(limit);
    return this.checkpoint.fail(limit);
  }

  assertOpen(): void {
    const cp = this.checkpoint;
    if (typeof cp === "function") cp();
    else if (cp._aborted || (cp._hasExternalSignal && cp.signal.aborted)) cp.signal.throwIfAborted();
    if (this._closed) throw new Error("Shell value arena is closed");
  }

  assertRetained(): void {
    if (this._closed) throw new Error("Shell value arena is closed");
  }

  scope(): ValueScope {
    this.assertOpen();
    const pooled = this._freeScopes?.pop();
    if (pooled) {
      pooled._reopen();
      return pooled;
    }
    return new ValueScope(this);
  }

  recycleScope(scope: ValueScope): void {
    if (!this._closed) {
      const list = this._freeScopes ??= [];
      if (list.length < 64) list.push(scope);
    }
  }

  createStore(): ValueStore {
    const pooled = this._freeStores?.pop();
    if (pooled) {
      this.assertOpen();
      pooled._reopen();
      return pooled;
    }
    return new ValueStore(this);
  }

  recycleStore(store: ValueStore): void {
    if (!this._closed) {
      const list = this._freeStores ??= [];
      if (list.length < 64) list.push(store);
    }
  }

  allocate(bytes: number, slots: number): AllocationRecord {
    this.assertOpen();
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(slots) || slots < 0) throw new RangeError("Invalid shell value allocation");
    if (bytes > this.maximumBytes - this._bytes) this._failLimit("maxExpansionBytes");
    if (slots > this.maximumSlots - this._slots) this._failLimit("maxExpansionFields");
    let record = this._freeRecords?.pop();
    if (record) {
      record.bytes = bytes;
      record.slots = slots;
      record.references = 1;
      record.epoch = this._epoch;
      record.object = undefined;
    } else {
      record = { arena: this, bytes, slots, references: 1, epoch: this._epoch };
    }
    this._bytes += bytes;
    this._slots += slots;
    return record;
  }

  grow(record: AllocationRecord, bytes: number): void {
    this.assertOpen();
    if (record.arena !== this || record.epoch !== this._epoch || record.object) throw new Error("Shell value reservation cannot grow");
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("Invalid shell value allocation");
    if (bytes > this.maximumBytes - this._bytes) this._failLimit("maxExpansionBytes");
    record.bytes += bytes;
    this._bytes += bytes;
  }

  resizeStringRecord(record: AllocationRecord, newBytes: number): void {
    this.assertOpen();
    if (record.arena !== this || record.epoch !== this._epoch || record.object || record.slots !== 0) throw new Error("Invalid string record resize");
    if (!Number.isSafeInteger(newBytes) || newBytes < 0) throw new RangeError("Invalid shell value allocation");
    const delta = newBytes - record.bytes;
    if (delta > this.maximumBytes - this._bytes) this._failLimit("maxExpansionBytes");
    this._bytes += delta;
    record.bytes = newBytes;
  }

  shrinkStringRecord(record: AllocationRecord, removedBytes: number): void {
    if (record.arena !== this || record.epoch !== this._epoch || record.object || record.slots !== 0) return;
    record.bytes -= removedBytes;
    this._bytes -= removedBytes;
  }

  commit(record: AllocationRecord, object: object): void {
    this.assertOpen();
    const objects = (this._objects ??= new WeakMap());
    if (record.arena !== this || record.epoch !== this._epoch || record.object || objects.has(object)) throw new Error("Shell value reservation is not fresh");
    record.object = object;
    objects.set(object, record);
  }

  release(record: AllocationRecord): void {
    if (record.arena !== this || record.epoch !== this._epoch) return;
    if (--record.references) return;
    record.epoch = 0;
    if (record.object) this._objects?.delete(record.object);
    else if (!this._closed) {
      const list = this._freeRecords ??= [];
      if (list.length < 128) list.push(record);
    }
    this._bytes -= record.bytes;
    this._slots -= record.slots;
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
      const existing = this._objects?.get(value);
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
    this._closed = true;
    this._epoch++;
    this._objects = undefined;
    if (this._freeScopes) this._freeScopes = undefined;
    if (this._freeStores) this._freeStores = undefined;
    if (this._freeRecords) this._freeRecords = undefined;
    this._bytes = 0;
    this._slots = 0;
  }
}

export class ValueScope implements ValueAllocation {
  declare readonly arena: ValueArena;
  declare _releases: Set<() => void> | undefined;
  declare _holds: Map<HeldValue, { scope: ValueScope }> | undefined;
  declare _closed: boolean;
  declare _enrollment: AllocationRecord | undefined;
  declare _bytesReservation: AllocationRecord | undefined;

  constructor(arena: ValueArena) {
    this.arena = arena;
    this._releases = undefined;
    this._holds = undefined;
    this._closed = false;
    this._enrollment = undefined;
    this._bytesReservation = undefined;
  }

  _reopen(): void {
    this._closed = false;
  }

  assertOpen(): void {
    this.arena.assertOpen();
    if (this._closed) throw new Error("Shell value scope is closed");
  }

  reserveBytes(bytes: number): void {
    this.assertOpen();
    this._enrollment ??= this.arena.allocate(64, 1);
    if (this._bytesReservation) this.arena.grow(this._bytesReservation, bytes);
    else this._bytesReservation = this.arena.allocate(bytes, 0);
  }

  reserve(bytes: number, slots: number): ValueReservation {
    this.assertOpen();
    this._enrollment ??= this.arena.allocate(64, 1);
    const record = this.arena.allocate(bytes, slots);
    let released = false;
    const releases = this._releases ??= new Set();
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
    if (typeof value !== "string") this._enrollment ??= this.arena.allocate(64, 1);
    const held = this.arena.hold(value) as HeldValue & { __stringRecord?: AllocationRecord };
    const owner = { scope: this as ValueScope };
    const result: HeldValue & { __stringRecord?: AllocationRecord; value: ShellValue } = {
      value,
      ...(held.__stringRecord ? { __stringRecord: held.__stringRecord } : {}),
      release: (): void => {
      owner.scope._holds?.delete(result);
      owner.scope._releases?.delete(result.release);
      held.release();
    } };
    const release = result.release;
    (this._releases ??= new Set()).add(release);
    (this._holds ??= new Map()).set(result, owner);
    return result;
  }

  prepareTransfer(held: HeldValue, destination: ValueScope): () => void {
    const validate = (): { scope: ValueScope } => {
      this.arena.assertRetained();
      const owner = this._holds?.get(held);
      if (!owner || this._closed || destination._closed || this.arena !== destination.arena || typeof held.value !== "string" && !destination._enrollment) throw new Error("Shell value restoration ownership is not prepared");
      return owner;
    };
    validate();
    return () => {
      const owner = validate();
      this._holds?.delete(held);
      this._releases?.delete(held.release);
      owner.scope = destination;
      (destination._holds ??= new Map()).set(held, owner);
      (destination._releases ??= new Set()).add(held.release);
    };
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    if (this._releases) {
      for (const release of this._releases) release();
    }
    if (this._bytesReservation) this.arena.release(this._bytesReservation);
    if (this._enrollment) this.arena.release(this._enrollment);
    if (!this._releases?.size && !this._holds?.size) {
      this._bytesReservation = undefined;
      this._enrollment = undefined;
      this.arena.recycleScope(this);
    }
  }

  closeForStoreRecycle(): boolean {
    if (this._closed) return false;
    this._closed = true;
    if (this._releases) {
      for (const release of this._releases) release();
    }
    if (this._bytesReservation) this.arena.release(this._bytesReservation);
    if (this._enrollment) this.arena.release(this._enrollment);
    if (!this._releases?.size && !this._holds?.size) {
      this._bytesReservation = undefined;
      this._enrollment = undefined;
      return true;
    }
    return false;
  }
}

export class ValueStore {
  declare readonly arena: ValueArena;
  declare private _values: Map<string, HeldValue> | undefined;
  declare private _strings: Map<string, string> | undefined;
  declare private _stringsShared: boolean;
  declare private _stringBytes: number;
  declare private _stringRecord: AllocationRecord | undefined;
  declare private _closed: boolean;
  declare private _scope: ValueScope | undefined;

  constructor(arena: ValueArena) {
    this.arena = arena;
    this._values = undefined;
    this._strings = undefined;
    this._stringsShared = false;
    this._stringBytes = 0;
    this._stringRecord = undefined;
    this._closed = false;
    this._scope = undefined;
    arena.assertOpen();
  }

  get scope(): ValueScope {
    return this._scope ??= new ValueScope(this.arena);
  }

  _reopen(): void {
    this._closed = false;
    this._scope?._reopen();
  }

  prewarm(): void {
    if (!this._strings) {
      const m = new Map<string, string>();
      for (let i = 0; i < 6; i++) m.set(String(i), "");
      for (let i = 0; i < 6; i++) m.delete(String(i));
      this._strings = m;
    }
    this._stringRecord ??= this.arena.allocate(0, 0);
  }

  get(name: string, text: string): ShellValue { return this._values?.get(name)?.value ?? this._strings?.get(name) ?? text; }

  publishString(name: string, value: string, rawVariables: Record<string, string | undefined>): void {
    const newBytes = value.length * 2;
    const held = this._values?.get(name);
    const oldStr = this._strings?.get(name);
    const oldBytes = oldStr !== undefined ? oldStr.length * 2 : 0;
    const delta = newBytes - oldBytes;
    const previousRecord = this._stringRecord;
    if (this._stringRecord) {
      if (delta !== 0) this.arena.resizeStringRecord(this._stringRecord, this._stringRecord.bytes + delta);
      else this.arena.assertOpen();
    } else {
      this._stringRecord = this.arena.allocate(newBytes, 0);
    }
    try { rawVariables[name] = value; }
    catch (error) {
      if (previousRecord) this.arena.shrinkStringRecord(previousRecord, delta);
      else {
        this.arena.release(this._stringRecord!);
        this._stringRecord = undefined;
      }
      throw error;
    }
    if (held) {
      held.release();
      this._values!.delete(name);
    }
    if (this._stringsShared && this._strings) {
      this._strings = new Map(this._strings);
      this._stringsShared = false;
    }
    (this._strings ??= new Map()).set(name, value);
    this._stringBytes += delta;
  }

  publish(name: string, value: ShellValue, action: () => boolean): boolean {
    if (typeof value === "string") {
      const newBytes = value.length * 2;
      const hadRecord = this._stringRecord !== undefined;
      if (this._stringRecord) this.arena.resizeStringRecord(this._stringRecord, this._stringRecord.bytes + newBytes);
      else this._stringRecord = this.arena.allocate(newBytes, 0);
      try {
        if (!action()) {
          if (hadRecord) this.arena.shrinkStringRecord(this._stringRecord!, newBytes);
          else { this.arena.release(this._stringRecord!); this._stringRecord = undefined; }
          return false;
        }
      } catch (error) {
        if (hadRecord) this.arena.shrinkStringRecord(this._stringRecord!, newBytes);
        else { this.arena.release(this._stringRecord!); this._stringRecord = undefined; }
        throw error;
      }
      this.invalidate(name);
      if (this._stringsShared && this._strings) {
        this._strings = new Map(this._strings);
        this._stringsShared = false;
      }
      (this._strings ??= new Map()).set(name, value);
      this._stringBytes += newBytes;
      return true;
    }
    const held = this.scope.hold(value);
    try {
      if (!action()) { held.release(); return false; }
    } catch (error) { held.release(); throw error; }
    this.invalidate(name);
    (this._values ??= new Map()).set(name, held);
    return true;
  }

  invalidate(name?: string): void {
    if (name === undefined) {
      if (this._values) {
        if (this._values.size > 0) {
          for (const value of this._values.values()) value.release();
          this._values.clear();
        }
      }
      if (this._stringsShared) {
        this._strings = undefined;
        this._stringsShared = false;
      } else if (this._strings && this._strings.size > 0) {
        if (this._closed) this._strings = undefined;
        else this._strings.clear();
      }
      this._stringBytes = 0;
      if (this._stringRecord) {
        this.arena.release(this._stringRecord);
        this._stringRecord = undefined;
      }
    } else {
      if (this._values) {
        this._values.get(name)?.release();
        this._values.delete(name);
      }
      const oldStr = this._strings?.get(name);
      if (oldStr !== undefined) {
        if (this._stringsShared) {
          this._strings = new Map(this._strings);
          this._stringsShared = false;
        }
        this._strings!.delete(name);
        const delta = oldStr.length * 2;
        this._stringBytes -= delta;
        if (this._stringRecord) this.arena.shrinkStringRecord(this._stringRecord, delta);
      }
    }
  }

  clone(): ValueStore {
    const copy = this.arena.createStore();
    try {
      if (this._stringRecord) {
        copy._stringRecord = this.arena.allocate(this._stringBytes, 0);
        copy._stringBytes = this._stringBytes;
        if (this._strings && this._strings.size > 0) {
          this._stringsShared = true;
          copy._strings = this._strings;
          copy._stringsShared = true;
        }
      }
      if (this._values) {
        for (const [name, held] of this._values) copy.publish(name, held.value, () => true);
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
      const values = this._values ??= new Map();
      for (const [name, held] of staged) values.set(name, held);
    }
  }

  restore(source: ValueStore, action: () => void): void {
    if (source === this) throw new Error("Shell value restoration requires an independent snapshot");
    this.arena.assertRetained();
    if (this._closed || source._closed || this.arena !== source.arena) throw new Error("Shell value restoration ownership is not prepared");
    const transfers = source._values ? [...source._values].map(([name, held]) => ({ name, held, transfer: source.scope.prepareTransfer(held, this.scope) })) : [];
    action();
    this.invalidate();
    if (source._stringRecord) {
      this._stringRecord = source._stringRecord;
      this._stringBytes = source._stringBytes;
      this._strings = source._strings;
      this._stringsShared = source._stringsShared;
      source._stringRecord = undefined;
      source._stringBytes = 0;
      source._strings = undefined;
      source._stringsShared = false;
    }
    if (transfers.length > 0) {
      const values = this._values ??= new Map();
      for (const { name, held, transfer } of transfers) {
        transfer();
        values.set(name, held);
        source._values!.delete(name);
      }
    }
  }

  restoreHeld(name: string, held: HeldValue, action: () => void): void {
    const transfer = this.scope.prepareTransfer(held, this.scope);
    action();
    this.invalidate(name);
    transfer();
    (this._values ??= new Map()).set(name, held);
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    if (this.arena["_closed"]) {
      if (this._values && this._values.size > 0) {
        for (const value of this._values.values()) value.release();
      }
      this._values = undefined;
      this._strings = undefined;
      this._stringRecord = undefined;
      this._stringBytes = 0;
      return;
    }
    this.invalidate();
    if (!this._scope || this._scope.closeForStoreRecycle()) {
      this.arena.recycleStore(this);
    }
  }
}
