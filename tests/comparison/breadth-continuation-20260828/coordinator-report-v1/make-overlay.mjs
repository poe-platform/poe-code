import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const bindings = JSON.parse(fs.readFileSync(path.join(directory, '../executor-v6/runs/grant-admission-v6-01/INPUTS-PRE.json'))).inputs;
const rows = [];
function transform(name, edits) {
  const filename = path.resolve(directory, `../executor-v6/${name}`);
  const relative = path.relative(repository, filename);
  const before = fs.readFileSync(filename, 'utf8');
  assert.equal(digest(before), bindings.find(row => row.path === relative).sha256);
  let after = before;
  for (const edit of edits) { assert.equal(after.split(edit.before).length - 1, 1); after = after.replace(edit.before, edit.after); }
  rows.push({ path: relative, beforeSha256: digest(before), afterSha256: digest(after), edits });
}
const coordinator = fs.readFileSync(path.resolve(directory, '../executor-v6/coordinator.mjs'), 'utf8');
const saveStart = coordinator.indexOf('  let written = 0;');
const saveEnd = coordinator.indexOf("  save('AUTHORIZATION.json'", saveStart);
const tailStart = coordinator.indexOf('  output.evidenceBytesBeforeFinal = written;');
transform('coordinator.mjs', [
  { before: "import fs from 'node:fs';", after: "import fs from 'node:fs';\nimport { createStore, readDocument, limits } from '../coordinator-report-v1/records.mjs';\nimport { publish } from '../coordinator-report-v1/publisher.mjs';" },
  { before: coordinator.slice(saveStart, saveEnd), after: "  const store = createStore(runRoot);\n  const save = (name, value) => store.save(name, value, name === 'STAGED.json' || /^child-\\d{3}\\.json$/.test(name) ? 2 * 1024 * 1024 : limits.document).sha256;\n" },
  { before: "      const bytes = fs.readFileSync(admissionFile);\n      requireThat(hash(bytes) === approved.acceptedAdmission.sha256, 'ADMISSION_HASH', admissionFile);\n      const admission = JSON.parse(bytes);", after: "      const admission = readDocument(path.dirname(admissionFile), path.basename(admissionFile), approved.acceptedAdmission.sha256);" },
  { before: "      staged = parseStage(fs.readFileSync(path.join(path.dirname(admissionFile), 'STAGED.json')), admission.stagedSha256);", after: "      staged = readDocument(path.dirname(admissionFile), 'STAGED.json', admission.stagedSha256, 2 * 1024 * 1024);" },
  { before: coordinator.slice(tailStart, coordinator.lastIndexOf('\n}')), after: "  output.evidenceBytesBeforeFinal = store.state().accounted;\n  const publication = publish({ output, ledger, store, inheritedExitCode: process.exitCode ?? 0 });\n  process.exitCode = publication.exitCode;" },
]);
transform('worker.mjs', [
  { before: "import fs from 'node:fs';", after: "import fs from 'node:fs';\nimport { readDocument } from '../coordinator-report-v1/records.mjs';" },
  { before: "  const configBytes = fs.readFileSync(configPath);\n  requireThat(configBytes.length < 2 * 1024 * 1024 && hash(configBytes) === process.argv[3], 'CONFIG_BINDING', process.argv[2]);\n  const config = JSON.parse(configBytes);", after: "  const config = readDocument(path.dirname(configPath), path.basename(configPath), process.argv[3], 2 * 1024 * 1024 - 1);" },
]);
transform('synthetic-worker.mjs', [
  { before: "import fs from 'node:fs';", after: "import fs from 'node:fs';\nimport { readDocument } from '../coordinator-report-v1/records.mjs';" },
  { before: "  const bytes = fs.readFileSync(configPath);\n  requireThat(bytes.length <= 2 * 1024 * 1024 && hash(bytes) === process.argv[3], 'CONFIG_BINDING', configPath);\n  config = JSON.parse(bytes);", after: "  config = readDocument(path.dirname(configPath), path.basename(configPath), process.argv[3], 2 * 1024 * 1024);" },
]);
const overlay = { schema: 'REPORT_ONLY_EXACT_SOURCE_OVERLAY_V1', baseRecipeCommit: '931b8e07114b8f69fa50f35e798a7a619f578cdb', appliesToFrozenFiles: false, realAdmissionAuthorized: false, sourceFilesChanged: 3, nativeBuiltinPolicyChanged: false, referencesNowBind: 'Physical descriptor/record bytes; all logical JSON parts separately authenticated before parse', rows };
const content = `${JSON.stringify(overlay, null, 2)}\n`;
const patch = `*** Begin Patch\n*** Add File: ${path.join(directory, 'OVERLAY.json')}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
const applied = spawnSync('apply_patch', [], { input: patch, encoding: 'utf8' });
assert.equal(applied.status, 0, applied.stderr);
console.log(applied.stdout.trim());
console.log(JSON.stringify(rows.map(row => ({ path: row.path, before: row.beforeSha256, after: row.afterSha256, edits: row.edits.length }))));
