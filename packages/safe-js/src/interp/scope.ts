import type { VariableDeclarationKind } from "../parse.js";
import type { PrivateName } from "./private-state.js";
import type { InterpreterSnapshot, InterpreterValue } from "./interpreter.js";
import type { ResourceScopeState } from "./resource-management.js";
import { builtinGlobalObjects, getIntrinsicIdentity, mutableBuiltinBindings } from "./intrinsics.js";
import { getSandboxPropertyDescriptor } from "./object-model.js";
import type { SandboxObject } from "./values.js";
import type { ModuleEnvironment } from "../modules/registry.js";
import { scopeDataRoots } from "./scope-data-roots.js";

type ScopeBinding = {
  kind: VariableDeclarationKind;
  deletable?: true;
  silentImmutable?: true;
  value: InterpreterValue | typeof uninitialized;
  accounting?: { value: InterpreterValue; root: SandboxObject };
};

type ScopeLookupResult =
  | {
      found: true;
      kind: VariableDeclarationKind;
      silentImmutable?: true;
      value: InterpreterValue;
      object?: SandboxObject;
    }
  | {
      found: false;
    };

const uninitialized = Symbol("uninitialized");

export type BindingReference =
  | {kind: "unresolvable"; name: string}
  | {kind: "binding"; name: string; scope: Scope}
  | {kind: "object"; name: string; object: SandboxObject; withEnvironment: boolean};

export type BindingOperations = {
  has(object: SandboxObject, name: string): boolean | Promise<boolean>;
  get(object: SandboxObject, key: PropertyKey): InterpreterValue | Promise<InterpreterValue>;
};

type ScopeOptions = {
  simpleCatchParameter?: string;
  globalEnvironment?: boolean;
  functionBoundary?: boolean;
  chargeData?: boolean;
};

export type ScopeFrame = {
  simpleCatchParameter?: string;
  globalEnvironment?: boolean;
  moduleEnvironment?: ModuleEnvironment;
  objectEnvironment?: SandboxObject;
  withObject?: SandboxObject;
  resourceState?: ResourceScopeState;
  privateNames?: Array<[string, PrivateName]>;
  parent?: Scope;
  importMeta?: InterpreterValue;
  functionBoundary: boolean;
  chargeData: boolean;
  bindings: Array<[string, number]>;
  cells: Array<{ kind: VariableDeclarationKind; silentImmutable?: true; deletable?: true } & (
    { initialized: false } | { initialized: true; value: InterpreterValue }
  )>;
  restoredBindings?: Array<[string, InterpreterValue]>;
};

export class Scope {
  moduleEnvironment?: ModuleEnvironment;
  private objectEnvironment?: SandboxObject;
  private withEnvironment = false;
  resourceState?: ResourceScopeState;
  privateNames?: Map<string, PrivateName>;
  readonly #bindings = new Map<string, ScopeBinding>();
  readonly #replacedBindings = new Set<ScopeBinding>();
  readonly #restoredBindings: Map<string, InterpreterValue>;
  #frameHydrated = false;
  #bindingDataRoots?: SandboxObject[];

