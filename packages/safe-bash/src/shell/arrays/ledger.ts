import { yieldTurn } from "../../contracts/yield.js";
export class ArrayFailure extends Error {
  constructor(detail: string) { super(`indexed array: ${detail}`); }
}

export interface Charge {
  readonly wrappers?: number;
  readonly slots?: number;
  readonly payload?: number;
  readonly metadata?: number;
  readonly allocatedSlots?: number;
  readonly work?: number;
  readonly generation?: boolean | number;
  readonly version?: boolean | number;
  readonly epoch?: boolean | number;
}

export interface Tickets {
  readonly generation: number;
  readonly version: number;
  readonly epoch: number;
}

const labels = ["wrapper", "Map slot", "payload", "metadata", "allocated byte", "allocated slot", "work"] as const;
type Counters = [number, number, number, number, number, number, number];

export class Admission implements Tickets {
  previous: Admission | undefined;
  next: Admission | undefined;
  owner: ArrayOwner | undefined;
  released = false;
  cleanup: (() => void) | undefined;
  restorationReferences = 0;

  constructor(
    readonly ledger: ArrayLedger,
    public wrappers: number,
    public slots: number,
    public payload: number,
    public metadata: number,
    public generation: number,
    public version: number,
    public epoch: number,
  ) {}

  _reset(
    wrappers: number,
    slots: number,
    payload: number,
    metadata: number,
    generation: number,
    version: number,
    epoch: number,
  ): void {
    this.wrappers = wrappers;
    this.slots = slots;
    this.payload = payload;
    this.metadata = metadata;
    this.generation = generation;
    this.version = version;
    this.epoch = epoch;
    this.previous = undefined;
    this.next = undefined;
    this.owner = undefined;
    this.released = false;
    this.cleanup = undefined;
    this.restorationReferences = 0;
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.cleanup?.();
    this.owner?.detach(this);
    this.ledger.release(this);
  }
}

export class ArrayLedger {
  private caps: Counters | undefined;
  private used: Counters | undefined;
  private c3Smi = -1;
  private c4Smi = -1;
  private c5Smi = -1;
  private c6Smi = -1;
  private u0Smi = 0;
  private u1Smi = 0;
  private u2Smi = 0;
  private u3Smi = 0;
  private u4Smi = 0;
  private u5Smi = 0;
  private u6Smi = 0;
  private sequence: { lastIssued: number };
  private checkpointCount = 0;
  private freeAdmissions: Admission[] | undefined;

  constructor(readonly bytes: number, readonly fields: number, initialTicket = 0, sharedSequence?: { lastIssued: number }) {
    if (!Number.isSafeInteger(initialTicket) || initialTicket < 0) throw new RangeError("Invalid private initial ticket");
    this.sequence = sharedSequence ?? { lastIssued: initialTicket };
  }

  internal(commandLimit: number): ArrayLedger {
    if (commandLimit === Infinity) {
      return new ArrayLedger(Infinity, Infinity, 0, this.sequence);
    }
    const requested = BigInt(commandLimit) + 1n;
    const maximum = BigInt(Number.MAX_SAFE_INTEGER) / 33024n;
    const units = requested < maximum ? requested : maximum;
    return new ArrayLedger(Number(32n * units), Number(64n * units), 0, this.sequence);
  }

  get active(): boolean { return this.caps !== undefined; }

  private syncUsedArray(): Counters {
    const used = this.used ??= [0, 0, 0, 0, 0, 0, 0];
    used[0] = this.u0Smi;
    used[1] = this.u1Smi;
    used[2] = this.u2Smi;
    used[3] = this.u3Smi;
    used[4] = this.u4Smi;
    used[5] = this.u5Smi;
    used[6] = this.u6Smi;
    return used;
  }

  snapshot(): { readonly caps: readonly number[] | undefined; readonly used: readonly number[]; readonly lastIssued: number } {
    const used = this.syncUsedArray();
    return { caps: this.caps?.slice(), used: used.slice(), lastIssued: this.sequence.lastIssued };
  }

