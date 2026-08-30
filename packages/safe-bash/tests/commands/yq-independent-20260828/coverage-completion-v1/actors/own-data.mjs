export function fields(value, names, label) {
  if (typeof value !== 'object' || value === null) throw new TypeError(`${label}: object required`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) throw new TypeError(`${label}: exact keys required`);
  const output = {};
  for (const name of names) {
    const descriptor = descriptors[name];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw new TypeError(`${label}: enumerable data required`);
    Object.defineProperty(output, name, { value: descriptor.value, enumerable: true });
  }
  return output;
}

export function denseStrings(value, maximum, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label}: array required`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) throw new TypeError(`${label}: finite length required`);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== length + 1) throw new TypeError(`${label}: holes or extras`);
  const output = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || typeof descriptor.value !== 'string' || descriptor.value.length > 512) throw new TypeError(`${label}: dense data strings required`);
    output.push(descriptor.value);
  }
  if (new Set(output).size !== output.length) throw new TypeError(`${label}: duplicates`);
  return output;
}

export function callable(namespace, name) {
  if ((typeof namespace !== 'object' || namespace === null) && typeof namespace !== 'function') throw new TypeError('admitted namespace required');
  const descriptor = Object.getOwnPropertyDescriptor(namespace, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError(`missing admitted export ${name}`);
  return descriptor.value;
}

export function describeReason(reason) {
  if (reason === null) return { kind: 'null' };
  if (reason === undefined) return { kind: 'undefined' };
  const kind = typeof reason;
  if (kind === 'boolean') return { kind, value: reason };
  if (kind === 'string') return { kind, value: reason.slice(0, 256), truncated: reason.length > 256 };
  if (kind === 'number') return Number.isFinite(reason) ? { kind, value: reason, negativeZero: Object.is(reason, -0) } : { kind, finite: false };
  return { kind };
}
