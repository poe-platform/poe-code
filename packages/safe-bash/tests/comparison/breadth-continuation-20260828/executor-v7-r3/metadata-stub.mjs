#!/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.dirname(fileURLToPath(import.meta.url));
const mapping = JSON.parse(fs.readFileSync(path.join(root, 'runs/METADATA.json')));
const key = process.argv[3];
if (process.argv.length !== 4 || process.argv[2] !== 'show' || !Object.hasOwn(mapping, key)) throw new Error('STUB_METADATA_ROUTE');
const entry = mapping[key];
const filename = path.resolve(root, entry.path);
if (!filename.startsWith(`${root}/runs/`) || filename.split(path.sep).some(name => name.toUpperCase() === 'AGENTS.MD')) throw new Error('STUB_METADATA_PATH');
const info = fs.lstatSync(filename);
if (!info.isFile() || info.isSymbolicLink() || info.size > 65536 || (info.mode & 0o7777) !== 0o644) throw new Error('STUB_METADATA_FILE');
const bytes = fs.readFileSync(filename);
if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('STUB_METADATA_HASH');
fs.writeSync(1, bytes);
