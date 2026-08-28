import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installLoader } from './loader.mjs';
import { installOffline } from './offline.mjs';
import { transport } from './transport.mjs';
import { errorRecord, requireThat } from './safety.mjs';
const writer = transport();
const config = JSON.parse(fs.readFileSync(process.argv[2]));
let loader;
let offline;
try {
  if (config.mode === 'leak') {
    const timer = setInterval(() => {}, 1000);
    process.once('SIGTERM', () => { clearInterval(timer); writer.emit({ kind: 'final', report: { timerRetired: true, intentionalNegative: true } }); });
  } else if (config.mode === 'nonzero') {
    writer.emit({ kind: 'final', report: { intentionalNegative: true } }); process.exitCode = 7;
  } else {
    loader = installLoader(config.view, value => writer.emit(value));
    if (config.mode === 'offline' || config.mode === 'require') offline = installOffline(config.view, value => writer.emit(value));
    let report;
    if (config.mode === 'offline') {
      try { await fetch('https://invalid.invalid'); } catch (error) { report = { caught: errorRecord(error) }; }
      requireThat(report?.caught?.code === 'OFFLINE_DENIED', 'OFFLINE_CONTROL', report);
      report.denials = [];
      for (const action of [() => fs.readFileSync('/unbound-source-never-opened'), () => fs.writeFileSync('/unbound-write-never-created', ''), () => process.getBuiltinModule('fs'), () => WebAssembly.compile(new Uint8Array())]) {
        try { await action(); report.denials.push('UNEXPECTED_SUCCESS'); }
        catch (error) { report.denials.push(error.code); }
      }
      const processes = await import('node:child_process');
      try { processes.spawn('never-executed'); report.denials.push('UNEXPECTED_SPAWN'); } catch (error) { report.denials.push(error.code); }
      const workerThreads = await import('node:worker_threads');
      try { new workerThreads.Worker('never-created'); report.denials.push('UNEXPECTED_WORKER'); } catch (error) { report.denials.push(error.code); }
      requireThat(report.denials.length === 6 && report.denials.every(code => ['UNBOUND_ASSET', 'OFFLINE_DENIED'].includes(code)), 'OFFLINE_NEGATIVE', report.denials);
      report.resources = offline.receipt();
    } else {
      const module = await import(pathToFileURL(path.join(config.view.root, config.entry ?? 'loaded.mjs')).href);
      report = { evaluated: true, observation: module.execute ? module.execute() : module.default, sourceCount: loader.loaded.length };
    }
    offline?.close(); loader.close();
    writer.emit({ kind: 'final', report });
  }
} catch (error) {
  offline?.close(); loader?.close();
  writer.emit({ kind: 'final', report: { caught: errorRecord(error), evaluated: false } });
}
