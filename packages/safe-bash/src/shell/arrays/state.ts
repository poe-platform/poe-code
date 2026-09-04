import type { State } from "../runtime.js";
import type { InvocationScope } from "../cleanup.js";
import { ArrayFailure, ArrayLedger, ArrayOwner } from "./ledger.js";
import type { Admission, Tickets } from "./ledger.js";
import { BindingStore, textToken } from "./bindings.js";
import { ValueArena, ValueStore } from "../value-state.js";

interface Session {
  readonly values: ValueArena;
  readonly ledger: ArrayLedger;
  readonly internal: ArrayLedger;
  readonly scope: InvocationScope;
  owner: ArrayOwner | undefined;
  guestOwner: ArrayOwner | undefined;
}

const sessions = new WeakMap<object, Session>();
const monitors = new WeakMap<State, StateMonitor>();
const overlayNext = Symbol("array overlay parent");
type OverlayMap = Map<string, { superseded?: boolean }> & { [overlayNext]?: OverlayMap };

export function trackState(state: State, budget: { readonly values?: ValueArena; readonly limits: { readonly maxExpansionBytes: number; readonly maxExpansionFields: number; readonly maxCommands?: number } }, scope: InvocationScope): State {
  const existing = monitors.get(state);
  if (existing) return existing.proxy;
  let session = sessions.get(budget);
  if (!session) {
    while (scope.parent) scope = scope.parent;
    const ledger = new ArrayLedger(budget.limits.maxExpansionBytes, budget.limits.maxExpansionFields);
    const values = budget.values ?? new ValueArena(budget.limits.maxExpansionBytes, budget.limits.maxExpansionFields, () => scope.assertOpen());
    session = { values, ledger, internal: ledger.internal(budget.limits.maxCommands ?? 10_000), scope, owner: undefined, guestOwner: undefined };
    const registered = session;
    scope.register(async () => { await registered.scope.drainWork(); await registered.owner?.close(); });
    scope.register(async () => { await registered.scope.drainWork(); values.close(); });
    sessions.set(budget, session);
  }
  return new StateMonitor(state, session).proxy;
}

export function stateMonitor(state: State): StateMonitor | undefined { return monitors.get(state); }

export function arrayStore(state: State): BindingStore | undefined { return monitors.get(state)?.store; }

export function guestArrays(state: State): BindingStore | undefined {
  const monitor = monitors.get(state), store = monitor?.store;
  return store?.owner.ledger === monitor?.session.ledger ? store : undefined;
}

export function requireArrays(state: State): BindingStore {
  const monitor = monitors.get(state);
  if (!monitor) throw new Error("Indexed-array state was not enrolled");
  return monitor.activate();
}

export class StateMonitor {
  readonly proxy: State;
  readonly values: ValueStore;
  readonly positionals: ValueStore;
  store: BindingStore | undefined;
  epoch = 0;
  #publication = false;
  readonly #wrapped = new WeakMap<object, object>();
  #wrapperCount = 0;
  #enrollment: Admission | undefined;
  #internalEnrollment: Admission | undefined;
  #restorations: Restoration | undefined;
  #overlays: OverlayMap | undefined;

  constructor(readonly raw: State, readonly session: Session, source?: StateMonitor) {
    this.values = source ? source.values.clone() : new ValueStore(session.values);
    try { this.positionals = source ? source.positionals.clone() : new ValueStore(session.values); }
    catch (error) { this.values.close(); throw error; }
    this.proxy = this.wrap(raw, "state") as State;
    monitors.set(raw, this);
    monitors.set(this.proxy, this);
    session.scope.register(async () => { await session.scope.drainWork(); this.closeValues(); });
  }

  closeValues(): void { this.values.close(); this.positionals.close(); }

