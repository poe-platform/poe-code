import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(own, '../../..');
const root = JSON.parse(fs.readFileSync(path.join(own, 'PREP.json'))).root;
const output = [];
try {
  for (const request of JSON.parse(process.argv[2])) {
    if (!/^(src\/shell\/|src\/contracts\/|tests\/compatibility\/bash-(strict-mode|redirection)-author-20260829\/)/.test(request.path) || request.path.includes('AGENTS') || !/\.(ts|mjs|json|md)$/.test(request.path)) throw Error('path');
    const target = path.join(repo, request.path), stat = fs.lstatSync(target); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw Error('size');
    const lines = fs.readFileSync(target, 'utf8').split('\n');
    const text = request.pattern ? lines.flatMap((line, index) => new RegExp(request.pattern).test(line) ? [`${index + 1}:${line}`] : []).join('\n') : lines.slice(request.from - 1, request.to).map((line, index) => `${request.from + index}:${line}`).join('\n');
    output.push({ path: request.path, text });
  }
  const bytes = JSON.stringify(output, null, 2); if (Buffer.byteLength(bytes) > 128 * 1024) throw Error('capture');
  fs.writeFileSync(path.join(root, `read-${Date.now()}.json`), bytes, { flag: 'wx' });
  for (const row of output) console.log(row.path + '\n' + row.text);
} catch (error) { fs.writeFileSync(path.join(root, `read-error-${Date.now()}.json`), JSON.stringify({ output, error: String(error) }), { flag: 'wx' }); throw error; }
