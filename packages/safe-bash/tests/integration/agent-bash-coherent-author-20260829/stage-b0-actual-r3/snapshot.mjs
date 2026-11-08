import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const scope = path.resolve('tests/integration/agent-bash-coherent-author-20260829/stage-b0-actual-r3');
const work = '/private/tmp/safe-bash-coherent-b0-20260829-r3';
const evidence = path.join(scope, 'evidence');
const limit = 805306368;
let bytes = 0;
const entries = [];
const digest = async file => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const walk = async (directory, relative = '') => {
  for (const name of fs.readdirSync(directory).sort()) {
    const child = path.join(directory, name);
    const key = relative ? `${relative}/${name}` : name;
    const stat = fs.lstatSync(child);
    if (name === 'AGENTS.md') throw new Error('Unexpected instruction entry; no body read');
    if (stat.isSymbolicLink()) entries.push({ path: key, type: 'link', target: fs.readlinkSync(child) });
    else if (stat.isDirectory()) {
      entries.push({ path: key, type: 'directory' });
      await walk(child, key);
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > limit) throw new Error('Work inventory limit');
      entries.push({ path: key, type: 'file', bytes: stat.size, sha256: await digest(child) });
    } else throw new Error(`Unsupported owned entry ${key}`);
  }
};
const text = file => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 2097152) throw new Error(`Text admission ${file}`);
  return fs.readFileSync(file, 'utf8');
};
try {
  fs.mkdirSync(evidence);
  await walk(work);
  const inventory = { at: new Date().toISOString(), root: work, bytes, entries };
  fs.writeFileSync(path.join(evidence, 'WORK-INVENTORY.json'), `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' });
  const raw = [];
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    if (!(/(?:^|\/)(?:RESULT|STOP)\.json$/.test(entry.path) || /(?:stdout|stderr|events|capture|supervisor|retirement)/i.test(entry.path))) continue;
    if (entry.path.includes('/node_modules/') || entry.path.includes('/dist/')) continue;
    if (entry.bytes > 67108864) throw new Error('Raw capture size');
    const destination = path.join(evidence, 'raw', entry.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(work, entry.path), destination, fs.constants.COPYFILE_EXCL);
    if (await digest(destination) !== entry.sha256) throw new Error('Raw copy hash mismatch');
    raw.push(entry);
  }
  for (const name of ['coherent-b0-39-20260829-r3.launch.stdout', 'coherent-b0-39-20260829-r3.launch.stderr', 'coherent-b0-actual-r3-authorize-20260829.stdout', 'coherent-b0-actual-r3-authorize-20260829.stderr', 'coherent-b0-actual-r3-preflight-20260829.stdout', 'coherent-b0-actual-r3-preflight-20260829.stderr']) {
    const file = path.join('/private/tmp', name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 67108864) throw new Error('Outer capture admission');
    const hash = await digest(file);
    fs.copyFileSync(file, path.join(evidence, name), fs.constants.COPYFILE_EXCL);
    raw.push({ path: file, type: 'file', bytes: stat.size, sha256: hash });
  }
  fs.writeFileSync(path.join(evidence, 'RAW-MANIFEST.json'), `${JSON.stringify(raw, null, 2)}\n`, { flag: 'wx' });
  for (const name of ['RESULT.json', 'STOP.json']) if (fs.existsSync(path.join(work, name))) console.log(name, text(path.join(work, name)));
  console.log('CAPTURE_FILES', JSON.stringify(raw));
  console.log('ROOT_ENTRIES', JSON.stringify(entries.filter(entry => entry.path.split('/').length <= 2)));
  for (const name of ['run.mjs', 'owner.mjs']) {
    const file = path.join(path.dirname(scope), 'stage-b0-r3', name);
    console.log('SEALED_SOURCE_REFERENCE', name, text(file));
  }
  console.log('SNAPSHOT', JSON.stringify({ at: inventory.at, bytes, entries: entries.length, rawFiles: raw.length }));
} catch (error) {
  console.error(error);
  process.exitCode = 78;
}
