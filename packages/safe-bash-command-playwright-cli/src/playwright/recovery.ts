import { validatePlaywrightSessionName } from './invocation.js';

/** Unknown includes interruption and errors: an effect may already have happened. */
export interface PlaywrightOperationOutcome {
  readonly operationId: string;
  readonly status: 'running' | 'completed' | 'unknown';
}

export interface PlaywrightRecoveryResult {
  readonly name: string;
  readonly status: 'live-page' | 'saved-storage' | 'unavailable';
  readonly livePageStateLost: boolean;
  readonly operation?: PlaywrightOperationOutcome;
}

/** Copy only correlation metadata, never provider objects, URLs or error messages. */
export function parsePlaywrightOperationOutcome(value: PlaywrightOperationOutcome): PlaywrightOperationOutcome {
  validatePlaywrightSessionName(value.operationId);
  if (!['running', 'completed', 'unknown'].includes(value.status)) throw new TypeError('Invalid Playwright operation outcome');
  return Object.freeze({ operationId: value.operationId, status: value.status });
}
