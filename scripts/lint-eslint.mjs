import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { BOUNDARY_RECEIPTS, createLintInputGuard, createLintSelection, withLintFailureDiagnostics } from './lint-input-guard.mjs';
export { createLintSelection } from './lint-input-guard.mjs';

const require = createRequire(import.meta.url);
const eslintPackage = require.resolve('eslint/package.json');

export function parseLintArguments(argv) {
  const args = [...argv];
  for (let index = 0; index < args.length - 1; index++) {
    if (args[index] === '--max-warnings' && args[index + 1] === '-1') args.splice(index, 2, '--max-warnings=-1');
  }
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: { format: { type: 'string', short: 'f', default: 'stylish' }, 'max-warnings': { type: 'string', default: '-1' } } });
  assert.ok(values.format === 'stylish' || values.format === 'json', 'only built-in stylish/json formatters are supported');
  const maximum = values['max-warnings'];
  assert.ok(maximum === '-1' || (maximum.length > 0 && [...maximum].every(character => '0123456789'.includes(character))), 'invalid max-warnings');
  const maxWarnings = Number(maximum);
  assert.ok(Number.isSafeInteger(maxWarnings), 'invalid max-warnings');
  return Object.freeze({ format: values.format, maxWarnings });
}

export async function lintRoot({ guard, config, receiptBinding = BOUNDARY_RECEIPTS, maxWarnings = -1 }) {
  const results = [];
  const gaps = [];
  const receiptResults = [];
  const directoryPins = [];
  const scope = { configured: 0, linted: 0, ignored: 0, unconfigured: 0, ignoredDirectories: 0, heldExcluded: 0 };
  const pending = [];
  let activeDirectory = null;
  let nextEntry = 0;
  let selection;
  let failure = null;
  let activePath = '';
  let traversalFinished = false;
  function deny(path, error) {
    gaps.push({ path, message: error instanceof Error ? error.message : String(error), descendantsUnknown: true });
  }
  try {
    assert.ok(Number.isSafeInteger(maxWarnings) && maxWarnings >= -1, 'invalid max-warnings');
    selection = createLintSelection(guard.root, config);
    guard.begin();
    const receipts = guard.loadReceipts(receiptBinding);
    const byPath = new Map(receipts.map(record => [record.path, record]));
    for (const record of receipts) {
      activePath = record.path;
      receiptResults.push(await guard.verifyReceipt(record, selection));
    }
    pending.push('');
    while (pending.length) {
      const path = pending.pop();
      activePath = path;
      let directory;
      try {
        directory = guard.directory(path, true);
        if (Object.hasOwn(directory, 'failure')) {
          activeDirectory = { path, entries: directory.entries };
          nextEntry = 0;
          activePath = directory.failurePath;
          throw directory.failure;
        }
      } catch (error) {
        if (guard.snapshot().failed) throw error;
        deny(path, error);
        activeDirectory = null;
        continue;
      }
      directoryPins.push({ path, identity: directory.identity, entriesSha256: directory.entriesSha256, entries: directory.entries.length });
      activeDirectory = { path, entries: directory.entries };
      nextEntry = 0;
      for (const name of directory.entries) {
        nextEntry++;
        const child = path === '' ? name : path + '/' + name;
        activePath = child;
        const absolute = guard.root + '/' + child;
        if (byPath.has(child)) {
          await guard.verifyReceipt(byPath.get(child), selection);
          continue;
        }
        let entry;
        try {
          if (guard.isHeld(child)) {
            assert.ok(selection.directoryIgnored(absolute) && await selection.classify(absolute) !== 'configured', 'held boundary is not globally excluded');
            scope.heldExcluded++;
            continue;
          }
          entry = directory.inspections.get(name);
          assert.ok(entry, 'missing directory entry inspection');
          if (Object.hasOwn(entry, 'error')) throw entry.error;
        } catch (error) {
          if (guard.snapshot().failed) throw error;
          deny(child, error);
          continue;
        }
        if (entry.kind === 'directory') {
          if (selection.directoryIgnored(absolute)) scope.ignoredDirectories++;
          else pending.push(child);
          continue;
        }
        const classification = await selection.classify(absolute);
        if (classification !== 'configured') {
          scope[classification]++;
          continue;
        }
        scope.configured++;
        const bytes = guard.read(child, 'subject');
        const linted = await selection.eslint.lintText(bytes.toString('utf8'), { filePath: absolute, warnIgnored: false });
        assert.ok(Array.isArray(linted) && linted.length === 1 && linted[0].filePath === absolute, 'lintText subject identity changed');
        results.push(linted[0]);
        scope.linted++;
      }
      activeDirectory = null;
    }
    traversalFinished = true;
  } catch (error) {
    failure = { path: activePath, message: error instanceof Error ? error.message : String(error) };
  }
  results.sort((left, right) => left.filePath < right.filePath ? -1 : left.filePath > right.filePath ? 1 : 0);
  gaps.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  directoryPins.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const errorCount = results.reduce((count, result) => count + result.errorCount, 0);
  const warningCount = results.reduce((count, result) => count + result.warningCount, 0);
  const complete = traversalFinished && failure === null && gaps.length === 0;
  const tooManyWarnings = maxWarnings >= 0 && warningCount > maxWarnings;
  const unprocessed = { directories: [...pending], entries: activeDirectory ? activeDirectory.entries.slice(nextEntry).map(name => activeDirectory.path === '' ? name : activeDirectory.path + '/' + name) : [], descendantsUnknown: !traversalFinished };
  return { eslint: selection?.eslint, results, gaps, receipts: receiptResults, directoryPins, unprocessed, scope, counters: guard.snapshot(), complete, traversalFinished, failure, errorCount, warningCount, tooManyWarnings, exitCode: complete ? (errorCount > 0 || tooManyWarnings ? 1 : 0) : 2 };
}

