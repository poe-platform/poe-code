import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.dirname(new URL(import.meta.url).pathname);
const capture = fs.openSync(path.join(root, 'REVIEW.capture.data'), 'wx', 0o600);
const began = Date.now();
const record = row => fs.writeSync(capture, `${JSON.stringify(row)}\n`);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const checks = [];
let starts = 0;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
try {
  record({ phase: 'start', began, role: 'SOURCE_DATA_ONLY' });
  const packetManifest = JSON.parse(fs.readFileSync(path.join(root, 'packet/MANIFEST.json')));
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, 'source/MANIFEST.json')));
  function packet(name) {
    const row = packetManifest.rows.find(row => row.path.endsWith(`/${name}`));
    assert(row, `missing packet ${name}`);
    const bytes = fs.readFileSync(path.join(root, 'packet', row.capture));
    assert(hash(bytes) === row.sha256 && bytes.length === row.bytes, `packet integrity ${name}`);
    return bytes;
  }
  const json = name => JSON.parse(packet(name));
  const seal = json('PRESEAL.json');
  const audit = json('AUDIT.json');
  const requests = json('REQUESTS.json');
  const protocol = json('PROTOCOL.json');
  const auth = json('AUTHENTICATION.json');
  const launch = packet('launch.mjs').toString('utf8');
  const authorityRoot = path.join(root, 'authority');
  fs.mkdirSync(authorityRoot);
  function child(executable, args, input) {
    assert(Date.now() - began < 300000 && starts < 5, 'review phase bound');
    starts++;
    record({ phase: 'child-enrolled', starts, executable, args });
    const result = spawnSync(executable, args, { input, cwd: '/Users/kjopek/Workspace/safe-bash', env: { PATH: '/usr/bin:/bin', HOME: authorityRoot, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' }, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    fs.writeFileSync(path.join(authorityRoot, `${starts}.stderr.data`), result.stderr ?? Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    record({ phase: 'child-retired', starts, status: result.status, signal: result.signal, error: result.error?.message, stdoutBytes: result.stdout?.length, stderrBytes: result.stderr?.length });
    assert(!result.error && !result.signal && result.status === 0, 'child refusal; no retry');
    return result.stdout;
  }
  function retrieve(label, revision, paths) {
    const raw = child('/usr/bin/git', ['ls-tree', '-r', '-z', revision, '--', ...paths]);
    fs.writeFileSync(path.join(authorityRoot, `${label}.inventory.data`), raw, { flag: 'wx', mode: 0o600 });
    const rows = raw.toString('utf8').split('\0').filter(Boolean).map(line => {
      const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
      assert(match && paths.includes(match[3]), 'unadmitted metadata path');
      return { mode: match[1], blob: match[2], path: match[3] };
    });
    assert(rows.length === paths.length, 'missing stored authority');
    const bodies = child('/usr/bin/git', ['cat-file', '--batch'], Buffer.from(rows.map(row => row.blob).join('\n') + '\n'));
    let offset = 0;
    for (const [index, row] of rows.entries()) {
      const end = bodies.indexOf(10, offset);
      const header = bodies.subarray(offset, end).toString('ascii').split(' ');
      const size = Number(header[2]);
      assert(header[0] === row.blob && header[1] === 'blob' && Number.isSafeInteger(size) && size >= 0 && size < 1048576, 'blob header');
      const bytes = bodies.subarray(end + 1, end + 1 + size);
      assert(bytes.length === size && bodies[end + 1 + size] === 10, 'blob framing');
      assert(crypto.createHash('sha1').update(`blob ${size}\0`).update(bytes).digest('hex') === row.blob, 'blob integrity');
      row.bytes = size; row.sha256 = hash(bytes); row.capture = `${label}-${index}.data`;
      fs.writeFileSync(path.join(authorityRoot, row.capture), bytes, { flag: 'wx', mode: 0o600 });
      offset = end + size + 2;
    }
    assert(offset === bodies.length, 'batch trailer');
    fs.writeFileSync(path.join(authorityRoot, `${label}.json`), JSON.stringify({ revision, rows }, null, 2) + '\n', { flag: 'wx' });
    return rows;
  }
  const legacyBase = 'tests/compatibility/bash-surface-independent-20260829/';
  const legacy = retrieve('legacy', '9afc9c5a321711fb566817916a281fe4776935fd', [legacyBase + 'CASES.original.json', legacyBase + 'run.mjs']);
  const version = json('VERSION-PROVENANCE.json');
  const versionRows = retrieve('version', version.commit, version.files.map(row => row.path));
  const original = JSON.parse(fs.readFileSync(path.join(authorityRoot, legacy.find(row => row.path.endsWith('CASES.original.json')).capture)));
  const runText = fs.readFileSync(path.join(authorityRoot, legacy.find(row => row.path.endsWith('run.mjs')).capture), 'utf8');
  const readVersion = suffix => fs.readFileSync(path.join(authorityRoot, versionRows.find(row => row.path.endsWith(suffix)).capture));
  const tools = json('TOOLS.json');
  const toolObserved = [];
  for (const pin of [...tools.toolPins, tools.environmentLauncher]) {
    const descriptor = fs.openSync(pin.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const before = fs.fstatSync(descriptor);
      assert(before.isFile() && before.size === pin.bytes && (before.mode & 0o777) === pin.mode, 'tool metadata refusal');
      const digest = crypto.createHash('sha256'); const buffer = Buffer.alloc(1048576); let bytes = 0; let count;
      while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) { bytes += count; assert(bytes <= pin.bytes, 'growing tool'); digest.update(buffer.subarray(0, count)); }
      const after = fs.fstatSync(descriptor); const sha256 = digest.digest('hex');
      assert(bytes === pin.bytes && sha256 === pin.sha256 && before.ino === after.ino && before.mtimeMs === after.mtimeMs && before.size === after.size, 'tool identity refusal');
      toolObserved.push({ path: pin.path, bytes, mode: before.mode & 0o777, sha256, role: 'STREAM_HASH_METADATA_NO_VERSION_PROBE' });
    } finally { fs.closeSync(descriptor); }
  }
  fs.writeFileSync(path.join(root, 'TOOL-METADATA.json'), JSON.stringify(toolObserved, null, 2) + '\n', { flag: 'wx' });
  function check(id, body) {
    try { const detail = body(); checks.push({ id, disposition: 'PASS_DATA_OR_SOURCE_ASSERTION', detail }); }
    catch (error) { checks.push({ id, disposition: 'FAIL_DATA_OR_SOURCE_ASSERTION', message: error.message }); }
    record(checks.at(-1));
  }
  check('C01', () => {
    assert(hash(packet('PRESEAL.json')) === '657d5ef886db90c625d40ba4f461ccea64c1ff9e2d48f3b1c72190bc0d52dea6', 'declared preseal');
    for (const pin of seal.files) {
      const bytes = packet(pin.path); const source = sourceManifest.rows.find(row => row.path.endsWith(`/${pin.path}`));
      assert(bytes.length === pin.bytes && hash(bytes) === pin.sha256 && source?.sha256 === pin.sha256 && source.bytes === pin.bytes, `source/evidence binding ${pin.path}`);
    }
    return { sourceFiles: seal.files.length, launcherSha256: hash(packet('launch.mjs')) };
  });
  check('C02', () => {
    assert(legacy.find(row => row.path.endsWith('CASES.original.json')).sha256 === audit.original.sha256, 'original authority');
    assert(audit.cases.length === 40 && original.cases.length === 40, 'forty');
    for (const [index, row] of audit.cases.entries()) {
      const prior = original.cases[index];
      assert(row.id === prior.id && row.program === prior.program && row.programSha256 === hash(Buffer.from(prior.program)) && row.stdinBase64 === Buffer.from(prior.stdin ?? original.defaultStdin).toString('base64'), row.id);
    }
    return { immutablePrograms: 40, executed: 0 };
  });
  check('C03', () => {
    const expected = { 'a.txt': 'A\n', 'b.txt': 'B\n', '.hidden': 'H\n', 'source-fixture': 'v=sourced; printf \'source:%s\\n\' "$1"\n' };
    assert(audit.fixtures.length === 4, 'four fixtures');
    for (const fixture of audit.fixtures) {
      const bytes = Buffer.from(fixture.base64, 'base64'); const legacyRow = auth.fixtures.find(row => row.path === fixture.path);
      assert(bytes.toString('base64') === fixture.base64 && bytes.equals(Buffer.from(expected[fixture.path])) && bytes.length === fixture.bytes && hash(bytes) === fixture.sha256 && legacyRow.sha256 === fixture.sha256 && fixture.mode === 0o600, fixture.path);
    }
    assert(audit.cases.find(row => row.id === 'B37').program.includes("eval 'v=eval'") && audit.cases.find(row => row.id === 'B38').program.includes("trap 'printf cleanup' EXIT"), 'nested literal bodies');
    return { fixtures: 4, fixtureBody: expected['source-fixture'], nestedEval: 'v=eval', nestedTrap: 'printf cleanup' };
  });
  check('C04', () => {
    assert(requests.length === 37 && JSON.stringify(requests.map(row => row.id)) === JSON.stringify(protocol.eligible), 'membership');
    assert(JSON.stringify(protocol.unqualified.map(row => row.id)) === JSON.stringify(['B26','B27','B28']), 'withheld');
    for (const request of requests) {
      const row = audit.cases.find(row => row.id === request.id); const base = protocol.root + '/' + row.id;
      assert(request.executable === '/bin/bash' && JSON.stringify(request.argv) === JSON.stringify(['--noprofile','--norc','-c',row.program,'surface-case']), 'argv');
      assert(JSON.stringify(request.environment) === JSON.stringify({ LC_ALL:'C', LANG:'C', TZ:'UTC', HOME:base+'/home', TMPDIR:base+'/tmp', PATH:base+'/empty-path' }) && request.cwd === base+'/work', 'env');
      assert(request.stdinBase64 === row.stdinBase64 && request.programSha256 === row.programSha256, 'request bytes');
    }
    return { observationsProposed: 37, allUnrun: true, successfulExternalExecutionAuthorized: false };
  });
  check('C05', () => {
    const names = { B20:'mapfile', B21:'readarray', B39:'__surface_missing_command__' };
    const paths = [];
    for (const [id, name] of Object.entries(names)) {
      const request = requests.find(row => row.id === id);
      assert(audit.cases.find(row => row.id === id).program.startsWith(name + (id === 'B39' ? ';' : ' ')) && !name.includes('/') && !request.environment.PATH.includes(':'), id);
      paths.push({ id, name, onlySearchPath: request.environment.PATH + '/' + name, policy: 'fresh empty owned directory; no successful executable authority' });
    }
    assert(JSON.stringify(protocol.lookupExceptions) === JSON.stringify(Object.keys(names)), 'exception membership');
    return paths;
  });
  check('C06', () => {
    const limits = protocol.limits;
    assert(requests.reduce((sum, row) => sum + row.extraProcessReservation, 0) === 13, 'fork reservations');
    assert(limits.controllerStarts + limits.directBashStarts + limits.sourceBoundAdditionalStarts + limits.outerToolShellAllowance + limits.administrativeStarts === 64, 'planned equation');
    assert(!launch.includes('totalWorkingBytes') && !launch.includes('peakProcesses') && !launch.includes('allProcesses'), 'source accounting observation changed');
    return { planned: 64, directBash: 37, internalSourceReservations: 13, controller: 1, toolShell: 1, unspecifiedAdministrativeAllowance: 12, peakPlanningOnly: 6, runtimeAllStartsCensus: false, workingByteEnforcementInLauncher: false };
  });
  check('C07', () => {
    for (const pin of version.files) { const row = versionRows.find(row => row.path === pin.path); assert(row.sha256 === pin.sha256 && row.bytes === pin.bytes, pin.path); }
    const stdout = readVersion('bash-version.stdout.raw').toString('utf8');
    assert(stdout.includes('3.2.57(1)-release') && readVersion('bash-version.stderr.raw').length === 0, 'prior version');
    return { priorCommit: version.commit, versionStdout: stdout, versionResult: JSON.parse(readVersion('VERSION-RESULT.json')), currentToolMetadata: toolObserved, versionExecutionsThisReview: 0 };
  });
  const commandMap = [
    ['printf'],['set','printf'],['set','printf'],['printf'],['printf'],['unset','printf'],['unset','printf'],['printf'],['printf (literal substitution and outer)'],['printf'],['shopt','printf'],['shopt','printf'],['shopt','printf'],['f (literal function)','printf'],['f (literal function)','local','readonly','printf'],['printf'],['printf'],['declare'],['typeset'],['mapfile (failed-lookup exception)','printf'],['readarray (failed-lookup exception)','printf'],['read','printf'],['printf','read'],['printf','read'],['printf'],['read','printf'],['read','printf'],['exec','printf'],['false','true','set','printf'],['false','true','printf'],['set','false','true','printf'],['set','printf'],['[[ syntax ]]','printf'],['arithmetic syntax','printf'],['f (literal function)','printf'],['case syntax','printf'],['. (literal ./source-fixture)','eval (literal v=eval)','printf'],['trap (literal printf cleanup)','printf','exit'],['__surface_missing_command__ (failed-lookup exception)','printf'],['printf']
  ];
  const matrix = audit.cases.map((row, index) => ({ id: row.id, program: row.program, sha256: row.programSha256, execution: 'UNRUN', disposition: row.disposition, commands: commandMap[index], reads: ['B10','B11','B12','B13'].includes(row.id) ? ['owned work directory entries'] : row.id === 'B23' ? ['owned work/out'] : row.id === 'B37' ? ['owned work/source-fixture; literal source body'] : [], writes: ['B23','B25'].includes(row.id) ? ['owned work/out'] : row.id === 'B28' ? ['WITHHELD dynamic-fd/exec interpretation'] : ['B26','B27'].includes(row.id) ? ['WITHHELD temporary-file placement'] : [], standardChannels: 'exact supplied stdin; owned regular stdout/stderr', ambientLookup: ['B20','B21','B39'].includes(row.id) ? 'one literal basename in fresh owned empty PATH only' : 'none from audited literal command positions', notes: ['B24','B36'].includes(row.id) ? '3.2 syntax support/output unknown; capture any syntax rejection, do not reinterpret as modern success' : row.id === 'B23' ? 'read -N support differs by source family; no external read executable permitted' : 'functional-only; no containment claim' }));
  check('C08', () => { assert(matrix.length === 40 && commandMap.length === 40 && matrix.filter(row => row.execution === 'UNRUN').length === 40, 'all identity roles'); return { identities: 40, eligible: 37, withheld: 3, noAdditionalLiteralExclusionFound: true, reviewerRole: 'independent manual source classification, not general shell parser proof' }; });
  fs.writeFileSync(path.join(root, 'CASE-MATRIX.json'), JSON.stringify(matrix, null, 2) + '\n', { flag: 'wx' });
  check('C09', () => {
    const predicate = "row.regularCaptureCompletion=row.exit&&row.close&&row.group.state==='absent'&&!row.stop;";
    assert(launch.includes(predicate) && launch.includes("halted=true;row.errors.push({phase:'fsync'"), 'bound completion predicate');
    const row = { exit:true, close:true, group:{state:'absent'}, errors:[{phase:'fsync',code:'EIO'}] };
    const halted = true;
    const regularCaptureCompletion = row.exit && row.close && row.group.state === 'absent' && !row.stop;
    assert(halted && regularCaptureCompletion, 'counterexample');
    return { role:'source-linked synthetic state, NOT actual fsync injection', halted, errors:row.errors, regularCaptureCompletion, consequence:'completed++ remains reachable despite capture finalization error' };
  });
  check('C10', () => {
    assert((launch.match(/observeOwnedGroup\(child\.pid\)/g) ?? []).length === 1, 'single observer site');
    const groupCheck = launch.indexOf("if(!knownClose||!row.exit||!row.close||row.group.state!=='absent')");
    const cleanup = launch.indexOf('finally{clearTimeout(termTimer)');
    assert(groupCheck > 0 && cleanup > groupCheck && launch.slice(groupCheck, cleanup).includes("signalOwnedGroup(child.pid,'SIGKILL')"), 'residual group branch');
    assert(launch.indexOf('fs.mkdirSync(runRoot') < launch.indexOf('const journal=') && launch.indexOf('const journal=') < launch.indexOf('try{\n requireValue'), 'startup order');
    return { role:'source-linked ordering model; no real children', possibleTrace:['direct exit/close','group present','send SIGKILL','clear remaining timers','no subsequent group observation','publish STOP with unresolved retirement'], rawCaptureGap:'mkdir/open/import failures precede durable journal/catch', firstStopReasonRetainedBy:'stop assigns row.stop only once', runtimeLifecycleProof:'UNRUN' };
  });
  const syntax = child(tools.toolPins.find(row => row.path.includes('/node')).path, ['--check','--input-type=module'], Buffer.from(launch));
  assert(syntax.length === 0, 'unexpected syntax stdout');
  fs.writeFileSync(path.join(root, 'LEGACY-FIXTURE-SOURCE.txt'), runText.split('\n').map((line,index) => `${index+1}: ${line}`).filter(line => /setupCase|source-fixture|a\.txt|b\.txt|\.hidden|writeFile/.test(line)).join('\n') + '\n', { flag:'wx' });
  const result = { status: checks.every(row => row.disposition === 'PASS_DATA_OR_SOURCE_ASSERTION') ? 'SOURCE_DATA_COMPLETE_LAUNCH_CORRECTIONS_REQUIRED' : 'DATA_ASSERTION_FAILURE_RETAINED', source:'9afc9c5a321711fb566817916a281fe4776935fd', evidence:'807b6ea5f934e7b9d23092c6d7f518b757b8fbea', presealSha256:hash(packet('PRESEAL.json')), launcherSha256:hash(packet('launch.mjs')), checks, syntax:{status:0,bodyExecuted:false}, metadataChildren:4, syntaxChildren:1, childrenRetired:starts, runtimeChildren:0, lifecycleChildren:0, bashExecutions:0, eligibleUnrun:37, withheldUnrun:3, begun:began, ended:Date.now() };
  fs.writeFileSync(path.join(root, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n', { flag:'wx' });
  record({ phase:'complete', status:result.status, controls:checks.length, failures:checks.filter(row => row.disposition.startsWith('FAIL')).length, starts, elapsedMs:Date.now()-began });
  console.log(JSON.stringify({ status:result.status, controls:checks.map(row => ({id:row.id,disposition:row.disposition,message:row.message})), starts, syntax:result.syntax }));
  console.log(fs.readFileSync(path.join(root, 'LEGACY-FIXTURE-SOURCE.txt'), 'utf8'));
  if (checks.some(row => row.disposition.startsWith('FAIL'))) process.exitCode = 1;
} catch (error) { record({ phase:'STOP', message:error.message, starts }); process.exitCode = 1; }
finally { fs.closeSync(capture); }
