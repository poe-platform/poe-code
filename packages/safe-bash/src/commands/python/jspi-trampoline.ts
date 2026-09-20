export const pythonJspiSignatures: Readonly<Record<string, string>> = Object.freeze({
  __syscall_chdir: 'ip', __syscall_chmod: 'ipi', __syscall_dup: 'ii',
  __syscall_faccessat: 'iipii', __syscall_fcntl64: 'iiip', __syscall_fdatasync: 'ii',
  __syscall_fstat64: 'iip', __syscall_ftruncate64: 'iij', __syscall_getcwd: 'ipp',
  __syscall_getdents64: 'iipp', __syscall_ioctl: 'iiip', __syscall_lstat64: 'ipp',
  __syscall_mkdirat: 'iipi', __syscall_newfstatat: 'iippi', __syscall_openat: 'iipip',
  __syscall_readlinkat: 'iippp', __syscall_renameat: 'iipip', __syscall_rmdir: 'ip',
  __syscall_stat64: 'ipp', __syscall_symlinkat: 'ipip', __syscall_truncate64: 'ipj',
  __syscall_unlinkat: 'iipi', __syscall_utimensat: 'iippi',
  fd_close: 'ii', fd_fdstat_get: 'iip', fd_pread: 'iippjp', fd_pwrite: 'iippjp',
  fd_read: 'iippp', fd_seek: 'iijip', fd_sync: 'ii', fd_write: 'iippp',
});

const unsigned = (value: number): number[] => {
  const bytes: number[] = [];
  do { bytes.push((value & 127) | (value > 127 ? 128 : 0)); value >>>= 7; } while (value);
  return bytes;
};
const vector = (entries: number[][]): number[] => [...unsigned(entries.length), ...entries.flat()];
const text = (value: string): number[] => { const bytes = new TextEncoder().encode(value); return [...unsigned(bytes.length), ...bytes]; };
const section = (type: number, bytes: number[]): number[] => [type, ...unsigned(bytes.length), ...bytes];
const signature = (parameters: number[], result?: number): number[] => [0x60, ...vector(parameters.map(type => [type])), ...(result === undefined ? [0] : [1, result])];

export function createPythonJspiTrampoline(): Uint8Array<ArrayBuffer> {
  const entries = Object.entries(pythonJspiSignatures);
  const types = entries.flatMap(([, value]) => {
    const parameters = [...value.slice(1)].map(type => type === 'j' ? 0x7e : 0x7f);
    return [signature(parameters, 0x7f), signature(parameters, 0x6f)];
  });
  types.push(signature([0x6f], 0x7f));
  const imports = entries.flatMap(([name], index) => [
    [...text('original'), ...text(name), 0, ...unsigned(index * 2)],
    [...text('request'), ...text(name), 0, ...unsigned(index * 2 + 1)],
    [...text('shutdown'), ...text(name), 0, ...unsigned(index * 2)],
  ]);
  imports.push([...text('control'), ...text('syncify'), 1, 0x70, 0, 1]);
  imports.push([...text('control'), ...text('active'), 3, 0x7f, 1]);
  const functions = entries.map(([, value], index) => {
    const argumentsBytes = [...value.slice(1)].flatMap((_type, parameter) => [0x20, ...unsigned(parameter)]);
    const code = [0, 0x23, 0, 0x04, 0x7f, 0x23, 0, 0x41, 2, 0x46, 0x04, 0x7f,
      ...argumentsBytes, 0x10, ...unsigned(index * 3 + 2), 0x05,
      ...argumentsBytes, 0x10, ...unsigned(index * 3 + 1),
      0x41, 0, 0x11, ...unsigned(entries.length * 2), 0, 0x0b, 0x05,
      ...argumentsBytes, 0x10, ...unsigned(index * 3), 0x0b, 0x0b];
    return [...unsigned(code.length), ...code];
  });
  return new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, vector(types)), ...section(2, vector(imports)),
    ...section(3, vector(entries.map((_entry, index) => unsigned(index * 2)))),
    ...section(7, vector(entries.map(([name], index) => [...text(name), 0, ...unsigned(entries.length * 3 + index)]))),
    ...section(10, vector(functions)),
  ]);
}

export function createPythonJspiNativeCall(): Uint8Array<ArrayBuffer> {
  const types = [signature([0x7f], 0x7f), signature([0x7f]), signature([0x7f], 0x6f),
    signature([0x6f], 0x7f), signature([0x7f, 0x7f], 0x7f), signature([], 0x7f)];
  const imports = [['python', 'utf8', 0], ['python', 'unicode', 0], ['python', 'free', 1],
    ['python', 'noMemory', 5], ['request', 'send', 2], ['shutdown', 'send', 0]] as const;
  const code = [1, 2, 0x7f, 0x20, 1, 0x10, 0, 0x22, 2, 0x45, 0x04, 0x7f, 0x41, 0, 0x05,
    0x23, 0, 0x41, 2, 0x46, 0x04, 0x7f, 0x20, 2, 0x10, 5, 0x05,
    0x20, 2, 0x10, 4, 0x41, 0, 0x11, 3, 0, 0x0b, 0x22, 2, 0x45, 0x04, 0x7f,
    0x10, 3, 0x05, 0x20, 2, 0x10, 1, 0x21, 3, 0x20, 2, 0x10, 2, 0x20, 3, 0x0b, 0x0b, 0x0b];
  return new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, vector(types)), ...section(2, vector([
      ...imports.map(([namespace, name, type]) => [...text(namespace), ...text(name), 0, type]),
      [...text('control'), ...text('syncify'), 1, 0x70, 0, 1],
      [...text('control'), ...text('active'), 3, 0x7f, 1],
    ])), ...section(3, vector([[4]])), ...section(7, vector([[...text('call'), 0, 6]])),
    ...section(10, vector([[...unsigned(code.length), ...code]])),
  ]);
}

export function createPythonJspiStatResult(): Uint8Array<ArrayBuffer> {
  const types = [signature([0x7f], 0x7f), signature([0x7f]), signature([0x7f, 0x7f], 0x7f),
    signature([0x7f, 0x7f, 0x7f]), signature([], 0x7f)];
  const imports = [['create', 0], ['size', 0], ['item', 2], ['retain', 1], ['set', 3], ['invalid', 4]] as const;
  const code = [1, 3, 0x7f, 0x20, 1, 0x10, 1, 0x23, 0, 0x47, 0x04, 0x40, 0x10, 5, 0x0f, 0x0b,
    0x20, 0, 0x10, 0, 0x22, 2, 0x45, 0x04, 0x7f, 0x41, 0, 0x05, 0x02, 0x40, 0x03, 0x40,
    0x20, 3, 0x23, 0, 0x4f, 0x0d, 1, 0x20, 1, 0x20, 3, 0x10, 2, 0x22, 4, 0x10, 3,
    0x20, 2, 0x20, 3, 0x20, 4, 0x10, 4, 0x20, 3, 0x41, 1, 0x6a, 0x21, 3, 0x0c, 0,
    0x0b, 0x0b, 0x20, 2, 0x0b, 0x0b];
  return new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, vector(types)), ...section(2, vector([
      ...imports.map(([name, type]) => [...text('python'), ...text(name), 0, type]),
      [...text('python'), ...text('fields'), 3, 0x7f, 0],
    ])), ...section(3, vector([[2]])), ...section(7, vector([[...text('construct'), 0, 6]])),
    ...section(10, vector([[...unsigned(code.length), ...code]])),
  ]);
}
