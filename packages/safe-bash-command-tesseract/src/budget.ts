import { TesseractError, type TesseractResource } from './contracts.js';
export function createTesseractBudget(limits: Readonly<Partial<Record<TesseractResource, number>>>, signal: AbortSignal) {
  const admitted = new Map<TesseractResource, number>();
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TesseractError('limit', 'invalid limit: ' + key, key);
    admitted.set(key as TesseractResource, value);
  }
  const counts = new Map<TesseractResource, number>();
  let closed = false;
  const check = () => {
    if (closed) throw new TesseractError('closed', 'invocation closed');
    if (signal.aborted) throw new TesseractError('cancelled', 'invocation cancelled');
  };
  return {
    charge(resource: TesseractResource, amount: number): void {
      check();
      const previous = counts.get(resource) ?? 0;
      const maximum = admitted.get(resource);
      if (!Number.isSafeInteger(amount) || amount < 0 || maximum === undefined || amount > maximum - previous) {
        throw new TesseractError('limit', 'exhausted ' + resource, resource);
      }
      counts.set(resource, previous + amount);
    },
    release(resource: TesseractResource, amount: number): void {
      const previous = counts.get(resource) ?? 0;
      // Work measures cumulative execution, not live memory reservations.
      if (closed || resource === 'work' || !Number.isSafeInteger(amount) || amount < 0 || amount > previous) throw new TesseractError('limit', 'invalid release: ' + resource, resource);
      counts.set(resource, previous - amount);
    },
    used(resource: TesseractResource): number { return counts.get(resource) ?? 0; },
    checkpoint: check,
    close(): void { counts.clear(); closed = true; }
  };
}
