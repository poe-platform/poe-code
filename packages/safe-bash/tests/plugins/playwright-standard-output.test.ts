import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createPlaywrightController } from '../../src/playwright/controller.js';
import { formatPlaywrightHelp } from '../../src/playwright/help.js';
import { parseInvocation } from '../../src/playwright/invocation.js';
import { registerPlaywrightAbilities } from '../../src/playwright/abilities.js';

const reference = readFileSync(new URL('./fixtures/playwright-cli-0.1.20-help.txt', import.meta.url), 'utf8');
const commandReference = JSON.parse(readFileSync(new URL('./fixtures/playwright-cli-0.1.20-commands.json', import.meta.url), 'utf8')) as Record<string, { help: string }>;

test('default help is exactly the standard CLI help, including all global options', () => {
  assert.equal(formatPlaywrightHelp(), reference);
});

test('every command topic preserves the official help bytes independently of enabled adapters', () => {
  for (const [command, definition] of Object.entries(commandReference)) {
    assert.equal(formatPlaywrightHelp(command as Parameters<typeof formatPlaywrightHelp>[0]), definition.help + '\n', command);
  }
});

test('help and version support JSON without allocating a browser', async () => {
  const controller = createPlaywrightController();
  const run = async (args: string[]) => {
    let output = '';
    await controller.run({ args, env: {}, signal: new AbortController().signal, async write(text) { output += text; } });
    return output;
  };
  try {
    assert.deepEqual(JSON.parse(await run(['--json', '--help'])), { help: reference.trimEnd() });
    assert.equal(await run(['--version']), '0.1.20\n');
    assert.deepEqual(JSON.parse(await run(['--json', '--version'])), { version: '0.1.20' });
    assert.deepEqual(JSON.parse(await run(['--json', 'list'])), { browsers: [] });
  } finally { await controller.dispose(); }
});

test('standard globals are parsed separately from command-specific options', () => {
  const abilities = registerPlaywrightAbilities({ eval: { options: 'all', async execute() {} } }, false);
  const parsed = parseInvocation({ args: ['--json', '--raw', '-s=mine', 'eval', '() => 1'], env: {}, signal: new AbortController().signal, async write() {} }, abilities);
  assert.equal(parsed.command, 'eval');
  assert.ok('json' in parsed && parsed.json);
  assert.ok('raw' in parsed && parsed.raw);
  assert.ok('session' in parsed && parsed.session === 'mine');
  assert.deepEqual('options' in parsed && parsed.options, {});
});
