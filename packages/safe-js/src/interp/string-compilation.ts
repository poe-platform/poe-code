import type { Scope } from "./scope.js";

const deniedScopes = new WeakSet<Scope>();

export function denyGuestStringCompilation(scope: Scope): void {
  deniedScopes.add(scope.globalScope());
}

export function assertGuestStringCompilation(scope: Scope): void {
  if (deniedScopes.has(scope.globalScope()))
    throw new EvalError("Guest string compilation is disabled.");
}
