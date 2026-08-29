import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateBinding, validateTemplate, assertUnused } from './binding-checks.mjs';
import { own } from './owner-schema-helper.mjs';
import { qualifyHostEnvironment } from './host-environment.mjs';
const home = path.dirname(fileURLToPath(import.meta.url));
const read = (file, cap = 262144) => { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.size > cap) throw Error('DATA_READ_BOUND'); return fs.readFileSync(file, 'utf8'); };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sealText = read(path.join(home, 'REPAIR-SEAL.json'));
if (digest(sealText) !== process.argv[2]) throw Error('REPAIR_SEAL_HASH');
const seal = JSON.parse(sealText);
const authenticate = () => { for (const expected of seal.inputs) { const stat = fs.lstatSync(expected.path); if (!stat.isFile() || stat.size !== expected.bytes || (stat.mode & 511) !== expected.mode) throw Error('INPUT_METADATA'); const descriptor = fs.openSync(expected.path, 'r'); const hash = crypto.createHash('sha256'); const buffer = Buffer.alloc(65536); try { for (;;) { const count = fs.readSync(descriptor, buffer, 0, buffer.length, null); if (!count) break; hash.update(buffer.subarray(0, count)); } } finally { fs.closeSync(descriptor); } if (hash.digest('hex') !== expected.sha256) throw Error('INPUT_HASH'); } };
authenticate();
const literal = JSON.parse(read(path.join(home, 'LITERAL-MAP.json')));
const plan = JSON.parse(read(path.join(home, 'DATA-PLAN.json')));
const newHome = literal.newHome; const oldHome = literal.oldHome; const executor = path.resolve(newHome, '../../..');
const instance = { owner: read(path.join(newHome, 'owner.mjs')), capture: read(path.join(newHome, 'capture.mjs')), oldOwner: read(path.join(oldHome, 'owner.mjs')), oldCapture: read(path.join(oldHome, 'capture.mjs')), home: newHome, expectedHome: newHome, runId: 'admission-20260829-v7r3-02', authPath: path.resolve(newHome, '../activation/AUTH.json'), grantPath: path.resolve(newHome, '../activation/ROOT-GRANT.json'), capturePath: path.join(newHome, 'actual-capture'), outputRoot: path.join(executor, 'runs', 'admission-20260829-v7r3-02'), executor };
const grant = JSON.parse(read(path.join(home, 'INACTIVE-ROOT-GRANT.TEMPLATE.json'))).exactThirteenFieldPayload;
const auth = JSON.parse(read(path.join(home, 'INACTIVE-AUTH.TEMPLATE.json'))).exactEnvelopeShape;
const expected = { grant: structuredClone(grant), auth: structuredClone(auth) };
const environment = { platform: 'darwin', uid: 501, keys: ['__CF_USER_TEXT_ENCODING'], value: '0x1F5:0x0:0x0' };
const namespaces = [instance.outputRoot, instance.outputRoot + '-supervision', path.resolve(newHome, '../activation'), path.resolve(newHome, '../activation/admin-capture'), instance.capturePath];
const exists = file => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const check = (condition, label) => { if (!condition) throw Error(label); };
const reject = (action, code) => { let caught = false; try { action(); } catch (error) { caught = true; check(error.message === code || error.code === code, 'WRONG_REJECTION:' + String(error)); } check(caught, 'MISSING_REJECTION'); };
const jobs = [
  () => validateBinding(instance),
  () => reject(() => validateBinding({ ...instance, owner: instance.oldOwner }), 'INSTANCE_SOURCE_DELTA'),
  () => reject(() => validateBinding({ ...instance, owner: instance.owner + '\n' }), 'INSTANCE_SOURCE_DELTA'),
  () => reject(() => validateBinding({ ...instance, capture: instance.capture + '\n' }), 'INSTANCE_SOURCE_DELTA'),
  () => reject(() => validateBinding({ ...instance, authPath: path.resolve(oldHome, '../activation/AUTH.json') }), 'INSTANCE_ROUTE'),
  () => reject(() => validateBinding({ ...instance, capturePath: path.join(oldHome, 'actual-capture') }), 'INSTANCE_ROUTE'),
  () => reject(() => validateBinding({ ...instance, home: oldHome }), 'INSTANCE_ROUTE'),
  () => reject(() => own({ expected: 1, extra: 2 }, ['expected']), 'OUTER_SCHEMA_KEYS'),
  () => { let invoked = 0; const value = {}; Object.defineProperty(value, 'expected', { enumerable: true, get() { invoked++; return 1; } }); reject(() => own(value, ['expected']), 'OUTER_SCHEMA_KEYS'); check(invoked === 0, 'GETTER_EXECUTED'); },
  () => reject(() => own(Object.create({ expected: 1 }), ['expected']), 'OUTER_SCHEMA_KEYS'),
  () => { check(Object.keys(grant).length === 13 && grant.runId === instance.runId && grant.outputRoot === instance.outputRoot && auth.grant.commit === 'UNASSIGNED_FRESH_ROOT_GRANT_COMMIT_REQUIRED', 'INACTIVE_BINDING'); validateTemplate(grant, auth, expected); },
  () => reject(() => validateTemplate({ ...grant, extra: true }, auth, expected), 'OUTER_SCHEMA_KEYS'),
  () => { const wrong = structuredClone(grant); wrong.command.runId = 'admission-20260829-v7r3-01'; reject(() => validateTemplate(wrong, auth, expected), 'INACTIVE_TEMPLATE_VALUE'); },
  () => reject(() => validateTemplate({ ...grant, role: ['root'] }, auth, expected), 'INACTIVE_TEMPLATE_VALUE'),
  () => { const wrong = structuredClone(auth); wrong.review.commit = '0'.repeat(40); reject(() => validateTemplate(grant, wrong, expected), 'INACTIVE_TEMPLATE_VALUE'); },
  () => assertUnused(namespaces, exists),
  () => reject(() => assertUnused(namespaces, file => file === instance.capturePath), 'INSTANCE_NAMESPACE_USED'),
  () => qualifyHostEnvironment(environment),
  () => reject(() => qualifyHostEnvironment({ ...environment, keys: [...environment.keys, 'EXTRA'] }), 'HOST_ENV_PROFILE'),
  () => reject(() => qualifyHostEnvironment({ ...environment, value: '0x1F5:0x0:0x1' }), 'HOST_ENV_PROFILE'),
  () => reject(() => qualifyHostEnvironment({ ...environment, uid: 502 }), 'HOST_ENV_PROFILE'),
  () => { let invoked = 0; const value = { ...environment }; Object.defineProperty(value, 'value', { enumerable: true, get() { invoked++; return environment.value; } }); reject(() => qualifyHostEnvironment(value), 'HOST_ENV_SCHEMA'); check(invoked === 0, 'ENV_GETTER_EXECUTED'); },
  () => { const adapter = JSON.parse(read(path.join(newHome, 'SEAL.json'))); own(adapter, ['schema', 'date', 'files', 'node', 'bindings', 'controls', 'actualAuthorized']); check(adapter.files.length === 7 && adapter.actualAuthorized === false, 'ADAPTER_SCHEMA'); for (const row of adapter.files) { const stat = fs.lstatSync(path.join(newHome, row.path)); check(stat.isFile() && stat.size === row.bytes && (stat.mode & 511) === row.mode && digest(read(path.join(newHome, row.path))) === row.sha256, 'ADAPTER_BINDING'); } },
  () => { const snippet = instance.oldOwner.slice(instance.oldOwner.indexOf('const requireThat ='), instance.oldOwner.indexOf('const hashFile =')); check(read(path.join(home, 'owner-schema-helper.mjs')) === snippet + '\nexport { own };\n', 'SCHEMA_SOURCE_CHANGED'); },
  () => { const wrapper = read(path.join(home, 'FUTURE-LAUNCH.sh.data')); check(wrapper.includes('umask 022\n') && wrapper.includes("'" + newHome + "/owner.mjs'") && wrapper.includes("'" + instance.authPath + "'") && wrapper.includes('exec -c ') && wrapper.includes('verify-fds-v3.mjs') && !wrapper.includes(oldHome) && !wrapper.includes('/../'), 'WRAPPER_ROUTE'); },
  () => { const profile = JSON.parse(read(path.join(home, 'FUTURE-PROFILE.json'))); check(profile.processes.totalPlanned === 67 && profile.processes.administrationSlots === 20 && profile.administrationSlots.length === 20 && profile.processes.runtimeIncludingOwner === 47 && profile.processes.peak === 5 && profile.processes.allOwnedCap === 128 && profile.capture.totalBytes === 269484032 && profile.capture.innerBodyBytes + profile.capture.innerCollectorBytes === 268435456 && profile.elapsed.totalMilliseconds === 5400000 && profile.elapsed.ownerWindowMilliseconds === 4500000 && profile.actualAuthorized === false, 'PROSPECTIVE_PROFILE'); }
];
check(jobs.length === plan.cases.length && jobs.length === 26, 'DATA_CENSUS');
const results = [];
for (const [index, action] of jobs.entries()) { try { action(); results.push({ id: plan.cases[index], qualified: true }); } catch (error) { results.push({ id: plan.cases[index], qualified: false, failure: String(error) }); } }
authenticate();
const report = { schema: 'REPAIR_DATA_CONTROL_RESULTS_V1', pid: process.pid, sealSha256: process.argv[2], results, qualified: results.filter(row => row.qualified).length, total: results.length, unrun: 0, actualOwnerEvaluations: 0, children: 0, namespaceObservations: namespaces.map(file => ({ path: file, absent: !exists(file) })), sourceQualification: 'Exact helper/data only; no full-owner runtime or production-authority claim' };
const bytes = Buffer.from(JSON.stringify(report) + '\n'); if (bytes.length > 262144) throw Error('DATA_RECEIPT_CAP');
const descriptor = fs.openSync(path.join(home, 'DATA-RESULT.json'), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600); try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
process.stdout.write(JSON.stringify({ qualified: report.qualified, total: report.total, unrun: report.unrun, ownerEvaluations: 0 }) + '\n');
process.exitCode = report.qualified === report.total ? 0 : 1;