  private activateCaps(caps: Counters): void {
    if (!this.caps) {
      this.caps = caps;
      this.c3Smi = caps[3]! <= 0x3fffffff ? (caps[3]! | 0) : 0x3fffffff;
      this.c4Smi = caps[4]! <= 0x3fffffff ? (caps[4]! | 0) : 0x3fffffff;
      this.c5Smi = caps[5]! <= 0x3fffffff ? (caps[5]! | 0) : 0x3fffffff;
      this.c6Smi = caps[6]! <= 0x3fffffff ? (caps[6]! | 0) : 0x3fffffff;
    }
  }

  charge(charge: Charge = {}, out?: { generation: number; version: number; epoch: number }): Tickets {
    if (
      this.c4Smi >= 0 &&
      charge.wrappers === undefined &&
      charge.slots === undefined &&
      charge.payload === undefined &&
      charge.allocatedSlots === undefined
    ) {
      const rawMeta = charge.metadata ?? 0;
      const rawWork = charge.work ?? 0;
      if ((rawMeta | 0) === rawMeta && rawMeta >= 0 && rawMeta <= 0x1fffffff && (rawWork | 0) === rawWork && rawWork >= 0 && rawWork <= 0x1fffffff) {
        const metaNum = (rawMeta + 64) | 0;
        const workNum = (rawWork + 15) | 0;
        const nextU4 = this.u4Smi + metaNum;
        const nextU6 = this.u6Smi + workNum;
        if (metaNum <= this.c3Smi - this.u3Smi && nextU4 <= this.c4Smi && nextU6 <= this.c6Smi) {
          let cursor = this.sequence.lastIssued;
          let generation = 0;
          if (charge.generation) {
            const count = charge.generation === true ? 1 : charge.generation;
            if ((count | 0) !== count || count < 0 || count > 0x3fffffff - cursor) return this.chargeSlow(charge, out);
            cursor = (cursor + (count | 0)) | 0;
            generation = cursor;
          }
          let version = 0;
          if (charge.version) {
            const count = charge.version === true ? 1 : charge.version;
            if ((count | 0) !== count || count < 0 || count > 0x3fffffff - cursor) return this.chargeSlow(charge, out);
            cursor = (cursor + (count | 0)) | 0;
            version = cursor;
          }
          let epoch = 0;
          if (charge.epoch) {
            const count = charge.epoch === true ? 1 : charge.epoch;
            if ((count | 0) !== count || count < 0 || count > 0x3fffffff - cursor) return this.chargeSlow(charge, out);
            cursor = (cursor + (count | 0)) | 0;
            epoch = cursor;
          }
          this.sequence.lastIssued = cursor;
          this.u4Smi = nextU4 | 0;
          this.u6Smi = nextU6 | 0;
          if (out) {
            out.generation = generation;
            out.version = version;
            out.epoch = epoch;
            return out;
          }
          return { generation, version, epoch };
        }
      }
    }
    return this.chargeSlow(charge, out);
  }

  private chargeSlow(charge: Charge, out?: { generation: number; version: number; epoch: number }): Tickets {
    const admission = this.reserve(charge);
    admission.release();
    if (out) {
      out.generation = admission.generation;
      out.version = admission.version;
      out.epoch = admission.epoch;
      return out;
    }
    return { generation: admission.generation, version: admission.version, epoch: admission.epoch };
  }