export async function printLintResult(result, options, stdout, stderr) {
  assert.ok(options.format === 'stylish' || options.format === 'json', 'unsupported formatter');
  if (result.eslint) {
    const formatterPath = dirname(eslintPackage) + '/lib/cli-engine/formatters/' + options.format + '.js';
    const formatter = await result.eslint.loadFormatter(formatterPath);
    const metadata = result.tooManyWarnings ? { maxWarningsExceeded: { maxWarnings: options.maxWarnings, foundWarnings: result.warningCount } } : {};
    const text = await formatter.format(result.results, metadata);
    if (text) stdout.write(text + '\n');
  }
  if (result.tooManyWarnings && result.errorCount === 0) stderr.write('ESLint found too many warnings (maximum: ' + options.maxWarnings + ').\n');
  stderr.write(JSON.stringify({ complete: result.complete, exitCode: result.exitCode, errorCount: result.errorCount, warningCount: result.warningCount, scope: result.scope, counters: result.counters, bootstrapCounters: result.bootstrapCounters, receipts: result.receipts, gaps: result.gaps, failure: result.failure, directoryPins: result.directoryPins, unprocessed: result.unprocessed }) + '\n');
}

export async function main({ argv = process.argv.slice(2), root = fileURLToPath(new URL('../', import.meta.url)).slice(0, -1), fileSystem = fs, loadConfig, stdout = process.stdout, stderr = process.stderr } = {}) {
  return withLintFailureDiagnostics(async initializationFailure => {
    try {
      const options = parseLintArguments(argv);
      const bootstrap = createLintInputGuard({ root, fileSystem, bootstrap: true });
      const packageBytes = bootstrap.read('package.json', 'configuration');
      assert.equal(JSON.parse(packageBytes.toString('utf8')).scripts?.['lint:eslint'], 'node scripts/lint-eslint.mjs', 'Phase 2 root lint wiring is not installed');
      const configBytes = bootstrap.read('eslint.config.js', 'configuration');
      const module = await (loadConfig ? loadConfig() : import(pathToFileURL(root + '/eslint.config.js').href));
      assert.ok(module.lintInputGuard && module.lintInputGuard.root === root, 'guarded configuration context required');
      const guard = module.lintInputGuard;
      assert.ok(!guard.snapshot().used, 'guard already used');
      assert.ok(guard.read('package.json', 'configuration').equals(packageBytes), 'root command changed during configuration');
      assert.ok(guard.read('eslint.config.js', 'configuration').equals(configBytes), 'root configuration changed during loading');
      const rootNames = guard.directory('').entries;
      assert.ok(!rootNames.includes('eslint-suppressions.json'), 'bulk suppressions require separate compatibility review');
      const result = await lintRoot({ guard, config: module.default, maxWarnings: options.maxWarnings });
      result.bootstrapCounters = bootstrap.snapshot();
      await printLintResult(result, options, stdout, stderr);
      return result.exitCode;
    } catch (error) {
      stderr.write(JSON.stringify({ complete: false, exitCode: 2, initializationFailure: initializationFailure(), error: error instanceof Error ? error.message : String(error) }) + '\n');
      return 2;
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main();
