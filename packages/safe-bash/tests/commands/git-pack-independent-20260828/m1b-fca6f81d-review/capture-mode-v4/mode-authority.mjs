function demand(condition, label) { if (!condition) throw new Error(label); }
function fields(value, expected) {
  demand(value !== null && typeof value === 'object' && !Array.isArray(value), 'MODE_RECORD');
  const keys = Reflect.ownKeys(value);
  demand(keys.length === expected.length && keys.every((key, index) => key === expected[index]), 'MODE_FIELDS');
  for (const key of keys) demand(Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'), 'MODE_OWN_DATA');
}
export function captureIdentity(declared, observed, authority) {
  fields(authority, ['role', 'creationMode', 'creationFlags', 'creationSourceSha256', 'archiveSha256']);
  demand(authority.role === 'CAPTURE_POSIX_MODE' && authority.creationMode === 0o600 && authority.creationFlags === 'wx', 'CAPTURE_CREATION_ROLE');
  demand(/^[a-f0-9]{64}$/.test(authority.creationSourceSha256) && /^[a-f0-9]{64}$/.test(authority.archiveSha256), 'CAPTURE_BOUND_AUTHORITY');
  fields(declared, ['path', 'mode', 'bytes', 'sha256']);
  fields(observed, ['path', 'mode', 'bytes', 'sha256']);
  demand(typeof declared.path === 'string' && /^DATA-01\/[0-9]{3}\.json$/.test(declared.path), 'CAPTURE_PATH_ROLE');
  demand(declared.mode === authority.creationMode && observed.mode === declared.mode, 'CAPTURE_POSIX_MODE');
  demand(Number.isSafeInteger(declared.bytes) && declared.bytes >= 0 && declared.bytes <= 1048576 && /^[a-f0-9]{64}$/.test(declared.sha256), 'CAPTURE_DECLARED_IDENTITY');
  demand(observed.path === declared.path && observed.bytes === declared.bytes && observed.sha256 === declared.sha256, 'CAPTURE_BYTE_IDENTITY');
  return { ...declared };
}
