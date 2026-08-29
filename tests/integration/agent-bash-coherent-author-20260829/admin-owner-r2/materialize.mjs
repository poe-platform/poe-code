import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const repo = '/Users/kjopek/Workspace/safe-bash';
const base = repo + '/tests/integration/agent-bash-coherent-author-20260829';
const source = base + '/stage-b1-r4/publish.mjs';
const stat = fs.lstatSync(source); assert(stat.isFile() && stat.size === 13280);
const bytes = fs.readFileSync(source); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), '380900151ecc5fa2b05cbba157d9fe3eb65401d88b62a26e7824b8a8742d1281');
let text = bytes.toString('utf8');
const deltas = [
  ["from './policy.mjs';", "from '../stage-b1-r4/policy.mjs';\nimport { admitPublisher, countPublication } from './ledger.mjs';"],
  ["const scope = 'tests/integration/agent-bash-coherent-author-20260829/stage-b1-r4';", "const scope = 'tests/integration/agent-bash-coherent-author-20260829/admin-owner-r2';"],
  ['let unknownChild = false;', 'let unknownChild = false;\nlet publisherStart;'],
  ["if (++gitAttempts > 3) throw Error('Metadata role cap');", "if (++gitAttempts > 3) throw Error('Metadata role cap');\n  if (auth.ownerAdmission.starts.length + 1 + gitAttempts > 36) throw Error('Named metadata reservation cap');"],
  ["!Number.isSafeInteger(auth.knownStartsBeforePublication) || auth.knownStartsBeforePublication < 7 || auth.knownStartsBeforePublication > 27", "!Number.isSafeInteger(auth.knownStartsBeforePublication) || auth.knownStartsBeforePublication !== auth.ownerAdmission?.knownStartsBeforePublication || auth.knownStartsBeforePublication > 32"],
  ["allowedEnd = deadline(auth, Date.now());", "publisherStart = admitPublisher(auth.ownerAdmission, { parentPid: process.ppid, selfPid: process.pid, startedUTC: new Date().toISOString() });\n  allowedEnd = deadline(auth, Date.now());"],
  ['knownStartsThroughReceipt: auth.knownStartsBeforePublication + 2 + gitAttempts,', "knownStartsThroughReceipt: countPublication(auth.ownerAdmission, publisherStart, terminal.children).knownStarts, ownedRoleLedger: { prior: auth.ownerAdmission.starts, publisher: publisherStart, children: terminal.children, ownerDisposition: 'EXIT_PENDING_EXTERNAL_OBSERVATION', namedUnusedReservations: ['git-add', 'git-commit', 'git-receipt'].filter(role => !terminal.children.some(child => child.role === role && child.pid)) },"],
];
for (const [before, after] of deltas) { assert.equal(text.split(before).length, 2, 'EXACT_SINGLE_DELTA'); text = text.replace(before, after); }
const target = 'tests/integration/agent-bash-coherent-author-20260829/admin-owner-r2/publish.mjs';
const patch = '*** Begin Patch\n*** Add File: ' + target + '\n' + text.split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n';
const child = spawn('/Users/kjopek/.codex/tmp/arg0/codex-arg0wITElD/apply_patch', [], { cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] });
const observation = { role: 'source-edit-apply-patch', pid: child.pid, startUTC: new Date().toISOString(), startObserved: Number.isSafeInteger(child.pid), exitObserved: false, closeObserved: false };
const timer = setTimeout(() => { if (!observation.closeObserved) child.kill('SIGTERM'); }, 3000);
const killTimer = setTimeout(() => { if (!observation.closeObserved) child.kill('SIGKILL'); }, 5000);
child.stdout.on('data', data => fs.writeSync(1, data)); child.stderr.on('data', data => fs.writeSync(2, data));
child.on('error', reason => { fs.writeSync(2, String(reason)); process.exitCode = 78; });
child.on('exit', code => { observation.exitObserved = true; observation.exitCode = code; });
child.on('close', code => { observation.closeObserved = true; clearTimeout(timer); clearTimeout(killTimer); fs.writeSync(1, JSON.stringify(observation) + '\n'); process.exitCode = code === 0 ? 0 : 78; });
child.stdin.end(patch);
