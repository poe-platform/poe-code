function ownField(reason, name) {
  if ((typeof reason !== 'object' || reason === null) && typeof reason !== 'function') {
    return { inspectionSucceeded: true, present: false };
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(reason, name);
    if (!descriptor) return { inspectionSucceeded: true, present: false };
    if (!Object.hasOwn(descriptor, 'value')) return { inspectionSucceeded: true, present: true, kind: 'accessor', read: false };
    return { inspectionSucceeded: true, present: true, kind: 'data', value: descriptor.value };
  } catch (inspectionError) {
    return { inspectionSucceeded: false, inspectionErrorPresent: true, inspectionError };
  }
}

export function observeOptionalGroup(kill, pid) {
  if (typeof kill !== 'function' || !Number.isSafeInteger(pid) || pid <= 0) {
    throw new TypeError('Explicit trusted kill dependency and positive safe PID required');
  }
  try {
    const result = kill(-pid, 0);
    return { attempted: true, group: result === true ? 'PRESENT' : 'UNKNOWN', returned: result, errorPresent: false };
  } catch (reason) {
    const fields = Object.fromEntries(['code', 'errno', 'syscall'].map(name => [name, ownField(reason, name)]));
    const code = fields.code;
    const absent = code.inspectionSucceeded && code.present && code.kind === 'data' && code.value === 'ESRCH';
    return { attempted: true, group: absent ? 'ABSENT' : 'UNKNOWN', errorPresent: true, reason, fields };
  }
}

export function knownRoleRetirement({ role, pid, exited, closed, status, signal, violation }) {
  if (typeof role !== 'string' || !role || !Number.isSafeInteger(pid) || pid <= 0) {
    throw new TypeError('Invalid known role identity');
  }
  return {
    role, pid, exited, closed, status, signal, violation,
    knownDirectRetirement: exited === true && closed === true,
    successfulExit: exited === true && closed === true && status === 0 && signal === null && violation === null,
    group: { attempted: false, result: 'NOT_REQUESTED' },
  };
}
