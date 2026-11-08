import { types } from 'node:util';

function scalar(value) {
  if (value === null) return { type: 'null' };
  const type = typeof value;
  if (type === 'undefined') return { type };
  if (type === 'boolean') return { type, value };
  if (type === 'number') return { type, value: Number.isFinite(value) ? value : String(value), negativeZero: Object.is(value, -0) };
  if (type === 'string') return { type, value: value.slice(0, 256), truncated: value.length > 256 };
  if (type !== 'object') return { type };
  if (types.isProxy(value)) return { type, opaqueProxy: true };
  const result = { type };
  for (const key of ['name', 'message', 'code']) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') result[key] = descriptor.value.slice(0, 256);
  }
  return result;
}

export function captureFailure(reason, phase) {
  const result = { primaryPresent: true, reason: scalar(reason), phase: typeof phase === 'string' ? phase.slice(0, 80) : 'UNOBSERVED', causePresent: false };
  if (reason !== null && typeof reason === 'object' && !types.isProxy(reason)) {
    const descriptor = Object.getOwnPropertyDescriptor(reason, 'cause');
    result.causePresent = descriptor !== undefined;
    if (descriptor) result.cause = Object.hasOwn(descriptor, 'value') ? scalar(descriptor.value) : { type: 'ACCESSOR_UNREAD' };
  }
  return result;
}
