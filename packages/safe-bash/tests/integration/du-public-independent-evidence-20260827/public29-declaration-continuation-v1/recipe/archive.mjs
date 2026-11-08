import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { safe as safeRelative, sha as sha256 } from './common.mjs';

export function archiveMembers(pack, limit, onMember) {
  const tar = gunzipSync(pack, { maxOutputLength: limit });
  const members = {};
  let offset = 0;
  let pending = null;
  function text(header, start, length) { return header.subarray(start, start + length).toString().replace(/\0.*$/su, ''); }
  function octal(header, start, length) { const value = text(header, start, length).trim(); assert.match(value || '0', /^[0-7]+$/u); return parseInt(value || '0', 8); }
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) { assert.ok(tar.subarray(offset).every(byte => byte === 0)); break; }
    const checksum = octal(header, 148, 8);
    let actual = 0;
    for (let index = 0; index < 512; index++) actual += index >= 148 && index < 156 ? 32 : header[index];
    assert.equal(actual, checksum, 'tar header checksum');
    const size = octal(header, 124, 12);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    const prefix = text(header, 345, 155);
    const base = text(header, 0, 100);
    const name = prefix ? `${prefix}/${base}` : base;
    const type = String.fromCharCode(header[156]);
    assert.equal(text(header, 157, 100), '', 'archive links forbidden');
    if (type === 'x') {
      assert.equal(pending, null, 'multiple pending pax headers');
      pending = {};
      let cursor = 0;
      while (cursor < body.length) {
        const space = body.indexOf(32, cursor);
        assert.ok(space > cursor);
        const length = Number(body.subarray(cursor, space).toString());
        assert.ok(Number.isSafeInteger(length) && length > 0 && cursor + length <= body.length);
        const record = body.subarray(space + 1, cursor + length).toString();
        assert.ok(record.endsWith('\n'));
        const equal = record.indexOf('=');
        assert.ok(equal > 0);
        const key = record.slice(0, equal);
        assert.ok(['path', 'mtime', 'atime', 'ctime', 'uid', 'gid', 'uname', 'gname', 'size'].includes(key), `unsupported pax ${key}`);
        assert.ok(!Object.hasOwn(pending, key));
        pending[key] = record.slice(equal + 1, -1);
        cursor += length;
      }
    } else {
      assert.ok(type === '0' || type === '\0', `nonregular archive member ${type}`);
      const effective = pending?.path ?? name;
      safeRelative(effective);
      assert.ok(effective.startsWith('package/'));
      if (pending?.size) assert.equal(Number(pending.size), size);
      const member = effective.slice('package/'.length);
      safeRelative(member);
      assert.ok(!Object.hasOwn(members, member), 'duplicate archive member');
      assert.ok((octal(header, 100, 8) & 0o170000) === 0 || (octal(header, 100, 8) & 0o170000) === 0o100000);
      members[member] = sha256(body);
      onMember(member, Buffer.from(body), octal(header, 100, 8) & 0o777);
      pending = null;
      assert.ok(Object.keys(members).length <= 2000, 'archive member bound');
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(pending, null);
  assert.ok(offset + 1024 <= tar.length, 'two tar end blocks');
  return members;
}
