import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import type { TableCase } from '../../table-text/cases.js';

assert.ok(existsSync('/tmp/safe-bash-comm-final-review.ready'), 'Root READY required');
assert.ok(process.cwd().startsWith(realpathSync('/tmp/safe-bash-comm-final-review-owned') + '/'), 'Only isolated reviewer snapshot');
const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const mode = process.argv[2] ?? 'direct216';
const observations: Record<string, unknown>[] = [];
let selectedPass = 0, exactPass = 0;
if (mode === 'direct216' || mode === 'shared-negative') {
  const { tableCases } = await import('../../table-text/cases.js');
  const { runTable } = await import('../../table-text/helpers.js');
  const evidence = JSON.parse(readFileSync('tests/commands/table-text/gnu-evidence.json', 'utf8'));
  assert.equal(tableCases.length, 216);
  assert.equal(evidence.observations.length, 216);
  for (const [index, fixture] of tableCases.entries()) {
    if (mode === 'shared-negative' && fixture.name !== 'comm: shared stdin') continue;
    const expected = evidence.observations[index];
    assert.equal(digest(JSON.stringify(fixture)), expected.caseSha256);
    const result = await runTable(fixture);
    const actual = { exitCode: result.exitCode, stdoutHex: result.stdoutHex, stderrHex: Buffer.from(result.stderr).toString('hex') };
    for (const [name, hex] of Object.entries(fixture.files)) assert.equal(Buffer.from(await result.fs.readFile(`/work/${name}`)).toString('hex'), hex, fixture.name);
    assert.deepEqual((await result.fs.readdir('/work')).map(entry => entry.name).sort(), Object.keys(fixture.files).sort(), fixture.name);
    const exact = actual.exitCode === expected.exitCode && actual.stdoutHex === expected.stdoutHex && actual.stderrHex === expected.stderrHex;
    const selected = actual.exitCode === expected.exitCode && actual.stdoutHex === expected.stdoutHex && Boolean(actual.stderrHex) === Boolean(expected.stderrHex) && (fixture.name !== 'comm: shared stdin' || exact);
    selectedPass += Number(selected);
    exactPass += Number(exact);
    observations.push({ name: fixture.name, inputSha256: expected.caseSha256, actual, selected, exact, filesUnchanged: true });
  }
} else {
  assert.equal(mode, 'built71');
  const { Shell, createMemoryFileSystem, agentCommands, createAgentCommands, createTableTextCommands } = await import('virtual-bash');
  const { createTableTextCommands: fromSubpath } = await import('virtual-bash/commands/table-text');
  assert.equal(fromSubpath, createTableTextCommands);
  assert.deepEqual(createTableTextCommands().map(command => command.name), ['paste', 'comm', 'join']);
  const names = createAgentCommands().map(command => command.name);
  assert.equal(names.length, 56);
  assert.equal(new Set(names).size, 56);
  assert.equal(names.filter(name => name === 'cut').length, 1);
  assert.ok(!names.includes('curl') && !names.includes('safejs'));
  assert.equal(Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).dependencies ?? {}).length, 0);
  const corpus: { fixture: TableCase; inputSha256: string; oracle: { exitCode: number; stdoutHex: string; stderrHex: string } }[] = JSON.parse(readFileSync('tests/commands/table-text-stress/frozen-corpus.json', 'utf8'));
  assert.equal(corpus.length, 71);
  for (const transfer of ['pipeline', 'redirection']) {
    for (const { fixture, inputSha256, oracle: expected } of corpus) {
      assert.equal(digest(JSON.stringify(fixture)), inputSha256);
      const fs = createMemoryFileSystem();
      await fs.mkdir('/work');
      for (const [name, hex] of Object.entries(fixture.files)) await fs.writeFile(`/work/${name}`, Buffer.from(hex, 'hex'));
      await fs.writeFile('/work/input', Buffer.from(fixture.stdinHex, 'hex'));
      const shell = new Shell({ fs, cwd: '/work', env: { LC_ALL: 'C' } }).use(agentCommands());
      try {
        const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
        const invocation = [fixture.command, ...fixture.args].map(quote).join(' ');
        const result = await shell.exec(transfer === 'pipeline' ? `cat input | ${invocation}` : `${invocation} < input`, { signal: AbortSignal.timeout(5000) });
        const actual = { exitCode: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), stderrHex: Buffer.from(result.stderrBytes).toString('hex') };
        for (const [name, hex] of Object.entries(fixture.files)) assert.equal(Buffer.from(await fs.readFile(`/work/${name}`)).toString('hex'), hex);
        assert.equal(Buffer.from(await fs.readFile('/work/input')).toString('hex'), fixture.stdinHex);
        assert.deepEqual((await fs.readdir('/work')).map(entry => entry.name).sort(), [...Object.keys(fixture.files), 'input'].sort());
        const exact = actual.exitCode === expected.exitCode && actual.stdoutHex === expected.stdoutHex && actual.stderrHex === expected.stderrHex;
        const selected = actual.exitCode === expected.exitCode && actual.stdoutHex === expected.stdoutHex && Boolean(actual.stderrHex) === Boolean(expected.stderrHex) && (fixture.name !== 'comm shared original' || exact);
        selectedPass += Number(selected);
        exactPass += Number(exact);
        observations.push({ name: fixture.name, transfer, inputSha256, actual, selected, exact, filesUnchanged: true });
      } finally { await shell.dispose(); }
    }
  }
}
console.log(JSON.stringify({ mode, selectedPass, exactPass, total: observations.length, profile: 'Original stdout/status/stderr-presence policy; repaired shared-stdin additionally requires exact GNU diagnostic. Exact-row count is separate, with all raw stderr retained.', observations }, null, 2));
assert.equal(selectedPass, observations.length, 'selected GNU acceptance; semantic assertion, not loader failure');
