import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { formatPlaywrightHelp } from '../../src/playwright/help.js';
import { registerPlaywrightAbilities } from '../../src/playwright/abilities.js';
import type { PlaywrightAbilities } from '../../src/playwright/index.js';

const reference = readFileSync(new URL('./fixtures/playwright-cli-0.1.20-help.txt', import.meta.url), 'utf8');
const commands = reference.split('\n').filter(line => line.startsWith('  ') && !line.trimStart().startsWith('--')).map(line => line.trimStart().split(' ')[0]!);

test('a fully enabled client preserves the exact visible upstream command order, syntax, descriptions and sections', () => {
  const abilities = Object.fromEntries(commands.map(name => [name, { execute: async () => {}, options: 'all' }])) as PlaywrightAbilities;
  const help = formatPlaywrightHelp(undefined, registerPlaywrightAbilities(abilities, false));
  assert.equal(help.split('\nGlobal options:\n')[0], reference.split('\nGlobal options:\n')[0]);
  assert.ok(!help.includes('[unsupported]'));
  assert.ok(!help.includes('[limited]'));
});

test('help contains only enabled commands, their actual options and nonempty sections', () => {
  const abilities = registerPlaywrightAbilities({ 'cookie-set': { execute: async () => {}, options: ['domain'], limitations: 'Only the approved domain is allowed.' }, 'response-body': { execute: async () => {} } }, false);
  const help = formatPlaywrightHelp(undefined, abilities);
  for (const line of reference.split('\n').filter(line => line.startsWith('  ') && !line.trimStart().startsWith('--'))) {
    const name = line.trimStart().split(' ')[0]!;
    assert.equal(help.includes(line), name === 'cookie-set' || name === 'response-body', name);
  }
  assert.ok(help.includes('Storage:'));
  assert.ok(help.includes('Network:'));
  assert.ok(!help.includes('Core:'));
  assert.ok(help.includes('cookie-set: --domain <value>'));
  assert.ok(!help.includes('--secure'));
  assert.ok(help.includes('Only the approved domain is allowed.'));
  const topic = formatPlaywrightHelp('cookie-set', abilities);
  assert.ok(topic.includes('--domain <value>'));
  assert.ok(!topic.includes('--secure'));
  assert.ok(formatPlaywrightHelp('open', abilities).includes('Not enabled by this client'));
});

test('legacy built-ins keep standard target syntax and honest restrictions while overrides remove those restrictions', () => {
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
    const full = formatPlaywrightHelp(command, registerPlaywrightAbilities({ [command]: { execute: async () => {} } }, false));
    assert.ok(!full.includes(restriction));
    assert.ok(!full.includes('[limited]'));
  }
  const help = formatPlaywrightHelp();
  for (const note of ['PLAYWRIGHT_CLI_SESSION', '--session', '--filename', '--full-page', 'host-configured', 'default', 'repeated open', 'remote loss']) assert.ok(help.includes(note), note);
});
