import type { State } from "../runtime.js";
import type { InvocationScope } from "../cleanup.js";
import { ArrayFailure, ArrayLedger, ArrayOwner } from "./ledger.js";
import type { Admission, Tickets } from "./ledger.js";
import { BindingStore, IndexedBinding, OwnedText, textToken } from "./bindings.js";
import { ValueArena, ValueStore, type ValueScope } from "../value-state.js";
import type { GetoptsInput } from "../getopts.js";

interface Session {
  readonly values: ValueArena;
  readonly ledger: ArrayLedger;
  readonly internal: ArrayLedger;
  readonly scope: InvocationScope;
  firstMonitor: StateMonitor | undefined;
  monitors: Set<StateMonitor> | undefined;
  owner: ArrayOwner | undefined;
  guestOwner: ArrayOwner | undefined;
}

const sessionSymbol = Symbol("safe-bash.arraySession");
const monitorSymbol = Symbol("safe-bash.stateMonitor");
const fallbackSessions = new WeakMap<object, Session>();
const rawMonitors = new WeakMap<State, StateMonitor>();
const syncResolved = Symbol.for("safe-bash.syncResolved");

function isSyncResolved(promise: unknown): boolean {
  return Boolean(promise && typeof promise === "object" && (promise as Record<symbol, unknown>)[syncResolved]);
}
const overlayNext = Symbol("array overlay parent");
const guardedMutationCharge = { generation: true, version: true, epoch: true, work: 5 } as const;
const unguardedMutationCharge = { generation: false, version: false, epoch: true, work: 5 } as const;
const guestMutationCharge = { epoch: true, work: 5 } as const;
const SHARED_MUTATION_TICKETS = { generation: 0, version: 0, epoch: 0 };
type OverlayMap = Map<string, { superseded?: boolean }> & { [overlayNext]?: OverlayMap };

function createSession(
  budget: { readonly values?: ValueArena; readonly limits: { readonly maxExpansionBytes: number; readonly maxExpansionFields: number; readonly maxCommands?: number } },
  scope: InvocationScope,
): Session {
  while (scope.parent) scope = scope.parent;
  const ledger = new ArrayLedger(budget.limits.maxExpansionBytes, budget.limits.maxExpansionFields);
  const values = budget.values ?? new ValueArena(budget.limits.maxExpansionBytes, budget.limits.maxExpansionFields, () => scope.assertOpen());
  const session: Session = {
    values,
    ledger,
    internal: ledger.internal(budget.limits.maxCommands ?? 10_000),
    scope,
    firstMonitor: undefined,
    monitors: undefined,
    owner: undefined,
    guestOwner: undefined,
  };
  scope.registerFinalizer(() => {
    if (session.monitors) {
      for (const owned of [...session.monitors]) owned.closeValues();
      session.monitors.clear();
    } else if (session.firstMonitor) {
      const first = session.firstMonitor;
      session.firstMonitor = undefined;
      first.closeValues();
    }
    if (session.owner) {
      const closed = session.owner.close();
      if (!isSyncResolved(closed)) return closed.finally(() => values.close());
    }
    values.close();
  });
  if (Object.isExtensible(budget)) {
    (budget as unknown as Record<symbol, Session>)[sessionSymbol] = session;
  } else {
    fallbackSessions.set(budget, session);
  }
  return session;
}

export function trackState(state: State, budget: { readonly values?: ValueArena; readonly limits: { readonly maxExpansionBytes: number; readonly maxExpansionFields: number; readonly maxCommands?: number } }, scope: InvocationScope): State {
  const existing = stateMonitor(state);
  if (existing) return existing.proxy;
  const session = (budget as unknown as Record<symbol, Session | undefined>)[sessionSymbol] ?? fallbackSessions.get(budget) ?? createSession(budget, scope);
  return new StateMonitor(state, session).proxy;
}

export function stateMonitor(state: State): StateMonitor | undefined {
  return (state as unknown as Record<symbol, StateMonitor | undefined>)[monitorSymbol] ?? rawMonitors.get(state);
}

export function arrayStore(state: State): BindingStore | undefined {
  const monitor = stateMonitor(state);
  if (!monitor) return undefined;
  return monitor.store ?? (monitor.lazyPipeStatus !== undefined ? monitor.lazyStoreView : undefined);
}

