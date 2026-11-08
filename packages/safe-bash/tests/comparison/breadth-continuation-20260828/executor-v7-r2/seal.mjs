import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.dirname(fileURLToPath(import.meta.url)), prior = path.resolve(root, '../executor-v7-r1'), repository = path.resolve(root, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const text = value => `${JSON.stringify(value, null, 2)}\n`;
const files = new Map();
function bind(filename, expected, role = 'r2-successor-source') {
  const absolute = path.resolve(root, filename);
  if (absolute.split(path.sep).some(name => name.toLowerCase() === 'agents.md')) throw new Error('NO_INSTRUCTION_PLAINTEXT');
  const info = fs.lstatSync(absolute); if (!info.isFile() || info.isSymbolicLink()) throw new Error('NOT_REGULAR');
  const entry = { path: path.relative(root, absolute), bytes: info.size, mode: info.mode & 0o7777, sha256: hash(fs.readFileSync(absolute)), role };
  if (expected && ['bytes', 'mode', 'sha256'].some(key => expected[key] !== entry[key])) throw new Error(`OLD_INPUT_CHANGED:${filename}`);
  files.set(entry.path, entry);
}
const oldBytes = fs.readFileSync(path.join(prior, 'SEAL.json'));
if (hash(oldBytes) !== '05aa8dce295c507fd605c93aa113ba2ecd5605064dc0f6dfe3a20aa6dc6bf04d') throw new Error('OLD_SEAL_CHANGED');
const old = JSON.parse(oldBytes);
for (const entry of old.files) bind(path.resolve(prior, entry.path), entry, entry.role);
bind(path.join(prior, 'SEAL.json'), null, 'immutable-original-seal');
for (const name of ['policy-interface/REVIEW.md', 'policy-interface/UNEXECUTED-TEMPLATE.md', 'authorization-shape/REPORT.md', 'composed/REPORT.md']) bind(`../../breadth-continuation-independent-20260828/executor-v7-r1-review/${name}`, null, 'independent-findings-unchanged');
const namespace = { path: '.', entries: [], excludedDescendants: ['runs'] };
for (const name of fs.readdirSync(root).sort()) {
  if (['SEAL.json', 'INTERFACE.json', 'AUTHORIZATION-TEMPLATE.data', 'DELTA.json'].includes(name)) throw new Error('NO_OLD_RECIPE_RETRY_OR_OVERWRITE');
  const info = fs.lstatSync(path.join(root, name)); if (info.isSymbolicLink()) throw new Error('NO_SYMLINK');
  namespace.entries.push({ path: name, directory: info.isDirectory() });
  if (info.isDirectory()) { if (name !== 'runs') throw new Error('UNKNOWN_DIRECTORY'); }
  else bind(name);
}
bind('runs/.keep');
const additions = new Map();
const add = (name, value, role) => { const bytes = Buffer.from(text(value)); if (bytes.length > 262144) throw new Error('METADATA_CAP'); additions.set(name, bytes); files.set(name, { path: name, bytes: bytes.length, mode: 0o644, sha256: hash(bytes), role }); namespace.entries.push({ path: name, directory: false }); };
const delta = { schema: 'EXPLICIT_R2_DELTA', original: '230ed3c6e15617b312760367adf9ede4e5c7ff6a', oldInputsByteUnchanged: true, changed: ['authorization.mjs: closed reference/context/signed-document types; two actual metadata observations', 'contracts.mjs: explicit finite own-data role schemas', 'report.mjs: V3 exact final/authority/child reconciliation', 'body.mjs: bound authority references and shared inclusive config writer', 'records.mjs: closed multipart schema and strict shared config helpers', 'worker.mjs/synthetic-worker.mjs: readConfig and authority-observer integration', 'coordinator.mjs/production.mjs: single ordered authority-to-final transport', 'outer.mjs: same source bytes, imports now resolve affected V3 assessor'], unchanged: ['bootstrap ordering/revocation implementation', 'loader/offline/CJS/asset/source/package guards', 'OPERATION-PLAN raw bytes and phase projection', '248+8MiB/64KiB/262144 budgets', 'all historical raw failures and source closure qualifications'], scope: 'SOURCE repair plus planned affected DATA/STUB controls, not admission bypass proof' };
add('DELTA.json', delta, 'explicit-source-delta');
const iface = JSON.parse(fs.readFileSync(path.join(prior, 'INTERFACE.json')));
iface.schema = 'BREADTH_V7_R2_ADMISSION_INTERFACE';
iface.recipe.path = path.relative(repository, path.join(root, 'SEAL.json'));
iface.outerCommand.entry = files.get('launch.mjs'); iface.innerCommand.entry = files.get('coordinator.mjs');
iface.executableBindings = [...new Set([...iface.executableBindings.map(entry => entry.path), 'contracts.mjs'])].map(name => files.get(name));
iface.authorization.inputPath = `${root}/runs/ROOT_GRANT_NAMESPACE/AUTH.json`;
iface.authorization.grantRequired.outputRoot = `${root}/runs/FRESH_ROOT_RUN_ID`;
iface.authorization.grantRequired.reportProtocol = 'BOUNDED_TERMINAL_V3';
iface.authorization.exactOwnData = { envelopeKeys: ['review', 'grant'], referenceKeys: ['commit', 'path', 'sha256'], primitiveCommit: '40 lowercase hex primitive string only', primitiveHash: '64 lowercase hex primitive string only', reviewKeys: ['role', 'verdict', 'recipeSha256'], admissionGrantKeys: ['role', 'phase', 'attempts', 'runId', 'outputRoot', 'recipeSha256', 'reviewSha256', 'planSha256', 'bootstrapProfile', 'reportProtocol', 'candidate', 'packSha256', 'command'], commandKeysInOrder: ['entry', 'phase', 'runId', 'nodeArgs'], gettersInheritedRequiredExtrasMissingCoercion: 'refuse' };
iface.outputs.body = `${root}/runs/FRESH_ROOT_RUN_ID`; iface.outputs.collector = `${root}/runs/FRESH_ROOT_RUN_ID-supervision`;
delete iface.outputs.configAndStagedBytes; iface.outputs.configBytesIncludingLF = 2097151; iface.outputs.stagedBytesIncludingLF = 2097152;
iface.observerContract = { protocol: 'BOUNDED_TERMINAL_V3', authorityEvents: 2, eventKeys: ['sequence', 'kind', 'receipt'], orderedReferences: ['review', 'grant'], metadataReceiptKeys: ['role', 'ordinal', 'reference', 'pid', 'group', 'status', 'signal', 'errorCode', 'stdoutBytes', 'stdoutSha256', 'stderrBase64', 'reaped'], finalReportKeys: ['mode', 'runId', 'status', 'unsafe', 'result', 'children', 'allChildrenReaped'], finalChildren: 'integer equals terminal array and accounting and authenticated actual ledger/planned operations', childRoles: 'normal natural0; C09-status intentional7; C09-deadline completed TERM negative; all exact typed exit/close/reaping', noCallerAuthenticationClaim: true };
iface.composition = { previousIndependent: '30/30 plus1 supplement preserved;7of8 A02 defect;F08 EPERM observation-qualified', previousAuthor: '31/33 original preserved; r1 separate correction preserved', currentScope: 'Affected DATA/own-stub controls only; whole production authority/worker chain remains unexecuted', full248Plus8MiBBoundaries: 'STATIC_ONLY' };
add('INTERFACE.json', iface, 'concrete-new-successor-interface');
add('AUTHORIZATION-TEMPLATE.data', { issued: false, warning: 'INERT TEMPLATE NOT AUTH_JSON OR ROOT GRANT. Placeholder strings fail schema/hash verification. Fresh root message and committed positive focused review required.', authEnvelope: { review: { commit: '<40HEX_FRESH_REVIEW_COMMIT>', path: '<COMMITTED_POSITIVE_REVIEW_PATH>', sha256: '<64HEX_REVIEW_SHA256>' }, grant: { commit: '<40HEX_FRESH_ROOT_GRANT_COMMIT>', path: '<COMMITTED_GRANT_PATH>', sha256: '<64HEX_GRANT_SHA256>' } }, reviewDocument: iface.authorization.reviewRequired, grantDocument: iface.authorization.grantRequired, commandShape: iface.outerCommand, schema: iface.authorization.exactOwnData, oldTokensReusable: false }, 'inert-complete-authorization-template');
namespace.entries.push({ path: 'SEAL.json', directory: false }); namespace.entries.sort((left, right) => left.path.localeCompare(right.path));
const seal = { schema: 'BREADTH_R2_PREEXECUTION_SEAL', date: '2026-08-28', permission: 'ONE_AFFECTED_DATA_STUB_RUN_ONLY', originalSealSha256: hash(oldBytes), interfaceSha256: files.get('INTERFACE.json').sha256, namespaces: [namespace, ...old.namespaces.map(entry => ({ ...entry, path: path.relative(root, path.resolve(prior, entry.path)) }))], files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path)), wholeHistoricalImportClosureClaim: false };
const sealBytes = Buffer.from(text(seal)); if (sealBytes.length > 262144) throw new Error('SEAL_CAP'); additions.set('SEAL.json', sealBytes);
const patch = ['*** Begin Patch']; for (const [name, bytes] of additions) patch.push(`*** Add File: ${path.join(root, name)}`, ...bytes.toString().trimEnd().split('\n').map(line => `+${line}`)); patch.push('*** End Patch'); process.stdout.write(`${patch.join('\n')}\n`);
