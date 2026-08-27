import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const base = '/tmp/safe-bash-stream-verifier-20260827-A';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cases = JSON.parse(readFileSync(join(base, 'cases.json'), 'utf8'));
const snapshots = readdirSync(base).filter(name => name.startsWith('snapshot-') && existsSync(join(base, name, 'SNAPSHOT.json')));
const runs = [];
for (const snapshot of snapshots) {
  const directory = join(base, snapshot);
  const manifest = JSON.parse(readFileSync(join(directory, 'SNAPSHOT.json'), 'utf8'));
  for (const run of readdirSync(directory).filter(name => name.startsWith('run-'))) {
    const path = join(directory, run);
    const result = JSON.parse(readFileSync(join(path, 'result.json'), 'utf8'));
    const tap = readFileSync(join(path, 'stdout.tap'), 'utf8');
    const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped'].map(name => [name, Number(tap.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? Number.NaN)]));
    const outcomes = cases.filter(item => existsSync(join(path, `${item.id}.json`))).map(item => {
      const capture = JSON.parse(readFileSync(join(path, `${item.id}.json`), 'utf8'));
      const stderr = Buffer.from(capture.actual.stderrHex, 'hex').toString();
      const status = capture.expected.exitCode === capture.actual.exitCode;
      const stdout = capture.expected.stdoutHex === capture.actual.stdoutHex;
      const exactStderr = capture.expected.stderrHex === null ? null : capture.expected.stderrHex === capture.actual.stderrHex;
      const diagnostics = capture.expected.exitCode === 0 ? stderr === '' : new RegExp(`^${item.command}:`, 'm').test(stderr) && stderr.trim() !== '' && (!item.diagnosticPath || stderr.includes(item.diagnosticPath) && /no such file/i.test(stderr));
      return { id: item.id, command: item.command, status, stdout, exactStderr, selected: status && stdout && diagnostics };
    });
    runs.push({ snapshot, run, result, counts, sourceManifestHash: hash(Object.entries(manifest.sourceHashes).filter(([name]) => name.startsWith('commands/stream-inspection/')).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([name, digest]) => `src/${name}\0${digest}\n`).join('')), fixtureMetrics: outcomes.length ? { count: outcomes.length, selected: outcomes.filter(item => item.selected).length, status: outcomes.filter(item => item.status).length, stdout: outcomes.filter(item => item.stdout).length, exactStderr: outcomes.filter(item => item.exactStderr === true).length, unspecifiedStderr: outcomes.filter(item => item.exactStderr === null).length, allThreeExact: outcomes.filter(item => item.status && item.stdout && item.exactStderr === true).length, failures: outcomes.filter(item => !item.selected).map(item => item.id) } : null });
  }
}
const report = { generatedAt: new Date().toISOString(), originalFrozenHashes: Object.fromEntries(['cases.json', 'native-controls.json', 'intent.json'].map(name => [name, hash(readFileSync(join(base, name)))])), distinctFrozenFixtures: 85, separateContractGroups: 39, distinctReusedBufferGroupsWithinContracts: 8, separateAppleControls: 48, newGNUStringsCaptures: 20, originalGNUCoreutilsCaptures: 65, actualTestCalls: runs.reduce((sum, run) => sum + run.counts.tests, 0), runs };
writeFileSync(join(base, 'SUMMARY.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