export function guestArrays(state: State): BindingStore | undefined {
  const monitor = stateMonitor(state), store = monitor?.store;
  return store?.owner.ledger === monitor?.session.ledger ? store : undefined;
}

export function requireArrays(state: State): BindingStore {
  const monitor = stateMonitor(state);
  if (!monitor) throw new Error("Indexed-array state was not enrolled");
  return monitor.activate();
}

export class StateMonitor {
  declare readonly raw: State;
  declare readonly session: Session;
  declare readonly proxy: State;
  declare readonly values: ValueStore;
  declare private _positionals: ValueStore | undefined;
  declare store: BindingStore | undefined;
  declare lazyPipeStatus: readonly number[] | undefined;
  declare private _lazyStoreView: BindingStore | undefined;
  declare epoch: number;
  declare private _publication: boolean;
  declare private _wrapped: WeakMap<object, object> | undefined;
  declare private _variablesProxy: object | undefined;
  declare private _functionsProxy: object | undefined;
  declare private _exportedProxy: object | undefined;
  declare private _positionalProxy: object | undefined;
  declare private _localsProxy: object | undefined;
  declare private _wrapperCount: number;
  declare private _enrollment: Admission | undefined;
  declare private _internalEnrollment: Admission | undefined;
  declare snapshotOwner: ArrayOwner | undefined;
  declare private _restorations: Restoration | undefined;
  declare private _freeRestorations: Restoration | undefined;
  declare private _overlays: OverlayMap | undefined;
  declare private _positionalRevision: object | undefined;
  declare private _getoptsInput: { input: GetoptsInput; allocation: ValueScope } | undefined;

  constructor(raw: State, session: Session, source?: StateMonitor) {
    this.raw = raw;
    this.session = session;
    this.values = source ? source.values.clone() : session.values.createStore();
    this._positionals = undefined;
    this.store = undefined;
    this.lazyPipeStatus = source?.lazyPipeStatus;
    this._lazyStoreView = undefined;
    this.epoch = 0;
    this._publication = false;
    this._wrapped = undefined;
    this._variablesProxy = undefined;
    this._functionsProxy = undefined;
    this._exportedProxy = undefined;
    this._positionalProxy = undefined;
    this._localsProxy = undefined;
    this._wrapperCount = 1;
    this._enrollment = undefined;
    this._internalEnrollment = undefined;
    this.snapshotOwner = undefined;
    this._restorations = undefined;
    this._freeRestorations = undefined;
    this._overlays = undefined;
    this._positionalRevision = undefined;
    this._getoptsInput = undefined;
    if (source && source._positionals) {
      try { this._positionals = source._positionals.clone(); }
      catch (error) { this.values.close(); throw error; }
    }
    this.proxy = new Proxy(raw, new StateProxyHandler(this, "state", false)) as State;
    if (Object.isExtensible(raw)) {
      Object.defineProperty(raw, monitorSymbol, { value: this, writable: true, configurable: true });
    } else {
      rawMonitors.set(raw, this);
    }
    if (session.monitors) {
      session.monitors.add(this);
    } else if (!session.firstMonitor) {
      session.firstMonitor = this;
    } else if (session.firstMonitor !== this) {
      session.monitors = new Set([session.firstMonitor, this]);
      session.firstMonitor = undefined;
    }
  }

  get positionals(): ValueStore {
    return this._positionals ??= this.session.values.createStore();
  }

  closeValues(): void {
    this.values.close();
    this._positionals?.close();
    this.lazyPipeStatus = undefined;
    this.invalidateGetoptsInput();
    if (this.store) {
      for (const [name] of this.store.bindings) {
        void this.store.remove(name, { generation: 0, version: 0, epoch: 0 });
      }
    }
    this._internalEnrollment?.release();
    this._internalEnrollment = undefined;
    this._enrollment?.release();
    this._enrollment = undefined;
    if (this.snapshotOwner) {
      void this.snapshotOwner.close();
      this.snapshotOwner = undefined;
    }
    if (this.session.monitors) this.session.monitors.delete(this);
    else if (this.session.firstMonitor === this) this.session.firstMonitor = undefined;
  }

