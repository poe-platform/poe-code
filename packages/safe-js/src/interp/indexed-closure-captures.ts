import type { SandboxValue } from "./values.js";

// These native collectors do not expose the supplied append callback. Foreign
// retainedValues providers keep their iterable observations and snapshot behavior.
type Collector = (append: (value: SandboxValue) => void) => void;
const closures = new WeakMap<object, Collector>();
const get = WeakMap.prototype.get.bind(closures);
const set = WeakMap.prototype.set.bind(closures);

export const readIndexedClosureCaptures = get;

export function registerIndexedClosureCaptures(closure: object, collect: Collector): void {
  // Never return the native set result: the private registry must not escape.
  set(closure, collect);
}
