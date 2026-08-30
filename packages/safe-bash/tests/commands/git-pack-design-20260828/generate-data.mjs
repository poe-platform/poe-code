import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const directory = new URL('./', import.meta.url);
const neutralBytes = await readFile(new URL('../git-design-20260828/NEUTRAL-FIXTURE.json', directory));
const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest();
const hex = (bytes, algorithm = 'sha256') => digest(bytes, algorithm).toString('hex');
const neutralSha256 = 'fcb7bae1505a86b2b676396742d7bf362ad779c77192770ed94085646f8d0074';
assert.equal(hex(neutralBytes), neutralSha256);
assert.deepEqual(process.argv.slice(2), ['--generate']);
assert.equal(process.version, 'v22.22.2');
const neutral = JSON.parse(neutralBytes);
const typeCodes = { commit: 1, tree: 2, blob: 3, tag: 4 };
const objectId = (type, body) => hex(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]), 'sha1');
const crcTable = Uint32Array.from({ length: 256 }, (_, entry) => {
  let value = entry;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
const crc32 = bytes => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
const word = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };
const sizeVarint = value => {
  assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= 98304);
  const bytes = [];
  do { const part = value % 128; value = Math.floor(value / 128); bytes.push(part | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
};
const header = (type, size) => {
  const bytes = [(type * 16) + size % 16];
  size = Math.floor(size / 16);
  while (size) {
    bytes[bytes.length - 1] |= 128;
    bytes.push(size % 128);
    size = Math.floor(size / 128);
  }
  return Buffer.from(bytes);
};
const offsetEncoding = distance => {
  assert.ok(Number.isSafeInteger(distance) && distance > 0);
  const bytes = [distance % 128];
  while ((distance = Math.floor(distance / 128)) > 0) {
    distance--;
    bytes.unshift(128 | (distance % 128));
  }
  return Buffer.from(bytes);
};
assert.equal(offsetEncoding(128).toString('hex'), '8000');
assert.equal(offsetEncoding(16384).toString('hex'), 'ff00');
const literal = bytes => {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 127) {
    const chunk = bytes.subarray(offset, offset + 127);
    parts.push(Buffer.from([chunk.length]), chunk);
  }
  return Buffer.concat(parts);
};
const copy = length => {
  assert.ok(length > 0 && length <= 98304);
  let opcode = 128;
  const argumentsBytes = [];
  if (length !== 65536) {
    for (let position = 0; position < 3; position++) {
      const byte = Math.floor(length / 256 ** position) % 256;
      if (byte) { opcode |= 16 * 2 ** position; argumentsBytes.push(byte); }
    }
  }
  return Buffer.from([opcode, ...argumentsBytes]);
};
const appendProgram = (base, addition) => Buffer.concat([
  sizeVarint(base.length), sizeVarint(base.length + addition.length),
  ...(base.length ? [copy(base.length)] : []), literal(addition),
]);
const direct = (body, type = 'blob', level = 9) => ({ kind: 'direct', type, body: Buffer.from(body), level });
const delta = (kind, base, body, program) => ({ kind, type: 'blob', base, body: Buffer.from(body), program });

const makeFixture = (id, description, specs, version = 2, largeEntry = undefined, expectedStage = undefined) => {
  assert.ok(specs.length <= 40);
  const objectIds = specs.map(spec => objectId(spec.type, spec.body));
  assert.equal(new Set(objectIds).size, objectIds.length);
  const packHeader = Buffer.concat([Buffer.from('PACK'), word(version), word(specs.length)]);
  const entryBuffers = [];
  const rows = [];
  let offset = 12;
  for (const [entryNumber, spec] of specs.entries()) {
    assert.ok(spec.body.length <= 98304);
    const content = spec.kind === 'direct' ? spec.body : spec.program;
    assert.ok(content.length <= 98304);
    const encodedType = spec.kind === 'direct' ? typeCodes[spec.type] : spec.kind === 'ofs' ? 6 : 7;
    const prefix = spec.kind === 'direct' ? Buffer.alloc(0) : spec.kind === 'ofs'
      ? offsetEncoding(offset - rows[spec.base].offset) : Buffer.from(objectIds[spec.base], 'hex');
    const entryHeader = header(encodedType, content.length);
    const compressed = deflateSync(content, { level: spec.level ?? 9 });
    const encoded = Buffer.concat([entryHeader, prefix, compressed]);
    entryBuffers.push(encoded);
    rows.push({
      entry: entryNumber, offset, end: offset + encoded.length,
      compressedStart: offset + entryHeader.length + prefix.length,
      encodedType, declaredBytes: content.length, baseEntry: spec.base ?? null,
      basePrefixHex: prefix.toString('hex'), oid: objectIds[entryNumber], type: spec.type,
      bodyBase64: spec.body.toString('base64'), bodySha256: hex(spec.body),
      programBase64: spec.program?.toString('base64') ?? null, crc32: crc32(encoded),
    });
    offset += encoded.length;
  }
  const packPayload = Buffer.concat([packHeader, ...entryBuffers]);
  const packSha1 = digest(packPayload, 'sha1');
  const pack = Buffer.concat([packPayload, packSha1]);
  assert.ok(pack.length <= 262144);
  const sorted = [...rows].sort((left, right) => Buffer.compare(Buffer.from(left.oid, 'hex'), Buffer.from(right.oid, 'hex')));
  const fanout = Buffer.alloc(1024);
  for (let bucket = 0; bucket < 256; bucket++) fanout.writeUInt32BE(sorted.filter(row => Number.parseInt(row.oid.slice(0, 2), 16) <= bucket).length, bucket * 4);
  const largeOffsets = [];
  const encodedOffsets = sorted.map(row => {
    if (row.entry !== largeEntry) return word(row.offset);
    const large = Buffer.alloc(8);
    large.writeBigUInt64BE(BigInt(row.offset));
    largeOffsets.push(large);
    return word(0x80000000 + largeOffsets.length - 1);
  });
  const indexPayload = Buffer.concat([
    Buffer.from('ff744f6300000002', 'hex'), fanout,
    ...sorted.map(row => Buffer.from(row.oid, 'hex')),
    ...sorted.map(row => word(row.crc32)), ...encodedOffsets, ...largeOffsets, packSha1,
  ]);
  const index = Buffer.concat([indexPayload, digest(indexPayload, 'sha1')]);
  const depthOf = (entry, seen = new Set()) => {
    assert.ok(!seen.has(entry));
    seen.add(entry);
    return specs[entry].kind === 'direct' ? 0 : 1 + depthOf(specs[entry].base, seen);
  };
  const depth = specs.length ? Math.max(...specs.map((_, entry) => depthOf(entry))) : 0;
  return {
    id, description, version, count: specs.length, maxDepth: depth,
    profile: expectedStage ? 'MALFORMED_DATA' : depth > 32 ? 'FORMAT_VALID_PROFILE_DEPTH_REFUSAL' : 'PROPOSED_PROFILE_DATA',
    expectedStage: expectedStage ?? null, packSha1: packSha1.toString('hex'),
    packSha256: hex(pack), indexSha256: hex(index), packBytes: pack.length, indexBytes: index.length,
    packBase64: pack.toString('base64'), indexBase64: index.toString('base64'), entries: rows,
  };
};

const neutralObjects = neutral.files.filter(file => /^\.git\/objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/.test(file.path)).map(file => {
  const raw = inflateSync(Buffer.from(file.base64, 'base64'), { maxOutputLength: 98304 });
  const separator = raw.indexOf(0);
  assert.ok(separator > 0);
  const [type, size] = raw.subarray(0, separator).toString('ascii').split(' ');
  const body = Buffer.from(raw.subarray(separator + 1));
  assert.equal(body.length, Number(size));
  assert.equal(objectId(type, body), file.path.slice('.git/objects/'.length).replace('/', ''));
  return direct(body, type);
});
assert.equal(neutralObjects.length, 11);
const fixtures = [
  makeFixture('P01', 'Original eleven-object graph as direct pack2 entries', neutralObjects),
  makeFixture('P02', 'Same exact graph in pack3', neutralObjects, 3),
];
const base128 = Buffer.alloc(115, 65);
const ofs128 = makeFixture('P03', 'OFS distance128 literal8000', [direct(base128, 'blob', 0), delta('ofs', 0, Buffer.concat([base128, Buffer.from('!')]), appendProgram(base128, Buffer.from('!')))]);
assert.equal(ofs128.entries[0].end - ofs128.entries[0].offset, 128);
assert.equal(ofs128.entries[1].basePrefixHex, '8000');
fixtures.push(ofs128);
const smallBase = Buffer.from('base\n');
const addition = Buffer.from('next\n');
const smallResult = Buffer.concat([smallBase, addition]);
const smallProgram = appendProgram(smallBase, addition);
fixtures.push(makeFixture('P04', 'Backward REF', [direct(smallBase), delta('ref', 0, smallResult, smallProgram)]));
fixtures.push(makeFixture('P05', 'Forward REF, same objects different order', [delta('ref', 1, smallResult, smallProgram), direct(smallBase)]));
fixtures.push(makeFixture('P06', 'Mixed REF then OFS depth2', [
  direct(smallBase), delta('ref', 0, smallResult, smallProgram),
  delta('ofs', 1, Buffer.concat([smallResult, Buffer.from('third\n')]), appendProgram(smallResult, Buffer.from('third\n'))),
]));
const largeBase = Buffer.alloc(65536, 90);
fixtures.push(makeFixture('P07', 'Copy opcode80 implies65536 then literal', [direct(largeBase), delta('ofs', 0, Buffer.concat([largeBase, Buffer.from('!')]), appendProgram(largeBase, Buffer.from('!')))]));
const sparseBase = Buffer.from(Array.from({ length: 65540 }, (_, position) => position % 251));
const sparseResult = Buffer.from(sparseBase.subarray(65537, 65539));
const sparseProgram = Buffer.concat([sizeVarint(sparseBase.length), sizeVarint(2), Buffer.from([0x95, 0x01, 0x01, 0x02])]);
fixtures.push(makeFixture('P08', 'Copy offset bytes0/2 retain their positions', [direct(sparseBase), delta('ofs', 0, sparseResult, sparseProgram)]));
const longLiteral = Buffer.concat([Buffer.alloc(127, 88), Buffer.from('Y')]);
fixtures.push(makeFixture('P09', 'Empty base then insert127 and insert1', [direct(Buffer.alloc(0)), delta('ofs', 0, longLiteral, appendProgram(Buffer.alloc(0), longLiteral))]));
fixtures.push(makeFixture('P10', 'Empty valid pack/index', []));
fixtures.push(makeFixture('P11', 'Small actual offset via64-bit table', [direct(smallBase), delta('ref', 0, smallResult, smallProgram)], 2, 1));
const chain = depth => {
  const specs = [direct(Buffer.from('A'))];
  for (let level = 1; level <= depth; level++) {
    const base = specs[level - 1].body;
    specs.push(delta('ofs', level - 1, Buffer.concat([base, Buffer.from('+')]), appendProgram(base, Buffer.from('+'))));
  }
  return specs;
};
fixtures.push(makeFixture('P12', 'Exactly32 delta edges', chain(32)));
fixtures.push(makeFixture('P13', 'Valid format33 edges; proposed profile refuses', chain(33)));
const malformed = [
  makeFixture('D01', 'Reserved delta opcode0', [direct(smallBase), delta('ref', 0, smallResult, Buffer.from([5, 10, 0]))], 2, undefined, 'DELTA_OPCODE'),
  makeFixture('D02', 'Wrong declared base length', [direct(smallBase), delta('ref', 0, smallResult, Buffer.from([4, ...smallProgram.subarray(1)]))], 2, undefined, 'DELTA_BASE_SIZE'),
  makeFixture('D03', 'Truncated copy parameter', [direct(smallBase), delta('ref', 0, smallResult, Buffer.from([5, 10, 0x91, 0]))], 2, undefined, 'DELTA_TRUNCATED'),
];
const negatives = [
  ['N01', 'P04', 'pack-trailer', 'PACK_HASH'], ['N02', 'P04', 'index-trailer', 'INDEX_HASH'],
  ['N03', 'P04', 'pack-reference', 'PACK_REFERENCE'], ['N04', 'P04', 'crc', 'CRC'],
  ['N05', 'P04', 'fanout-bucket', 'FANOUT'], ['N06', 'P04', 'duplicate-oid', 'OID_ORDER'],
  ['N07', 'P04', 'duplicate-offset', 'OFFSET'], ['N08', 'P04', 'outside-offset', 'OFFSET'],
  ['N09', 'P11', 'unsafe-large-offset', 'OFFSET'], ['N10', 'P04', 'version', 'PACK_VERSION'],
  ['N11', 'P03', 'type-zero', 'ENTRY_TYPE'], ['N12', 'P03', 'ofs-zero', 'OFS_BASE'],
  ['N13', 'P03', 'ofs-interior', 'OFS_BASE'], ['N14', 'P04', 'ref-missing', 'REF_BASE'],
  ['N15', 'P04', 'trailing-byte', 'ZLIB_TRAILING'],
].map(([id, fixture, mutation, expectedStage]) => ({ id, fixture, mutation, expectedStage }));
const data = {
  format: 'git-m1b-neutral-data-v1', date: '2026-08-28', productExecutions: 0, nativeGitExecutions: 0,
  neutralSource: { path: 'tests/commands/git-design-20260828/NEUTRAL-FIXTURE.json', sha256: neutralSha256 },
  workflowTransformation: { removeExactly: neutral.files.filter(file => /^\.git\/objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/.test(file.path)).map(file => file.path), addFixture: ['P01', 'P02'], preserveOtherFiles: true },
  unchangedProposedOutputs: neutral.proposedOutputs, fixtures, malformed, negatives,
};
assert.equal(fixtures.length + malformed.length, 16);
assert.ok([...fixtures, ...malformed].reduce((sum, fixture) => sum + fixture.count, 0) <= 160);
const rawBytes = [...fixtures, ...malformed].reduce((sum, fixture) => sum + fixture.packBytes + fixture.indexBytes + fixture.entries.reduce((bodySum, entry) => bodySum + Buffer.from(entry.bodyBase64, 'base64').length + Buffer.from(entry.programBase64 ?? '', 'base64').length, 0), 0);
assert.ok(rawBytes <= 2097152);
const output = Buffer.from(`${JSON.stringify(data, null, 2)}\n`);
assert.ok(output.length <= 4194304);
await writeFile(new URL('NEUTRAL-PACKS.json', directory), output, { flag: 'wx' });
console.log(JSON.stringify({ role: 'DATA_GENERATION_ONLY', runtime: { version: process.version, path: process.execPath, sha256: hex(await readFile(process.execPath)) }, generatorSha256: hex(await readFile(fileURLToPath(import.meta.url))), inputSha256: hex(neutralBytes), fixtureSha256: hex(output), fixtureBytes: output.length, encodedPackSets: 16, proposedPositiveFormatSets: 13, malformedSets: 3, structuralMutationDescriptors: negatives.length, rawBytes, productExecutions: 0, nativeGitExecutions: 0 }));