  get positionalRevision(): object { return this._positionalRevision ??= {}; }
  get getoptsInput(): GetoptsInput | undefined { return this._getoptsInput?.input; }
  get lazyStoreView(): BindingStore {
    return this._lazyStoreView ??= new LazyPipeStatusStoreView(this) as unknown as BindingStore;
  }

  retainGetoptsInput(revision: object, input: GetoptsInput, allocation: ValueScope): boolean {
    this.session.scope.assertOpen();
    if (revision !== (this._positionalRevision ??= {})) return false;
    this._getoptsInput?.allocation.close();
    this._getoptsInput = { input, allocation };
    return true;
  }

  private invalidateGetoptsInput(): void {
    this._getoptsInput?.allocation.close();
    this._getoptsInput = undefined;
    this._positionalRevision = undefined;
  }

  changedValue(target: object, field: string, key: PropertyKey): void {
    if (field === "state") {
      if (key === "variables") { this._variablesProxy = undefined; this.values.invalidate(); }
      if (key === "positional") { this._positionalProxy = undefined; this._positionals?.invalidate(); this.invalidateGetoptsInput(); }
      if (key === "functions") this._functionsProxy = undefined;
      if (key === "exported") this._exportedProxy = undefined;
      if (key === "locals") this._localsProxy = undefined;
    } else if (field === "variables" && (this.raw.variables === target || this._variablesProxy === target || this.raw.variables === this._wrapped?.get(target))) {
      this.values.invalidate(String(key));
    } else if (field === "positional" && (this.raw.positional === target || this._positionalProxy === target || this.raw.positional === this._wrapped?.get(target))) {
      this._positionals?.invalidate();
      this.invalidateGetoptsInput();
    }
  }

  internalOwner(): ArrayOwner {
    this.session.scope.assertOpen();
    return this.session.owner ??= ArrayOwner.create(this.session.internal);
  }

  activate(internal = false): BindingStore {
    if (this.store && (internal || this._enrollment)) return this.store;
    const root = this.internalOwner();
    const existingGuestOwner = this.session.guestOwner;
    const owner = internal ? root : existingGuestOwner ?? ArrayOwner.create(this.session.ledger, root);
    let enrollment: Admission;
    try {
      enrollment = owner.reserve({ slots: this._wrapperCount * 2 + 2, metadata: 128 + this._wrapperCount * 128, work: this._wrapperCount * 8 + 8 });
    } catch (error) {
      if (!internal && !existingGuestOwner) void owner.close();
      throw error;
    }
    if (internal) this._internalEnrollment = enrollment;
    else {
      this.session.guestOwner = owner;
      this._enrollment = enrollment;
    }
    let pending = 0;
    for (let entry = this._restorations; entry; entry = entry.next) if (!entry.epoch) pending++;
    if (pending) {
      const admission = owner.reserve({ epoch: pending, metadata: pending * 64, work: pending * 8 });
      admission.restorationReferences = pending;
      let ticket = admission.epoch - pending;
      for (let entry = this._restorations; entry; entry = entry.next) if (!entry.epoch) { entry.epoch = ++ticket; entry.admission = admission; }
    }
    for (let entry = this._restorations; entry; entry = entry.next) if (entry.resource && !entry.holding) entry.holding = owner.hold();
    if (this.store) this.store.owner = owner;
    else this.store = BindingStore.create(owner);
    this.store.epoch = this.epoch;
    if (this.lazyPipeStatus !== undefined) {
      const statuses = this.lazyPipeStatus;
      this.lazyPipeStatus = undefined;
      const savedEpoch = this.epoch;
      const tickets = root.reserve({ generation: true, version: true, epoch: true, work: 8 + statuses.length * 2 });
      const prepared = this.store.prepareExistingName("PIPESTATUS", 10, root, this.session.scope.signal);
      const staged = IndexedBinding.create(root);
      try {
        for (let i = 0; i < statuses.length; i++) {
          const s = statuses[i]!;
          const statusStr = s === 0 ? "0" : s === 1 ? "1" : String(s);
          staged.owner.chargeWork(statusStr.length);
          const token = new OwnedText(statusStr, statusStr.length, staged.owner.reserve({ payload: statusStr.length, metadata: 32, work: 4 }));
          try { staged.insert(i, token); }
          catch (error) { token.release(); throw error; }
        }
        const savedPublication = this._publication;
        this._publication = false;
        try {
          this.publish(tickets, "PIPESTATUS", () => {
            void this.store!.publish("PIPESTATUS", staged, tickets, prepared, false, root);
          });
        } finally {
          this._publication = savedPublication;
        }
        this.epoch = savedEpoch;
        this.store.epoch = savedEpoch;
      } catch (error) {
        this.lazyPipeStatus = statuses;
        void staged.release();
        prepared?.admission.release();
        prepared?.name.release();
        tickets.release();
        throw error;
      }
    }
    return this.store;
  }

