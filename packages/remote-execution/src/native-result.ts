import type { NativeResult } from './materializations.js';

/** Shared admission for adapter results and portable status observations. */
export function validateNativeResult(value: unknown): asserts value is NativeResult {
  const invalid = () => { throw new TypeError('Invalid native job status'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = value as NativeResult;
  if (!Number.isSafeInteger(result.exitCode) || result.exitCode < 0) invalid();
  for (const octets of [result.stdout, result.stderr]) {
    if (!Array.isArray(octets)) invalid();
    for (const octet of octets)
      if (!Number.isInteger(octet) || octet < 0 || octet > 255) invalid();
  }
}
