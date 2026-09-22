// Only internal collectors which always return fresh, dense arrays qualify.
// Caller-provided retainedValues callbacks keep their iterable semantics.
const closures = new WeakSet<object>();
const has = WeakSet.prototype.has.bind(closures);
const add = WeakSet.prototype.add.bind(closures);

export const hasIndexedClosureCaptures = has;

export function registerIndexedClosureCaptures(closure: object): void {
  // Never return the native add result: the private registry must not escape.
  add(closure);
}
