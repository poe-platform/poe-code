// Slot probes do not read user properties or Symbol.toStringTag.
function slot(method: () => unknown, value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  try { Reflect.apply(method, value, []); return true; }
  catch { return false; }
}
const getter = (prototype: object, key: string) => Object.getOwnPropertyDescriptor(prototype, key)!.get!;
const regexpPrototype = RegExp.prototype;
const regexpSource = getter(regexpPrototype, "source");
const booleanValue = Boolean.prototype.valueOf;
const numberValue = Number.prototype.valueOf;
const stringValue = String.prototype.valueOf;
const bigintValue = BigInt.prototype.valueOf;
const symbolValue = Symbol.prototype.valueOf;
const dateValue = Date.prototype.getTime;
const asyncFunctionPrototype = Object.getPrototypeOf(async function () {});
const generatorFunctionPrototype = Object.getPrototypeOf(function* () {});
const arrayBufferLength = getter(ArrayBuffer.prototype, "byteLength");
const dataViewBuffer = getter(DataView.prototype, "buffer");
const mapSize = getter(Map.prototype, "size");
const promiseThen = Promise.prototype.then;
const NativeError = Error;
const nativeIsError = Reflect.get(NativeError, "isError");
const proxies = new WeakSet<object>();
export function createTrackedProxy<T extends object>(target: T, handler: ProxyHandler<T>): T {
  const proxy = new Proxy(target, handler);
  proxies.add(proxy);
  return proxy;
}
export const types = {
  isProxy: (value: unknown) => (typeof value === "object" && value !== null || typeof value === "function") && proxies.has(value as object),
  isBooleanObject: (value: unknown) => typeof value === "object" && value !== null && slot(booleanValue, value),
  isNumberObject: (value: unknown) => typeof value === "object" && value !== null && slot(numberValue, value),
  isStringObject: (value: unknown) => typeof value === "object" && slot(stringValue, value),
  isBigIntObject: (value: unknown) => typeof value === "object" && value !== null && slot(bigintValue, value),
  isSymbolObject: (value: unknown) => typeof value === "object" && value !== null && slot(symbolValue, value),
  isDate: (value: unknown) => slot(dateValue, value),
  isRegExp: (value: unknown) => value !== regexpPrototype && slot(regexpSource, value),
  isArrayBuffer: (value: unknown) => slot(arrayBufferLength, value),
  isDataView: (value: unknown) => slot(dataViewBuffer, value),
  isMap: (value: unknown) => slot(mapSize, value),
  isPromise(value: unknown): value is Promise<unknown> {
    // Promise has no exposed slot getter. Handle both branches so the probe
    // cannot introduce an unhandled rejection.
    try { Reflect.apply(promiseThen, value, [() => undefined, () => undefined]); return true; }
    catch { return false; }
  },
  isAsyncFunction: (value: unknown) => typeof value === "function" && Object.getPrototypeOf(value) === asyncFunctionPrototype,
  isGeneratorFunction: (value: unknown) => typeof value === "function" && Object.getPrototypeOf(value) === generatorFunctionPrototype,
  isNativeError: (value: unknown): value is Error => typeof value === "object" && value !== null &&
    (typeof nativeIsError === "function" ? Reflect.apply(nativeIsError, NativeError, [value]) === true : value instanceof NativeError)
};
