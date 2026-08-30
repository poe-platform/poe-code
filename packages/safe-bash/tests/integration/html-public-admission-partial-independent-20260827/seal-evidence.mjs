import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { identity, inventory, own, write } from './common.mjs';

assert.equal(process.argv.length, 2);
const result = JSON.parse(readFileSync(join(own, 'RESULT.json')));
assert.deepEqual(identity(join(own, 'captures.tgz')), result.compact);
assert.equal(result.allGroupsSettled, true);
assert.equal(result.worktreeRemoved, true);
assert.equal(result.executionDirectoryRemoved, true);
assert.ok(!existsSync(join(own, 'node_modules', 'partial-work')));
assert.ok(!existsSync(join(own, 'execution')));
let buffer = Buffer.alloc(0), current, padding = 0, total = 0, ended = false;
const members = {}, directories = [], paxHeaders = [];
const decoder = createReadStream(join(own, 'captures.tgz')).pipe(createGunzip({ chunkSize: 65536 }));
for await (const chunk of decoder) {
  total += chunk.length; assert.ok(total <= 128 * 1024 ** 2, 'compact evidence raw ceiling');
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length) {
    if (current) {
      const take = Math.min(current.remaining, buffer.length);
      current.digest.update(buffer.subarray(0, take));
      if (current.pax) current.fragments.push(Buffer.from(buffer.subarray(0, take)));
      current.remaining -= take; buffer = buffer.subarray(take);
      if (current.remaining) break;
      const receipt = { bytes: current.size, sha256: current.digest.digest('hex') };
      if (current.pax) {
        const payload = Buffer.concat(current.fragments), keys = [];
        let cursor = 0;
        while (cursor < payload.length) {
          const separator = payload.indexOf(32, cursor); assert.ok(separator > cursor);
          const size = Number(payload.subarray(cursor, separator).toString('ascii'));
          assert.ok(Number.isSafeInteger(size) && size > separator - cursor && cursor + size <= payload.length);
          const record = payload.subarray(separator + 1, cursor + size); assert.equal(record.at(-1), 10);
          const equals = record.indexOf(61); assert.ok(equals > 0);
          const key = record.subarray(0, equals).toString('ascii');
          assert.ok(['mtime', 'LIBARCHIVE.xattr.com.apple.provenance', 'SCHILY.xattr.com.apple.provenance'].includes(key), `PAX override not permitted: ${key}`);
          keys.push(key); cursor += size;
        }
        paxHeaders.push({ name: current.name, ...receipt, keys, applied: false });
      } else members[current.name] = receipt;
      padding = (512 - current.size % 512) % 512; current = undefined;
    } else if (padding) {
      const take = Math.min(padding, buffer.length); assert.ok(buffer.subarray(0, take).every(byte => byte === 0));
      padding -= take; buffer = buffer.subarray(take);
    } else {
      if (buffer.length < 512) break;
      const header = buffer.subarray(0, 512); buffer = buffer.subarray(512);
      if (header.every(byte => byte === 0)) { ended = true; continue; }
      assert.equal(ended, false, 'nonzero record after tar terminator');
      const text = (start, length) => header.subarray(start, start + length).toString().split('\0')[0];
      const checksum = Number.parseInt(text(148, 8).trim(), 8);
      assert.equal(header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0), checksum);
      const prefix = text(345, 155), rawName = `${prefix ? `${prefix}/` : ''}${text(0, 100)}`;
      const name = rawName.slice(2), type = text(156, 1), size = Number.parseInt(text(124, 12).trim(), 8);
      assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= 32 * 1024 ** 2);
      if (type === 'x') {
        assert.ok(size > 0 && size <= 65536);
        current = { name: rawName, size, remaining: size, digest: createHash('sha256'), pax: true, fragments: [] };
        continue;
      }
      assert.ok(rawName.startsWith('./'));
      if (type === '5') { assert.equal(size, 0); directories.push(name); continue; }
      assert.ok(type === '0' || type === '', `unexpected compact member kind ${type}`);
      assert.ok(name && !name.split('/').some(part => part === '..' || part === '.' || part === ''));
      assert.ok(!Object.hasOwn(members, name));
      current = { name, size, remaining: size, digest: createHash('sha256') };
      if (size === 0) { members[name] = { bytes: 0, sha256: current.digest.digest('hex') }; current = undefined; }
    }
  }
}
assert.equal(current, undefined); assert.equal(padding, 0); assert.equal(buffer.length, 0); assert.equal(ended, true);
assert.deepEqual(Object.keys(members).sort(), Object.keys(result.rawFiles).sort());
for (const [name, entry] of Object.entries(members)) { assert.equal(entry.sha256, result.rawFiles[name].sha256, name); assert.equal(entry.bytes, result.rawFiles[name].bytes, name); }
write(join(own, 'COMPACT-VERIFIED.json'), { at: new Date().toISOString(), archive: result.compact, rawTarBytes: total, regularFiles: Object.keys(members).length, directories: directories.length, paxHeaders, allRawMemberNamesBytesHashesMatched: true, extractedFiles: 0, inputArchiveReplayed: false, newCases: 0, postOnlyAttempt: 2, priorPostParserFailure: 'COMPACT-CHECK-ATTEMPT-1.json' });
const files = inventory(own);
assert.ok(!Object.hasOwn(files, 'EVIDENCE-MANIFEST.json'));
write(join(own, 'EVIDENCE-MANIFEST.json'), { schema: 'html-partial-evidence/1', at: new Date().toISOString(), recipeCommit: result.recipeCommit, recipeManifestSha256: result.recipeManifestSha256, status: result.status, coveredFiles: Object.keys(files).length, files, scope: 'partial only; no old RSS rescore, v2 global acceptance, HTML34, v3.2 or DU29 execution' });
console.log(JSON.stringify({ evidenceManifestSha256: identity(join(own, 'EVIDENCE-MANIFEST.json')).sha256, coveredFiles: Object.keys(files).length, compactRawFiles: Object.keys(members).length, status: result.status }));