  private changedValue(target: object, field: string, key: PropertyKey): void {
    if (field === "state") {
      if (key === "variables") this.values.invalidate();
      if (key === "positional") this.positionals.invalidate();
    } else if (field === "variables" && (this.raw.variables === target || this.raw.variables === this.#wrapped.get(target))) {
      this.values.invalidate(String(key));
    } else if (field === "positional" && (this.raw.positional === target || this.raw.positional === this.#wrapped.get(target))) {
      this.positionals.invalidate();
    }
  }

  internalOwner(): ArrayOwner {
    this.session.scope.assertOpen();
    return this.session.owner ??= ArrayOwner.create(this.session.internal);
  }

  activate(internal = false): BindingStore {
    if (this.store && (internal || this.#enrollment)) return this.store;
    const root = this.internalOwner();
    const owner = internal ? root : this.session.guestOwner ??= ArrayOwner.create(this.session.ledger, root);
    const enrollment = owner.reserve({ slots: this.#wrapperCount * 2 + 2, metadata: 128 + this.#wrapperCount * 128, work: this.#wrapperCount * 8 + 8 });
    if (internal) this.#internalEnrollment = enrollment;
    else this.#enrollment = enrollment;
    let pending = 0;
    for (let entry = this.#restorations; entry; entry = entry.next) if (!entry.epoch) pending++;
    if (pending) {
      const admission = owner.reserve({ epoch: pending, metadata: pending * 64, work: pending * 8 });
      admission.restorationReferences = pending;
      let ticket = admission.epoch - pending;
      for (let entry = this.#restorations; entry; entry = entry.next) if (!entry.epoch) { entry.epoch = ++ticket; entry.admission = admission; }
    }
    for (let entry = this.#restorations; entry; entry = entry.next) if (entry.resource && !entry.holding) entry.holding = owner.hold();
    if (this.store) this.store.owner = owner;
    else this.store = BindingStore.create(owner);
    this.store.epoch = this.epoch;
    return this.store;
  }

  restoration(resource = false): Restoration {
    const owner = this.store?.owner ?? this.session.guestOwner;
    const admission = owner?.reserve({ epoch: true, metadata: 64, work: 8 });
    if (admission) admission.restorationReferences = 1;
    const permit = new Restoration(this, admission, resource);
    try {
      if (resource && owner) permit.holding = owner.hold();
    } catch (error) { admission?.release(); throw error; }
    permit.next = this.#restorations;
    if (this.#restorations) this.#restorations.previous = permit;
    this.#restorations = permit;
    return permit;
  }

  openOverlay(frame: OverlayMap): void {
    if (this.#overlays) frame[overlayNext] = this.#overlays;
    this.#overlays = frame;
  }

  closeOverlay(frame: OverlayMap): void {
    if (this.#overlays !== frame) throw new Error("Indexed-array overlay dependency order violated");
    this.#overlays = frame[overlayNext];
    delete frame[overlayNext];
  }

  *overlayFrames(): Iterable<OverlayMap> {
    for (let frame = this.#overlays; frame; frame = frame[overlayNext]) yield frame;
  }

  prepareCollection<Value extends object>(value: Value, field: string): Value {
    return this.wrap(value, field) as Value;
  }

  async prepareTypedPublication(name: string, owner: ArrayOwner, signal: AbortSignal): Promise<() => void> {
    owner.reserve({ metadata: 128, work: 7 });
    const saved: { superseded?: boolean }[] = [];
    for (let frame = this.#overlays; frame; frame = frame[overlayNext]) {
      owner.reserve({ work: 2 }).release();
      const entry = frame.get(name);
      if (entry) {
        owner.reserve({ metadata: 32, allocatedSlots: 1, work: 3 });
        saved.push(entry);
      }
      await owner.ledger.checkpoint(signal, 2);
    }
    return () => { for (const entry of saved) entry.superseded = true; };
  }

  retire(permit: Restoration): void {
    if (permit.previous) permit.previous.next = permit.next;
    else this.#restorations = permit.next;
    if (permit.next) permit.next.previous = permit.previous;
  }

  restore(permit: Restoration, action: () => void): void {
    this.#publication = true;
    try { action(); }
    finally { this.#publication = false; }
    if (permit.epoch) {
      this.epoch = permit.epoch;
      if (this.store) this.store.epoch = permit.epoch;
    }
  }

  mutation(name?: string): Admission | undefined {
    if (this.#publication) return undefined;
    return this.store ? this.store.tickets(name) : this.session.guestOwner?.reserve({ epoch: true, work: 5 });
  }

  finish(tickets: Admission | undefined, name?: string): void {
    if (!tickets) return;
    this.epoch = tickets.epoch;
    this.store?.changed(tickets, name);
    tickets.release();
  }

  publish(tickets: Tickets, name: string | undefined, action: () => void): void {
    if (this.#publication) throw new Error("Nested indexed-array publication");
    this.#publication = true;
    try { action(); }
    finally { this.#publication = false; }
    this.epoch = tickets.epoch;
    this.store?.changed(tickets, name);
  }

  private wrap(value: object, field: string): object {
    const previous = this.#wrapped.get(value);
    if (previous) return previous;
    if (this.#enrollment || this.#internalEnrollment) {
      (this.#enrollment ? this.session.guestOwner! : this.session.owner!).reserve({ slots: 2, metadata: 128, work: 8 });
    }
    this.#wrapperCount++;
    const monitor = this;
    const named = field === "variables" || field === "exported" || field === "readonlyVariables";
    let proxy: object;
    if (value instanceof Map || value instanceof Set) {
      proxy = new Proxy(value, { get(target, key) {
        if (key === "set" && target instanceof Map) return (name: unknown, entry: unknown) => {
          const tickets = monitor.mutation(named ? String(name) : undefined);
          target.set(name, entry);
          monitor.finish(tickets, named ? String(name) : undefined);
          return proxy;
        };
        if (key === "add" && target instanceof Set) return (name: unknown) => {
          const tickets = monitor.mutation(named ? String(name) : undefined);
          target.add(name);
          monitor.finish(tickets, named ? String(name) : undefined);
          return proxy;
        };
        if (key === "delete") return (name: unknown) => {
          const tickets = monitor.mutation(named ? String(name) : undefined);
          const result = target.delete(name);
          monitor.finish(tickets, named ? String(name) : undefined);
          return result;
        };
        if (key === "clear") return () => {
          const tickets = monitor.mutation();
          target.clear();
          monitor.finish(tickets);
        };
        const entry: unknown = Reflect.get(target, key, target);
        return typeof entry === "function" ? entry.bind(target) : entry;
      } });
    } else {
      proxy = new Proxy(value, {
        get(target, key, receiver) {
          const entry: unknown = Reflect.get(target, key, receiver);
          if (entry && typeof entry === "object" && key !== "redirectAssignments") {
            if (field === "state" && key === "functions") return monitor.wrap(entry, "functions");
            if (field !== "functions") return monitor.wrap(entry, field === "state" ? String(key) : field);
          }
          return entry;
        },
        set(target, key, entry) {
          const name = named ? String(key) : undefined;
          const tickets = monitor.mutation(name);
          const result = Reflect.set(target, key, entry);
          if (result) monitor.changedValue(target, field, key);
          monitor.finish(tickets, name);
          return result;
        },
        deleteProperty(target, key) {
          const name = named ? String(key) : undefined;
          const tickets = monitor.mutation(name);
          const result = Reflect.deleteProperty(target, key);
          if (result) monitor.changedValue(target, field, key);
          monitor.finish(tickets, name);
          return result;
        },
        defineProperty(target, key, descriptor) {
          const name = named ? String(key) : undefined;
          const tickets = monitor.mutation(name);
          const result = Reflect.defineProperty(target, key, descriptor);
          if (result) monitor.changedValue(target, field, key);
          monitor.finish(tickets, name);
          return result;
        },
      });
    }
    this.#wrapped.set(value, proxy);
    this.#wrapped.set(proxy, proxy);
    return proxy;
  }
}

export class Restoration {
  next: Restoration | undefined;
  previous: Restoration | undefined;
  epoch: number;
  #closed = false;
  holding: Admission | undefined;

  constructor(readonly monitor: StateMonitor, public admission: Admission | undefined, readonly resource: boolean) { this.epoch = admission?.epoch ?? 0; }

  apply(action: () => void, close = true): void {
    if (this.#closed) throw new Error("Indexed-array restoration already consumed");
    try { this.monitor.restore(this, action); }
    finally { if (close) this.close(); }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.monitor.retire(this);
    if (this.admission && --this.admission.restorationReferences === 0) this.admission.release();
    this.holding?.release();
  }
}

export async function snapshotState(state: State, clone: () => State, signal: AbortSignal, prepare?: (destination: State, owner: ArrayOwner) => Promise<void>): Promise<State> {
  const monitor = stateMonitor(state);
  if (!monitor) return clone();
  if (!monitor.store && !monitor.session.ledger.active) return new StateMonitor(clone(), monitor.session, monitor).proxy;
  const store = monitor.store ?? monitor.activate();
  const internal = store.owner.ledger === monitor.session.internal;
  const epoch = monitor.epoch;
  const owner = ArrayOwner.create(store.owner.ledger, store.owner);
  const holding = store.owner.hold();
  const check = () => {
    signal.throwIfAborted();
    if (monitor.epoch !== epoch) throw new ArrayFailure("stale state snapshot");
  };
  let result: StateMonitor | undefined;
  try {
    owner.reserve({ metadata: 512, work: 32, epoch: true });
    if (!internal) {
    for (const key in state.variables) {
      if (!Object.hasOwn(state.variables, key)) continue;
      check();
      owner.reserve({ slots: 1, metadata: 32, work: 4 });
      await textToken(owner, key, signal);
      check();
      await textToken(owner, state.variables[key]!, signal);
      check();
    }
    for (const value of state.positional) { await textToken(owner, value, signal); check(); }
    for (const key of state.exported) { owner.reserve({ slots: 1, metadata: 32, work: 4 }); await textToken(owner, key, signal); check(); }
    for (const key of state.readonlyVariables ?? []) { owner.reserve({ slots: 1, metadata: 32, work: 4 }); await textToken(owner, key, signal); check(); }
    for (const key of state.functions.keys()) { owner.reserve({ slots: 1, metadata: 32, work: 4 }); await textToken(owner, key, signal); check(); }
    for (const value of state.directoryStack?.entries ?? []) { await textToken(owner, value, signal); check(); }
    for (const frame of state.locals) {
      owner.reserve({ metadata: 64, work: 4 });
      for (const [key, saved] of frame) {
        owner.reserve({ slots: 1, metadata: 64, work: 8 });
        await textToken(owner, key, signal); check();
        if (saved.value !== undefined) { await textToken(owner, saved.value, signal); check(); }
      }
    }
    }
    check();
    result = new StateMonitor(clone(), monitor.session, monitor);
    const destination = result.activate(internal);
    for (const [name, entry] of store.bindings) {
      check();
      const prepared = await destination.prepareName(name, owner, signal);
      check();
      const tickets = owner.reserve({ generation: true, version: true, epoch: true, work: 5 });
      entry.binding.retain();
      destination.publish(name, entry.binding, tickets, prepared);
      await owner.ledger.checkpoint(signal, 5);
    }
    check();
    if (prepare) { await prepare(result.proxy, owner); check(); }
    return result.proxy;
  } catch (error) {
    result?.closeValues();
    if (result?.store) for (const [name] of result.store.bindings) await result.store.remove(name, { generation: 0, version: 0, epoch: 0 });
    await owner.close();
    throw error;
  } finally { holding.release(); }
}
