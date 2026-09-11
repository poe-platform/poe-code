import { Float16Array } from "./float16-array.js";

export const numericTypedArrayConstructors = {
  Float32Array, Uint8Array, Int8Array, Uint8ClampedArray,
  Int16Array, Uint16Array, Int32Array, Uint32Array, Float64Array,
  BigInt64Array, BigUint64Array, Float16Array
};
export type NumericTypedArrayConstructor = typeof numericTypedArrayConstructors[keyof typeof numericTypedArrayConstructors];
export type NumericTypedArray = InstanceType<NumericTypedArrayConstructor>;
