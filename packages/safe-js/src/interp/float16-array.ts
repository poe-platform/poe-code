import { Float16Array as PonyfillFloat16Array } from "@petamoriken/float16";

export const float16BackingViews = new WeakMap<object, Uint16Array<ArrayBufferLike>>();

const FallbackFloat16Array = class Float16Array extends PonyfillFloat16Array {
  constructor(input?: number | ArrayLike<number> | Iterable<number> | ArrayBufferLike, byteOffset?: number, length?: number) {
    // The ponyfill accepts the full native constructor input union; select one
    // overload for TypeScript without changing the runtime arguments.
    super(input as ArrayBuffer, byteOffset, length);
    if (Object.getPrototypeOf(this) !== Float16Array.prototype) return;
    const buffer = this.buffer;
    float16BackingViews.set(this, new Uint16Array(buffer, this.byteOffset,
      input === buffer && length === undefined ? undefined : this.length));
  }
};
Object.defineProperty(FallbackFloat16Array, "name", { value: "Float16Array", configurable: true });

export const Float16Array: Omit<typeof PonyfillFloat16Array, never> & {
  new(input?: number | ArrayLike<number> | Iterable<number> | ArrayBufferLike, byteOffset?: number, length?: number): PonyfillFloat16Array;
} =
  Object.getOwnPropertyDescriptor(globalThis, "Float16Array")?.value ?? FallbackFloat16Array;
