/** Builtin scalar constant allocation, without guest conversion hooks.
 * Implementations own allocation metering and immutable guest value storage.
 */
export interface CodeConstants<Value> {
  string(value: string): Value;
  integer(value: number): Value;
}
