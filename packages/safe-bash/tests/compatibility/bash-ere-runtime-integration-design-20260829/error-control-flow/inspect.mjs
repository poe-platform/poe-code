import fs from 'node:fs';
import crypto from 'node:crypto';

const output = 'tests/compatibility/bash-ere-runtime-integration-design-20260829/error-control-flow';
const prior = 'tests/compatibility/bash-ere-runtime-integration-design-20260829';
const admitted = [];
let totalBytes = 0;
function read(path, expected, maximum = 1048576) {
  const before = fs.lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum) throw new Error(`file admission: ${path}`);
  const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes;
  try {
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error('opened identity');
    bytes = fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== before.size || sha256 !== expected) throw new Error(`hash admission: ${path}`);
  totalBytes += bytes.length;
  if (totalBytes > 2097152) throw new Error('aggregate source admission');
  admitted.push({path, bytes: bytes.length, sha256});
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}
const started = new Date().toISOString();
const catalog = JSON.parse(read(`${prior}/CORE-SOURCE.json.data`, '12a5806df9ea13eb66e99bec1f0c0c3198bfeb76da012559d943a4d874070fc4'));
const sources = [
  {name: 'gnu-execute', path: '/tmp/safe-bash-reference-source-20260829-fn91Rw/bash-5.3/execute_cmd.c', sha256: '5b7da1b3c61225fdf726929ffbc4f89f7068cbe83d2060b6ad1509c2feb9a032'},
  {name: 'gnu-regmatch', path: '/tmp/safe-bash-reference-source-20260829-fn91Rw/bash-5.3/lib/sh/shmatch.c', sha256: 'c889cb70a2670e5f009e4b0f77e6b32ad0c6d55a6bfe36f6cfab14a58515d06c'},
];
for (const name of ['conditional', 'runtime', 'parser', 'shell', 'cancellation']) {
  const path = `src/shell/${name}.ts`;
  const row = catalog.inputs.find(entry => entry.path === path);
  if (!row || typeof row.sha256 !== 'string') throw new Error(`catalog row: ${path}`);
  sources.push({name: `core-${name}`, path: `${prior}/selected/${path.replaceAll('/', '__')}.data`, sha256: row.sha256});
}
const excerpts = [];
for (const source of sources) {
  const text = read(source.path, source.sha256);
  const lines = text.split('\n');
  const selected = new Set();
  const patterns = source.name === 'gnu-execute' ? [/^execute_cond_node \(/, /^execute_cond_command \(/, /^execute_connection \(/, /case cm_cond:/, /invert =/, /if \(invert\)/] : source.name === 'gnu-regmatch' ? [/^sh_regmatch \(/] : source.name === 'core-conditional' ? [/export async function evaluateConditional/, /operator === "=~"/, /async function binary/] : source.name === 'core-runtime' ? [/evaluateConditional\(/, /ConditionalUnsupported/, /instanceof ShellLimitError/, /case "and"/, /case "or"/, /async andOr/, /async pipeline/] : source.name === 'core-parser' ? [/conditional/, /Conditional/, /\[\[/] : source.name === 'core-shell' ? [/async exec/, /ShellLimitError/, /cancellation/] : [/select/, /ShellLimitError/, /primary/];
  for (let index = 0; index < lines.length; index++) {
    if (patterns.some(pattern => pattern.test(lines[index]))) {
      const after = source.name === 'gnu-execute' && /^execute_cond_node \(/.test(lines[index]) ? 245 : source.name === 'gnu-execute' && /^execute_connection \(/.test(lines[index]) ? 295 : source.name === 'gnu-regmatch' ? 130 : source.name === 'core-conditional' ? 80 : 24;
      for (let cursor = Math.max(0, index - 8); cursor <= Math.min(lines.length - 1, index + after); cursor++) selected.add(cursor);
    }
  }
  const excerpt = [...selected].sort((left,right) => left-right).map(index => `${index+1}:${lines[index]}`).join('\n') + '\n';
  fs.writeFileSync(`${output}/${source.name}.source.txt`, excerpt, {flag: 'wx', mode: 0o600});
  excerpts.push({name: source.name, sourceSha256: source.sha256, sourceLines: lines.length, selectedLines: selected.size, excerptSha256: crypto.createHash('sha256').update(excerpt).digest('hex')});
}
const result = {kind: 'SOURCE_ONLY', started, completed: new Date().toISOString(), core: catalog.computedTree, totalBytes, admitted, excerpts, productExecutions: 0};
fs.writeFileSync(`${output}/BINDINGS.json`, JSON.stringify(result, null, 2)+'\n', {flag: 'wx', mode: 0o600});
console.log(JSON.stringify(result, null, 2));
