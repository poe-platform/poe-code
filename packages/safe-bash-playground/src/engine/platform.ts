import { setTimeout, clearTimeout } from "./browser-timers.mjs";

export { Buffer } from "./browser-builtins.mjs";
export { setTimeout, clearTimeout };

export function setImmediate(callback: () => void): ReturnType<typeof setTimeout> {
  return setTimeout(callback, 0);
}

export const clearImmediate = clearTimeout;
export const TransformStream = globalThis.TransformStream;
export const performance = globalThis.performance;
