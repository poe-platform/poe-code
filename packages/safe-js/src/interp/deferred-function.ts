import { scopeDataRoots } from "./scope-data-roots.js";
import {
  registerDeferredClosureChargeIdentity,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

const freeze = Object.freeze;

// A pending binding retains its initializer and lexical roots, without creating
// a guest function carrier. Its accounting identity survives materialization so
// an older captured scope group can still retain the same function.
export class DeferredFunction {
  readonly root: SandboxObject = freeze({ __proto__: null });
  readonly #chargeIdentity: object = freeze({ __proto__: null });
  #value?: SandboxClosure;
  #initialization?: {
    create: () => SandboxClosure;
    collect: (append: (value: SandboxValue) => void) => void;
  };
  #resolving = false;

  constructor(
    create: () => SandboxClosure,
    collect: (append: (value: SandboxValue) => void) => void
  ) {
    this.#initialization = { create, collect };
    scopeDataRoots.set(this.root, {
      deferred: {
        chargeIdentity: this.#chargeIdentity,
        read: () => this.#value,
        collect: (append) => this.#initialization?.collect(append)
      }
    });
  }

  resolve(): SandboxClosure {
    if (this.#value !== undefined) return this.#value;
    if (this.#resolving) throw new TypeError("Cannot reenter deferred function initialization.");
    this.#resolving = true;
    try {
      const value = this.#initialization!.create();
      registerDeferredClosureChargeIdentity(value, this.#chargeIdentity);
      this.#value = value;
      this.#initialization = undefined;
      return this.#value;
    } finally {
      this.#resolving = false;
    }
  }
}
