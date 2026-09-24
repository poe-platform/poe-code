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
    readonly wrappers: number,
    readonly slots: number,
    readonly payload: number,
    readonly metadata: number,
    readonly generation: number,
    readonly version: number,
    readonly epoch: number,
  ) {}

  release(): void {
    if (this.released) return;
    this.released = true;
    this.cleanup?.();
    this.owner?.detach(this);
    this.ledger.release(this);
  }
}

export class ArrayLedger {
  #caps: Counters | undefined;
  #used: Counters = [0, 0, 0, 0, 0, 0, 0];
  #sequence = { lastIssued: 0 };
  #checkpoint = 0;

  constructor(readonly bytes: number, readonly fields: number, initialTicket = 0) {
    if (!Number.isSafeInteger(initialTicket) || initialTicket < 0) throw new RangeError("Invalid private initial ticket");
    this.#sequence.lastIssued = initialTicket;
  }

  internal(commandLimit: number): ArrayLedger {
    if (commandLimit === Infinity) {
      const ledger = new ArrayLedger(Infinity, Infinity);
      ledger.#sequence = this.#sequence;
      return ledger;
    }
    const requested = BigInt(commandLimit) + 1n;
    const maximum = BigInt(Number.MAX_SAFE_INTEGER) / 33024n;
    const units = requested < maximum ? requested : maximum;
    const ledger = new ArrayLedger(Number(32n * units), Number(64n * units));
    ledger.#sequence = this.#sequence;
    return ledger;
  }

