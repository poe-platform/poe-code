// Accounting-only projections for owners whose mutable fields are fully
// traversed by measurement. Never guest-visible objects.
export const intrinsicDataRoots = new WeakMap<object, {
  readonly target: object;
  readonly values: readonly unknown[];
}>();
