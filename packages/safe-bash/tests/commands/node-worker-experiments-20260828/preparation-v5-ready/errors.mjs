import { exact, integer, text } from './wire.mjs';

export const FS_CODES = Object.freeze(['EACCES', 'EAGAIN', 'EBADF', 'EBUSY', 'ECANCELED', 'EEXIST', 'EFBIG', 'EINTR', 'EINVAL', 'EIO', 'EISDIR', 'ELOOP', 'EMFILE', 'ENAMETOOLONG', 'ENFILE', 'ENOENT', 'ENOMEM', 'ENOSPC', 'ENOSYS', 'ENOTDIR', 'ENOTEMPTY', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EPIPE', 'EROFS', 'ETIMEDOUT', 'EXDEV']);

export function typedErrorDTO(original, recognizeTypedOrigin) {
  if (recognizeTypedOrigin(original) !== true) throw original;
  const allowed = ['stack', 'message', 'cause', 'code', 'errno', 'syscall', 'path', 'dest', 'name'];
  const descriptors = Object.getOwnPropertyDescriptors(original);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (!allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value')) throw original;
  }
  function required(key) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw original;
    return descriptor.value;
  }
  function optional(key) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.value === undefined) return null;
    return text(descriptor.value, 1024);
  }
  try {
    const dto = { name: required('name'), code: required('code'), message: text(required('message'), 1024), errno: integer(required('errno'), -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), path: optional('path'), syscall: optional('syscall'), dest: optional('dest') };
    validateErrorDTO(dto, 'fsError');
    return dto;
  } catch { throw original; }
}

export function validateErrorDTO(value, kind) {
  const dto = exact(value, kind === 'fsError' ? ['name', 'code', 'message', 'errno', 'path', 'syscall', 'dest'] : ['name', 'code', 'message']);
  text(dto.message, 1024);
  if (kind === 'fsError') {
    if (dto.name !== 'FsError' || !FS_CODES.includes(dto.code)) throw new Error('typed error vocabulary');
    integer(dto.errno, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    for (const field of ['path', 'syscall', 'dest']) if (dto[field] !== null) text(dto[field], 1024);
  } else if (dto.name !== 'Error' || dto.code !== (kind === 'denied' ? 'ERR_VNODE_DENIED' : 'ERR_VNODE_UNSUPPORTED')) throw new Error('refusal vocabulary');
  return dto;
}