  restoration(resource = false): Restoration {
    const owner = this.store?.owner ?? this.session.guestOwner;
    const admission = owner?.reserve({ epoch: true, metadata: 64, work: 8 });
    if (admission) admission.restorationReferences = 1;
    let permit = this._freeRestorations;
    if (permit) {
      this._freeRestorations = permit.next;
      permit._reset(admission, resource);
    } else {
      permit = new Restoration(this, admission, resource);
    }
    try {
      if (resource && owner) permit.holding = owner.hold();
    } catch (error) { admission?.release(); throw error; }
    permit.next = this._restorations;
    if (this._restorations) this._restorations.previous = permit;
    this._restorations = permit;
    return permit;
  }

  openOverlay(frame: OverlayMap): void {
    if (this._overlays) frame[overlayNext] = this._overlays;
    this._overlays = frame;
  }

  closeOverlay(frame: OverlayMap): void {
    if (this._overlays !== frame) throw new Error("Indexed-array overlay dependency order violated");
    this._overlays = frame[overlayNext];
    delete frame[overlayNext];
  }

  hasOverlay(name: string): boolean {
    for (let frame = this._overlays; frame; frame = frame[overlayNext]) {
      if (frame.has(name)) return true;
    }
    return false;
  }

  *overlayFrames(): Iterable<OverlayMap> {
    for (let frame = this._overlays; frame; frame = frame[overlayNext]) yield frame;
  }

  prepareCollection<Value extends object>(value: Value, field: string): Value {
    return this.wrap(value, field) as Value;
  }

  async prepareTypedPublication(name: string, owner: ArrayOwner, signal: AbortSignal): Promise<() => void> {
    owner.reserve({ metadata: 128, work: 7 });
    const saved: { superseded?: boolean }[] = [];
    for (let frame = this._overlays; frame; frame = frame[overlayNext]) {
      owner.chargeWork(2);
      const entry = frame.get(name);
      if (entry) {
        owner.reserve({ metadata: 32, allocatedSlots: 1, work: 3 });
        saved.push(entry);
      }
      const pending = owner.ledger.checkpoint(signal, 2);
      if (pending) await pending;
    }
    return () => { for (const entry of saved) entry.superseded = true; };
  }

  retire(permit: Restoration): void {
    if (permit.previous) permit.previous.next = permit.next;
    else this._restorations = permit.next;
    if (permit.next) permit.next.previous = permit.previous;
    permit.previous = undefined;
    permit.next = this._freeRestorations;
    this._freeRestorations = permit;
  }

  restore(permit: Restoration, action: () => void): void {
    this._publication = true;
    try { action(); }
    finally { this._publication = false; }
    if (permit.epoch) {
      this.epoch = permit.epoch;
      if (this.store) this.store.epoch = permit.epoch;
    }
  }

  mutation(name?: string): Tickets | undefined {
    if (this._publication) return undefined;
    if (this.store) {
      const guarded = name !== undefined && (this.store.bindings.has(name) || this.store.watches.has(name));
      return this.store.owner.charge(guarded ? guardedMutationCharge : unguardedMutationCharge, SHARED_MUTATION_TICKETS);
    }
    return this.session.guestOwner?.charge(guestMutationCharge, SHARED_MUTATION_TICKETS);
  }

  finish(tickets: Tickets | undefined, name?: string): void {
    if (!tickets) return;
    this.epoch = tickets.epoch;
    this.store?.changed(tickets, name);
  }

