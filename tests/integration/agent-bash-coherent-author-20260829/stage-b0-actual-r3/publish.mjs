import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const scope = path.resolve('tests/integration/agent-bash-coherent-author-20260829/stage-b0-actual-r3');
const evidence = path.join(scope, 'evidence');
const work = '/private/tmp/safe-bash-coherent-b0-20260829-r3';
const hash = async file => {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
};
const read = file => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 2097152) throw new Error(`Bounded JSON admission: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const write = (name, value) => fs.writeFileSync(path.join(evidence, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
try {
  const result = read(path.join(work, 'RESULT.json'));
  const inventory = read(path.join(evidence, 'WORK-INVENTORY.json'));
  const expected = ['C01','C02','C03','C04','C05','C06','C07','C08','C09','C12','C13','C14','C17'];
  const matrix = result.aggregate.map(layout => {
    if (JSON.stringify(layout.report.rows.map(row => row.id)) !== JSON.stringify(expected)) throw new Error('Unexpected executed identity sequence');
    return {
      layout: layout.layout, pid: layout.pid,
      passed: layout.report.passed, failed: layout.report.failed,
      regexWorkers: layout.regexWorkers, internalLoaderAdmissions: layout.internalLoaderAdmissions,
      guestEngineCalls: layout.report.guestEngineCalls,
      shells: layout.report.rows.reduce((sum, row) => sum + row.shells, 0),
      cleanupFulfilled: layout.report.rows.flatMap(row => row.cleanup).filter(status => status === 'fulfilled').length,
      rows: layout.report.rows,
    };
  });
  const events = [];
  for (const entry of inventory.entries) {
    if (entry.type !== 'file' || !/events/i.test(entry.path) || entry.bytes > 2097152) continue;
    const file = path.join(work, entry.path);
    if (await hash(file) !== entry.sha256) throw new Error('Event integrity mismatch');
    for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      try { events.push(JSON.parse(line)); } catch { throw new Error('Unknown event encoding'); }
    }
  }
  const roles = events.filter(event => event.spawned).map(start => ({
    role: start.role, pid: start.pid,
    observations: events.filter(event => event.pid === start.pid && !event.spawned),
  }));
  const resultMetadata = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'aggregate'));
  const summary = {
    status: result.status, launcherExit: 0, attempts: 1,
    finalEvidenceAt: new Date().toISOString(),
    authorizationCommit: '6f8e55272cf2f207a2c71753bd8ccd5a430ccc07',
    candidate: '8ab0b2875c695c7cf6fbe90080cd083f69ef7146',
    preseal: { bytes: 11952, sha256: '78e6c945ceadfb54d51d806fbe57399ab5a552ad4571791cb916c085736e27a7' },
    resultMetadata,
    matrix: matrix.map(({ rows, ...layout }) => layout),
    totals: {
      executed: matrix.reduce((sum, layout) => sum + layout.rows.length, 0),
      passed: matrix.reduce((sum, layout) => sum + layout.passed, 0),
      failed: matrix.reduce((sum, layout) => sum + layout.failed, 0),
      shells: matrix.reduce((sum, layout) => sum + layout.shells, 0),
      cleanupFulfilled: matrix.reduce((sum, layout) => sum + layout.cleanupFulfilled, 0),
      regexWorkers: matrix.reduce((sum, layout) => sum + layout.regexWorkers, 0),
      internalLoaderAdmissions: matrix.reduce((sum, layout) => sum + layout.internalLoaderAdmissions, 0),
      guestEngineCalls: matrix.reduce((sum, layout) => sum + layout.guestEngineCalls, 0),
    },
    ownedRoleObservations: roles,
    workSnapshot: { at: inventory.at, bytes: inventory.bytes, entries: inventory.entries.length },
    conservativeExplicitStartAccounting: {
      authorization: 4, preflight: 8, launchIncludingFourSupervisedChildren: 7,
      contextOnlyInstructionReads: 4, snapshotPublication: 3,
      finalPublicationIncludingCommitIdentity: 6, totalInclusiveUpperCount: 32,
      basis: 'Explicit tool/admin/helper roles; conservatively counts exec replacements as starts. Not an OS-wide/transitive census. Final publication roles complete in the outer command transcript.',
    },
    qualifications: [
      'Known-role-only functional review; observed supervisor group fields are raw observations, not universal group-absence or full-census acceptance.',
      'Parent/static Regex closure only, not nested-load tracing. Actual application Regex Worker count is separate from internal-loader admissions.',
      'Public exec/dispose and registered cleanup observations do not establish finalization of arbitrary unenrolled provider work.',
      'No build rerun: source-built uses authenticated actual StageA output. Offline installation and physical move executed in this attempt.',
      'No PUBLIC95/Node guest engine/native oracle/external network/private input execution.',
      'All50 Unit2, remaining retained/type/mutant/binding cohorts and five PUBLIC95 workflows remain later; not full coherent acceptance or 726-slot completion.',
      'Earlier STOP/HOLD evidence and original cohorts remain unchanged.',
    ],
  };
  write('MATRIX.json', matrix);
  write('SUMMARY.json', summary);
  for (const suffix of ['stdout', 'stderr']) {
    const file = `/private/tmp/coherent-b0-actual-r3-snapshot-20260829.${suffix}`;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 67108864) throw new Error('Closed snapshot capture admission');
    fs.copyFileSync(file, path.join(evidence, path.basename(file)), fs.constants.COPYFILE_EXCL);
  }
  let checkedFiles = 0;
  for (const entry of inventory.entries) {
    const file = path.join(work, entry.path);
    const stat = fs.lstatSync(file);
    if (entry.type === 'file') {
      if (!stat.isFile() || stat.size !== entry.bytes || await hash(file) !== entry.sha256) throw new Error(`Post-snapshot mutation ${entry.path}`);
      checkedFiles++;
    } else if (entry.type === 'link') {
      if (!stat.isSymbolicLink() || fs.readlinkSync(file) !== entry.target) throw new Error('Link drift');
    } else if (!stat.isDirectory()) throw new Error('Directory drift');
  }
  const afterPaths = [];
  const paths = (directory, relative = '') => {
    for (const name of fs.readdirSync(directory).sort()) {
      const child = path.join(directory, name);
      const key = relative ? `${relative}/${name}` : name;
      afterPaths.push(key);
      if (fs.lstatSync(child).isDirectory()) paths(child, key);
    }
  };
  paths(work);
  if (JSON.stringify(afterPaths) !== JSON.stringify(inventory.entries.map(entry => entry.path))) throw new Error('Added/missing owned entry');
  write('POST-SNAPSHOT-INTEGRITY.json', { status: 'PASS', at: new Date().toISOString(), checkedFiles, entries: afterPaths.length, addedMissingChanged: 0 });
  const files = [];
  const seal = async (directory, relative = '') => {
    for (const name of fs.readdirSync(directory).sort()) {
      if (name === 'EVIDENCE-MANIFEST.json') continue;
      const file = path.join(directory, name);
      const key = relative ? `${relative}/${name}` : name;
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) await seal(file, key);
      else if (stat.isFile()) files.push({ path: key, bytes: stat.size, sha256: await hash(file) });
      else throw new Error('Unexpected evidence object');
    }
  };
  await seal(scope);
  if (files.reduce((sum, file) => sum + file.bytes, 0) > 67108864) throw new Error('Evidence cap');
  if (Date.now() > Date.parse('2026-08-29T12:32:52.037Z')) throw new Error('Conservative inclusive publication deadline');
  write('EVIDENCE-MANIFEST.json', { at: new Date().toISOString(), files });
  console.log(JSON.stringify(summary));
  console.log('EVIDENCE_SEAL', await hash(path.join(evidence, 'EVIDENCE-MANIFEST.json')));
} catch (error) {
  console.error(error);
  process.exitCode = 78;
}
