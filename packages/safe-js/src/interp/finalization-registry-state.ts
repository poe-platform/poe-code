import { createWeakReferenceState } from "./weak-reference.js";
import { wellKnownSymbols } from "./symbols.js";
import type { SandboxClosure, SandboxValue } from "./values.js";

export const finalizationRegistryStates = new WeakMap<object, { state: FinalizationRegistryState; callback: SandboxClosure }>();

type WeakTarget = Extract<SandboxValue, object | symbol>;
type FinalizationCell = {
  target: ReturnType<typeof createWeakReferenceState>;
  token?: ReturnType<typeof createWeakReferenceState>;
  heldValue: SandboxValue;
  queued: boolean;
  release?: () => void;
};

// The caller owns scheduling, error reporting and lifetime. Native GC notices
// never invoke guest code directly, and cells remain cancellable until dispatch.
export class FinalizationRegistryState {
  readonly cells = new Set<FinalizationCell>();
  private readonly native: FinalizationRegistry<FinalizationCell>;
  private disposed = false;

  constructor(
    readonly cleanup: (heldValue: SandboxValue) => Promise<void>,
    private readonly enqueue: (job: () => Promise<void>, cell: FinalizationCell) => void
  ) {
    this.native = new FinalizationRegistry(cell => this.notify(cell));
  }

  private notify(cell: FinalizationCell): void {
    if (this.disposed || !this.cells.has(cell) || cell.queued) return;
    cell.queued = true;
    this.enqueue(async () => {
      if (this.disposed || !this.cells.delete(cell)) return;
      try { await this.cleanup(cell.heldValue); }
      finally {
        cell.heldValue = undefined;
        cell.release?.();
        cell.release = undefined;
      }
    }, cell);
  }

  register(target: WeakTarget | undefined, heldValue: SandboxValue, token?: WeakTarget): void {
    if (this.disposed) throw new TypeError("Finalization registry is disposed.");
    const cell: FinalizationCell = {
      target: target === undefined ? {deref:() => undefined} : createWeakReferenceState(target), heldValue, queued: false,
      ...(token === undefined ? {} : { token: createWeakReferenceState(token) })
    };
    // Well-known symbols cannot become unreachable. Some hosts represent them
    // with registered symbols, which their native registry refuses to accept.
    if (target !== undefined && (typeof target !== "symbol" || !Object.values(wellKnownSymbols).includes(target)))
      Reflect.apply(this.native.register, this.native, [target, cell, cell]);
    this.cells.add(cell);
    if (target === undefined) this.notify(cell);
  }

  unregister(token: WeakTarget): boolean {
    let removed = false;
    for (const cell of this.cells) {
      if (cell.token?.deref() !== token) continue;
      this.native.unregister(cell);
      this.cells.delete(cell);
      // A cancelled job may never be dispatched. Drop its payload and owner
      // roots now rather than retaining them through that queued closure.
      cell.heldValue = undefined;
      cell.release?.();
      cell.release = undefined;
      removed = true;
    }
    return removed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cell of this.cells) {
      this.native.unregister(cell);
      cell.heldValue = undefined;
      cell.release?.();
      cell.release = undefined;
    }
    this.cells.clear();
  }
}
