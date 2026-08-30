export function jsonSize(value, maximum, depth = 0) {
  if (depth > 8) throw new Error('JSON depth');
  let count = 0;
  const add = bytes => { count += bytes; if (count > maximum) throw new Error('JSON byte admission'); };
  if (typeof value === 'string') {
    add(2);
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code === 34 || code === 92) add(2);
      else if (code < 32) add([8,9,10,12,13].includes(code) ? 2 : 6);
      else if (code < 128) add(1);
      else if (code < 2048) add(2);
      else if (code >= 55296 && code <= 56319 && index + 1 < value.length && value.charCodeAt(index + 1) >= 56320 && value.charCodeAt(index + 1) <= 57343) { add(4); index += 1; }
      else if (code >= 55296 && code <= 57343) add(6);
      else add(3);
    }
  } else if (value === null) add(4);
  else if (typeof value === 'boolean') add(value ? 4 : 5);
  else if (typeof value === 'number' && Number.isSafeInteger(value)) add(String(value).length);
  else {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('finite JSON record');
    const names = Reflect.ownKeys(value);
    if (names.length > 16) throw new Error('JSON keys');
    add(2);
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (typeof name !== 'string' || !descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('JSON own data');
      add((index ? 1 : 0) + jsonSize(name, maximum - count, depth + 1) + 1);
      add(jsonSize(descriptor.value, maximum - count, depth + 1));
    }
  }
  return count;
}
