import { createSandboxArguments, type SandboxArguments } from "./arguments.js";
import { scopeDataRoots } from "./scope-data-roots.js";
import type { SandboxObject, SandboxValue } from "./values.js";

const freeze = Object.freeze;
const setPrototypeOf = Object.setPrototypeOf;
const indexString = String;
const iterator = Symbol.iterator;

// Only an unread, unmapped arguments binding has this immutable initial layout.
// Once materialized it becomes an ordinary arguments object with fresh native
// descriptor observations. Snapshots and binding reads force that transition.
export class DeferredArguments {
  readonly root: SandboxObject = freeze({ __proto__: null });
  readonly eligible: boolean;
  #value?: SandboxArguments;
  #resolving = false;
  #snapshot?: {
    values: readonly SandboxValue[];
    references: readonly SandboxValue[];
    length: number;
    units: number;
    iterator: symbol;
  };

  constructor(values: readonly SandboxValue[]) {
    const captured: SandboxValue[] = setPrototypeOf([], null);
    const references: SandboxValue[] = setPrototypeOf([], null);
    // Object unit and length property. Symbol properties use the fresh internal
    // symbol registry during measurement. The restricted native callee accessor
    // retains no guest closure and has no data charge.
    let units = 8;
    let eligible = true;
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      captured[index] = value;
      units += 1 + indexString(index).length;
      if (typeof value === "string") units += value.length;
      else if (typeof value === "bigint") eligible = false;
      else if (typeof value === "symbol" || (typeof value === "object" && value !== null))
        references[references.length] = value;
    }
    this.eligible = eligible;
    this.#snapshot = freeze({
      values: freeze(captured),
      references: freeze(references),
      length: values.length,
      units,
      iterator
    });
    scopeDataRoots.set(this.root, {
      arguments: {
        read: () => this.#value,
        capture: () => this.#snapshot
      }
    });
  }

  resolve(): SandboxArguments {
    if (this.#value !== undefined) return this.#value;
    if (this.#resolving) throw new TypeError("Cannot reenter deferred arguments initialization.");
    this.#resolving = true;
    try {
      const snapshot = this.#snapshot!;
      const value = createSandboxArguments(snapshot.values);
      if (value.length !== snapshot.length) value.length = snapshot.length;
      this.#value = value;
      this.#snapshot = undefined;
      return value;
    } finally {
      this.#resolving = false;
    }
  }
}