  publishStringVariable(name: string, value: string): void {
    const tickets = this.mutation(name);
    this.values.publishString(name, value, this.raw.variables);
    this.finish(tickets, name);
  }

  publish(tickets: Tickets, name: string | undefined, action: () => void): void {
    if (this._publication) throw new Error("Nested indexed-array publication");
    this._publication = true;
    try { action(); }
    finally { this._publication = false; }
    this.epoch = tickets.epoch;
    this.store?.changed(tickets, name);
  }

  private _reserveWrapSlot(): void {
    if (this._enrollment || this._internalEnrollment) {
      (this._enrollment ? this.session.guestOwner! : this.session.owner!).reserve({ slots: 2, metadata: 128, work: 8 });
    }
    this._wrapperCount++;
  }

  wrap(value: object, field: string): object {
    if (value === this.raw || value === this.proxy) return this.proxy;
    if (field === "variables" && (value === this.raw.variables || value === this._variablesProxy)) {
      if (this._variablesProxy) return this._variablesProxy;
      this._reserveWrapSlot();
      return this._variablesProxy = new Proxy(this.raw.variables, new StateProxyHandler(this, "variables", true));
    }
    if (field === "functions" && (value === this.raw.functions || value === this._functionsProxy)) {
      if (this._functionsProxy) return this._functionsProxy;
      this._reserveWrapSlot();
      const handler = new CollectionProxyHandler(this, false);
      const proxy = new Proxy(this.raw.functions, handler);
      handler.proxy = proxy;
      return this._functionsProxy = proxy;
    }
    if (field === "exported" && (value === this.raw.exported || value === this._exportedProxy)) {
      if (this._exportedProxy) return this._exportedProxy;
      this._reserveWrapSlot();
      const handler = new CollectionProxyHandler(this, true);
      const proxy = new Proxy(this.raw.exported, handler);
      handler.proxy = proxy;
      return this._exportedProxy = proxy;
    }
    if (field === "positional" && (value === this.raw.positional || value === this._positionalProxy)) {
      if (this._positionalProxy) return this._positionalProxy;
      this._reserveWrapSlot();
      return this._positionalProxy = new Proxy(this.raw.positional, new StateProxyHandler(this, "positional", false));
    }
    if (field === "locals" && (value === this.raw.locals || value === this._localsProxy)) {
      if (this._localsProxy) return this._localsProxy;
      this._reserveWrapSlot();
      return this._localsProxy = new Proxy(this.raw.locals, new StateProxyHandler(this, "locals", false));
    }
    let wrapped = this._wrapped;
    if (wrapped) {
      const previous = wrapped.get(value);
      if (previous) return previous;
    } else {
      wrapped = new WeakMap();
      this._wrapped = wrapped;
    }
    this._reserveWrapSlot();
    const named = field === "variables" || field === "exported" || field === "readonlyVariables";
    let proxy: object;
    if (value instanceof Map || value instanceof Set) {
      const handler = new CollectionProxyHandler(this, named);
      proxy = new Proxy(value, handler);
      handler.proxy = proxy;
    } else {
      proxy = new Proxy(value, new StateProxyHandler(this, field, named));
    }
    wrapped.set(value, proxy);
    wrapped.set(proxy, proxy);
    return proxy;
  }
}

class LazyPipeStatusStoreView {
  constructor(private readonly monitor: StateMonitor) {}
  get(name: string): IndexedBinding | undefined {
    if (this.monitor.store) return this.monitor.store.get(name);
    if (name !== "PIPESTATUS" || this.monitor.lazyPipeStatus === undefined) return undefined;
    return this.monitor.activate(true).get("PIPESTATUS");
  }
  get owner() { return this.monitor.activate(true).owner; }
  get bindings() { return this.monitor.activate(true).bindings; }
  get watches() { return this.monitor.activate(true).watches; }
  get epoch(): number { return this.monitor.store ? this.monitor.store.epoch : this.monitor.epoch; }
  set epoch(value: number) { if (this.monitor.store) this.monitor.store.epoch = value; else this.monitor.epoch = value; }
  prepareExistingName(...args: Parameters<BindingStore["prepareExistingName"]>) {
    return this.monitor.activate(true).prepareExistingName(...args);
  }
  prepareName(...args: Parameters<BindingStore["prepareName"]>) {
    return this.monitor.activate(true).prepareName(...args);
  }
  tickets(...args: Parameters<BindingStore["tickets"]>) {
    return this.monitor.activate(true).tickets(...args);
  }
  publish(...args: Parameters<BindingStore["publish"]>) {
    return this.monitor.activate(true).publish(...args);
  }
  remove(...args: Parameters<BindingStore["remove"]>) {
    return this.monitor.activate(true).remove(...args);
  }
  watch(...args: Parameters<BindingStore["watch"]>) {
    return this.monitor.activate(true).watch(...args);
  }
  changed(...args: Parameters<BindingStore["changed"]>) {
    this.monitor.activate(true).changed(...args);
  }
}

