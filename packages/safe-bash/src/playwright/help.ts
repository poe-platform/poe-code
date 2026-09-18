import type { PlaywrightCommand } from './catalog.js';
import type { RegisteredPlaywrightAbility } from './abilities.js';
import { playwrightCommandReference } from './command-reference.js';
import { playwrightHelpReference } from './help-reference.js';

/** The command vocabulary is stable even when a provider cannot perform an operation. */
export function formatPlaywrightHelp(topic?: PlaywrightCommand | 'tab', _abilities?: ReadonlyMap<PlaywrightCommand, RegisteredPlaywrightAbility>): string {
  if (topic === undefined || topic === 'tab') return playwrightHelpReference;
  return playwrightCommandReference[topic].help + '\n';
}
