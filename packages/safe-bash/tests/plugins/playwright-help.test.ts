import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { formatPlaywrightHelp } from '../../src/playwright/help.js';
import { registerPlaywrightAbilities } from '../../src/playwright/abilities.js';
import type { PlaywrightAbilities } from '../../src/playwright/index.js';

const reference = readFileSync(new URL('./fixtures/playwright-cli-0.1.20-help.txt', import.meta.url), 'utf8');
const commands = reference.split('\n').filter(line => line.startsWith('  ') && !line.trimStart().startsWith('--')).map(line => line.trimStart().split(' ')[0]!);

test('a fully enabled client preserves all upstream help bytes, including global options', () => {
  const abilities = Object.fromEntries(commands.map(name => [name, { execute: async () => {}, options: 'all' }])) as PlaywrightAbilities;
  assert.equal(formatPlaywrightHelp(undefined, registerPlaywrightAbilities(abilities, false)), reference);
});

test('a restricted client keeps the same vocabulary; provider restrictions do not rewrite standard help', () => {
  const abilities = registerPlaywrightAbilities({ 'cookie-set': { execute: async () => {}, options: ['domain'], limitations: 'Only the approved domain is allowed.' }, 'response-body': { execute: async () => {} } }, false);
  assert.equal(formatPlaywrightHelp(undefined, abilities), reference);
  const topic = formatPlaywrightHelp('cookie-set', abilities);
  assert.ok(topic.startsWith('playwright-cli cookie-set <name> <value>'));
  assert.ok(topic.includes('--domain'));
  assert.ok(topic.includes('--secure'));
  assert.ok(!topic.includes('Only the approved domain'));
  assert.equal(formatPlaywrightHelp('open', abilities), formatPlaywrightHelp('open'));
});

test('built-in and custom command help use the same official target forms without implementation prose', () => {
  for (const [command, usage] of [
    ['click', 'click <target> [button]'], ['fill', 'fill <target> <text>'],
    ['snapshot', 'snapshot [target]'], ['screenshot', 'screenshot [target]'],
  ] as const) {
    const help = formatPlaywrightHelp(command);
    assert.ok(help.startsWith(`playwright-cli ${usage}\n`));
    assert.equal(help, formatPlaywrightHelp(command, registerPlaywrightAbilities({ [command]: { execute: async () => {} } }, false)));
    for (const phrase of ['[limited]', 'Client capabilities', 'Host limits', 'reopen explicitly']) assert.ok(!help.includes(phrase));
  }
});
