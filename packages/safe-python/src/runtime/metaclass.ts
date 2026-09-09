import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Select among type-valued metaclasses using concrete MRO identity membership.
 * Explicit non-type metaclass callables bypass this rule in class construction.
 * The caller supplies the initial candidate and already-resolved base metaclasses.
 */
export function selectTypeMetaclass<Type extends object>(
  candidate: Type,
  baseMetaclasses: readonly Type[],
  getMro: (type: Type) => readonly Type[],
  meter?: ExecutionMeter
): Type {
  meter?.checkpoint();
  function isSubtype(derived: Type, base: Type): boolean {
    if (derived === base) return true;
    for (const ancestor of getMro(derived)) {
      meter?.checkpoint();
      if (ancestor === base) return true;
    }
    return false;
  }
  let winner = candidate;
  for (const base of baseMetaclasses) {
    meter?.checkpoint();
    if (isSubtype(winner, base)) continue;
    if (isSubtype(base, winner)) winner = base;
    else throw new PythonRuntimeError("TypeError", "metaclass conflict: the metaclass of a derived class must be a (non-strict) subclass of the metaclasses of all its bases");
  }
  return winner;
}
