import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { base, command, directory, git, hash, inventory, json, revisions, textHashes } from './common.mjs';
import { fixtures } from './fixtures.mjs';

const root = realpathSync(mkdtempSync('/tmp/sort-cache-timing-'));
const archive = git('archive', base, 'src', 'package.json', 'tsconfig.json', 'tsconfig.build.json');
writeFileSync(join(root, 'source.tar'), archive, { flag: 'wx' });
const sources = {};
for (const [label, revision] of Object.entries(revisions)) {
  const path = join(root, label); mkdirSync(path);
  command('/usr/bin/tar', ['-xf', join(root, 'source.tar'), '-C', path]);
  const text = git('show', `${revision}:src/commands/text.ts`);
  assert.equal(hash(text), textHashes[label]);
  writeFileSync(join(path, 'src/commands/text.ts'), text);
  sources[label] = inventory(path);
  if (label !== 'A') assert.deepEqual(sources[label].filter(file => file.path !== 'src/commands/text.ts'), sources.A.filter(file => file.path !== 'src/commands/text.ts'));
}
for (const [left, right] of [['A', 'B'], ['B', 'C']]) {
  const patch = git('diff', revisions[left], revisions[right], '--', 'src/commands/text.ts');
  writeFileSync(join(directory, `${left}-${right}.patch`), patch, { flag: 'wx' });
}
const specimens = fixtures();
const encoded = Buffer.from(JSON.stringify(specimens));
const compressed = gzipSync(encoded, { level: 9 });
writeFileSync(join(directory, 'fixtures.json.gz'), compressed, { flag: 'wx' });
const profiles = specimens.map(specimen => ({ id: specimen.id, script: specimen.script, timing: specimen.timing ?? false, cold: specimen.cold ?? false, pair: specimen.pair ?? null, records: specimen.count ?? null, logicalCharge: specimen.logicalCharge ?? null, inputBytes: Buffer.from(specimen.input, 'base64').length, inputSha256: hash(Buffer.from(specimen.input, 'base64')), expectedSha256: hash(JSON.stringify(specimen.expected)) }));
assert.equal(profiles.filter(profile => profile.timing).length, 8);
assert.equal(profiles.filter(profile => profile.cold).length, 4);
json(join(directory, 'frozen.json'), { root, base, revisions, textHashes, sourceArchiveSha256: hash(archive), sources, fixtureSha256: hash(encoded), fixtureGzipSha256: hash(compressed), profiles, correctnessCalls: specimens.length * 3, measuredWarm: 192, measuredCold: 32, warmups: 32, totalCommands: specimens.length * 3 + 256, inputBytesConsumed: specimens.reduce((sum, specimen) => sum + Buffer.from(specimen.input, 'base64').length * (3 + (specimen.timing ? 28 : 0) + (specimen.cold ? 8 : 0)), 0), compilerSha256: hash(readFileSync('node_modules/typescript/bin/tsc')), compilerRuntimeSha256: hash(readFileSync('node_modules/typescript/lib/_tsc.js')), node: process.version, nodeExecutableSha256: hash(readFileSync(process.execPath)) });
console.log(JSON.stringify({ root, profiles: profiles.length, correctnessCalls: specimens.length * 3, timingProfiles: 8, loadObserved: false, productExecuted: false }));
