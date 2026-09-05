import { Admission, ArrayFailure, ArrayOwner, exactSum } from "./ledger.js";
import type { Tickets } from "./ledger.js";
import { shellValueByteLength, shellValueRetainedBytes, shellValueText } from "../../contracts/value.js";
import type { ShellValue } from "../../contracts/value.js";

export const controlNames: ReadonlySet<string> = new Set([
  "PATH", "PWD", "OLDPWD", "HOME", "CDPATH", "IFS", "OPTIND", "OPTERR", "OPTARG", "REPLY", "LANG", "LC_ALL", "LC_CTYPE",
]);

export class OwnedText {
  references = 1;

  constructor(readonly shellValue: ShellValue, readonly bytes: number, readonly admission: Admission) {}

  get value(): string { return shellValueText(this.shellValue); }

  retain(): this {
    if (!this.references || this.admission.released) throw new ArrayFailure("cell ownership is released");
    if (this.references === Number.MAX_SAFE_INTEGER) throw new ArrayFailure("reference capacity is not representable");
    this.references++;
    return this;
  }

  release(): void {
    if (this.references && --this.references === 0) this.admission.release();
  }
}

export async function textToken(owner: ArrayOwner, value: ShellValue, signal: AbortSignal): Promise<OwnedText> {
  signal.throwIfAborted();
  owner.assertOpen();
  if (typeof value !== "string") {
    const bytes = shellValueByteLength(value);
    const metadata = exactSum(32, shellValueRetainedBytes(value) - bytes);
    await owner.ledger.checkpoint(signal, 4);
    signal.throwIfAborted();
    const admission = owner.reserve({ payload: bytes, metadata, work: 4 });
    return new OwnedText(value, bytes, admission);
  }
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
  signal.throwIfAborted();
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

  getValue(index: number): ShellValue | undefined { return this.values.get(index)?.text.shellValue; }

  retain(): this {
    this.owner.assertOpen();
    if (!this.references) throw new ArrayFailure("binding ownership is released");
    if (this.references === Number.MAX_SAFE_INTEGER) throw new ArrayFailure("reference capacity is not representable");
    this.references++;
    return this;
  }

  release(): Promise<void> | undefined {
    if (!this.references) return this.owner.completion;
    if (--this.references === 0) return this.owner.close();
    return undefined;
  }

  insert(index: number, text: OwnedText): void {
    if (!text.references || text.admission.released) throw new ArrayFailure("cell ownership is released");
    const slot = this.owner.reserve({ slots: 1, metadata: 32, work: 5 });
    try { this.owner.share(text.admission); }
    catch (error) { slot.release(); throw error; }
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
    signal.throwIfAborted();
    this.owner.assertOpen();
    this.retain();
    let copy: IndexedBinding | undefined;
    try {
      copy = IndexedBinding.create(this.owner.parent!);
      for (const [index, element] of this.values) {
        copy.owner.reserve({ work: 2 }).release();
        const text = element.text.retain();
        try { copy.insert(index, text); }
        catch (error) { text.release(); throw error; }
        await copy.owner.ledger.checkpoint(signal, 2);
      }
      signal.throwIfAborted();
      return copy;
    } catch (error) { await copy?.release(); throw error; }
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

export interface PreparedBinding {
  readonly binding: IndexedBinding;
  readonly tickets: Tickets;
  validate(): void;
  publish(): Promise<void> | undefined;
  close(): Promise<void>;
}

export class BindingStore {
  readonly bindings = new Map<string, NamedBinding>();
  readonly watches = new Map<string, Watch>();
  epoch = 0;

  private constructor(public owner: ArrayOwner) {}

  static create(parent: ArrayOwner): BindingStore {
    parent.reserve({ metadata: 192, work: 10 });
    return new BindingStore(parent);
  }

  get(name: string): IndexedBinding | undefined { return this.bindings.get(name)?.binding; }

  async prepare(name: string, signal: AbortSignal, copy = true): Promise<PreparedBinding> {
    signal.throwIfAborted();
    const owner = this.owner;
    const operation = ArrayOwner.create(owner.ledger, owner);
    let holding: Admission | undefined;
    let binding: IndexedBinding | undefined;
    let retirement: Promise<void> | undefined;
    let published = false;
    let closed = false;
    let completion: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (completion) return completion;
      closed = true;
      completion = (async () => {
        try { if (published) await retirement; else await binding?.release(); }
        finally {
          try { await operation.close(); }
          finally { holding?.release(); }
        }
      })();
      return completion;
    };
    try {
      holding = owner.hold();
      operation.reserve({ metadata: 192, work: 12 });
      const watch = await this.watch(name, operation, signal);
      const tickets = operation.adopt(this.tickets(name));
      const previous = this.get(name);
      binding = copy && previous ? await previous.copy(signal) : IndexedBinding.create(owner);
      const staged = binding;
      const prepared = await this.prepareName(name, operation, signal);
      const validate = (): void => {
        signal.throwIfAborted();
        if (closed || published) throw new ArrayFailure("binding publication is closed");
        owner.assertOpen();
        staged.owner.assertOpen();
        if (this.owner !== owner || !watch.valid()) throw new ArrayFailure("binding changed during preparation");
      };
      validate();
      return Object.freeze({
        binding: staged,
        tickets,
        validate,
        publish: (): Promise<void> | undefined => {
          validate();
          retirement = this.publish(name, staged, tickets, prepared);
          published = true;
          return retirement;
        },
        close,
      });
    } catch (error) { await close(); throw error; }
  }

  async watch(name: string, operation: ArrayOwner, signal: AbortSignal, owner = this.owner): Promise<BindingWatch> {
    let watch = this.watches.get(name);
    const observer = operation.reserve({ metadata: 64, work: 5 });
    if (!watch) {
      signal.throwIfAborted();
      owner.reserve({ work: name.length }).release();
      const bytes = Buffer.byteLength(name);
      const token = new OwnedText(name, bytes, owner.reserve({ metadata: 32, payload: bytes, work: 4 }));
      try {
        const admission = owner.reserve({ slots: 1, metadata: 96, generation: true, version: true, work: 9 });
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

  publish(name: string, binding: IndexedBinding, tickets: Tickets, prepared?: { readonly name: OwnedText; readonly admission: Admission }, restoring = false, owner = this.owner): Promise<void> | undefined {
    const previous = this.bindings.get(name);
    const displaced = previous?.binding;
    if (previous) previous.binding = binding;
    else {
      if (!prepared) throw new Error("Missing indexed-array name admission");
      owner.adopt(prepared.name.admission, restoring);
      owner.adopt(prepared.admission, restoring);
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

  revise(name: string, binding: IndexedBinding, tickets: Tickets): void {
    if (this.get(name) !== binding) throw new ArrayFailure("binding identity changed before revision");
    this.changed(tickets, name);
    const watch = this.watches.get(name);
    if (watch) watch.typedVersion = tickets.version;
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