  constructor(
    bindings: Record<string, InterpreterValue> = {},
    private readonly parent?: Scope,
    private importMeta?: InterpreterValue,
    private readonly options: ScopeOptions = {
      functionBoundary: parent === undefined
    },
    restoredBindings?: Record<string, InterpreterValue>
  ) {
    this.#restoredBindings =
      parent === undefined
        ? new Map(Object.entries(restoredBindings ?? {}))
        : parent.#restoredBindings;
    const mutable = mutableBuiltinBindings.get(bindings);
    this.objectEnvironment = builtinGlobalObjects.get(bindings);
    for (const [name, value] of Object.entries(this.objectEnvironment === undefined ? bindings : {})) {
      this.#bindings.set(name, {
        kind: mutable?.has(name) ? "var" : "const",
        value
      });
    }
  }

  child(bindings: Record<string, InterpreterValue> = {}, options: ScopeOptions = {}): Scope {
    return new Scope(bindings, this, undefined, {
      chargeData: true,
      ...options
    });
  }

  withObject(object: SandboxObject): Scope {
    const scope = this.child();
    scope.objectEnvironment = object;
    scope.withEnvironment = true;
    return scope;
  }

  resolveBinding(name: string, operations: BindingOperations): BindingReference | Promise<BindingReference> {
    if (this.#bindings.has(name)) return {kind: "binding", name, scope: this};
    if (this.objectEnvironment !== undefined) return this.resolveObjectBinding(name, this.objectEnvironment, operations);
    if (this.parent !== undefined) return this.parent.resolveBinding(name, operations);
    if (name === "undefined") return {kind: "binding", name, scope: this};
    return {kind: "unresolvable", name};
  }

  private async resolveObjectBinding(name: string, object: SandboxObject, operations: BindingOperations): Promise<BindingReference> {
    if (await operations.has(object, name)) {
      let blocked = false;
      if (this.withEnvironment) {
        const unscopables = await operations.get(object, Symbol.unscopables);
        if (typeof unscopables === "object" && unscopables !== null)
          blocked = Boolean(await operations.get(unscopables as SandboxObject, name));
      }
      if (!blocked) return {kind: "object", name, object, withEnvironment: this.withEnvironment};
    }
    if (this.parent !== undefined) return this.parent.resolveBinding(name, operations);
    if (name === "undefined") return {kind: "binding", name, scope: this};
    return {kind: "unresolvable", name};
  }

  declarePrivateName(description: string): PrivateName {
    const names = this.privateNames ??= new Map();
    const existing = names.get(description);
    if (existing !== undefined) return existing;
    const name = { description };
    names.set(description, name);
    return name;
  }

  resolvePrivateName(description: string): PrivateName {
    const ownName = this.privateNames?.get(description);
    if (ownName !== undefined) return ownName;
    let scope: Scope | undefined = this.parent;
    while (scope !== undefined) {
      const name = scope.privateNames?.get(description);
      if (name !== undefined) return name;
      scope = scope.parent;
    }
    throw new SyntaxError(`Undeclared private name #${description}.`);
  }

  visiblePrivateNames(): ReadonlySet<string> {
    const names = new Set(this.privateNames?.keys());
    for (let scope = this.parent; scope !== undefined; scope = scope.parent)
      for (const name of scope.privateNames?.keys() ?? []) names.add(name);
    return names;
  }

  consumeRestoredBinding(
    name: string
  ): { found: true; value: InterpreterValue } | { found: false } {
    if (!this.#restoredBindings.has(name)) {
      return { found: false };
    }

    const value = this.#restoredBindings.get(name);
    this.#restoredBindings.delete(name);
    return { found: true, value };
  }

  hasOwnBinding(name: string): boolean {
    return this.#bindings.has(name);
  }

  deleteBinding(name: string): boolean {
    const binding = this.#bindings.get(name);
    if (binding?.deletable !== true) return false;
    this.#bindings.delete(name);
    if (![...this.#bindings.values()].includes(binding)) this.#replacedBindings.delete(binding);
    this.#bindingDataRoots = undefined;
    return true;
  }

  getOwnBindingKind(name: string): VariableDeclarationKind | undefined {
    return this.#bindings.get(name)?.kind;
  }

  isFunctionBoundary(): boolean {
    return this.options.functionBoundary === true;
  }

  iterationChild(names: readonly string[]): Scope {
    const scope = new Scope({}, this.parent);

    for (const name of names) {
      const binding = this.requireInitializedBinding(name);
      if (binding.kind === "var") {
        continue;
      }
      scope.declare(name, binding.kind, binding.value);
    }

    return scope;
  }

  lookupImportMeta(): InterpreterValue {
    if (this.importMeta !== undefined) {
      return this.importMeta;
    }

    if (this.parent !== undefined) {
      return this.parent.lookupImportMeta();
    }

    return {};
  }

  lookupThis(): InterpreterValue {
    const binding = this.#bindings.get("this");
    if (binding !== undefined) {
      if (binding.value === uninitialized) throw new ReferenceError("Cannot access 'this' before initialization.");
      return binding.value;
    }
    return this.parent?.lookupThis();
  }

  lookupModuleEnvironment(): ModuleEnvironment | undefined {
    return this.moduleEnvironment ?? this.parent?.lookupModuleEnvironment();
  }

  retainedValues(): InterpreterValue[] {
    const values = this.parent?.retainedValues() ?? [];
    if (this.moduleEnvironment !== undefined) values.push(...Object.values(this.moduleEnvironment.namespaces));
    if (this.resourceState !== undefined) values.push(this.resourceState);
    if (this.options.chargeData !== false) {
      if (this.importMeta !== undefined) values.push(this.importMeta);
      if (this.privateNames !== undefined) values.push(...this.privateNames.values());
      for (const binding of this.#bindings.values()) {
        if (binding.value !== uninitialized) values.push(binding.value);
      }
    } else {
      for (const binding of this.#replacedBindings) {
        if (binding.value !== uninitialized) values.push(binding.value);
      }
    }
    return values;
  }

  retainedDataRoots(): InterpreterValue[] {
    const values = this.parent?.retainedDataRoots() ?? [];
    if (this.withEnvironment && this.objectEnvironment !== undefined) values.push(this.objectEnvironment);
    if (this.moduleEnvironment !== undefined) values.push(...Object.values(this.moduleEnvironment.namespaces));
    if (this.resourceState !== undefined) values.push(this.resourceState);
    if (this.options.chargeData !== false) {
      if (this.importMeta !== undefined) values.push(this.importMeta);
      if (this.privateNames !== undefined) values.push(...this.privateNames.values());
    }
    if (this.#bindingDataRoots === undefined) {
      const roots: SandboxObject[] = [];
      const bindings = this.options.chargeData === false ? this.#replacedBindings : this.#bindings.values();
      for (const binding of bindings) {
        const value = binding.value;
        if (!isChargedBindingValue(value)) continue;
        if (binding.accounting === undefined) {
          const root = Object.freeze({});
          scopeDataRoots.set(root, {value});
          binding.accounting = {value, root};
        }
        roots.push(binding.accounting.root);
      }
      this.#bindingDataRoots = [];
      if (roots.length > 0) {
        const group = Object.freeze({});
        scopeDataRoots.set(group, {values: roots});
        this.#bindingDataRoots.push(group);
      }
    }
    values.push(...this.#bindingDataRoots);
    return values;
  }

  declare(name: string, kind: VariableDeclarationKind, value: InterpreterValue,
    options?: {silentImmutable: true}
  ): void {
    if (options?.silentImmutable && kind !== "const") throw new TypeError("Silent immutable bindings must be const.");
    const existing = this.#bindings.get(name);
    if (existing !== undefined && existing.value !== uninitialized) {
      throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
    }
    if (existing !== undefined && existing.kind !== kind) {
      throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
    }

    if (existing !== undefined) this.writeBindingValue(existing, value);
    else {
      this.#bindings.set(name, { kind, value, ...options });
      if (isChargedBindingValue(value)) this.#bindingDataRoots = undefined;
    }
  }

  declareAlias(name: string, target: string): void {
    if (this.#bindings.has(name)) throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
    const binding = this.#bindings.get(target);
    if (binding === undefined) throw new ReferenceError(`Identifier '${target}' is not defined.`);
    this.#bindings.set(name, binding);
  }

  declareVar(name: string, options?: {functionValue?: InterpreterValue; deletable?: true}): void {
    const definesFunction = options !== undefined && "functionValue" in options;
    if (this.options.globalEnvironment === true) {
      const object = this.parent?.objectEnvironment;
      if (object === undefined) throw new TypeError("Missing global object environment.");
      const descriptor = Object.getOwnPropertyDescriptor(object, name);
      if (!definesFunction && descriptor !== undefined) return;
      const attributes = definesFunction && descriptor?.configurable === false
        ? {value: options.functionValue}
        : {value: options?.functionValue, writable: true, enumerable: true, configurable: true};
      if (!Reflect.defineProperty(object, name, attributes)) throw new TypeError(`Cannot declare global '${name}'.`);
      return;
    }
    const boundary = this.options.functionBoundary === true ? this : this.parent;
    if (boundary === undefined) {
      throw new Error("Cannot declare var without a function boundary.");
    }
    if (boundary !== this) {
      boundary.declareVar(name, options);
      return;
    }

    const existing = this.#bindings.get(name);
    if (existing?.kind === "var") {
      if (definesFunction) {
        this.writeBindingValue(existing, options.functionValue);
        this.trackReplacement(name, existing);
      }
      return;
    }
    if (existing !== undefined) {
      throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
    }

    this.#bindings.set(name, {
      kind: "var",
      ...(options?.deletable ? {deletable: true} : {}),
      value: options?.functionValue
    });
    if (options !== undefined && isChargedBindingValue(options.functionValue)) this.#bindingDataRoots = undefined;
    if (options !== undefined) this.trackReplacement(name, this.#bindings.get(name)!);
  }

  validateEvalGlobalDeclarations(names: ReadonlySet<string>, functions: ReadonlySet<string>): void {
    if (this.options.globalEnvironment === true) {
      const object = this.parent?.objectEnvironment;
      if (object === undefined) throw new TypeError("Missing global object environment.");
      for (const name of names) {
        const descriptor = Object.getOwnPropertyDescriptor(object, name);
        if (descriptor === undefined ? !Object.isExtensible(object)
          : functions.has(name) && descriptor.configurable !== true &&
            (!("value" in descriptor) || descriptor.writable !== true || descriptor.enumerable !== true))
          throw new TypeError(`Cannot declare global '${name}'.`);
      }
    } else if (!this.isFunctionBoundary()) {
      this.parent?.validateEvalGlobalDeclarations(names, functions);
    }
  }

  findEvalVarConflict(names: ReadonlySet<string>): string | undefined {
    for (const name of names) {
      const kind = this.getOwnBindingKind(name);
      if (kind !== undefined && kind !== "var" && this.options.simpleCatchParameter !== name) {
        return name;
      }
    }
    if (!this.isFunctionBoundary() && this.options.globalEnvironment !== true)
      return this.parent?.findEvalVarConflict(names);
    return undefined;
  }

  assignVar(name: string, value: InterpreterValue,
    setProperty?: (object: SandboxObject, key: string, value: InterpreterValue) => void | Promise<void>
  ): void | Promise<void> {
    if (this.options.globalEnvironment === true) {
      return this.assign(name, value, setProperty, false);
    }
    if (this.isFunctionBoundary()) {
      this.assignOwnBinding(name, value, false);
      return;
    }
    if (this.parent === undefined) throw new Error("Cannot assign var without a function boundary.");
    return this.parent.assignVar(name, value, setProperty);
  }

  predeclare(name: string, kind: VariableDeclarationKind): void {
    if (this.#bindings.has(name)) {
      throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
    }

    this.#bindings.set(name, {
      kind,
      value: uninitialized
    });
  }

  assign(name: string, value: InterpreterValue,
    setProperty?: (object: SandboxObject, key: string, value: InterpreterValue) => void | Promise<void>,
    strict = true
  ): void | Promise<void> {
    const scope = this.resolveScope(name);
    if (scope === undefined) {
      if (name === "undefined") throw new TypeError("Cannot assign to const binding 'undefined'.");
      throw new ReferenceError(`Cannot assign to undeclared binding '${name}'.`);
    }

    if (!scope.#bindings.has(name) && scope.objectEnvironment !== undefined) {
      if (setProperty !== undefined) return setProperty(scope.objectEnvironment, name, value);
      const descriptor = getSandboxPropertyDescriptor(scope.objectEnvironment, name);
      if (descriptor === undefined) throw new ReferenceError(`Cannot assign to undeclared binding '${name}'.`);
      if (!("value" in descriptor)) throw new TypeError("Object environment accessors require a guest call context.");
      if (!Reflect.set(scope.objectEnvironment, name, value)) throw new TypeError(`Cannot assign to read-only binding '${name}'.`);
      return;
    }
    return scope.assignOwnBinding(name, value, strict);
  }

  assignOwnBinding(name: string, value: InterpreterValue, strict = true): void {
    let binding = this.#bindings.get(name);
    if (binding === undefined) {
      if (strict) throw new ReferenceError(`Cannot assign to undeclared binding '${name}'.`);
      binding = {kind: "var", deletable: true, value};
      this.#bindings.set(name, binding);
      this.#bindingDataRoots = undefined;
      this.trackReplacement(name, binding);
      return;
    }

    if (binding.value === uninitialized) {
      throw new ReferenceError(`Cannot access '${name}' before initialization.`);
    }

    if (binding.kind === "const") {
      if (binding.silentImmutable && !strict) return;
      throw new TypeError(`Cannot assign to const binding '${name}'.`);
    }

    this.writeBindingValue(binding, value);
    this.trackReplacement(name, binding);
  }

  globalScope(): Scope {
    if (this.parent === undefined || this.options.globalEnvironment === true) return this;
    let scope: Scope = this.parent;
    while (scope.parent !== undefined && scope.options.globalEnvironment !== true) scope = scope.parent;
    return scope;
  }

  lookup(name: string): ScopeLookupResult {
    const binding = this.#bindings.get(name);
    if (binding !== undefined) {
      if (binding.value === uninitialized) {
        throw new ReferenceError(`Cannot access '${name}' before initialization.`);
      }

      return {
        found: true,
        kind: binding.kind,
        ...(binding.silentImmutable ? {silentImmutable: true} : {}),
        value: binding.value
      };
    }

    if (this.objectEnvironment !== undefined) {
      const descriptor = getSandboxPropertyDescriptor(this.objectEnvironment, name);
      if (descriptor !== undefined) return {found: true, kind: "var", value: descriptor.value, object: this.objectEnvironment};
    }
    if (this.parent !== undefined) {
      return this.parent.lookup(name);
    }

    // A virtual default also serves legacy snapshots without adding frame cells.
    if (name === "undefined") return { found: true, kind: "const", value: undefined };
    return { found: false };
  }

  snapshot(): InterpreterSnapshot {
    const scopes: Scope[] = [this];
    let parent = this.parent;

    while (parent !== undefined) {
      scopes.push(parent);
      parent = parent.parent;
    }

    const bindings: Record<string, InterpreterValue> = {};

    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      const object = scopes[index].objectEnvironment;
      if (object !== undefined) {
        // Public dump discovery must still see builtin roots and mutations.
        // Accessors are captured through the object, never invoked by a dump.
        for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(object))) {
          if ("value" in descriptor) defineSnapshotBinding(bindings, name, descriptor.value);
        }
      }
      for (const [name, binding] of scopes[index].#bindings.entries()) {
        if (binding.value === uninitialized) {
          continue;
        }

        defineSnapshotBinding(bindings, name, binding.value);
      }
    }

    return {
      bindings
    };
  }

  captureFrame(): ScopeFrame {
    const ids = new Map<ScopeBinding, number>();
    const cells: ScopeFrame["cells"] = [];
    const bindings: ScopeFrame["bindings"] = [];
    for (const [name, binding] of this.#bindings) {
      let id = ids.get(binding);
      if (id === undefined) {
        id = cells.length;
        ids.set(binding, id);
        cells.push(binding.value === uninitialized
          ? { kind: binding.kind, initialized: false }
          : { kind: binding.kind, initialized: true, value: binding.value,
              ...(binding.deletable ? {deletable: true} : {}),
              ...(binding.silentImmutable ? {silentImmutable: true} : {}) });
      }
      bindings.push([name, id]);
    }
    return {
      parent: this.parent,
      ...(this.options.simpleCatchParameter === undefined ? {} : {simpleCatchParameter: this.options.simpleCatchParameter}),
      ...(this.moduleEnvironment === undefined || this.moduleEnvironment.available.length === 0 ? {} : {moduleEnvironment: this.moduleEnvironment}),
      ...(this.objectEnvironment === undefined ? {} : this.withEnvironment
        ? {withObject: this.objectEnvironment} : {objectEnvironment: this.objectEnvironment}),
      importMeta: this.importMeta,
      functionBoundary: this.isFunctionBoundary(),
      ...(this.options.globalEnvironment === true ? {globalEnvironment: true} : {}),
      chargeData: this.options.chargeData !== false,
      bindings,
      cells,
      ...(this.resourceState === undefined ? {} : {resourceState: this.resourceState}),
      ...(this.privateNames === undefined ? {} : { privateNames: [...this.privateNames] }),
      ...(this.parent === undefined ? { restoredBindings: [...this.#restoredBindings] } : {})
    };
  }

  hydrateFrame(frame: ScopeFrame): void {
    if (this.#frameHydrated || this.#bindings.size !== 0 || this.importMeta !== undefined ||
        (this.parent === undefined && this.#restoredBindings.size !== 0))
      throw new TypeError("Frame hydration requires a fresh scope.");
    if (frame.parent !== this.parent || frame.functionBoundary !== this.isFunctionBoundary() ||
        frame.simpleCatchParameter !== this.options.simpleCatchParameter ||
        (frame.globalEnvironment === true) !== (this.options.globalEnvironment === true) ||
        frame.chargeData !== (this.options.chargeData !== false))
      throw new TypeError("Scope frame does not match its allocation.");
    if (this.parent !== undefined && frame.restoredBindings !== undefined)
      throw new TypeError("Only root scopes own restored bindings.");
    const cells: ScopeBinding[] = frame.cells.map(cell => ({
      kind: cell.kind,
      ...(cell.deletable ? {deletable: true as const} : {}),
      ...(cell.silentImmutable ? {silentImmutable: true as const} : {}),
      value: cell.initialized ? cell.value : uninitialized
    }));
    const bindings = new Map<string, ScopeBinding>();
    const referenced = new Set<number>();
    for (const [name, id] of frame.bindings) {
      if (typeof name !== "string" || bindings.has(name) || !Number.isSafeInteger(id) || id < 0 || id >= cells.length)
        throw new TypeError("Invalid scope binding cell.");
      bindings.set(name, cells[id]);
      referenced.add(id);
    }
    if (referenced.size !== cells.length) throw new TypeError("Unreferenced scope binding cell.");
    const restored = new Map(frame.restoredBindings ?? []);
    if (restored.size !== (frame.restoredBindings?.length ?? 0)) throw new TypeError("Duplicate restored binding.");
    this.importMeta = frame.importMeta;
    this.moduleEnvironment = frame.moduleEnvironment;
    if (frame.withObject !== undefined && (frame.objectEnvironment !== undefined ||
      frame.parent === undefined || frame.functionBoundary || frame.globalEnvironment === true))
      throw new TypeError("Invalid with scope frame.");
    this.objectEnvironment = frame.withObject ?? frame.objectEnvironment;
    this.withEnvironment = frame.withObject !== undefined;
    this.resourceState = frame.resourceState;
    if (frame.privateNames !== undefined) this.privateNames = new Map(frame.privateNames);
    for (const [name, binding] of bindings) {
      this.#bindings.set(name, binding);
      this.trackReplacement(name, binding);
    }
    if (this.parent === undefined)
      for (const [name, value] of restored) this.#restoredBindings.set(name, value);
    this.#frameHydrated = true;
    this.#bindingDataRoots = undefined;
  }

  copyInitializedBindingsFrom(source: Scope, names: readonly string[]): void {
    for (const name of names) {
      const sourceBinding = source.requireInitializedBinding(name);
      const targetScope = this.resolveScope(name);
      if (targetScope === undefined) {
        this.declare(name, sourceBinding.kind, sourceBinding.value);
        continue;
      }

      const targetBinding = targetScope.#bindings.get(name)!;
      targetBinding.kind = sourceBinding.kind;
      targetScope.writeBindingValue(targetBinding, sourceBinding.value);
    }
  }

  private writeBindingValue(binding: ScopeBinding, value: InterpreterValue): void {
    if (!Object.is(binding.value, value)) {
      if (binding.accounting !== undefined || isChargedBindingValue(value)) this.#bindingDataRoots = undefined;
      // Release obsolete snapshots even without another accounting pass.
      binding.accounting = undefined;
    }
    binding.value = value;
  }

  private resolveScope(name: string): Scope | undefined {
    if (this.#bindings.has(name) || (this.objectEnvironment !== undefined &&
        getSandboxPropertyDescriptor(this.objectEnvironment, name) !== undefined)) {
      return this;
    }

    return this.parent?.resolveScope(name);
  }

  private trackReplacement(name: string, binding: ScopeBinding): void {
    if (this.options.chargeData !== false || binding.kind === "const") return;
    const value = binding.value;
    if (typeof value === "object" && value !== null && getIntrinsicIdentity(value) === JSON.stringify([name])) {
      if (this.#replacedBindings.delete(binding)) this.#bindingDataRoots = undefined;
    } else if (!this.#replacedBindings.has(binding)) {
      this.#replacedBindings.add(binding);
      this.#bindingDataRoots = undefined;
    }
  }

  private requireInitializedBinding(name: string): {
    kind: VariableDeclarationKind;
    value: InterpreterValue;
  } {
    const scope = this.resolveScope(name);
    const binding = scope === undefined ? undefined : scope.#bindings.get(name);

    if (binding === undefined) {
      throw new ReferenceError(`Identifier '${name}' is not defined.`);
    }

    if (binding.value === uninitialized) {
      throw new ReferenceError(`Cannot access '${name}' before initialization.`);
    }

    return {
      kind: binding.kind,
      value: binding.value
    };
  }
}

function isChargedBindingValue(value: ScopeBinding["value"]): value is InterpreterValue {
  return value !== uninitialized && value != null && typeof value !== "number" && typeof value !== "boolean";
}

function defineSnapshotBinding(
  target: Record<string, InterpreterValue>,
  name: string,
  value: InterpreterValue
): void {
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}
