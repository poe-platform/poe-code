const uninitialized = Symbol("uninitialized");
export class Scope {
    parent;
    importMeta;
    options;
    #bindings = new Map();
    #restoredBindings;
    constructor(bindings = {}, parent, importMeta, options = {
        functionBoundary: parent === undefined
    }, restoredBindings) {
        this.parent = parent;
        this.importMeta = importMeta;
        this.options = options;
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
    child(bindings = {}, options = {}) {
        return new Scope(bindings, this, undefined, {
            chargeData: true,
            ...options
        });
    }
    consumeRestoredBinding(name) {
        if (!this.#restoredBindings.has(name)) {
            return { found: false };
        }
        const value = this.#restoredBindings.get(name);
        this.#restoredBindings.delete(name);
        return { found: true, value };
    }
    hasOwnBinding(name) {
        return this.#bindings.has(name);
    }
    getOwnBindingKind(name) {
        return this.#bindings.get(name)?.kind;
    }
    isFunctionBoundary() {
        return this.options.functionBoundary === true;
    }
    iterationChild(names) {
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
    lookupImportMeta() {
        if (this.importMeta !== undefined) {
            return this.importMeta;
        }
        if (this.parent !== undefined) {
            return this.parent.lookupImportMeta();
        }
        return {};
    }
    retainedValues() {
        const values = this.parent?.retainedValues() ?? [];
        if (this.options.chargeData !== false) {
            if (this.importMeta !== undefined)
                values.push(this.importMeta);
            for (const binding of this.#bindings.values()) {
                if (binding.value !== uninitialized)
                    values.push(binding.value);
            }
        }
        return values;
    }
    declare(name, kind, value) {
        const existing = this.#bindings.get(name);
        if (existing !== undefined && existing.value !== uninitialized) {
            throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
        }
        if (existing !== undefined && existing.kind !== kind) {
            throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
        }
        this.#bindings.set(name, {
            kind,
            value
        });
    }
    declareVar(name) {
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
    predeclare(name, kind) {
        if (this.#bindings.has(name)) {
            throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
        }
        this.#bindings.set(name, {
            kind,
            value: uninitialized
        });
    }
    assign(name, value) {
        const scope = this.resolveScope(name);
        if (scope === undefined) {
            throw new ReferenceError(`Cannot assign to undeclared binding '${name}'.`);
        }
        const binding = scope.#bindings.get(name);
        if (binding?.kind === "const") {
            throw new TypeError(`Cannot assign to const binding '${name}'.`);
        }
        if (binding === undefined) {
            throw new ReferenceError(`Cannot assign to undeclared binding '${name}'.`);
        }
        if (binding.value === uninitialized) {
            throw new ReferenceError(`Cannot access '${name}' before initialization.`);
        }
        scope.#bindings.set(name, {
            kind: binding.kind,
            value
        });
    }
    lookup(name) {
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
    snapshot() {
        const scopes = [this];
        let parent = this.parent;
        while (parent !== undefined) {
            scopes.push(parent);
            parent = parent.parent;
        }
        const bindings = {};
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
    copyInitializedBindingsFrom(source, names) {
        for (const name of names) {
            const sourceBinding = source.requireInitializedBinding(name);
            const targetScope = this.resolveScope(name);
            if (targetScope === undefined) {
                this.declare(name, sourceBinding.kind, sourceBinding.value);
                continue;
            }
            targetScope.#bindings.set(name, {
                kind: sourceBinding.kind,
                value: sourceBinding.value
            });
        }
    }
    resolveScope(name) {
        if (this.#bindings.has(name)) {
            return this;
        }
        return this.parent?.resolveScope(name);
    }
    requireInitializedBinding(name) {
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
function defineSnapshotBinding(target, name, value) {
    Object.defineProperty(target, name, {
        configurable: true,
        enumerable: true,
        value,
        writable: true
    });
}
