import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT, check, Hold, fingerprint, inventory, regular } from './core.mjs';
import { qualify } from './qualify.mjs';
import { loadBinding, pinnedDocuments, verifySeal, readHandoff } from './protocol.mjs';
import { casesFrom } from './executor.mjs';
import { admit } from './admission.mjs';

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'qualify-synthetic') {
    check(args.length === 0, 'ARGUMENTS');
    await qualify();
  } else if (command === 'verify-recipe') {
    await verifySeal();
    const binding = await loadBinding();
    const documents = await pinnedDocuments(binding);
    const rows = casesFrom(documents);
    process.stdout.write(`recipe verified; bound expectations=${rows.length}; product=0; native=0\n`);
  } else if (command === 'verify-evidence') {
    await verifySeal();
    const directory = path.join(ROOT, 'synthetic-evidence');
    const manifest = JSON.parse(await readFile(path.join(directory, 'EVIDENCE-MANIFEST.json'), 'utf8'));
    for (const entry of manifest.files) {
      const actual = await fingerprint(await regular(directory, entry.path), entry.bytes);
      check(actual.bytes === entry.bytes && actual.mode === entry.mode && actual.sha256 === entry.sha256, 'EVIDENCE_IDENTITY', entry.path);
    }
    const actual = (await inventory(directory)).filter(entry => !entry.directory && entry.path !== 'EVIDENCE-MANIFEST.json').map(entry => entry.path).sort();
    check(JSON.stringify(actual) === JSON.stringify(manifest.files.map(entry => entry.path).sort()), 'EVIDENCE_NEW_ENTRY');
    const actualDirectories = (await inventory(directory)).filter(entry => entry.directory).map(entry => entry.path).sort();
    check(JSON.stringify(actualDirectories) === JSON.stringify(manifest.directories), 'EVIDENCE_NEW_DIRECTORY');
    process.stdout.write(`evidence verified; files=${manifest.files.length}; append-aware=yes\n`);
  } else if (command === 'admit-candidate') {
    await verifySeal();
    const handoff = args.length ? await readHandoff(args[0], Number(args[1]), args[2]) : null;
    const admission = await admit(handoff);
    process.stdout.write(`${JSON.stringify(admission)}\n`);
  } else if (command === 'run-candidate') {
    await verifySeal();
    if (!args.length) await admit(null);
    throw new Hold('PRODUCT_ROUTE_HELD', 'actual API, authenticated build/pack closure, public lifecycle adapter, diagnostics and resource ledgers require root-routed candidate review; this preparatory seal cannot authorize execution');
  } else throw new Hold('USAGE', 'verify-recipe | qualify-synthetic | verify-evidence | admit-candidate [handoff bytes sha256] | run-candidate');
} catch (error) {
  process.stderr.write(`${error instanceof Hold ? error.code : error.name}: ${String(error.message).slice(0, 1024)}\n`);
  process.exitCode = error instanceof Hold ? 2 : 1;
}
