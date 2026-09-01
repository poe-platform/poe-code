export { Buffer } from "buffer";
export const TransformStream = globalThis.TransformStream;
export const setImmediate = (callback, ...args) => setTimeout(callback, 0, ...args);
export const clearImmediate = clearTimeout;
