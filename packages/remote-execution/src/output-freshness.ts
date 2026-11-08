import type { OutputFreshness } from './output-retrieval.js';

/** Keep the validator's native receiver while preventing it from silently
 * validating a different identity/version under an acknowledged resume token. */
export function admitOutputFreshness(guard: OutputFreshness): OutputFreshness {
 const { identity, version, assertCurrent } = guard;
 if (identity === null || !['object', 'symbol'].includes(typeof identity)
  || typeof version !== 'string' || !version.length || version.length > 256
  || typeof assertCurrent !== 'function') throw new TypeError('Invalid output freshness binding');
 const validate = assertCurrent.bind(guard);
 return Object.freeze({ identity, version, async assertCurrent(signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (guard.identity !== identity || guard.version !== version) throw new TypeError('Canonical output freshness binding changed');
  await validate(signal);
  signal?.throwIfAborted();
  if (guard.identity !== identity || guard.version !== version) throw new TypeError('Canonical output freshness binding changed');
 } });
}
