import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { Owner, identity, writeAll, tag } from '../admin-owner-r1/tracked-owner.mjs';
const repo = '/Users/kjopek/Workspace/safe-bash';
const relative = 'tests/integration/agent-bash-coherent-author-20260829/final-admin-r5';
const root = path.join(repo, relative), base = path.dirname(root);
const raw = '/private/tmp/b1-final-admin-r5-preparation';
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const owner = new Owner({ raw, cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: raw, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' }, tools: [], wallMs: 540000, reserveMs: 45000, cleanupMs: 2000, maxStarts: 20, peak: 3, captureLimit: 4 * 1024 * 1024, metadataLimit: 16 * 1024 * 1024, tailBytes: 262144 });
const say = value => { const bytes = Buffer.from(JSON.stringify(value) + '\n'); writeAll(fs, 1, bytes, count => owner.charge(count)); fs.writeSync(3, bytes); };
const read = (filename, maximum = 131072) => { const input = identity(filename, maximum), bytes = fs.readFileSync(filename); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), input.sha256); return { input, bytes }; };
const json = filename => JSON.parse(read(filename).bytes);
const git = async (role, args) => { const result = await owner.run(role, '/usr/bin/git', args, 20000); assert.equal(result.faults.primaryPresent, false); assert.equal(result.row.exitCode, 0); return fs.readFileSync(result.files[0], 'utf8').trim(); };
try {
  assert.equal(fs.existsSync(raw), false); fs.mkdirSync(raw); owner.persist(path.join(raw, 'START.json'), owner.snapshot());
  const prior = json(path.join(base, 'admin-owner-r2/PRESEAL.json'));
  for (const tool of prior.tools) assert.deepEqual(identity(tool.path, 128 * 1024 * 1024), tool);
  owner.config.tools = prior.tools;
  assert.equal(await git('git-root', ['rev-parse', '--show-toplevel']), repo);
  await git('git-scoped-status', ['status', '--porcelain=v1', '-z', '--', relative]);
  for (const name of ['stage-b1-r4/PRESEAL.json', 'stage-b1-r4/PUBLICATION-BINDING.json', 'stage-b1-r4-final-binding/COMMANDS.json']) {
    const value = json(path.join(base, name));
    const summary = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Array.isArray(item) && item.length > 8 ? { count: item.length, first: item.slice(0, 2) } : item]));
    say({ name, summary });
  }
  for (const name of ['stage-b1-r4/bootstrap.mjs', 'stage-b1-r4/runner.mjs']) {
    const filename = path.join(base, name); if (!fs.existsSync(filename)) continue;
    const file = read(filename); say({ name, input: file.input, source: file.bytes.toString() });
  }
  say({ status: 'WAITING_FOR_SEALED_FINISH_MODULE', pid: process.pid });
  const input = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const command of input) {
    if (command === 'finish') {
      const module = read(path.join(root, 'finish.mjs')); owner.persist(path.join(raw, 'FINISH-SOURCE.json'), module.input);
      const { finish } = await import('./finish.mjs');
      const result = await finish({ owner, repo, relative, root, base, raw, node, read, json, git, say });
      say(result); input.close(); break;
    } else if (command === 'stop') { owner.terminal = true; owner.persist(path.join(raw, 'STOP.json'), owner.snapshot()); input.close(); break; }
    else throw new Error('UNBOUND_COMMAND');
  }
} catch (reason) {
  owner.terminal = true;
  try { owner.persist(path.join(raw, 'FAILURE.json'), { reason: tag(reason), detail: reason instanceof Error ? reason.message.slice(0, 512) : undefined, snapshot: owner.snapshot() }); } catch {}
  say({ status: 'STOP', reason: tag(reason), detail: reason instanceof Error ? reason.message.slice(0, 512) : undefined, snapshot: owner.snapshot() }); process.exitCode = 78;
}