  reserve(charge: Charge = {}): Admission {
    const caps = this.caps ?? this.derive();
    let cursor = this.sequence.lastIssued;
    let generation = 0;
    if (charge.generation) {
      const count = charge.generation === true ? 1 : charge.generation;
      if (!Number.isSafeInteger(count) || count < 0 || count > Number.MAX_SAFE_INTEGER - cursor) throw new ArrayFailure("private generation capacity exhausted");
      cursor += count;
      generation = cursor;
    }
    let version = 0;
    if (charge.version) {
      const count = charge.version === true ? 1 : charge.version;
      if (!Number.isSafeInteger(count) || count < 0 || count > Number.MAX_SAFE_INTEGER - cursor) throw new ArrayFailure("private version capacity exhausted");
      cursor += count;
      version = cursor;
    }
    let epoch = 0;
    if (charge.epoch) {
      const count = charge.epoch === true ? 1 : charge.epoch;
      if (!Number.isSafeInteger(count) || count < 0 || count > Number.MAX_SAFE_INTEGER - cursor) throw new ArrayFailure("private epoch capacity exhausted");
      cursor += count;
      epoch = cursor;
    }
    const wrappers = charge.wrappers ?? 0;
    const slots = charge.slots ?? 0;
    const payload = charge.payload ?? 0;
    const rawMeta = charge.metadata ?? 0;
    const allocatedSlots = charge.allocatedSlots ?? slots;
    const rawWork = charge.work ?? 0;
    if (
      Number.isSafeInteger(wrappers) && wrappers >= 0 &&
      Number.isSafeInteger(slots) && slots >= 0 &&
      Number.isSafeInteger(payload) && payload >= 0 &&
      Number.isSafeInteger(rawMeta) && rawMeta >= 0 && rawMeta <= Number.MAX_SAFE_INTEGER - 64 &&
      Number.isSafeInteger(allocatedSlots) && allocatedSlots >= 0 &&
      Number.isSafeInteger(rawWork) && rawWork >= 0 && rawWork <= Number.MAX_SAFE_INTEGER - 15
    ) {
      const metadataNum = rawMeta + 64;
      const allocBytes = payload + metadataNum;
      const workNum = rawWork + 15;
      if (Number.isSafeInteger(allocBytes)) {
        if (caps[0]! !== Infinity && wrappers > caps[0]! - this.u0Smi) throw new ArrayFailure(`private ${labels[0]} limit exceeded`);
        if (caps[1]! !== Infinity && slots > caps[1]! - this.u1Smi) throw new ArrayFailure(`private ${labels[1]} limit exceeded`);
        if (caps[2]! !== Infinity && payload > caps[2]! - this.u2Smi) throw new ArrayFailure(`private ${labels[2]} limit exceeded`);
        if (caps[3]! !== Infinity && metadataNum > caps[3]! - this.u3Smi) throw new ArrayFailure(`private ${labels[3]} limit exceeded`);
        if (caps[4]! !== Infinity && allocBytes > caps[4]! - this.u4Smi) throw new ArrayFailure(`private ${labels[4]} limit exceeded`);
        if (caps[5]! !== Infinity && allocatedSlots > caps[5]! - this.u5Smi) throw new ArrayFailure(`private ${labels[5]} limit exceeded`);
        if (caps[6]! !== Infinity && workNum > caps[6]! - this.u6Smi) throw new ArrayFailure(`private ${labels[6]} limit exceeded`);
        this.activateCaps(caps);
        this.sequence.lastIssued = cursor;
        this.u0Smi += wrappers;
        this.u1Smi += slots;
        this.u2Smi += payload;
        this.u3Smi += metadataNum;
        this.u4Smi += allocBytes;
        this.u5Smi += allocatedSlots;
        this.u6Smi += workNum;
        const pooled = this.freeAdmissions?.pop();
        if (pooled) {
          pooled._reset(wrappers, slots, payload, metadataNum, generation, version, epoch);
          return pooled;
        }
        return new Admission(this, wrappers, slots, payload, metadataNum, generation, version, epoch);
      }
    }
    const used = this.syncUsedArray();
    const metadataRequest = BigInt(charge.metadata ?? 0) + 64n;
    const work = BigInt(charge.work ?? 0) + 15n;
    const requested = [BigInt(wrappers), BigInt(slots), BigInt(payload), metadataRequest, BigInt(payload) + metadataRequest, BigInt(allocatedSlots), work];
    for (let index = 0; index < requested.length; index++) {
      const amount = requested[index]!;
      if (amount < 0n || caps[index] !== Infinity && amount > BigInt(caps[index]! - used[index]!)) {
        throw new ArrayFailure(`private ${labels[index]} limit exceeded`);
      }
    }
    this.activateCaps(caps);
    this.sequence.lastIssued = cursor;
    this.u0Smi += Number(requested[0]!);
    this.u1Smi += Number(requested[1]!);
    this.u2Smi += Number(requested[2]!);
    this.u3Smi += Number(requested[3]!);
    this.u4Smi += Number(requested[4]!);
    this.u5Smi += Number(requested[5]!);
    this.u6Smi += Number(requested[6]!);
    return new Admission(this, wrappers, slots, payload, Number(metadataRequest), generation, version, epoch);
  }

