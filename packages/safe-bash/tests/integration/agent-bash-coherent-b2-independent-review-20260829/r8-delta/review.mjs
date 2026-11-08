import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { Owner, identity, writeAll } from '../../agent-bash-coherent-author-20260829/admin-owner-r1/tracked-owner.mjs';
const repo = '/Users/kjopek/Workspace/safe-bash', relative = 'tests/integration/agent-bash-coherent-b2-independent-review-20260829/r8-delta';
const root = path.join(repo, relative), raw = '/private/tmp/b2-r8-independent-delta-review';
const author = repo + '/tests/integration/agent-bash-coherent-b2-preflight-20260829';
const owner = new Owner({ raw, cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: raw, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' }, tools: [], wallMs: 540000, reserveMs: 60000, cleanupMs: 2000, maxStarts: 23, peak: 3, captureLimit: 4 * 1024 * 1024, metadataLimit: 16 * 1024 * 1024, tailBytes: 262144 });
const say = value => { const bytes = Buffer.from(JSON.stringify(value) + '\n'); writeAll(fs, 1, bytes, count => owner.charge(count)); fs.writeSync(3, bytes); };
const read = (filename, maximum = 131072) => { const input = identity(filename, maximum), bytes = fs.readFileSync(filename); assert.equal(bytes.length, input.bytes); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), input.sha256); return { input, bytes }; };
const git = async (role, argv) => { const result = await owner.run(role, '/usr/bin/git', argv, 15000); assert.equal(result.faults.primaryPresent, false); assert.equal(result.row.exitCode, 0); return fs.readFileSync(result.files[0]); };
try {
  assert.equal(fs.existsSync(raw), false); fs.mkdirSync(raw); owner.persist(path.join(raw, 'START.json'), owner.snapshot());
  const trusted = JSON.parse(read(repo + '/tests/integration/agent-bash-coherent-author-20260829/b1-r6-window-v2/FINAL.json').bytes);
  for (const tool of trusted.tools) assert.deepEqual(identity(tool.path, 128 * 1024 * 1024), tool); owner.config.tools = trusted.tools;
  assert.equal((await git('git-root', ['rev-parse', '--show-toplevel'])).toString().trim(), repo);
  await git('git-scoped-status', ['status', '--porcelain=v1', '-z', '--', relative]);
  const handoff = read(author + '/completion-r8/completion-v2/HANDOFF.md'); owner.persist(path.join(raw, 'HANDOFF-INPUT.json'), { ...handoff.input, text: handoff.bytes.toString() }); say({ ...handoff.input, text: handoff.bytes.toString() });
  const tree = await git('git-author-tree', ['ls-tree', '-rz', '8bb8e583047fcf8929150cd69f455c2d918db513', '--', 'tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r8/completion-v2']);
  owner.persist(path.join(raw, 'AUTHOR-TREE.json'), { commit: '8bb8e583047fcf8929150cd69f455c2d918db513', nulRecords: tree.toString().split('\0').filter(Boolean) }); say({ tree: tree.toString().split('\0').filter(Boolean) });
  say({ status: 'READ_ONLY_INSPECTION_READY', pid: process.pid });
  const input = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const command of input) {
    if (command.startsWith('read ')) {
      const name = command.slice(5); assert(!name.includes('..') && !path.isAbsolute(name));
      const file = read(path.join(author, name)); owner.persist(path.join(raw, 'read-' + crypto.createHash('sha256').update(name).digest('hex').slice(0, 12) + '.json'), { ...file.input, text: file.bytes.toString() }); say({ ...file.input, text: file.bytes.toString() });
    } else if (command === 'execute-sealed-review') {
      const { finish } = await import('./finish.mjs'); const result = await finish({ owner, repo, relative, root, raw, author, read, git }); say(result); input.close(); break;
    } else if (command === 'stop') { owner.terminal = true; owner.persist(path.join(raw, 'STOP.json'), { snapshot: owner.snapshot(), actualProduct: 0 }); input.close(); break; }
    else throw new Error('UNKNOWN_REVIEW_COMMAND');
  }
} catch (error) {
  owner.terminal = true;
  try { owner.persist(path.join(raw, 'STOP.json'), { message: error instanceof Error ? error.message : String(error), snapshot: owner.snapshot() }); } catch {}
  say({ status: 'REVIEW_STOP', message: error instanceof Error ? error.message : String(error), snapshot: owner.snapshot() }); process.exitCode = 78;
}
