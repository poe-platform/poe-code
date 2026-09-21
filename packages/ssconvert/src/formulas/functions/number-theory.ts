import { error, numericResult } from "../values.js";
import { bool, collect, numberArg } from "./common.js";
import { fakeFloor } from "./floating-point.js";
import type { FunctionHost, FunctionImplementation, SpecialForm } from "./types.js";

const bitMaximum = 2 ** 52;

function modularPower(base: bigint, exponent: bigint, modulus: bigint, host: FunctionHost): bigint {
  let result = 1n;
  while (exponent > 0n) {
    host.tick();
    if (exponent & 1n) result = result * base % modulus;
    exponent >>= 1n; base = base * base % modulus;
  }
  return result;
}
/** Deterministic Miller-Rabin over the released bit_max domain. */
function prime(n: bigint, host: FunctionHost): boolean {
  if (n < 2n) return false;
  let d = n - 1n, s = 0;
  while ((d & 1n) === 0n) { host.tick(); d >>= 1n; s++; }
  for (const base of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n]) {
    host.tick();
    if (n === base) return true;
    if (n % base === 0n) return false;
    let x = modularPower(base, d, n, host);
    if (x === 1n || x === n - 1n) continue;
    let passed = false;
    for (let j = 1; j < s; j++) { host.tick(); x = x * x % n; if (x === n - 1n) { passed = true; break; } }
    if (!passed) return false;
  }
  return true;
}
function factors(n: bigint, host: FunctionHost): readonly (readonly [bigint, number])[] {
  const result: [bigint, number][] = [];
  if (n <= 1n) return result;
  if (prime(n, host)) return [[n, 1]];
  for (let p = 2n; p * p <= n; p = p === 2n ? 3n : p + 2n) {
    host.tick(); let exponent = 0;
    while (n % p === 0n) { host.tick(); exponent++; n /= p; }
    if (exponent) {
      result.push([p, exponent]);
      if (n > 1n && prime(n, host)) break;
    }
  }
  if (n > 1n) result.push([n, 1]);
  return result;
}
const multiplicative: Readonly<Record<string, (p: bigint, exponent: number) => bigint>> = {
  NT_D: (_p, exponent) => BigInt(exponent + 1),
  NT_PHI: (p, exponent) => p ** BigInt(exponent - 1) * (p - 1n),
  NT_RADICAL: p => p,
  NT_SIGMA: (p, exponent) => (p ** BigInt(exponent + 1) - 1n) / (p - 1n),
  NT_MU: (_p, exponent) => exponent > 1 ? 0n : -1n
};
export const numberTheoryFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ...Object.fromEntries(Object.entries(multiplicative).map(([name, term]) => [name, ((args, host) => {
    const n = Math.floor(numberArg(args, 0, host));
    if (n < 1 || n > bitMaximum) return error("#NUM!");
    let result = 1n;
    for (const [p, exponent] of factors(BigInt(n), host)) { host.tick(); result *= term(p, exponent); }
    return numericResult(Number(result));
  }) satisfies FunctionImplementation])),
  NT_OMEGA: (args, host) => {
    const n = Math.floor(numberArg(args, 0, host));
    return n < 1 || n > bitMaximum ? error("#NUM!") : numericResult(factors(BigInt(n), host).length);
  },
  ISPRIME: (args, host) => {
    const n = Math.floor(numberArg(args, 0, host));
    return n < 0 ? bool(false) : n > bitMaximum ? error("#LIMIT!") : bool(prime(BigInt(n), host));
  },
  PFACTOR: (args, host) => {
    const n = Math.floor(numberArg(args, 0, host));
    if (n < 2) return error("#VALUE!");
    if (n > bitMaximum) return error("#LIMIT!");
    return numericResult(Number(factors(BigInt(n), host)[0]![0]));
  },
  ITHPRIME: (args, host) => {
    const index = Math.floor(numberArg(args, 0, host));
    if (index < 1 || index > 2147483647) return error("#NUM!");
    if (index > 100000000) return error("#LIMIT!");
    let count = 0;
    for (let candidate = 2n; ; candidate = candidate === 2n ? 3n : candidate + 2n) {
      host.tick(); if (prime(candidate, host) && ++count === index) return numericResult(Number(candidate));
    }
  },
  NT_PI: (args, host) => {
    const n = Math.floor(numberArg(args, 0, host));
    if (n > bitMaximum || n > 2038074743) return error("#LIMIT!");
    let count = 0;
    for (let candidate = 2n; candidate <= n; candidate = candidate === 2n ? 3n : candidate + 2n) { host.tick(); if (prime(candidate, host)) count++; }
    return numericResult(count);
  },
  ...Object.fromEntries(["BITLSHIFT", "BITRSHIFT"].map(name => [name, ((args, host) => {
    const x = numberArg(args, 0, host), shift = Math.floor(numberArg(args, 1, host));
    if (x < 0 || x > bitMaximum) return error("#NUM!");
    if (shift >= 64 || shift <= -64) return numericResult(0);
    const signed = name === "BITLSHIFT" ? shift : -shift, integer = BigInt(Math.trunc(x));
    return numericResult(Number(signed < 0 ? integer >> BigInt(-signed) : BigInt.asUintN(64, integer << BigInt(signed))));
  }) satisfies FunctionImplementation]))
};
export const numberTheorySpecialForms: Readonly<Record<string, SpecialForm>> = Object.fromEntries(
  ["BITAND", "BITOR", "BITXOR"].map(name => [name, ((nodes, host) => {
    let result = name === "BITAND" ? (1n << 64n) - 1n : 0n, count = 0, invalid = false;
    for (const node of nodes) for (const cell of collect(host.evaluate(node, true), host)) {
      if (cell.kind === "error") return cell;
      if (cell.kind !== "number" && cell.kind !== "boolean") continue;
      const n = fakeFloor(Number(cell.value));
      if (n < 0 || n > bitMaximum) { invalid = true; continue; }
      count++; const x = BigInt(n);
      result = name === "BITAND" ? result & x : name === "BITOR" ? result | x : result ^ x;
    }
    return invalid || !count && name !== "BITOR" ? error("#VALUE!") : numericResult(Number(result));
  }) satisfies SpecialForm])
);
