import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { agentCommands } from '../src/index.ts';
import { success, withFixture } from '../tests/integration/adapter-tools/fixtures.ts';
import { requiredWorkflowCommands } from '../tests/integration/adapter-tools/preflight-review/preflight.ts';

const literal = {
  standard: ['cat', 'cp', 'find', 'mkdir', 'mv', 'printf', 'pwd', 'rm', 'rmdir', 'sort', 'tee', 'test', 'touch', 'xargs'],
  text: ['sed', 'awk'], structured: ['jq'], search: ['rg'], bytes: ['sha256sum', 'gzip'], diffPatch: ['diff', 'patch'],
};
const expected = JSON.parse(readFileSync(new URL('./expected-default-commands.json', import.meta.url))).names.slice().sort();
const backends = ['memory', 'real', 's3', 'webdav', 'mount', 'overlay', 'readonly'];
const names = registry => registry.list().map(command => command.name).sort();

test('independent literal required-command contract is exactly 22 names', () => {
  assert.equal(Object.values(literal).flat().length, 22);
  assert.equal(new Set(Object.values(literal).flat()).size, 22);
  assert.deepEqual(requiredWorkflowCommands, literal);
  assert.equal(expected.length, 53);
  assert.equal(new Set(expected).size, 53);
});

for (const backend of backends) {
  for (const [family, required] of Object.entries(literal)) {
    for (const missing of required) {
      test(`${backend}: cardinality53 missing ${family} command ${missing} rejects before callback`, { timeout: 20000 }, async context => {
        let entered = false;
        let observed;
        let transformed;
        const substitute = `registry_unblock_substitute_${missing}`;
        await assert.rejects(withFixture(backend, async () => { entered = true; }, {
          name: 'independent-cardinality-preserving-mutation',
          async setup(host) {
            await agentCommands().setup(host);
            assert.deepEqual(names(host.commands), expected);
            assert.equal(host.commands.unregister(missing), true);
            host.commands.register({ name: substitute, execute: () => ({ exitCode: 0 }) });
            transformed = names(host.commands);
            assert.equal(transformed.length, 53);
            assert.deepEqual(transformed, [...expected.filter(name => name !== missing), substitute].sort());
          },
        }), error => {
          assert.ok(error instanceof assert.AssertionError);
          observed = error.message;
          assert.equal(observed, `adapter-tools preflight: missing required ${family} command: ${missing}`);
          return true;
        });
        assert.equal(entered, false);
        context.diagnostic(JSON.stringify({ backend, family, missing, substitute, beforeCount: 53, afterCount: transformed.length, observed, callbackEntered: entered }));
      });
    }
  }
  test(`${backend}: optional command addition cardinality54 executes real workflows`, { timeout: 20000 }, async context => {
    let entered = false;
    let optionalExecuted = false;
    await withFixture(backend, async ({ exec, shell, dispatched }) => {
      entered = true;
      assert.equal(names(shell.commands).length, 54);
      success(await exec('registry_unblock_optional'), '');
      success(await exec('cat old.txt'), 'alpha\nbeta\n');
      success(await exec("find src -type f -name '*.txt' | xargs rg --no-heading --no-filename '^TODO' | sed 's/^TODO //' | awk '{ print $1 \":\" $2 }' | jq -R '.' | jq -s '.'"), '[\n  "alpha:2",\n  "beta:3"\n]\n');
      success(await exec('cat old.txt | gzip -c | gzip -dc'), 'alpha\nbeta\n');
      success(await exec('diff -q old.txt target.txt'), '');
      for (const command of ['registry_unblock_optional', 'cat', 'find', 'xargs', 'rg', 'sed', 'awk', 'jq', 'gzip', 'diff']) {
        assert.ok(dispatched.includes(command), `workflow did not dispatch ${command}`);
      }
      assert.equal(optionalExecuted, true);
      context.diagnostic(JSON.stringify({ backend, beforeCount: 53, afterCount: 54, callbackEntered: entered, optionalExecuted, dispatched }));
    }, {
      name: 'independent-optional-addition',
      async setup(host) {
        await agentCommands().setup(host);
        assert.deepEqual(names(host.commands), expected);
        host.commands.register({ name: 'registry_unblock_optional', execute: () => { optionalExecuted = true; return { exitCode: 0 }; } });
        assert.deepEqual(names(host.commands), [...expected, 'registry_unblock_optional'].sort());
      },
    });
    assert.equal(entered, true);
  });
}
