import { PlaywrightResourceLimitError } from './resource-limit.js';

export function createPlaywrightCommandBudget(maxBytes: number) {
  let remaining = maxBytes;
  return {
    get remaining() { return remaining; },
    admit(bytes: number) {
      if (bytes > remaining) throw new PlaywrightResourceLimitError('Playwright command byte limit exceeded');
      remaining -= bytes;
    },
  };
}