  get active(): boolean { return this.#caps !== undefined; }

  snapshot(): { readonly caps: readonly number[] | undefined; readonly used: readonly number[]; readonly lastIssued: number } {
    return { caps: this.#caps?.slice(), used: this.#used.slice(), lastIssued: this.#sequence.lastIssued };
  }

  charge(charge: Charge = {}, out?: { generation: number; version: number; epoch: number }): Tickets {
    const caps = this.#caps ?? this.derive();
    let cursor = this.#sequence.lastIssued;
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
        const used = this.#used;
        if (caps[0]! !== Infinity && wrappers > caps[0]! - used[0]!) throw new ArrayFailure(`private ${labels[0]} limit exceeded`);
        if (caps[1]! !== Infinity && slots > caps[1]! - used[1]!) throw new ArrayFailure(`private ${labels[1]} limit exceeded`);
        if (caps[2]! !== Infinity && payload > caps[2]! - used[2]!) throw new ArrayFailure(`private ${labels[2]} limit exceeded`);
        if (caps[3]! !== Infinity && metadataNum > caps[3]! - used[3]!) throw new ArrayFailure(`private ${labels[3]} limit exceeded`);
        if (caps[4]! !== Infinity && allocBytes > caps[4]! - used[4]!) throw new ArrayFailure(`private ${labels[4]} limit exceeded`);
        if (caps[5]! !== Infinity && allocatedSlots > caps[5]! - used[5]!) throw new ArrayFailure(`private ${labels[5]} limit exceeded`);
        if (caps[6]! !== Infinity && workNum > caps[6]! - used[6]!) throw new ArrayFailure(`private ${labels[6]} limit exceeded`);
        this.#caps = caps;
        this.#sequence.lastIssued = cursor;
        used[4]! += allocBytes;
        used[5]! += allocatedSlots;
        used[6]! += workNum;
        if (out) {
          out.generation = generation;
          out.version = version;
          out.epoch = epoch;
          return out;
        }
        return { generation, version, epoch };
      }
    }
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
    const caps = this.#caps ?? this.derive();
    let cursor = this.#sequence.lastIssued;
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
        const used = this.#used;
        if (caps[0]! !== Infinity && wrappers > caps[0]! - used[0]!) throw new ArrayFailure(`private ${labels[0]} limit exceeded`);
        if (caps[1]! !== Infinity && slots > caps[1]! - used[1]!) throw new ArrayFailure(`private ${labels[1]} limit exceeded`);
        if (caps[2]! !== Infinity && payload > caps[2]! - used[2]!) throw new ArrayFailure(`private ${labels[2]} limit exceeded`);
        if (caps[3]! !== Infinity && metadataNum > caps[3]! - used[3]!) throw new ArrayFailure(`private ${labels[3]} limit exceeded`);
        if (caps[4]! !== Infinity && allocBytes > caps[4]! - used[4]!) throw new ArrayFailure(`private ${labels[4]} limit exceeded`);
        if (caps[5]! !== Infinity && allocatedSlots > caps[5]! - used[5]!) throw new ArrayFailure(`private ${labels[5]} limit exceeded`);
        if (caps[6]! !== Infinity && workNum > caps[6]! - used[6]!) throw new ArrayFailure(`private ${labels[6]} limit exceeded`);
        this.#caps = caps;
        this.#sequence.lastIssued = cursor;
        used[0]! += wrappers;
        used[1]! += slots;
        used[2]! += payload;
        used[3]! += metadataNum;
        used[4]! += allocBytes;
        used[5]! += allocatedSlots;
        used[6]! += workNum;
        return new Admission(this, wrappers, slots, payload, metadataNum, generation, version, epoch);
      }
    }
    const metadataRequest = BigInt(charge.metadata ?? 0) + 64n;
    const work = BigInt(charge.work ?? 0) + 15n;
    const requested = [BigInt(wrappers), BigInt(slots), BigInt(payload), metadataRequest, BigInt(payload) + metadataRequest, BigInt(allocatedSlots), work];
    for (let index = 0; index < requested.length; index++) {
      const amount = requested[index]!;
      if (amount < 0n || caps[index] !== Infinity && amount > BigInt(caps[index]! - this.#used[index]!)) {
        throw new ArrayFailure(`private ${labels[index]} limit exceeded`);
      }
    }
    this.#caps = caps;
    this.#sequence.lastIssued = cursor;
    for (let index = 0; index < requested.length; index++) this.#used[index]! += Number(requested[index]!);
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
    this.#used[0] -= admission.wrappers;
    this.#used[1] -= admission.slots;
    this.#used[2] -= admission.payload;
    this.#used[3] -= admission.metadata;
  }

  checkpoint(signal?: AbortSignal, units = 1): Promise<void> | undefined {
    signal?.throwIfAborted();
    this.#checkpoint += units;
    if (this.#checkpoint >= 128) {
      this.#checkpoint %= 128;
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

const resolvedPromise = Promise.resolve();
const sharedDiscardTickets = { generation: 0, version: 0, epoch: 0 };

export class ArrayOwner {
  #head: Admission | undefined;
  #firstChild: ArrayOwner | undefined;
  #nextSibling: ArrayOwner | undefined;
  #previousSibling: ArrayOwner | undefined;
  #closed = false;
  #started = false;
  #resolve: (() => void) | undefined;
  #reject: ((error: unknown) => void) | undefined;
  #holds = 0;
  #resolveIdle: (() => void) | undefined;
  #idle: Promise<void> | undefined;
  #releasing = false;
  #completion: Promise<void> | undefined;

  private constructor(readonly ledger: ArrayLedger, readonly parent: ArrayOwner | undefined, readonly header: Admission) {}

  get completion(): Promise<void> {
    if (!this.#completion) {
      this.#completion = new Promise<void>((resolve, reject) => { this.#resolve = resolve; this.#reject = reject; });
      void this.#completion.catch(() => undefined);
    }
    return this.#completion;
  }

  static create(ledger: ArrayLedger, parent?: ArrayOwner): ArrayOwner {
    parent?.assertOpen();
    const header = ledger.reserve({ metadata: 64, work: 9 });
    const owner = new ArrayOwner(ledger, parent, header);
    if (parent) {
      owner.#nextSibling = parent.#firstChild;
      if (parent.#firstChild) parent.#firstChild.#previousSibling = owner;
      parent.#firstChild = owner;
    }
    return owner;
  }

  assertOpen(): void {
    if (this.#closed) throw new ArrayFailure("ownership admission is closed");
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
    if (!prepaid || !root.#holds || root.#releasing) this.assertOpen();
    if (admission.released || admission.ledger !== this.ledger) throw new Error("Invalid indexed-array ownership transfer");
    admission.owner?.detach(admission);
    admission.owner = this;
    admission.previous = undefined;
    admission.next = this.#head;
    if (this.#head) this.#head.previous = admission;
    this.#head = admission;
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
    if (root.#holds === Number.MAX_SAFE_INTEGER) throw new ArrayFailure("resource capacity exhausted");
    const admission = this.reserve({ metadata: 64, work: 5 });
    root.#holds++;
    admission.cleanup = () => {
      root.#holds--;
      if (!root.#holds && root.#closed) root.#resolveIdle?.();
    };
    return admission;
  }

  detach(admission: Admission): void {
    if (admission.previous) admission.previous.next = admission.next;
    else this.#head = admission.next;
    if (admission.next) admission.next.previous = admission.previous;
    admission.owner = undefined;
    admission.previous = undefined;
    admission.next = undefined;
  }

  close(): Promise<void> {
    if (!this.#started) {
      this.#started = true;
      this.#closed = true;
      const syncPending = this.#drainSync();
      if (!syncPending) {
        if (this.#resolve) this.#resolve();
        else this.#completion = resolvedPromise;
      } else {
        const p = syncPending.then(
          () => { this.#resolve?.(); },
          error => {
            if (this.#reject) this.#reject(error);
            else throw error;
          },
        );
        if (!this.#completion) {
          this.#completion = p;
          void this.#completion.catch(() => undefined);
        }
      }
    }
    return this.completion;
  }

  #drainSync(): Promise<void> | undefined {
    if (!this.parent) {
      if (this.#holds) {
        this.#idle ??= new Promise<void>(resolve => { this.#resolveIdle = resolve; });
        return this.#drainAsync(this.#idle);
      }
      this.#releasing = true;
    }
    while (this.#firstChild) {
      const childClose = this.#firstChild.close();
      if (childClose !== resolvedPromise) return this.#drainAsync(childClose, true);
      const checkpoint = this.ledger.checkpoint();
      if (checkpoint) return this.#drainAsync(checkpoint);
    }
    while (this.#head) {
      this.#head.release();
      const checkpoint = this.ledger.checkpoint();
      if (checkpoint) return this.#drainAsync(checkpoint);
    }
    this.#finishDrain();
    return undefined;
  }

  #finishDrain(): void {
    if (this.parent) {
      if (this.#previousSibling) this.#previousSibling.#nextSibling = this.#nextSibling;
      else this.parent.#firstChild = this.#nextSibling;
      if (this.#nextSibling) this.#nextSibling.#previousSibling = this.#previousSibling;
    }
    this.header.release();
  }

  async #drainAsync(firstAwait: Promise<void>, awaitedChild = false): Promise<void> {
    await firstAwait;
    if (!this.parent) {
      if (!this.#releasing) this.#releasing = true;
    }
    if (awaitedChild) {
      const checkpoint = this.ledger.checkpoint();
      if (checkpoint) await checkpoint;
    }
    while (this.#firstChild) {
      await this.#firstChild.close();
      const checkpoint = this.ledger.checkpoint();
      if (checkpoint) await checkpoint;
    }
    while (this.#head) {
      this.#head.release();
      const checkpoint = this.ledger.checkpoint();
      if (checkpoint) await checkpoint;
    }
    this.#finishDrain();
  }
}
