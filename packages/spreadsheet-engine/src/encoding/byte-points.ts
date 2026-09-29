import { SsconvertError } from "../contracts.js";

/** Admit GLib's historical one–six byte point encoding before allocating owned
 * output. Each traversal restarts its state; both passes retain work checks. */
export function encodeByteTextPoints(traverse: (emit: (point: number) => void) => void,
  maximum: number, tick: () => void): Uint8Array {
  const width = (point: number) => point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : point < 2097152 ? 4 : point < 67108864 ? 5 : 6;
  let size = 0;
  traverse(point => {
    for (let count = width(point); count > 0; count--) {
      tick();
      if (++size > maximum) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
    }
  });
  tick();
  const result = new Uint8Array(size); let offset = 0;
  traverse(point => {
    const count = width(point); let remaining = point;
    for (let index = count - 1; index > 0; index--) {
      tick(); result[offset + index] = 128 | (remaining & 63); remaining = Math.floor(remaining / 64);
    }
    tick(); result[offset] = count === 1 ? point : [0, 0, 192, 224, 240, 248, 252][count]! | remaining;
    offset += count;
  });
  return result;
}
