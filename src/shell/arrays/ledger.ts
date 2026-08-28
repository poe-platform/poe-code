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
  #lastIssued = 0;
  #checkpoint = 0;

  constructor(readonly bytes: number, readonly fields: number, initialTicket = 0) {
    if (!Number.isSafeInteger(initialTicket) || initialTicket < 0) throw new RangeError("Invalid private initial ticket");
    this.#lastIssued = initialTicket;
  }

  get active(): boolean { return this.#caps !== undefined; }

  snapshot(): { readonly caps: readonly number[] | undefined; readonly used: readonly number[]; readonly lastIssued: number } {
    return { caps: this.#caps?.slice(), used: this.#used.slice(), lastIssued: this.#lastIssued };
  }

  reserve(charge: Charge = {}): Admission {
    const caps = this.#caps ?? this.derive();
    let cursor = this.#lastIssued;
    const ticket = (requested: boolean | number | undefined, label: string): number => {
      if (!requested) return 0;
      const count = requested === true ? 1 : requested;
      if (!Number.isSafeInteger(count) || count < 0 || count > Number.MAX_SAFE_INTEGER - cursor) throw new ArrayFailure(`private ${label} capacity exhausted`);
      cursor += count;
      return cursor;
    };
    const generation = ticket(charge.generation, "generation");
    const version = ticket(charge.version, "version");
    const epoch = ticket(charge.epoch, "epoch");
    const wrappers = charge.wrappers ?? 0;
    const slots = charge.slots ?? 0;
    const payload = charge.payload ?? 0;
    const metadataRequest = BigInt(charge.metadata ?? 0) + 64n;
    const allocatedSlots = charge.allocatedSlots ?? slots;
    const work = BigInt(charge.work ?? 0) + 15n;
    const requested = [BigInt(wrappers), BigInt(slots), BigInt(payload), metadataRequest, BigInt(payload) + metadataRequest, BigInt(allocatedSlots), work];
    for (let index = 0; index < requested.length; index++) {
      const amount = requested[index]!;
      if (amount < 0n || amount > BigInt(caps[index]! - this.#used[index]!)) {
        throw new ArrayFailure(`private ${labels[index]} limit exceeded`);
      }
    }
    this.#caps = caps;
    this.#lastIssued = cursor;
    for (let index = 0; index < requested.length; index++) this.#used[index]! += Number(requested[index]!);
    return new Admission(this, wrappers, slots, payload, Number(metadataRequest), generation, version, epoch);
  }

  private derive(): Counters {
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
      return new Promise<void>((resolve, reject) => setImmediate(() => {
        try { signal?.throwIfAborted(); resolve(); }
        catch (error) { reject(error); }
      }));
    }
  }
}

export function exactSum(left: number, right: number): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0 || left > Number.MAX_SAFE_INTEGER - right) {
    throw new ArrayFailure("private allocated byte capacity is not representable");
  }
  return left + right;
}

export class ArrayOwner {
  #head: Admission | undefined;
  #firstChild: ArrayOwner | undefined;
  #nextSibling: ArrayOwner | undefined;
  #previousSibling: ArrayOwner | undefined;
  #closed = false;
  #started = false;
  #resolve!: () => void;
  #reject!: (error: unknown) => void;
  #holds = 0;
  #resolveIdle!: () => void;
  readonly #idle: Promise<void>;
  #releasing = false;
  readonly completion: Promise<void>;

  private constructor(readonly ledger: ArrayLedger, readonly parent: ArrayOwner | undefined, readonly header: Admission) {
    this.completion = new Promise<void>((resolve, reject) => { this.#resolve = resolve; this.#reject = reject; });
    this.#idle = new Promise<void>(resolve => { this.#resolveIdle = resolve; });
    void this.completion.catch(() => undefined);
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
      if (!root.#holds && root.#closed) root.#resolveIdle();
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
      void this.drain().then(this.#resolve, this.#reject);
    }
    return this.completion;
  }

  private async drain(): Promise<void> {
    if (!this.parent) {
      if (this.#holds) await this.#idle;
      this.#releasing = true;
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
    if (this.parent) {
      if (this.#previousSibling) this.#previousSibling.#nextSibling = this.#nextSibling;
      else this.parent.#firstChild = this.#nextSibling;
      if (this.#nextSibling) this.#nextSibling.#previousSibling = this.#previousSibling;
    }
    this.header.release();
  }
}
