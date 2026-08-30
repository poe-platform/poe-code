export function exactOwnData(actual, expected, label = 'value') {
  if (expected === null || typeof expected !== 'object') {
    if (typeof actual !== typeof expected || !Object.is(actual, expected)) throw new TypeError(label + ': primitive mismatch');
    return;
  }
  if (actual === null || typeof actual !== 'object') throw new TypeError(label + ': own-data object required');
  const array = Array.isArray(expected);
  if (Array.isArray(actual) !== array) throw new TypeError(label + ': array shape mismatch');
  const actualKeys = Reflect.ownKeys(actual);
  const expectedKeys = Reflect.ownKeys(expected);
  if (actualKeys.length !== expectedKeys.length || actualKeys.some(key => !expectedKeys.includes(key))) throw new TypeError(label + ': exact own keys required');
  const descriptors = Object.getOwnPropertyDescriptors(actual);
  const expectedDescriptors = Object.getOwnPropertyDescriptors(expected);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(label + ': accessor rejected');
    exactOwnData(descriptor.value, expectedDescriptors[key].value, label + '.' + String(key));
  }
}

export function ownValue(actual, key, label) {
  if (actual === null || typeof actual !== 'object') throw new TypeError(label + ': object required');
  const descriptor = Object.getOwnPropertyDescriptor(actual, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(label + ': own data required');
  return descriptor.value;
}

export function validateRole(role, executable, args, options, policy) {
  if (role === 'spawn') {
    exactOwnData(executable, policy.node, 'spawn.path');
    exactOwnData(args, policy.childArgs, 'spawn.argv');
    exactOwnData(options, {cwd:policy.cwd, env:policy.env, detached:true, stdio:['ignore','pipe','pipe']}, 'spawn.options');
    return;
  }
  if (role === 'observer') {
    exactOwnData(executable, '/bin/ps', 'observer.path');
    exactOwnData(args, policy.observerArgs, 'observer.argv');
    const timeout = ownValue(options, 'timeout', 'observer.timeout');
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2000) throw new TypeError('observer.timeout: finite admitted range required');
    exactOwnData(options, {encoding:'utf8', timeout, maxBuffer:8*1024*1024}, 'observer.options');
    return timeout;
  }
  throw new TypeError('role: unknown role');
}

export function collectorAccepted(receipt) {
  return receipt.exit === 0 && receipt.signal === null && receipt.closed === true && receipt.streamsClosed === true && receipt.timedOut === false && receipt.overflow === false;
}
