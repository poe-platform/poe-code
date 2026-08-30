import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative } from 'node:path';

const root = '/Users/kjopek/Workspace/safe-bash';
if (process.cwd() !== root) throw new Error('Wrong workspace');
const directory = 'benchmarks/reports/baseline-only-20260827/coverage-setup';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const file = path => ({ path, bytes: statSync(path).size, sha256: hash(readFileSync(path)) });
const publish = (name, data, prior) => {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  const body = prior === undefined ? `*** Add File: ${directory}/${name}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}` : `*** Update File: ${directory}/${name}\n@@\n${prior.trimEnd().split('\n').map(line => `-${line}`).join('\n')}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}`;
  execFileSync('apply_patch', [`*** Begin Patch\n${body}\n*** End Patch\n`], { stdio: 'inherit' });
};
const prior = readFileSync(`${directory}/inventory.json`, 'utf8');
const inventory = JSON.parse(prior);
const trace = record => {
  if (!record) return;
  let path = resolve(dirname(record.bundlePath), record.lazyImport);
  let exported = record.export;
  record.implementationChain = [];
  for (let depth = 0; depth < 4; depth++) {
    const text = readFileSync(path, 'utf8');
    record.implementationChain.push({ ...file(relative(root, path)), exported });
    const local = text.match(new RegExp(`([\\w$]+) as ${exported}(?:[,}])`))?.[1] ?? exported;
    let target;
    for (const match of text.matchAll(/import\{([^}]+)\}from"([^"]+)"/g)) {
      const binding = match[1].split(',').map(item => item.trim().split(' as ')).find(parts => (parts[1] ?? parts[0]) === local);
      if (binding) { target = { path: resolve(dirname(path), match[2]), exported: binding[0] }; break; }
    }
    if (!target) break;
    path = target.path;
    exported = target.exported;
  }
};
for (const row of inventory.rows) trace(row.currentBaseline.registry);
for (const row of inventory.addedOptional) trace(row.baseline.registry);
const wait = inventory.rows.find(row => row.name === 'wait');
wait.currentBaseline.kernel.handler = 'inline-return-empty-success';
wait.currentBaseline.kernel.handlerByteOffset = null;
publish('inventory.json', inventory, prior);

const nativePath = 'benchmarks/reports/expanded-20260827/native-scratch-aligned/native.json';
const native = JSON.parse(readFileSync(nativePath, 'utf8'));
const existing = Object.entries(native.toolIdentities).map(([name, prior]) => ({ name, historical: prior, available: existsSync(prior.executable), current: existsSync(prior.executable) ? file(prior.executable) : null }));
const coreDirectory = dirname(native.toolIdentities.stat.executable);
const possible = ['date', 'du', 'expand', 'expr', 'fold', 'nl', 'printenv', 'seq', 'sleep', 'split', 'strings', 'tac', 'timeout', 'unexpand', 'whoami'].map(name => ({ name, candidate: `${coreDirectory}/${name}`, available: existsSync(`${coreDirectory}/${name}`), current: existsSync(`${coreDirectory}/${name}`) ? file(`${coreDirectory}/${name}`) : null }));
publish('native-and-helper-before.json', { capturedAt: new Date().toISOString(), metadataOnly: true, casesExecuted: 0, input: file(nativePath), historicalProfile: native.primaryProfile, existing, additionalCandidatePaths: possible, aliases: { egrep: 'Existing grep -E is a candidate oracle only; preserve literal egrep launcher validation', fgrep: 'Existing grep -F is a candidate oracle only; preserve literal fgrep launcher validation' }, unavailableFromExistingHarness: ['column', 'file', 'rev', 'tree', 'sqlite3', 'xan', 'yq', 'html-to-markdown', 'js-exec', 'python', 'python3', 'time'], unavailableMeaning: 'Not supplied by existing harness, not proof absent on machine. No broad host search/install; native profile must be explicitly validated by future executor.', systemBash: { ...file('/bin/bash'), version: 'GNU bash, version 3.2.57(1)-release (arm64-apple-darwin25)' }, missingAttempt: { path: '/opt/homebrew/bin/bash', reason: 'ENOENT; no installation or retry' }, helperCommands: ['No prepareNative() call: it creates fixture launchers and runs tools.', 'Only /bin/bash --version metadata query and constructor/definition inventory occurred.'] });
