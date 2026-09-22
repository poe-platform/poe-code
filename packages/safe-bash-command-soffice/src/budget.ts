import { SofficeError, type SofficeLimits, type SofficeResource } from './contracts.js';
export function createSofficeBudget(limits: SofficeLimits, signal: AbortSignal) {
  const maximum = new Map<SofficeResource, number>();
  for (const resource of ['argumentBytes', 'files', 'inputBytes', 'retainedBytes', 'outputBytes', 'nodes', 'pages', 'work'] as const) {
    const value = limits[resource];
    if (!Number.isSafeInteger(value) || value < 0) throw new SofficeError('limit', 'invalid limit', resource);
    maximum.set(resource, value);
  }
  const counts = new Map<SofficeResource, number>();
  let closed = false;
  const checkpoint = () => {
    if (closed) throw new SofficeError('closed', 'invocation closed');
    if (signal.aborted) throw new SofficeError('cancelled', 'invocation cancelled');
  };
  return {
    checkpoint,
    charge(resource: SofficeResource, amount: number): void {
      checkpoint();
      const used = counts.get(resource) ?? 0;
      const limit = maximum.get(resource);
      if (!Number.isSafeInteger(amount) || amount < 0 || limit === undefined || amount > limit - used) throw new SofficeError('limit', 'resource exhausted', resource);
      counts.set(resource, used + amount);
    },
    chargeText(text: string): void {
      checkpoint();
      for (const character of text) {
        this.charge('work', 1);
        const point = character.codePointAt(0)!;
        if (point === 0 || (point >= 0xd800 && point <= 0xdfff)) throw new SofficeError('invalid-argument', 'NUL or unpaired surrogate in argument');
        this.charge('argumentBytes', point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4);
      }
    },
    releaseRetainedBytes(amount: number): void {
      // Rollback is cleanup: cancellation must not prevent releasing owned memory.
      if (closed) throw new SofficeError('closed', 'invocation closed');
      const used = counts.get('retainedBytes') ?? 0;
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > used) throw new SofficeError('limit', 'invalid retained byte release');
      counts.set('retainedBytes', used - amount);
    },
    used(resource: SofficeResource): number { return counts.get(resource) ?? 0; },
    close(): void { counts.clear(); closed = true; }
  };
}
export type SofficeBudget = ReturnType<typeof createSofficeBudget>;
