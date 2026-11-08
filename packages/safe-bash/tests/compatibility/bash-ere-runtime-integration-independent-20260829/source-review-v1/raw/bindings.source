import { Admission, ArrayFailure, ArrayLedger, ArrayOwner, exactSum } from "./ledger.js";
import type { Tickets } from "./ledger.js";

export const controlNames: ReadonlySet<string> = new Set([
  "PATH", "PWD", "OLDPWD", "HOME", "CDPATH", "IFS", "OPTIND", "OPTERR", "OPTARG", "REPLY", "LANG", "LC_ALL", "LC_CTYPE",
]);

export class OwnedText {
  references = 1;

  constructor(readonly value: string, readonly bytes: number, readonly admission: Admission) {}

  retain(): this {
    if (this.references === Number.MAX_SAFE_INTEGER) throw new ArrayFailure("reference capacity is not representable");
    this.references++;
    return this;
  }

  release(): void {
    if (--this.references === 0) this.admission.release();
  }
}

export async function textToken(owner: ArrayOwner, value: string, signal: AbortSignal): Promise<OwnedText> {
  let bytes = 0;
  for (let offset = 0; offset < value.length;) {
    const end = Math.min(value.length, offset + 64);
    owner.reserve({ work: end - offset }).release();
    while (offset < end) {
      const code = value.codePointAt(offset)!;
      bytes = exactSum(bytes, code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4);
      offset += code > 0xffff ? 2 : 1;
    }
    await owner.ledger.checkpoint(signal, 64);
  }
  const admission = owner.reserve({ payload: bytes, metadata: 32, work: 4 });
  return new OwnedText(value, bytes, admission);
}

export interface Element {
  readonly text: OwnedText;
  readonly slot: Admission;
}

export class IndexedBinding {
  readonly values = new Map<number, Element>();
  maximum = -1;
  generation = 0;
  version = 0;
  references = 1;

  private constructor(readonly owner: ArrayOwner) {}

  static create(parent: ArrayOwner): IndexedBinding {
    const owner = ArrayOwner.create(parent.ledger, parent);
    try {
      owner.reserve({ wrappers: 1, metadata: 128, work: 7 });
      return new IndexedBinding(owner);
    } catch (error) {
      void owner.close();
      throw error;
    }
  }

  get(index: number): string | undefined { return this.values.get(index)?.text.value; }

  retain(): this {
    if (this.references === Number.MAX_SAFE_INTEGER) throw new ArrayFailure("reference capacity is not representable");
    this.references++;
    return this;
  }

  release(): Promise<void> | undefined {
    if (--this.references === 0) return this.owner.close();
    return undefined;
  }

  insert(index: number, text: OwnedText): void {
    const slot = this.owner.reserve({ slots: 1, metadata: 32, work: 5 });
    const previous = this.values.get(index);
    const element = { text, slot };
    slot.cleanup = () => {
      if (this.values.get(index) === element) this.values.delete(index);
      text.release();
    };
    this.values.set(index, element);
    if (index > this.maximum) this.maximum = index;
    previous?.slot.release();
  }

  async copy(signal: AbortSignal): Promise<IndexedBinding> {
    const copy = IndexedBinding.create(this.owner.parent!);
    this.retain();
    try {
      for (const [index, element] of this.values) {
        copy.owner.reserve({ work: 2 }).release();
        const slot = copy.owner.reserve({ slots: 1, metadata: 32, work: 5 });
        const text = element.text.retain();
        const cloned = { text, slot };
        slot.cleanup = () => { if (copy.values.get(index) === cloned) copy.values.delete(index); text.release(); };
        copy.values.set(index, cloned);
        if (index > copy.maximum) copy.maximum = index;
        await copy.owner.ledger.checkpoint(signal, 2);
      }
      return copy;
    } catch (error) { await copy.release(); throw error; }
    finally { await this.release(); }
  }

  async indices(owner: ArrayOwner, signal: AbortSignal): Promise<number[]> {
    const size = this.values.size;
    owner.reserve({ metadata: exactSum(128, size * 64), allocatedSlots: size * 2, work: size * 4 + 6 });
    let indices: number[] = [];
    let scratch: number[] = [];
    for (const index of this.values.keys()) {
      indices.push(index);
      await owner.ledger.checkpoint(signal);
    }
    for (let width = 1; width < size; width *= 2) {
      for (let start = 0; start < size; start += width * 2) {
        let left = start;
        let right = Math.min(size, start + width);
        const leftEnd = right;
        const rightEnd = Math.min(size, start + width * 2);
        for (let destination = start; destination < rightEnd; destination++) {
          owner.reserve({ work: 2 }).release();
          scratch[destination] = left < leftEnd && (right >= rightEnd || indices[left]! <= indices[right]!) ? indices[left++]! : indices[right++]!;
          await owner.ledger.checkpoint(signal, 2);
        }
      }
      const temporary = indices;
      indices = scratch;
      scratch = temporary;
    }
    return indices;
  }
}

