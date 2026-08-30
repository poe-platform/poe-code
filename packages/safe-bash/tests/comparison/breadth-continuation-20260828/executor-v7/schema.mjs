export function dataObject(value, required, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) return null;
  if (required.some(key => !Object.hasOwn(descriptors, key))) return null;
  if (keys.some(key => !Object.hasOwn(descriptors[key], 'value') || descriptors[key].enumerable !== true)) return null;
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
export function denseArray(value, maximum) {
  if (!Array.isArray(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
  if (Reflect.ownKeys(descriptors).length !== length + 1) return null;
  const result = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[index];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
    result.push(descriptor.value);
  }
  return result;
}
export const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
export const hashString = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
