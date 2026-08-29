import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, canonical, requireValue, admitRequest, renderProfile, singleflight } from './profile.mjs';
import { captureProcess } from './lifecycle.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name)));
export function createAuthorProvider(options) {
  const control = read('CONTROLS.json'), tools = read('TOOLS.json');
  requireValue(options.root === control.root && options.authorOnly === true && process.platform === 'darwin' && process.arch === tools.architecture && process.umask() === 0o22, 'AUTHOR_PLATFORM_OR_ROOT');
  const budget = { reserved: 0, maxChildren: control.limits.fixtureChildReservations, active: false, captureBytes: 0, maxCapture: control.limits.captureBytes, halted: false, deadline: Math.min(options.deadline, Date.now() + control.limits.cohortMs) };
  let closed = false, running;
  const receipts = [];
  const close = singleflight(async () => { closed = true; if (running) await running.catch(() => {}); return { retirement: budget.halted ? 'STOP' : 'DIRECT_AND_REPORTED_CHILDREN_RETIRED', active: budget.active, budget: { ...budget }, universalDescendantCensus: false, opaqueWorkGuarantee: false, receipts: receipts.length }; });
  return {
    budget, receipts, close,
    run(request, signal, onEvent) {
      requireValue(!closed && !running && !budget.halted, 'PROVIDER_CLOSED_OR_BUSY');
      admitRequest(request, control, tools);
      const profile = renderProfile(request, control, tools);
      const profilePath = options.root + '/profiles/' + request.id + '.sb';
      fs.writeFileSync(profilePath, profile, { flag: 'wx', mode: 0o400 });
      const expected = options.profiles.find(item => item.id === request.id);
      requireValue(expected && expected.sha256 === hash(profile), 'PROFILE_BINDING');
      running = captureProcess(request, { root: options.root, budget, profilePath, tools, onEvent, onReceipt: receipt => receipts.push(receipt) }, signal);
      return running.finally(() => { running = undefined; });
    },
  };
}
export async function begin() { throw Error('NATIVE_NOT_AUTHORIZED_AND_OLD_LOSSLESS_INTERFACE_UNQUALIFIED'); }
export async function run() { throw Error('NATIVE_PROVIDER_NOT_BEGUN'); }
export async function close() { return { retirement: 'NOT_BEGUN', unknownProcesses: 0, losslessDescendants: false }; }
export function validateNativeLiteral(request, cases, qualification) {
  const row = [...cases.cases, ...qualification.cases].find(item => item.id === request.id);
  requireValue(row && request.role === 'native' && canonical(request.argv) === canonical(['--noprofile','--norc','-c',row.program,'surface-case']), 'UNLISTED_NATIVE_LITERAL');
  requireValue(Object.keys(request.environment).sort().join(',') === 'HOME,LANG,LC_ALL,PATH,TMPDIR,TZ' && request.environment.LANG === 'C' && request.environment.LC_ALL === 'C' && request.environment.TZ === 'UTC', 'NATIVE_ENVIRONMENT');
  return row;
}
