import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../../..');
const author = path.join(repo, 'tests/compatibility/bash-ere-transport-corrections-20260829/corrections-v2');
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const phase = process.argv[2];
const capture = fs.openSync(path.join(root, `${phase}.jsonl`), 'wx');
const emit = value => fs.writeSync(capture, JSON.stringify(value) + '\n');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = (file, maximum = 1048576, hash) => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw Error('file admission: ' + file);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size || (hash && sha(bytes) !== hash)) throw Error('file binding: ' + file);
  return bytes;
};
const write = (file, bytes) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o644 });
};
const json = value => JSON.stringify(value, null, 2) + '\n';
const hashTool = async () => {
  const stat = fs.lstatSync(node);
  if (!stat.isFile() || stat.size !== 112989184 || (stat.mode & 0o777) !== 0o755) throw Error('Node stat');
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(node, { highWaterMark: 65536 })) hash.update(chunk);
  const digest = hash.digest('hex');
  if (digest !== '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011') throw Error('Node hash');
  return { path: node, bytes: stat.size, mode: '0755', sha256: digest };
};
const manifestRow = file => {
  const bytes = read(file);
  return { path: path.relative(root, file), bytes: bytes.length, sha256: sha(bytes), mode: fs.lstatSync(file).mode & 0o777 };
};
try {
  emit({ phase, pid: process.pid, at: new Date().toISOString() });
  const tool = await hashTool();
  if (phase === 'prepare') {
    const combinedBytes = read(path.join(author, 'COMBINED-12.json'), 4096, 'e785668f13549aba24323a6db568fb58805eca41a190ce18b41c299c28a53a5f');
    const combined = JSON.parse(combinedBytes);
    if (combined.modules.length !== 12) throw Error('source membership');
    const files = [];
    write(path.join(root, 'COMBINED-12.json'), combinedBytes);
    for (const item of combined.modules) {
      if (!/^(?:transport\/)?[a-z-]+\.ts$/.test(item.name)) throw Error('source name');
      const bytes = read(path.join(repo, 'src/commands/regex-execution/ere', item.name), item.size, item.sha256);
      if (bytes.length !== item.size || crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== item.blob) throw Error('source blob');
      const local = path.join(root, 'source', item.name + '.data');
      write(local, bytes); files.push(manifestRow(local));
    }
    const wrapper = read(path.join(author, 'ACTUAL.json.gz.base64.data'), 74581, '4195e5c754649d487e57df250dc23b6c3dda9466749df250ed3bd5da00ea0378');
    const compressed = Buffer.from(wrapper.toString('ascii').trim(), 'base64');
    if (compressed.length !== 55933 || sha(compressed) !== '238582e29cc1a2667305e29f7c08f394feab1d617ce0b1139ac9dcc6736f2071') throw Error('compressed binding');
    const raw = zlib.gunzipSync(compressed, { maxOutputLength: 270425 });
    if (raw.length !== 270425 || sha(raw) !== 'c48fb95289f63590d55dc694d89f575082379ee378484aa64fe5c0c19829e70b') throw Error('archive binding');
    const archive = JSON.parse(raw);
    if (archive.entries.length !== 37 || new Set(archive.entries.map(item => item.path)).size !== 37) throw Error('archive membership');
    const allowed = ['errors.js', 'limits.js', 'transport/accounting.js', 'transport/protocol.js', 'transport/validation.js'];
    const loads = [];
    for (const name of allowed) {
      const item = archive.entries.find(entry => entry.path === 'RUN/work/emitted/' + name);
      if (!item) throw Error('missing pure asset');
      const bytes = Buffer.from(item.base64, 'base64');
      if (bytes.length !== item.bytes || sha(bytes) !== item.sha256) throw Error('pure asset binding');
      const local = path.join(root, 'emitted', name);
      write(local, bytes); files.push(manifestRow(local));
      loads.push({ path: local, bytes: item.bytes, sha256: item.sha256 });
    }
    write(path.join(root, 'emitted/package.json'), '{"type":"module"}\n');
    write(path.join(root, 'PURE-LOADS.json'), json(loads));
    const authorBytes = read(path.join(author, 'pure-controls.mjs.data'), 14686);
    if (crypto.createHash('sha1').update(`blob ${authorBytes.length}\0`).update(authorBytes).digest('hex') !== 'df6df67f46ae56d671b48f75516bf77e082d1f36') throw Error('author fixture');
    write(path.join(root, 'author.mjs'), authorBytes);
    for (const name of ['PLAN.md', 'parent.mjs', 'pure.mjs', 'author.mjs', 'PURE-LOADS.json', 'COMBINED-12.json', 'emitted/package.json']) files.push(manifestRow(path.join(root, name)));
    const seal = { schema: 1, source: '46611a5b67ad7af276154421ac7f50dd536ec570', engine: '72187e5abc1179883f85a63e1ef558f2e141c542', authorEvidence: 'bd3a0422b10c8fc4d79ed0c69dda6fb2f28df5c3', tool, files, authorGroups: 20, novelGroups: 12, pureHelpers: 3, pureChildren: 1, workerStarts: 0, compilerStarts: 0, captureCap: 1048576, deadlineMs: 30000 };
    write(path.join(root, 'PRESEAL.json'), json(seal));
    emit({ prepared: true, files: files.length, sealSha256: sha(Buffer.from(json(seal))) });
  } else if (phase === 'run') {
    const stdout = fs.openSync(path.join(root, 'child.stdout'), 'wx');
    const stderr = fs.openSync(path.join(root, 'child.stderr'), 'wx');
    const seal = JSON.parse(read(path.join(root, 'PRESEAL.json'), 32768, process.argv[3]));
    const verify = () => {
      for (const row of seal.files) {
        const file = path.join(root, row.path);
        if (read(file, row.bytes, row.sha256).length !== row.bytes || (fs.lstatSync(file).mode & 0o777) !== row.mode) throw Error('postguard ' + row.path);
      }
    };
    verify();
    const loadHash = sha(read(path.join(root, 'PURE-LOADS.json')));
    let observed = 0; let failure; let failurePresent = false; let exited; let timer; let killTimer;
    const child = spawn(node, ['--unhandled-rejections=strict', '--max-old-space-size=128', path.join(root, 'pure.mjs'), loadHash], { cwd: root, env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = reason => { if (!failurePresent) { failurePresent = true; failure = String(reason); } child.kill('SIGTERM'); if (!killTimer) killTimer = setTimeout(() => child.kill('SIGKILL'), 1000); };
    const retain = (fd, bytes) => {
      observed += bytes.length;
      if (observed > seal.captureCap) { stop('capture cap'); return; }
      try { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(fd, bytes, offset); if (count === 0) throw Error('zero write'); offset += count; } } catch (error) { stop(error); }
    };
    child.stdout.on('data', bytes => retain(stdout, bytes)); child.stderr.on('data', bytes => retain(stderr, bytes));
    child.on('error', stop); child.on('exit', (code, signal) => { exited = { code, signal }; });
    timer = setTimeout(() => stop('deadline'), seal.deadlineMs);
    const closed = await new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
    clearTimeout(timer); clearTimeout(killTimer); fs.fsyncSync(stdout); fs.fsyncSync(stderr); fs.closeSync(stdout); fs.closeSync(stderr);
    verify(); await hashTool();
    const result = Object.freeze({ pid: child.pid, exited, closed, observedBytes: observed, failurePresent, failure, postguards: seal.files.length, pureChildStarts: 1, pureChildCloses: 1, parentChildPeak: 2, workerStarts: 0, engineEvaluations: 0 });
    write(path.join(root, 'RUN.json'), json(result)); emit(result);
    if (failurePresent || closed.code !== 0 || closed.signal !== null) process.exitCode = 1;
  } else throw Error('unknown phase');
} catch (error) { emit({ error: String(error), stack: error?.stack }); process.exitCode = 1; }
finally { fs.fsyncSync(capture); fs.closeSync(capture); }
