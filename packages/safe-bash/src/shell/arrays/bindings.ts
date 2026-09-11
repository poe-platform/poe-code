import { Admission, ArrayFailure, ArrayOwner, exactSum } from "./ledger.js";
import type { Tickets } from "./ledger.js";
import { shellValueByteLength, shellValueBytes, shellValueFromBytes, shellValueText, type ShellValue } from "../../contracts/value.js";

export const controlNames: ReadonlySet<string> = new Set([
  "PATH", "PWD", "OLDPWD", "HOME", "CDPATH", "IFS", "OPTIND", "OPTERR", "OPTARG", "REPLY", "LANG", "LC_ALL", "LC_CTYPE",
]);

export class OwnedText {
  references = 1;

  constructor(readonly value: string, readonly bytes: number, readonly admission: Admission, readonly rawValue?: ShellValue) {}

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

export async function valueToken(owner: ArrayOwner, value: ShellValue, signal: AbortSignal): Promise<OwnedText> {
  if (typeof value === "string") return textToken(owner, value, signal);
  const bytes = shellValueByteLength(value);
  const temporary = owner.reserve({ payload: bytes * 3, metadata: 64, work: 4 });
  try {
    const input = shellValueBytes(value);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let text: string | undefined = "";
    for (let offset = 0; offset < bytes; offset += 1024) {
      const end = Math.min(bytes, offset + 1024);
      owner.reserve({ work: end - offset }).release();
      await owner.ledger.checkpoint(signal, end - offset);
      if (text !== undefined) try { text += decoder.decode(input.subarray(offset, end), { stream: end < bytes }); }
      catch (error) {
        if (!(error instanceof TypeError) || "code" in error && error.code !== "ERR_ENCODING_INVALID_ENCODED_DATA") throw error;
        text = undefined;
      }
    }
    if (text !== undefined) return await textToken(owner, text, signal);
    // Invalid UTF-8 needs an owned raw copy and its decoded projection.
    const admission = owner.reserve({ payload: bytes * 4, metadata: 128, work: 4 });
    try {
      const raw = shellValueFromBytes(input);
      return new OwnedText(shellValueText(raw), bytes, admission, raw);
    } catch (error) { admission.release(); throw error; }
  } finally { temporary.release(); }
}

export interface Element {
  readonly text: OwnedText;
  readonly slot: Admission;
}

export class IndexedBinding {
  readonly values = new Map<number, Element>();
  readonly keys = new Map<string, { index: number; text: OwnedText; admission: Admission }>();
  readonly keyByIndex = new Map<number, string>();
  maximum = -1;
  generation = 0;
  version = 0;
  references = 1;
  assigned = false;

  private constructor(readonly owner: ArrayOwner, readonly associative = false) {}

  static create(parent: ArrayOwner, associative = false): IndexedBinding {
    const owner = ArrayOwner.create(parent.ledger, parent);
    try {
      owner.reserve({ wrappers: 1, metadata: 128, work: 7 });
      return new IndexedBinding(owner, associative);
    } catch (error) {
      void owner.close();
      throw error;
    }
  }

  async keyIdentity(value: ShellValue, owner: ArrayOwner, signal: AbortSignal): Promise<string> {
    const length = shellValueByteLength(value);
    if (!length) throw new ArrayFailure("bad array subscript");
    const admission = owner.reserve({ payload: length * 5, metadata: 64 + length * 16, work: length + 2 });
    try {
    const bytes = shellValueBytes(value);
    const parts: string[] = [];
    for (const byte of bytes) {
      parts.push(byte.toString(16).padStart(2, "0"));
      await owner.ledger.checkpoint(signal);
    }
    return parts.join("");
    } finally { admission.release(); }
  }

  async keyIndex(value: ShellValue, owner: ArrayOwner, signal: AbortSignal, create = false): Promise<number | undefined> {
    const identity = await this.keyIdentity(value, owner, signal);
    const existing = this.keys.get(identity);
    if (existing || !create) return existing?.index;
    const index = this.maximum + 1;
    const admission = this.owner.reserve({ metadata: 128 + identity.length * 2, work: 8 });
    let text: OwnedText;
    try { text = await valueToken(this.owner, value, signal); }
    catch (error) { admission.release(); throw error; }
    const entry = { index, text, admission };
    admission.cleanup = () => {
      if (this.keys.get(identity) === entry) { this.keys.delete(identity); this.keyByIndex.delete(index); }
      text.release();
    };
    this.keys.set(identity, entry);
    this.keyByIndex.set(index, identity);
    this.maximum = index;
    return index;
  }

  remove(index: number): void {
    this.values.get(index)?.slot.release();
    const identity = this.keyByIndex.get(index);
    if (identity !== undefined) this.keys.get(identity)?.admission.release();
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
    this.assigned = true;
    if (index > this.maximum) this.maximum = index;
    previous?.slot.release();
  }

  async copy(signal: AbortSignal): Promise<IndexedBinding> {
    const copy = IndexedBinding.create(this.owner.parent!, this.associative);
    copy.assigned = this.assigned;
    this.retain();
    try {
      for (const [identity, entry] of this.keys) {
        const admission = copy.owner.reserve({ metadata: 128 + identity.length * 2, work: identity.length + 8 });
        copy.owner.parent!.adopt(entry.text.admission);
        const text = entry.text.retain();
        const cloned = { index: entry.index, text, admission };
        admission.cleanup = () => { if (copy.keys.get(identity) === cloned) { copy.keys.delete(identity); copy.keyByIndex.delete(entry.index); } text.release(); };
        copy.keys.set(identity, cloned); copy.keyByIndex.set(entry.index, identity);
        await copy.owner.ledger.checkpoint(signal, identity.length + 8);
      }
      for (const [index, element] of this.values) {
        copy.owner.reserve({ work: 2 }).release();
        const slot = copy.owner.reserve({ slots: 1, metadata: 32, work: 5 });
        copy.owner.parent!.adopt(element.text.admission);
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

  private constructor(public owner: ArrayOwner) {}

  static create(parent: ArrayOwner): BindingStore {
    parent.reserve({ metadata: 192, work: 10 });
    return new BindingStore(parent);
  }

  get(name: string): IndexedBinding | undefined { return this.bindings.get(name)?.binding; }

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