interface Watch {
  generation: number;
  version: number;
  observers: number;
  typedVersion: number;
  readonly admission: Admission;
  readonly name: OwnedText;
}

export class BindingWatch {
  #closed = false;
  readonly generation: number;
  readonly version: number;
  readonly typedVersion: number;

  constructor(readonly store: BindingStore, readonly name: string, readonly watch: Watch, readonly admission: Admission) {
    this.generation = watch.generation;
    this.version = watch.version;
    this.typedVersion = watch.typedVersion;
  }

  valid(): boolean { return this.watch.generation === this.generation && this.watch.version === this.version; }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.store.retire(this.name, this.watch);
    this.admission.release();
  }
}

interface NamedBinding {
  binding: IndexedBinding;
  readonly name: OwnedText;
  readonly admission: Admission;
}

export class BindingStore {
  readonly bindings = new Map<string, NamedBinding>();
  readonly watches = new Map<string, Watch>();
  epoch = 0;

  private constructor(readonly owner: ArrayOwner) {}

  static create(parent: ArrayOwner): BindingStore {
    parent.reserve({ metadata: 192, work: 10 });
    return new BindingStore(parent);
  }

  get(name: string): IndexedBinding | undefined { return this.bindings.get(name)?.binding; }

  async watch(name: string, operation: ArrayOwner, signal: AbortSignal): Promise<BindingWatch> {
    let watch = this.watches.get(name);
    const observer = operation.reserve({ metadata: 64, work: 5 });
    if (!watch) {
      signal.throwIfAborted();
      this.owner.reserve({ work: name.length }).release();
      const bytes = Buffer.byteLength(name);
      const token = new OwnedText(name, bytes, this.owner.reserve({ metadata: 32, payload: bytes, work: 4 }));
      try {
        const admission = this.owner.reserve({ slots: 1, metadata: 96, generation: true, version: true, work: 9 });
        watch = { generation: admission.generation, version: admission.version, typedVersion: 0, observers: 0, admission, name: token };
        this.watches.set(name, watch);
      } catch (error) { token.release(); throw error; }
    }
    if (watch.observers === Number.MAX_SAFE_INTEGER) throw new ArrayFailure("observer capacity is not representable");
    watch.observers++;
    const result = new BindingWatch(this, name, watch, observer);
    observer.cleanup = () => result.close();
    await operation.ledger.checkpoint(signal, name.length);
    return result;
  }

  retire(name: string, watch: Watch): void {
    if (--watch.observers !== 0) return;
    this.watches.delete(name);
    watch.admission.release();
    watch.name.release();
  }

  tickets(name?: string): Admission {
    const guarded = name !== undefined && (this.bindings.has(name) || this.watches.has(name));
    return this.owner.reserve({ generation: guarded, version: guarded, epoch: true, work: 5 });
  }

  changed(tickets: Tickets, name?: string): void {
    this.epoch = tickets.epoch;
    if (name !== undefined) {
      const watch = this.watches.get(name);
      if (watch) { watch.generation = tickets.generation; watch.version = tickets.version; }
      const binding = this.get(name);
      if (binding) { binding.generation = tickets.generation; binding.version = tickets.version; }
    }
  }

  async prepareName(name: string, operation: ArrayOwner, signal: AbortSignal): Promise<{ readonly name: OwnedText; readonly admission: Admission } | undefined> {
    if (this.bindings.has(name)) return undefined;
    const token = await textToken(operation, name, signal);
    try {
      const admission = operation.reserve({ slots: 1, metadata: 32, work: 5 });
      return { name: token, admission };
    } catch (error) { token.release(); throw error; }
  }

  publish(name: string, binding: IndexedBinding, tickets: Tickets, prepared?: { readonly name: OwnedText; readonly admission: Admission }, restoring = false): Promise<void> | undefined {
    const previous = this.bindings.get(name);
    const displaced = previous?.binding;
    if (previous) previous.binding = binding;
    else {
      if (!prepared) throw new Error("Missing indexed-array name admission");
      this.owner.adopt(prepared.name.admission, restoring);
      this.owner.adopt(prepared.admission, restoring);
      const entry = { binding, name: prepared.name, admission: prepared.admission };
      prepared.admission.cleanup = () => {
        if (this.bindings.get(name) !== entry) return;
        this.bindings.delete(name);
        entry.name.release();
        void entry.binding.release();
      };
      this.bindings.set(name, entry);
    }
    this.changed(tickets, name);
    const watch = this.watches.get(name);
    if (watch) watch.typedVersion = tickets.version;
    return displaced?.release();
  }

  remove(name: string, tickets: Tickets): Promise<void> | undefined {
    const previous = this.bindings.get(name);
    this.bindings.delete(name);
    this.changed(tickets, name);
    if (!previous) return undefined;
    previous.admission.release();
    previous.name.release();
    return previous.binding.release();
  }
}
