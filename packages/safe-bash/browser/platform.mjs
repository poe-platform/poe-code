export { Buffer } from "buffer";
export { posixPath as posix } from "poe-code/safe-fs/core";
export const TransformStream = globalThis.TransformStream;
export const setImmediate = (callback, ...args) => setTimeout(callback, 0, ...args);
export const clearImmediate = clearTimeout;
