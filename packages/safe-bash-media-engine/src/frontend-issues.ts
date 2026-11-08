import type { Discovery } from './types.js';
import type { ImageMagickDiscovery } from './imagemagick.js';
import type { AccessGraph } from './resolution-types.js';

/** Native deferrals are advisory diagnostics, never errors to throw before
 * execution. Grammar failures cannot certify a complete static parse. */
export function frontendIssues(deferred: Discovery['deferred'] | ImageMagickDiscovery['deferred']): AccessGraph['issues'] {
  return deferred.map(item => ({
    reason: ['unknown-option', 'missing-value', 'filter-syntax', 'unknown option; native validation',
      'missing option operand before implicit output', 'incomplete script token'].includes(item.reason) ? 'syntax' : 'live',
    detail: `Frontend ${'source' in item ? item.source : 'argv'} at index ${item.index}: ${item.reason}`,
  }));
}
