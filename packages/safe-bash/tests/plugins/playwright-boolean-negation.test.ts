import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerPlaywrightAbilities } from '../../src/playwright/abilities.js';
import { parseInvocation } from '../../src/playwright/invocation.js';
import { createPlaywrightCli } from '../../src/commands/playwright/index.js';
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';

const abilities = registerPlaywrightAbilities({
  list: { options: 'all', async execute() {} },
  'cookie-set': { options: 'all', async execute() {} },
  'install-browser': { options: 'all', async execute() {} },
  eval: { options: 'all', async execute() {} },
}, false);

function parse(args: string[]) {
  return parseInvocation({ args, env: {}, signal: new AbortController().signal, async write() {} }, abilities);
}

for (const flag of ['json', 'raw']) {
  for (const [prefix, expected] of [
    [[`--no-${flag}`], false],
    [[`--${flag}`, `--no-${flag}`], false],
    [[`--no-${flag}`, `--${flag}`], true],
    [[`--${flag}`, `--${flag}`], true],
  ] as const) {
    test(`global ${prefix.join(' ')} uses its last boolean value`, () => {
      assert.equal(parse([...prefix, 'list'])[flag as 'json' | 'raw'], expected);
    });
  }
}

test('command booleans retain false and last-write semantics', () => {
  const parsed = parse(['cookie-set', 'name', 'value', '--secure', '--no-secure', '--no-httpOnly']);
  assert.ok('options' in parsed);
  assert.deepEqual(parsed.options, { secure: false, httpOnly: false });
});

test('explicit no-prefixed option names are not reinterpreted', () => {
  const parsed = parse(['install-browser', '--no-shell']);
  assert.ok('options' in parsed);
  assert.deepEqual(parsed.options, { 'no-shell': true });
});

test('negation cannot enable unregistered command options or negate strings', () => {
  assert.throws(() => parse(['list', '--no-secure']), /Unsupported option: --secure/);
  assert.throws(() => parse(['list', '--no-session']), /Unknown option/);
  assert.throws(() => parse(['--no-json=false', 'list']), /Invalid option/);
  assert.throws(() => parse(['--no-version', 'list']), /Unsupported option: --version/);
});

test('literal arguments do not toggle global output flags', () => {
  const parsed = parse(['eval', '--', '--no-json']);
  assert.ok('args' in parsed);
  assert.deepEqual(parsed.args, ['--no-json']);
  assert.equal(parsed.json, false);
});

for (const [prefix, json] of [
  ['--json --no-json', false],
  ['--no-json --json', true],
  ['--json --no-json -- --json', false],
] as const) {
  test(`public parse errors honor final JSON selection: ${prefix}`, async context => {
    const cli = createPlaywrightCli();
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(cli.plugin);
    context.after(() => shell.dispose());
    const result = await shell.exec(`playwright-cli ${prefix} unknown`);
    assert.equal(result.exitCode, 1);
    if (json) {
      assert.equal(result.stderr, '');
      assert.equal(JSON.parse(result.stdout).isError, true);
    } else {
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /playwright-cli:/);
    }
  });
}
