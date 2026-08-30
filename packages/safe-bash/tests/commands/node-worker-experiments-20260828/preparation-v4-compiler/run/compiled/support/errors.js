import { getSystemErrorMap } from "node:util";
const systemErrnos = new Map([...getSystemErrorMap()].map(([errno, [name]]) => [name, errno]));
const descriptions = {
    EACCES: "permission denied",
    EAGAIN: "resource temporarily unavailable",
    EBADF: "bad file descriptor",
    EBUSY: "resource busy or locked",
    ECANCELED: "operation canceled",
    EEXIST: "file already exists",
    EFBIG: "file too large",
    EINTR: "interrupted system call",
    EINVAL: "invalid argument",
    EIO: "input/output error",
    EISDIR: "illegal operation on a directory",
    ELOOP: "too many symbolic links encountered",
    EMFILE: "too many open files",
    ENAMETOOLONG: "name too long",
    ENFILE: "file table overflow",
    ENOENT: "no such file or directory",
    ENOMEM: "not enough memory",
    ENOSPC: "no space left on device",
    ENOSYS: "function not implemented",
    ENOTDIR: "not a directory",
    ENOTEMPTY: "directory not empty",
    ENOTSUP: "operation not supported",
    EOPNOTSUPP: "operation not supported",
    EPERM: "operation not permitted",
    EPIPE: "broken pipe",
    EROFS: "read-only file system",
    ETIMEDOUT: "operation timed out",
    EXDEV: "cross-device link not permitted",
};
export class FsError extends Error {
    code;
    errno;
    syscall;
    path;
    dest;
    constructor(code, options = {}) {
        if (!isErrnoCode(code))
            throw new TypeError(`Unsupported errno code: ${String(code)}`);
        const errno = systemErrnos.get(code === "EOPNOTSUPP" ? "ENOTSUP" : code);
        if (errno === undefined)
            throw new TypeError(`Unsupported platform errno code: ${code}`);
        const operation = options.syscall ? `, ${options.syscall}` : "";
        const path = options.path === undefined ? "" : ` '${options.path}'`;
        const destination = options.dest === undefined ? "" : ` -> '${options.dest}'`;
        super(`${code}: ${options.message ?? descriptions[code]}${operation}${path}${destination}`, options);
        this.name = "FsError";
        this.code = code;
        this.errno = errno;
        if (options.syscall !== undefined)
            this.syscall = options.syscall;
        if (options.path !== undefined)
            this.path = options.path;
        if (options.dest !== undefined)
            this.dest = options.dest;
    }
}
export function isErrnoCode(code) {
    return typeof code === "string" && Object.hasOwn(descriptions, code);
}
export function isFsError(error, code) {
    return error instanceof FsError && (code === undefined || error.code === code);
}
export function toFsError(error, options = {}) {
    if (error instanceof FsError && Object.keys(options).length === 0)
        return error;
    const source = typeof error === "object" && error !== null
        ? error
        : {};
    const details = {
        ...(typeof source.syscall === "string" ? { syscall: source.syscall } : {}),
        ...(typeof source.path === "string" ? { path: source.path } : {}),
        ...(typeof source.dest === "string" ? { dest: source.dest } : {}),
        cause: error,
        ...options,
    };
    return new FsError(isErrnoCode(source.code) ? source.code : "EIO", details);
}
