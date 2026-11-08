import { validatePlaywrightSessionName } from './invocation.js';

interface Selection { readonly name: string; readonly selection: string }
export interface PlaywrightSelectionPersistence {
  read(signal: AbortSignal): Promise<Selection | undefined>;
  write(value: Selection | undefined, signal: AbortSignal): Promise<void>;
}

export function createPlaywrightSessionSelection(persistence?: PlaywrightSelectionPersistence) {
  if (persistence && (typeof persistence.read !== 'function' || typeof persistence.write !== 'function')) throw new TypeError('Invalid Playwright selection persistence');
  let current: Selection | undefined;
  return {
    get current() { return current; },
    async load(signal: AbortSignal) {
      if (!persistence) return;
      const value = await persistence.read(signal);
      signal.throwIfAborted();
      if (value !== undefined) {
        validatePlaywrightSessionName(value.name);
        validatePlaywrightSessionName(value.selection);
      }
      current = value;
    },
    async set(value: Selection | undefined, signal: AbortSignal) {
      signal.throwIfAborted();
      await persistence?.write(value, signal);
      signal.throwIfAborted();
      current = value;
    },
  };
}
