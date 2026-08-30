import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { captureTool, verifyTool } from './npm-tool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const previous = JSON.parse(fs.readFileSync(path.join(here, 'NPM-TOOL-LINKS.json')));
const approved = previous.links.map(link => ({ path: link.path, mode: link.mode, target: link.target })).sort((left, right) => left.path < right.path ? -1 : 1);
const tool = captureTool(previous.root, approved);
assert.equal(tool.links.length, 12);
for (const actual of tool.links) {
  const old = previous.links.find(link => link.path === actual.path);
  assert.equal(path.join(tool.root, actual.resolved), old.resolved);
  for (const field of ['targetMode', 'targetBytes', 'targetSha256']) assert.equal(actual[field], old[field]);
}
assert.equal(JSON.parse(fs.readFileSync(path.join(tool.root, 'package.json'))).version, '10.9.7');
assert.equal(tool.entries.find(entry => entry.path === 'bin/npm-cli.js').sha256, previous.cliSha256);
verifyTool(tool);
const bytes = Buffer.from(JSON.stringify(tool));
const encoded = gzipSync(bytes, { level: 9 }).toString('base64') + '\n';
const filename = path.join(here, 'NPM-TOOL-INVENTORY.json.gz.base64');
assert.ok(!fs.existsSync(filename), 'never replace inventory');
execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${filename}\n+${encoded}*** End Patch\n`, timeout: 10000 });
console.log(JSON.stringify({ kind: 'metadata-only-npm-closure', root: tool.root, version: '10.9.7', rootMode: tool.rootMode, entries: tool.entries.length, files: tool.entries.filter(entry => entry.kind === 'file').length, directories: tool.entries.filter(entry => entry.kind === 'directory').length, links: tool.links.length, encodedSha256: createHash('sha256').update(encoded).digest('hex'), decodedSha256: createHash('sha256').update(bytes).digest('hex'), npmExecutions: 0 }, null, 2));
