import type { PlaywrightPage } from './adapter.js';

// Native pages keep their identity for adapter capabilities and event observers.
// Only their saved destination is deferred; no navigation outlives a command.
export const savedTabDestinations = new WeakMap<PlaywrightPage, string>();

export function savedTabDestination(page: PlaywrightPage): string | undefined {
  const destination = savedTabDestinations.get(page);
  if (destination !== undefined && page.url() !== 'about:blank') {
    // A viewer or host has already navigated this page. Never replay its old URL.
    savedTabDestinations.delete(page);
    return undefined;
  }
  return destination;
}
