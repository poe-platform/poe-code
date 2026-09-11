export function nativePromiseDataProperties(value: Promise<unknown>): Array<readonly [string, PropertyDescriptor]> {
  return Object.getOwnPropertyNames(value).flatMap(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return "value" in descriptor ? [[key, descriptor] as const] : [];
  });
}
