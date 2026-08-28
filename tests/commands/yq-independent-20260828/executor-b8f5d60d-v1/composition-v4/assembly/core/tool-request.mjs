import { isAbsolute, resolve } from 'node:path';

const MAXIMUM_STRING_LENGTH = 262144;

function requireData(condition, code) {
  if (!condition) throw Object.assign(new TypeError(code), { code, unsafe: true });
}

function ownData(call) {
  requireData(call !== null && typeof call === 'object' && !Array.isArray(call), 'TOOL_REQUEST_OWN_RECORD');
  const names = Reflect.ownKeys(call);
  requireData(names.length === 3 && names.every(name => typeof name === 'string'), 'TOOL_REQUEST_OWN_KEYS');
  const values = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(call, name);
    requireData(descriptor !== undefined && Object.hasOwn(descriptor, 'value') && !Object.hasOwn(descriptor, 'get') && !Object.hasOwn(descriptor, 'set'), 'TOOL_REQUEST_OWN_DATA');
    Object.defineProperty(values, name, { value: descriptor.value, enumerable: true });
  }
  return { names, values };
}

function boundedString(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAXIMUM_STRING_LENGTH && !value.includes('\0');
}

export function projectToolRequest(call, phase) {
  const { names, values } = ownData(call);
  requireData(Object.hasOwn(values, 'kind') && typeof values.kind === 'string', 'TOOL_REQUEST_KIND');
  let order;
  if (values.kind === 'compiler') {
    order = ['kind', 'configPath', 'timeoutMs'];
    requireData(names.every(name => order.includes(name)), 'TOOL_REQUEST_COMPILER_KEYS');
    requireData(phase === 'BUILD' || phase === 'TYPES', 'TOOL_REQUEST_COMPILER_ROLE');
    requireData(boundedString(values.configPath) && isAbsolute(values.configPath) && resolve(values.configPath) === values.configPath, 'TOOL_REQUEST_CONFIG_PATH');
    requireData(typeof values.timeoutMs === 'number' && values.timeoutMs === (phase === 'BUILD' ? 120000 : 60000), 'TOOL_REQUEST_TIMEOUT');
  } else {
    requireData(values.kind === 'git-show' || values.kind === 'git-tree', 'TOOL_REQUEST_KIND');
    order = ['kind', 'revision', 'path'];
    requireData(names.every(name => order.includes(name)), 'TOOL_REQUEST_GIT_KEYS');
    requireData(phase === 'AUTHENTICATION', 'TOOL_REQUEST_GIT_ROLE');
    requireData(typeof values.revision === 'string' && /^[0-9a-f]{40}$/u.test(values.revision), 'TOOL_REQUEST_REVISION');
    requireData(boundedString(values.path), 'TOOL_REQUEST_GIT_PATH');
  }
  const projected = Object.create(null);
  for (const name of order) Object.defineProperty(projected, name, { value: values[name], enumerable: true });
  return Object.freeze(projected);
}
