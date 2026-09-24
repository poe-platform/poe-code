import type { PlaywrightCommand } from './catalog.js';
import type { RegisteredPlaywrightAbility } from './abilities.js';
import { playwrightCommandReference } from './command-reference.js';
import { playwrightHelpReference } from './help-reference.js';

/** The command vocabulary is stable even when a provider cannot perform an operation. */
export function formatPlaywrightHelp(topic?: PlaywrightCommand | 'tab', abilities?: ReadonlyMap<PlaywrightCommand, RegisteredPlaywrightAbility>, namedSessionAttachment = false): string {
  let help = topic === undefined || topic === 'tab' ? playwrightHelpReference : playwrightCommandReference[topic].help + '\n';
  if (!abilities) return help;
  if (topic === undefined || topic === 'attach') {
    if (abilities.get('attach')?.execute) help += '\nHost attachment capability\n  attach: supported through the configured authenticated attachment broker.\n';
    else if (namedSessionAttachment) help += '\nHost attachment capability\n  attach: supported for named sessions owned by this authenticated controller.\n  attach NAME selects a live session or restores its committed resumable profile.\n  Later commands with the same PLAYWRIGHT_CLI_SESSION default use that session; -s overrides it.\n  An explicit attachment session must match NAME. detach clears selection and retains the browser; close retires it.\n  CDP, endpoint, extension, config and idle-timeout attachment options are unsupported.\n';
    else help += '\nHost attachment capability\n  attach: unsupported; an authenticated browser attachment broker is unavailable in this host.\n  Do not retry attach after a provider failure. Run playwright-cli list, then use an explicit existing owned session alias:\n  playwright-cli -s=<existing-alias> snapshot\n  playwright-cli -s=<existing-alias> tab-list\n  playwright-cli -s=<existing-alias> goto <url>\n  Only sessions belonging to the authenticated owner are available; a session alias does not grant access to another owner.\n';
  }
  if (topic === undefined || topic === 'show') {
    help += abilities.get('show')?.execute
      ? '\nHost dashboard capability\n  show: supported through the configured host dashboard ability.\n'
      : '\nHost dashboard capability\n  show: unsupported; Playwright dashboard and interactive local browser login are unavailable in this host.\n  Do not use show for a login handoff. Use only an authentication flow explicitly provided by the host application.\n';
  }
  return help;
}
