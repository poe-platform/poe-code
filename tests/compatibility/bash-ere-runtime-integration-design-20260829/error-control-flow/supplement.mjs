import fs from 'node:fs';
import crypto from 'node:crypto';

const root = 'tests/compatibility/bash-ere-runtime-integration-design-20260829/error-control-flow';
const inputs = [
  {name: 'gnu-parse', path: '/tmp/safe-bash-reference-source-20260829-fn91Rw/bash-5.3/parse.y', hash: '076a16d00c5b065137b3d2730d2b94a1f6c89a1bbb5d2f4bd72d31e00947e27f', ranges: [], patterns: [/CMD_INVERT_RETURN/, /cond_expr \(/, /cond_or \(/, /cond_and \(/, /cond_term \(/]},
  {name: 'gnu-command-boundary', path: '/tmp/safe-bash-reference-source-20260829-fn91Rw/bash-5.3/execute_cmd.c', hash: '5b7da1b3c61225fdf726929ffbc4f89f7068cbe83d2060b6ad1509c2feb9a032', ranges: [[1125,1178],[1190,1215]], patterns: []},
  {name: 'core-list-boundary', path: 'tests/compatibility/bash-ere-runtime-integration-design-20260829/selected/src__shell__runtime.ts.data', hash: '4e67e4e5d1d4a0c6b9b479d4381edbab5948a7b2b292f219a46067aeee7ce058', ranges: [[1300,1383],[1470,1534]], patterns: []},
];
let totalBytes = 0;
const records = [];
for (const input of inputs) {
  const stat = fs.lstatSync(input.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) throw new Error('source type/size');
  const descriptor = fs.openSync(input.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes;
  try {
    const opened = fs.fstatSync(descriptor);
    if (stat.ino !== opened.ino || stat.dev !== opened.dev || stat.size !== opened.size) throw new Error('source inode');
    bytes = fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== input.hash || bytes.length !== stat.size) throw new Error('source hash');
  totalBytes += bytes.length;
  if (totalBytes > 786432) throw new Error('aggregate source bytes');
  const lines = new TextDecoder('utf8', {fatal: true}).decode(bytes).split('\n');
  const selected = new Set();
  for (const [first,last] of input.ranges) for (let line = first; line <= last; line++) selected.add(line-1);
  for (let index=0; index<lines.length; index++) if (input.patterns.some(pattern => pattern.test(lines[index]))) {
    for (let cursor=Math.max(0,index-4); cursor<=Math.min(lines.length-1,index+10); cursor++) selected.add(cursor);
  }
  const text = [...selected].sort((left,right)=>left-right).map(index=>`${index+1}:${lines[index]}`).join('\n')+'\n';
  fs.writeFileSync(`${root}/${input.name}.source.txt`, text, {flag:'wx',mode:0o600});
  records.push({path:input.path,sha256,bytes:bytes.length,excerpt:input.name,excerptSha256:crypto.createHash('sha256').update(text).digest('hex')});
}
const result = {role:'SOURCE_ONLY',completed:new Date().toISOString(),totalBytes,records};
fs.writeFileSync(`${root}/SUPPLEMENT-BINDINGS.json`,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(result));
