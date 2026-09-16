import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { formatPlaywrightHelp } from '../../src/playwright/help.js';

const reference = readFileSync(new URL('./fixtures/playwright-cli-0.1.20-help.txt', import.meta.url), 'utf8');
const availability = 'Availability: [unsupported] is not implemented; [limited] has restrictions explained below.';

test('global help preserves the complete pinned Microsoft reference except explicit availability annotations', () => {
  const help = formatPlaywrightHelp();
  assert.ok(help.startsWith(reference.split('\n').slice(0, 5).join('\n') + '\n'));
  assert.ok(help.includes(availability));
  const original = help.split('\nCompatibility notes:\n')[0]!
    .replace(availability + '\n\n', '')
    .split('\n').map(line => line.endsWith(' [unsupported]') ? line.slice(0, -14) : line.endsWith(' [limited]') ? line.slice(0, -10) : line).join('\n');
  assert.equal(original, reference);
});

test('every unavailable command and global option is marked without changing its official description', () => {
  const supported = new Set(['open', 'close', 'goto', 'click', 'fill', 'snapshot', 'press', 'screenshot', 'tab-list', 'tab-new', 'tab-close', 'tab-select', 'list', 'close-all', '--help']);
  const limited = new Set(['click', 'fill', 'snapshot', 'screenshot']);
  const lines = formatPlaywrightHelp().split('\n');
  for (const line of reference.split('\n').filter(line => line.startsWith('  '))) {
    const command = line.trimStart().split(' ')[0]!;
    const suffix = !supported.has(command) ? ' [unsupported]' : limited.has(command) ? ' [limited]' : '';
    assert.ok(lines.includes(line + suffix), command);
  }
});

test('standard target terminology is retained and unsupported forms are explained separately', () => {
  for (const [command, usage, restriction] of [
    ['click', 'click <target> [button]', 'button argument is unsupported'],
    ['fill', 'fill <target> <text>', 'issued snapshot ref'],
    ['snapshot', 'snapshot [target]', 'target argument is unsupported'],
    ['screenshot', 'screenshot [target]', 'target argument is unsupported'],
  ] as const) {
    const help = formatPlaywrightHelp(command);
    assert.ok(help.includes(`Usage: playwright-cli ${usage}`), command);
    assert.ok(help.includes(`Usage: playwright-cli -s=<session> ${usage}`), command);
    assert.ok(help.includes(restriction), command);
  }
  const help = formatPlaywrightHelp();
  for (const note of ['PLAYWRIGHT_CLI_SESSION', '--session', '--filename', '--full-page', 'host-configured', 'default', 'repeated open', 'remote loss', 'Unsupported']) assert.ok(help.includes(note), note);
});
