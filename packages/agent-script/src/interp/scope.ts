import type { VariableDeclarationKind } from "../parse.js";
import type { InterpreterSnapshot, InterpreterValue } from "./interpreter.js";

type ScopeBinding = {
  kind: VariableDeclarationKind;
  value: InterpreterValue;
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

export class Scope {
  readonly #bindings = new Map<string, ScopeBinding>();

  constructor(bindings: Record<string, InterpreterValue> = {}, private readonly parent?: Scope) {
    for (const [name, value] of Object.entries(bindings)) {
      this.#bindings.set(name, {
        kind: "const",
        value
      });
    }
  }

  child(bindings: Record<string, InterpreterValue> = {}): Scope {
    return new Scope(bindings, this);
  }

  declare(name: string, kind: VariableDeclarationKind, value: InterpreterValue): void {
    if (this.#bindings.has(name)) {
      throw new Error(`Cannot redeclare binding '${name}' in the same scope.`);
    }

    this.#bindings.set(name, {
      kind,
      value
    });
  }

  assign(name: string, value: InterpreterValue): void {
    const scope = this.resolveScope(name);
    if (scope === undefined) {
      throw new Error(`Cannot assign to undeclared binding '${name}'.`);
    }

    const binding = scope.#bindings.get(name);
    if (binding?.kind === "const") {
      throw new Error(`Cannot assign to const binding '${name}'.`);
    }

    if (binding === undefined) {
      throw new Error(`Cannot assign to undeclared binding '${name}'.`);
    }

    scope.#bindings.set(name, {
      kind: binding.kind,
      value
    });
  }

  lookup(name: string): ScopeLookupResult {
    const binding = this.#bindings.get(name);
    if (binding !== undefined) {
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
    const inheritedBindings = this.parent?.snapshot().bindings ?? {};

    return {
      bindings: {
        ...inheritedBindings,
        ...Object.fromEntries([...this.#bindings.entries()].map(([name, binding]) => [name, binding.value]))
      }
    };
  }

  private resolveScope(name: string): Scope | undefined {
    if (this.#bindings.has(name)) {
      return this;
    }

    return this.parent?.resolveScope(name);
  }
}