  private derive(): Counters {
    if (this.bytes === Infinity || this.fields === Infinity) {
      return [this.fields, this.fields, this.bytes, 128 * this.fields, 8 * this.bytes + 512 * this.fields, 8 * this.fields, 32 * this.bytes + 256 * this.fields];
    }
    const bytes = BigInt(this.bytes);
    const fields = BigInt(this.fields);
    const values = [fields, fields, bytes, 128n * fields, 8n * bytes + 512n * fields, 8n * fields, 32n * bytes + 256n * fields];
    const result: Counters = [0, 0, 0, 0, 0, 0, 0];
    for (let index = 0; index < values.length; index++) {
      const value = values[index]!;
      if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ArrayFailure(`private ${labels[index]} capacity is not representable`);
      result[index] = Number(value);
    }
    return result;
  }

  release(admission: Admission): void {
    this.u0Smi -= admission.wrappers;
    this.u1Smi -= admission.slots;
    this.u2Smi -= admission.payload;
    this.u3Smi -= admission.metadata;
    admission.cleanup = undefined;
    admission.restorationReferences = 0;
    const free = this.freeAdmissions ??= [];
    if (free.length < 128) free.push(admission);
  }

  checkpoint(signal?: AbortSignal, units = 1): Promise<void> | undefined {
    signal?.throwIfAborted();
    this.checkpointCount += units;
    if (this.checkpointCount >= 128) {
      this.checkpointCount %= 128;
      return yieldTurn(signal);
    }
  }
}

export function exactSum(left: number, right: number): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0 || left > Number.MAX_SAFE_INTEGER - right) {
    throw new ArrayFailure("private allocated byte capacity is not representable");
  }
  return left + right;
}

const resolvedPromise: Promise<void> = Object.defineProperty(Promise.resolve(), Symbol.for("safe-bash.syncResolved"), { value: true });
const sharedDiscardTickets = { generation: 0, version: 0, epoch: 0 };

export class ArrayOwner {
  declare readonly ledger: ArrayLedger;
  declare readonly parent: ArrayOwner | undefined;
  declare readonly header: Admission;
  declare private _head: Admission | undefined;
  declare private _firstChild: ArrayOwner | undefined;
  declare private _nextSibling: ArrayOwner | undefined;
  declare private _previousSibling: ArrayOwner | undefined;
  declare private _closed: boolean;
  declare private _started: boolean;
  declare private _resolve: (() => void) | undefined;
  declare private _reject: ((error: unknown) => void) | undefined;
  declare private _holds: number;
  declare private _resolveIdle: (() => void) | undefined;
  declare private _idle: Promise<void> | undefined;
  declare private _releasing: boolean;
  declare private _completion: Promise<void> | undefined;

  private constructor(ledger: ArrayLedger, parent: ArrayOwner | undefined, header: Admission) {
    this.ledger = ledger;
    this.parent = parent;
    this.header = header;
    this._head = undefined;
    this._firstChild = undefined;
    this._nextSibling = undefined;
    this._previousSibling = undefined;
    this._closed = false;
    this._started = false;
    this._resolve = undefined;
    this._reject = undefined;
    this._holds = 0;
    this._resolveIdle = undefined;
    this._idle = undefined;
    this._releasing = false;
    this._completion = undefined;
  }

  get completion(): Promise<void> {
    if (!this._completion) {
      this._completion = new Promise<void>((resolve, reject) => { this._resolve = resolve; this._reject = reject; });
      void this._completion.catch(() => undefined);
    }
    return this._completion;
  }

  static create(ledger: ArrayLedger, parent?: ArrayOwner): ArrayOwner {
    parent?.assertOpen();
    const header = ledger.reserve({ metadata: 64, work: 9 });
    const owner = new ArrayOwner(ledger, parent, header);
    if (parent) {
      owner._nextSibling = parent._firstChild;
      if (parent._firstChild) parent._firstChild._previousSibling = owner;
      parent._firstChild = owner;
    }
    return owner;
  }

  assertOpen(): void {
    if (this._closed) throw new ArrayFailure("ownership admission is closed");
    this.parent?.assertOpen();
  }

  reserve(charge: Charge): Admission {
    this.assertOpen();
    return this.adopt(this.ledger.reserve(charge));
  }

  charge(charge: Charge, out?: { generation: number; version: number; epoch: number }): Tickets {
    this.assertOpen();
    return this.ledger.charge(charge, out);
  }

  chargeWork(work: number): void {
    this.assertOpen();
    this.ledger.charge({ work }, sharedDiscardTickets);
  }

