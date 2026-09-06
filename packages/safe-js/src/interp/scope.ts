import type { VariableDeclarationKind } from "../parse.js";
import type { InterpreterSnapshot, InterpreterValue } from "./interpreter.js";

type ScopeBinding = {
  kind: VariableDeclarationKind;
  value: InterpreterValue | typeof uninitialized;
};

type ScopeLookupResult =
  | {
      found: true;
      kind: VariableDeclarationKind;
      value: InterpreterValue;
    }
  | {
      found: false;
    };

const uninitialized = Symbol("uninitialized");

type ScopeOptions = {
  functionBoundary?: boolean;
  chargeData?: boolean;
};

export class Scope {
  readonly #bindings = new Map<string, ScopeBinding>();
  readonly #restoredBindings: Map<string, InterpreterValue>;

  constructor(
    bindings: Record<string, InterpreterValue> = {},
    private readonly parent?: Scope,
    private readonly importMeta?: InterpreterValue,
    private readonly options: ScopeOptions = {
      functionBoundary: parent === undefined
    },
    restoredBindings?: Record<string, InterpreterValue>
  ) {
    this.#restoredBindings =
      parent === undefined
        ? new Map(Object.entries(restoredBindings ?? {}))
        : parent.#restoredBindings;
    for (const [name, value] of Object.entries(bindings)) {
      this.#bindings.set(name, {
        kind: "const",
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

  retainedValues(): InterpreterValue[] {
    const values = this.parent?.retainedValues() ?? [];
    if (this.options.chargeData !== false) {
      if (this.importMeta !== undefined) values.push(this.importMeta);
      for (const binding of this.#bindings.values()) {
        if (binding.value !== uninitialized) values.push(binding.value);
      }
    }
    return values;
  }

  declare(name: string, kind: VariableDeclarationKind, value: InterpreterValue): void {
    const existing = this.#bindings.get(name);
    if (existing !== undefined && existing.value !== uninitialized) {
      throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
    }
    if (existing !== undefined && existing.kind !== kind) {
      throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
    }

    if (existing !== undefined) existing.value = value;
    else this.#bindings.set(name, { kind, value });
  }

  declareAlias(name: string, target: string): void {
    if (this.#bindings.has(name)) throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
    const binding = this.#bindings.get(target);
    if (binding === undefined) throw new ReferenceError(`Identifier '${target}' is not defined.`);
    this.#bindings.set(name, binding);
  }

  declareVar(name: string): void {
    const boundary = this.options.functionBoundary === true ? this : this.parent;
    if (boundary === undefined) {
      throw new Error("Cannot declare var without a function boundary.");
    }
    if (boundary !== this) {
      boundary.declareVar(name);
      return;
    }

    const existing = this.#bindings.get(name);
    if (existing?.kind === "var") {
      return;
    }
    if (existing !== undefined) {
      throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
    }

    this.#bindings.set(name, {
      kind: "var",
      value: undefined
    });
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

  assign(name: string, value: InterpreterValue): void {
    const scope = this.resolveScope(name);
    if (scope === undefined) {
      throw new ReferenceError(`Cannot assign to undeclared binding '${name}'.`);
    }

    const binding = scope.#bindings.get(name);
    if (binding === undefined) {
      throw new ReferenceError(`Cannot assign to undeclared binding '${name}'.`);
    }

    if (binding.value === uninitialized) {
      throw new ReferenceError(`Cannot access '${name}' before initialization.`);
    }

    if (binding.kind === "const") {
      throw new TypeError(`Cannot assign to const binding '${name}'.`);
    }

    binding.value = value;
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
        value: binding.value
      };
    }

    if (this.parent !== undefined) {
      return this.parent.lookup(name);
    }

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
      targetBinding.value = sourceBinding.value;
    }
  }

  private resolveScope(name: string): Scope | undefined {
    if (this.#bindings.has(name)) {
      return this;
    }

    return this.parent?.resolveScope(name);
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
