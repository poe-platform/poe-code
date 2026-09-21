import type { PlaywrightCommand } from './catalog.js';
import type { RegisteredPlaywrightAbility } from './abilities.js';
import { playwrightCommandReference } from './command-reference.js';
import { playwrightHelpReference } from './help-reference.js';

/** The command vocabulary is stable even when a provider cannot perform an operation. */
export function formatPlaywrightHelp(topic?: PlaywrightCommand | 'tab', abilities?: ReadonlyMap<PlaywrightCommand, RegisteredPlaywrightAbility>, namedSessionAttachment = false): string {
  const reference = topic === undefined || topic === 'tab' ? playwrightHelpReference : playwrightCommandReference[topic].help + '\n';
  if (!abilities || topic !== undefined && topic !== 'attach') return reference;
  if (abilities.get('attach')?.execute) return reference + '\nHost attachment capability\n  attach: supported through the configured authenticated attachment broker.\n';
  if (namedSessionAttachment) return reference + '\nHost attachment capability\n  attach: supported for named sessions owned by this authenticated controller.\n  attach NAME selects a live session or restores its committed resumable profile.\n  Later commands with the same PLAYWRIGHT_CLI_SESSION default use that session; -s overrides it.\n  An explicit attachment session must match NAME. detach clears selection and retains the browser; close retires it.\n  CDP, endpoint, extension, config and idle-timeout attachment options are unsupported.\n';
  return reference + '\nHost attachment capability\n  attach: unsupported; an authenticated browser attachment broker is unavailable in this host.\n  Do not retry attach after a provider failure. Run playwright-cli list, then use an explicit existing owned session alias:\n  playwright-cli -s=<existing-alias> snapshot\n  playwright-cli -s=<existing-alias> tab-list\n  playwright-cli -s=<existing-alias> goto <url>\n  Only sessions belonging to the authenticated owner are available; a session alias does not grant access to another owner.\n';
}