  adopt(admission: Admission, prepaid = false): Admission {
    const root = this.root();
    if (!prepaid || !root._holds || root._releasing) this.assertOpen();
    if (admission.released || admission.ledger !== this.ledger) throw new Error("Invalid indexed-array ownership transfer");
    admission.owner?.detach(admission);
    admission.owner = this;
    admission.previous = undefined;
    admission.next = this._head;
    if (this._head) this._head.previous = admission;
    this._head = admission;
    return admission;
  }

  share(admission: Admission): void {
    this.assertOpen();
    const source = admission.owner;
    if (admission.released || !source || admission.ledger !== this.ledger || source.root() !== this.root()) {
      throw new ArrayFailure("cell ownership is not shareable");
    }
    source.assertOpen();
    for (let destination: ArrayOwner | undefined = source; destination; destination = destination.parent) {
      let common = destination === this;
      for (let ancestor = this.parent; ancestor && !common; ancestor = ancestor.parent) {
        common = destination === ancestor;
      }
      if (common) {
        if (source !== destination) destination.adopt(admission);
        return;
      }
    }
  }

  private root(): ArrayOwner {
    let root: ArrayOwner = this;
    while (root.parent) root = root.parent;
    return root;
  }

  hold(): Admission {
    this.assertOpen();
    const root = this.root();
    if (root._holds === Number.MAX_SAFE_INTEGER) throw new ArrayFailure("resource capacity exhausted");
    const admission = this.reserve({ metadata: 64, work: 5 });
    root._holds++;
    admission.cleanup = () => {
      root._holds--;
      if (!root._holds && root._closed) root._resolveIdle?.();
    };
    return admission;
  }

  detach(admission: Admission): void {
    if (admission.previous) admission.previous.next = admission.next;
    else this._head = admission.next;
    if (admission.next) admission.next.previous = admission.previous;
    admission.owner = undefined;
    admission.previous = undefined;
    admission.next = undefined;
  }

  close(): Promise<void> {
    if (!this._started) {
      this._started = true;
      this._closed = true;
      const syncPending = this._drainSync();
      if (!syncPending) {
        if (this._resolve) this._resolve();
        else this._completion = resolvedPromise;
      } else {
        const p = syncPending.then(
          () => { this._resolve?.(); },
          error => {
            if (this._reject) this._reject(error);
            else throw error;
          },
        );
        if (!this._completion) {
          this._completion = p;
          void this._completion.catch(() => undefined);
        }
      }
    }
    return this.completion;
  }

  private _drainSync(): Promise<void> | undefined {
    if (!this.parent) {
      if (this._holds) {
        this._idle ??= new Promise<void>(resolve => { this._resolveIdle = resolve; });
        return this._drainAsync(this._idle);
      }
      this._releasing = true;
    }
    while (this._firstChild) {
      const childClose = this._firstChild.close();
      if (childClose !== resolvedPromise) return this._drainAsync(childClose, true);
      const checkpoint = this.ledger.checkpoint();
      if (checkpoint) return this._drainAsync(checkpoint);
    }
    while (this._head) {
      this._head.release();
      const checkpoint = this.ledger.checkpoint();
      if (checkpoint) return this._drainAsync(checkpoint);
    }
    this._finishDrain();
    return undefined;
  }

  private _finishDrain(): void {
    if (this.parent) {
      if (this._previousSibling) this._previousSibling._nextSibling = this._nextSibling;
      else this.parent._firstChild = this._nextSibling;
      if (this._nextSibling) this._nextSibling._previousSibling = this._previousSibling;
    }
    this.header.release();
  }

  private async _drainAsync(firstAwait: Promise<void>, awaitedChild = false): Promise<void> {
    await firstAwait;
    if (!this.parent) {
      if (!this._releasing) this._releasing = true;
    }
    if (awaitedChild) {
      const checkpoint = this.ledger.checkpoint();
      if (checkpoint) await checkpoint;
    }
    while (this._firstChild) {
      await this._firstChild.close();
      const checkpoint = this.ledger.checkpoint();
      if (checkpoint) await checkpoint;
    }
    while (this._head) {
      this._head.release();
      const checkpoint = this.ledger.checkpoint();
      if (checkpoint) await checkpoint;
    }
    this._finishDrain();
  }
}
