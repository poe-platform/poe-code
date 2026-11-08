import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readDocument } from './records.mjs';
import { writeClaim } from './evidence.mjs';
import { installLoader } from './loader.mjs';
import { createQueryWindow, importWithWindow, closeQueryWindow } from './bootstrap.mjs';
import { transport } from './transport.mjs';
import { requireThat, errorRecord } from '../executor-v4/safety.mjs';

const writer = transport();
let loader;
let window;
let factoryCalls = 0;
let nativeDelegations = 0;
let observation;
let primaryPresent = false;
let primary;
let imported;
try {
  const filename = path.resolve(process.argv[2]);
  const config = readDocument(path.dirname(filename), path.basename(filename), process.argv[3], 2 * 1024 * 1024 - 1);
  requireThat(config.authorization?.syntheticOnly === true && config.kind === 'probe' && config.operationId === 'stub-probe' && config.launchOrdinal === 1, 'STUB_ONLY', null);
  writeClaim(config, config.authorization.operation, config.authorization.recipe, path.dirname(filename));
  loader = installLoader(config.view, row => writer.emit(row));
  const denying = () => { nativeDelegations++; throw new Error('NO_NATIVE_DELEGATION_ALLOWED'); };
  const host = { getBuiltinModule: denying };
  window = createQueryWindow(row => writer.emit(row));
  observation = await importWithWindow({ host, window, load: async () => {
    imported = await import(pathToFileURL(path.join(config.view.root, 'bootstrap-stub.mjs')).href);
    return imported.consume(host, config.authorization.scenario === 'caught-gate');
  } });
  requireThat(host.getBuiltinModule === denying && window.snapshot().revoked, 'STUB_RESTORE_BEFORE_FACTORY', null);
  factoryCalls++;
  if (config.authorization.scenario === 'late-caught-gate') imported.later();
} catch (error) { primaryPresent = true; primary = error; process.exitCode = 1; }
finally {
  window?.revoke();
  try { closeQueryWindow(window); } catch (error) { if (!primaryPresent) { primaryPresent = true; primary = error; } process.exitCode = 1; }
  const loads = loader?.loaded ?? [];
  try { loader?.close(); } catch (error) { if (!primaryPresent) { primaryPresent = true; primary = error; } process.exitCode = 1; }
  writer.emit({ kind: 'final', report: { explicitlySyntheticNoEngines: true, exportEvaluation: !primaryPresent, observation, factoryCalls, nativeDelegations, bootstrap: window?.snapshot() ?? null, loads, ...(primaryPresent ? { primaryPresent, primaryUndefined: primary === undefined, fatal: errorRecord(primary) } : {}) } });
}
