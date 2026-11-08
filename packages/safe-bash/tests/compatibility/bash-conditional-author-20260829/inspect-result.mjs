import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url));
const capture = JSON.parse(fs.readFileSync(path.join(own, 'PREP.json'))).root;
const descriptor = fs.openSync(path.join(capture, `inspect-result-${Date.now()}.json`), 'wx');
const log = { role: 'RETAINED_RESULT_READONLY' };
try {
  const outer = process.argv[2]; if (!/^\/tmp\/bash-conditional-launch-[a-zA-Z0-9]+$/.test(outer)) throw Error('outer');
  const text = fs.readFileSync(path.join(outer, 'stdout'), 'utf8');
  const root = JSON.parse(text.split('\n')[0]).output;
  if (!/^\/tmp\/conditional-author-[a-zA-Z0-9]+$/.test(root)) throw Error('root');
  const file = path.join(root, 'RESULT.json'); if (fs.statSync(file).size > 16000000) throw Error('bound');
  const result = JSON.parse(fs.readFileSync(file));
  for (const [label, relative] of [['exports', 'package.json'], ['rootIndex', 'src/index.ts']]) {
    const target = path.join(root, 'source', relative); if (fs.statSync(target).size > 65536) throw Error('source bound');
    const text = fs.readFileSync(target, 'utf8'); log[label] = label === 'exports' ? JSON.parse(text).exports : text.split('\n').filter(line => /shell|parseShell/.test(line));
  }
  if (process.argv[3]) {
    if (!/^[a-zA-Z0-9-]+$/.test(process.argv[3])) throw Error('label');
    log.raw = {};
    for (const extension of ['stdout', 'stderr']) { const artifact = path.join(root, process.argv[3] + '.' + extension); if (fs.statSync(artifact).size > 1024 * 1024) throw Error('bound'); log.raw[extension] = fs.readFileSync(artifact, 'utf8'); }
  }
  Object.assign(log, { root, error: result.error, status: result.status, failures: result.failures, package: result.package?.sha256, packageBytes: result.package?.bytes, members: result.package?.members?.length, cleanup: result.cleanup, controls: result.controls, types: result.types.map(row => ({ label: row.label, pass: row.pass, errors: row.errors })), cohorts: result.cohorts.map(row => ({ label: row.label, pass: row.pass, fail: row.fail, cases: row.cases?.length })), children: result.children.map(row => ({ label: row.label, code: row.code, closed: row.closed, signal: row.signal })), scratch: result.actualScratchBytes });
} catch (error) { log.error = String(error?.stack ?? error); process.exitCode = 1; }
finally { fs.writeSync(descriptor, JSON.stringify(log, null, 2)); fs.closeSync(descriptor); }
console.log(JSON.stringify({ ...log, exports: undefined, rootIndex: undefined, types: log.types?.map(row => ({ label: row.label, pass: row.pass, diagnostics: row.errors.length })) }));