class StateProxyHandler implements ProxyHandler<object> {
  constructor(
    private readonly monitor: StateMonitor,
    private readonly field: string,
    private readonly named: boolean,
  ) {}
  get(target: object, key: PropertyKey, receiver: unknown): unknown {
    if (key === monitorSymbol) return this.monitor;
    const entry: unknown = Reflect.get(target, key, receiver);
    if (typeof entry !== "object" || entry === null) return entry;
    if (this.field === "state" && key === "extensions") return entry;
    if (key !== "redirectAssignments") {
      if (this.field === "state" && key === "functions") return this.monitor.wrap(entry, "functions");
      if (this.field !== "functions") return this.monitor.wrap(entry, this.field === "state" ? String(key) : this.field);
    }
    return entry;
  }
  set(target: object, key: PropertyKey, entry: unknown): boolean {
    const name = this.named ? String(key) : undefined;
    const tickets = this.monitor.mutation(name);
    const result = Reflect.set(target, key, entry);
    if (result) this.monitor.changedValue(target, this.field, key);
    this.monitor.finish(tickets, name);
    return result;
  }
  deleteProperty(target: object, key: PropertyKey): boolean {
    const name = this.named ? String(key) : undefined;
    const tickets = this.monitor.mutation(name);
    const result = Reflect.deleteProperty(target, key);
    if (result) this.monitor.changedValue(target, this.field, key);
    this.monitor.finish(tickets, name);
    return result;
  }
  defineProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor): boolean {
    const name = this.named ? String(key) : undefined;
    const tickets = this.monitor.mutation(name);
    const result = Reflect.defineProperty(target, key, descriptor);
    if (result) this.monitor.changedValue(target, this.field, key);
    this.monitor.finish(tickets, name);
    return result;
  }
}

class CollectionProxyHandler implements ProxyHandler<Map<unknown, unknown> | Set<unknown>> {
  proxy!: object;
  private boundCache: Map<PropertyKey, unknown> | undefined;
  constructor(
    private readonly monitor: StateMonitor,
    private readonly named: boolean,
  ) {}
  get(target: Map<unknown, unknown> | Set<unknown>, key: PropertyKey): unknown {
    const cache = this.boundCache;
    if (cache) {
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
    }
    if (key === "set" && target instanceof Map) {
      const fn = (name: unknown, entry: unknown) => {
        const k = this.named ? String(name) : undefined;
        const tickets = this.monitor.mutation(k);
        target.set(name, entry);
        this.monitor.finish(tickets, k);
        return this.proxy;
      };
      (this.boundCache ??= new Map()).set(key, fn);
      return fn;
    }
    if (key === "add" && target instanceof Set) {
      const fn = (name: unknown) => {
        const k = this.named ? String(name) : undefined;
        const tickets = this.monitor.mutation(k);
        target.add(name);
        this.monitor.finish(tickets, k);
        return this.proxy;
      };
      (this.boundCache ??= new Map()).set(key, fn);
      return fn;
    }
    if (key === "delete") {
      const fn = (name: unknown) => {
        const k = this.named ? String(name) : undefined;
        const tickets = this.monitor.mutation(k);
        const result = target.delete(name);
        this.monitor.finish(tickets, k);
        return result;
      };
      (this.boundCache ??= new Map()).set(key, fn);
      return fn;
    }
    if (key === "clear") {
      const fn = () => {
        const tickets = this.monitor.mutation();
        target.clear();
        this.monitor.finish(tickets);
      };
      (this.boundCache ??= new Map()).set(key, fn);
      return fn;
    }
    const entry: unknown = Reflect.get(target, key, target);
    if (typeof entry === "function") {
      const bound = entry.bind(target);
      (this.boundCache ??= new Map()).set(key, bound);
      return bound;
    }
    return entry;
  }
}

