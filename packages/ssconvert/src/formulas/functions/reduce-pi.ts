import { fakeTrunc } from "./floating-point.js";
import { error, numericResult } from "../values.js";
import { numberArg } from "./common.js";
import type { FunctionImplementation } from "./types.js";

/** floor(pi * 2^2048), independently calculated with 2200-bit mpmath precision. */
export const scaledPi = 0x3243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89452821e638d01377be5466cf34e90c6cc0ac29b7c97c50dd3f84d5b5b54709179216d5d98979fb1bd1310ba698dfb5ac2ffd72dbd01adfb7b8e1afed6a267e96ba7c9045f12c7f9924a19947b3916cf70801f2e2858efc16636920d871574e69a458fea3f4933d7e0d95748f728eb658718bcd5882154aee7b54a41dc25a59b59c30d5392af26013c5d1b023286085f0ca417918b8db38ef8e79dcb0603a180e6c9e0e8bb01e8a3ed71577c1bd314b2778af2fda55605c60e65525f3aa55ab945748986263e8144055ca396a2aab10b6b4cc5c341141e8cea15486af7c72e993n;

/** Fixed-point reduction retains enough guard bits for the entire finite binary64 domain. */
export const reducePiFunctions: Readonly<Record<string, FunctionImplementation>> = {
  REDUCEPI: (args, host) => {
    const x = numberArg(args, 0, host), e = fakeTrunc(numberArg(args, 1, host));
    if (e < -1 || e > 7) return error("#VALUE!");
    host.tick(); const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, Math.abs(x));
    const bits = view.getBigUint64(0), exponent = Number(bits >> 52n);
    const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
    const fixed = mantissa << BigInt((exponent ? exponent - 1075 : -1074) + 2048);
    const step = e >= 0 ? scaledPi >> BigInt(e) : scaledPi << BigInt(-e);
    // Upstream's simple path selects its quotient using a binary64 reciprocal,
    // including its deliberate rounded half-boundary behavior.
    let count = Math.abs(x) < 2 ** (27 - e) ? BigInt(Math.round(Math.abs(x) * (0.6366197723675814 * 2 ** (e - 1)))) : (fixed + (step >> 1n)) / step;
    let remainder = fixed - count * step;
    if (x < 0) { count = -count; remainder = -remainder; }
    if (numberArg(args, 2, host) !== 0) return numericResult(Number(count & ((1n << BigInt(e + 1)) - 1n)));
    const negative = remainder < 0; if (negative) remainder = -remainder;
    if (remainder === 0n) return numericResult(0);
    const length = remainder.toString(2).length, shift = Math.max(974, length - 53);
    let significant = remainder >> BigInt(shift);
    const dropped = remainder - (significant << BigInt(shift)), half = 1n << BigInt(shift - 1);
    if (dropped > half || dropped === half && (significant & 1n)) significant++;
    const value = Number(significant) * 2 ** (shift - 2048);
    return numericResult(negative ? -value : value);
  }
};