export class Restoration {
  next: Restoration | undefined;
  previous: Restoration | undefined;
  epoch: number;
  #closed = false;
  holding: Admission | undefined;

  constructor(readonly monitor: StateMonitor, public admission: Admission | undefined, public resource: boolean) { this.epoch = admission?.epoch ?? 0; }

  _reset(admission: Admission | undefined, resource: boolean): void {
    this.admission = admission;
    this.resource = resource;
    this.epoch = admission?.epoch ?? 0;
    this.#closed = false;
    this.holding = undefined;
    this.next = undefined;
    this.previous = undefined;
  }

  completeStatus(status: number): void {
    if (this.#closed) throw new Error("Indexed-array restoration already consumed");
    try {
      this.monitor.raw.status = status;
      if (this.epoch) {
        this.monitor.epoch = this.epoch;
        if (this.monitor.store) this.monitor.store.epoch = this.epoch;
      }
    } finally {
      this.close();
    }
  }

  decrementLoopDepth(): void {
    if (this.#closed) throw new Error("Indexed-array restoration already consumed");
    try {
      this.monitor.raw.loopDepth--;
      if (this.epoch) {
        this.monitor.epoch = this.epoch;
        if (this.monitor.store) this.monitor.store.epoch = this.epoch;
      }
    } finally {
      this.close();
    }
  }

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
    this.admission = undefined;
    this.holding = undefined;
  }
}

export function trySnapshotStateSync(state: State, clone: () => State, scope?: InvocationScope): State | undefined {
  const monitor = stateMonitor(state);
  if (!monitor) return clone();
  if (scope || monitor.store || monitor.session.ledger.active) return undefined;
  return new StateMonitor(clone(), monitor.session, monitor).proxy;
}

export async function snapshotState(state: State, clone: () => State, signal: AbortSignal, prepare?: (destination: State, owner: ArrayOwner) => Promise<void>, scope?: InvocationScope): Promise<State> {
  const monitor = stateMonitor(state);
  if (!monitor) return clone();
  const session: Session = scope ? { ...monitor.session, scope, owner: undefined, guestOwner: undefined, firstMonitor: undefined, monitors: new Set() } : monitor.session;
  if (scope) scope.register(async () => {
    await scope.drainWork();
    for (const owned of session.monitors!) {
      owned.closeValues();
      if (owned.store) for (const [name] of owned.store.bindings) {
        await scope.cleanup(async () => { await owned.store!.remove(name, { generation: 0, version: 0, epoch: 0 }); });
      }
    }
    session.monitors!.clear();
    await session.owner?.close();
  });
  if (!monitor.store && !monitor.session.ledger.active) return new StateMonitor(clone(), session, monitor).proxy;
  const store = monitor.store ?? monitor.activate();
  const internal = store.owner.ledger === monitor.session.internal;
  const epoch = monitor.epoch;
  const parent = scope ? session.owner ??= ArrayOwner.create(session.internal) : store.owner;
  const owner = ArrayOwner.create(store.owner.ledger, parent);
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
    for (const key of state.readonlyFunctions ?? []) { owner.reserve({ slots: 1, metadata: 32, work: 4 }); await textToken(owner, key, signal); check(); }
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
    result = new StateMonitor(clone(), session, monitor);
    result.snapshotOwner = owner;
    const destination = result.activate(internal);
    for (const [name, entry] of store.bindings) {
      check();
      const prepared = destination.prepareExistingName(name, entry.name.bytes, owner, signal);
      check();
      const tickets = owner.reserve({ generation: true, version: true, epoch: true, work: 5 });
      entry.binding.retain();
      destination.publish(name, entry.binding, tickets, prepared);
      const pending = owner.ledger.checkpoint(signal, 5);
      if (pending) await pending;
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
