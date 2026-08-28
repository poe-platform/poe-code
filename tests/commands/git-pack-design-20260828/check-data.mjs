import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest();
const hex = (bytes, algorithm = 'sha256') => hash(bytes, algorithm).toString('hex');
const directory = new URL('./', import.meta.url);
const input = await readFile(new URL('NEUTRAL-PACKS.json', directory));
assert.ok(input.length <= 4194304);
assert.equal(process.version, 'v22.22.2');
assert.deepEqual(process.argv.slice(2), []);
const data = JSON.parse(input);
const neutralInput = await readFile(new URL('../git-design-20260828/NEUTRAL-FIXTURE.json', directory));
assert.equal(hex(neutralInput), 'fcb7bae1505a86b2b676396742d7bf362ad779c77192770ed94085646f8d0074');
const neutral = JSON.parse(neutralInput);
assert.deepEqual(data.unchangedProposedOutputs, neutral.proposedOutputs);
assert.equal(data.unchangedProposedOutputs.length, 6);
const crc = bytes => {
  let remainder = 0xffffffff;
  for (const byte of bytes) {
    remainder ^= byte;
    for (let bit = 0; bit < 8; bit++) remainder = (remainder >>> 1) ^ ((remainder & 1) ? 0xedb88320 : 0);
  }
  return (remainder ^ 0xffffffff) >>> 0;
};
assert.equal(crc(Buffer.from('123456789')), 0xcbf43926);
class InvalidData extends Error {
  constructor(stage) { super(stage); this.stage = stage; }
}
const requireData = (condition, stage) => { if (!condition) throw new InvalidData(stage); };
const decodeIndex = bytes => {
  requireData(bytes.length >= 1072 && bytes.length <= 262144, 'INDEX_SIZE');
  requireData(bytes.subarray(0, 8).equals(Buffer.from('ff744f6300000002', 'hex')), 'INDEX_HEADER');
  requireData(hash(bytes.subarray(0, -20), 'sha1').equals(bytes.subarray(-20)), 'INDEX_HASH');
  const count = bytes.readUInt32BE(1028);
  requireData(count <= 40, 'INDEX_COUNT');
  const largeStart = 1032 + count * 28;
  const extra = bytes.length - largeStart - 40;
  requireData(extra >= 0 && extra % 8 === 0 && extra / 8 <= count, 'INDEX_SIZE');
  const largeCount = extra / 8;
  const rows = [];
  const usedLarge = new Set();
  for (let row = 0; row < count; row++) {
    const oid = bytes.subarray(1032 + row * 20, 1052 + row * 20).toString('hex');
    if (row) requireData(rows[row - 1].oid < oid, 'OID_ORDER');
    const value = bytes.readUInt32BE(1032 + count * 24 + row * 4);
    let offset = value;
    if (value >= 0x80000000) {
      const slot = value - 0x80000000;
      requireData(slot < largeCount && !usedLarge.has(slot), 'OFFSET');
      usedLarge.add(slot);
      const large = bytes.readBigUInt64BE(largeStart + slot * 8);
      requireData(large <= BigInt(Number.MAX_SAFE_INTEGER), 'OFFSET');
      offset = Number(large);
    }
    rows.push({ oid, offset, crc: bytes.readUInt32BE(1032 + count * 20 + row * 4) });
  }
  requireData(usedLarge.size === largeCount, 'OFFSET');
  let previous = 0;
  for (let bucket = 0; bucket < 256; bucket++) {
    const cumulative = bytes.readUInt32BE(8 + bucket * 4);
    requireData(cumulative >= previous && cumulative <= count, 'FANOUT');
    requireData(cumulative === rows.filter(row => Number.parseInt(row.oid.slice(0, 2), 16) <= bucket).length, 'FANOUT');
    previous = cumulative;
  }
  return { rows, count, packHash: bytes.subarray(-40, -20) };
};

const reconstruct = (base, program) => {
  let cursor = 0;
  const byte = () => {
    requireData(cursor < program.length, 'DELTA_TRUNCATED');
    return program[cursor++];
  };
  const variable = () => {
    let result = 0;
    let multiplier = 1;
    for (let count = 0; count < 8; count++) {
      const part = byte();
      result += (part % 128) * multiplier;
      requireData(Number.isSafeInteger(result) && result <= 98304, 'DELTA_SIZE');
      if (part < 128) return result;
      multiplier *= 128;
    }
    throw new InvalidData('DELTA_SIZE');
  };
  requireData(variable() === base.length, 'DELTA_BASE_SIZE');
  const required = variable();
  const fragments = [];
  let produced = 0;
  while (cursor < program.length) {
    const opcode = byte();
    requireData(opcode !== 0, 'DELTA_OPCODE');
    let fragment;
    if (opcode < 128) {
      requireData(cursor + opcode <= program.length, 'DELTA_TRUNCATED');
      fragment = program.subarray(cursor, cursor + opcode);
      cursor += opcode;
    } else {
      let start = 0;
      let length = 0;
      for (let position = 0; position < 4; position++) if (opcode & 2 ** position) start += byte() * 256 ** position;
      for (let position = 0; position < 3; position++) if (opcode & 2 ** (position + 4)) length += byte() * 256 ** position;
      if (!length) length = 65536;
      requireData(start <= base.length && length <= base.length - start, 'DELTA_COPY');
      fragment = base.subarray(start, start + length);
    }
    requireData(fragment.length <= required - produced, 'DELTA_RESULT');
    fragments.push(fragment);
    produced += fragment.length;
  }
  requireData(produced === required, 'DELTA_RESULT');
  return Buffer.concat(fragments, produced);
};

const validate = (pack, index) => {
  requireData(pack.length >= 32 && pack.length <= 262144, 'PACK_SIZE');
  requireData(pack.subarray(0, 4).toString('ascii') === 'PACK', 'PACK_MAGIC');
  const version = pack.readUInt32BE(4);
  requireData(version === 2 || version === 3, 'PACK_VERSION');
  requireData(hash(pack.subarray(0, -20), 'sha1').equals(pack.subarray(-20)), 'PACK_HASH');
  const decoded = decodeIndex(index);
  requireData(decoded.packHash.equals(pack.subarray(-20)), 'PACK_REFERENCE');
  requireData(pack.readUInt32BE(8) === decoded.count, 'PACK_COUNT');
  const rows = [...decoded.rows].sort((left, right) => left.offset - right.offset);
  if (!rows.length) requireData(pack.length === 32, 'PACK_SIZE');
  for (const [rowNumber, row] of rows.entries()) {
    requireData(Number.isSafeInteger(row.offset) && row.offset >= 12 && row.offset < pack.length - 20, 'OFFSET');
    requireData(rowNumber ? row.offset > rows[rowNumber - 1].offset : row.offset === 12, 'OFFSET');
  }
  const starts = new Set(rows.map(row => row.offset));
  const frames = new Map();
  for (const [rowNumber, row] of rows.entries()) {
    const end = rows[rowNumber + 1]?.offset ?? pack.length - 20;
    requireData(crc(pack.subarray(row.offset, end)) === row.crc, 'CRC');
    let cursor = row.offset;
    const byte = () => { requireData(cursor < end, 'ENTRY_TRUNCATED'); return pack[cursor++]; };
    let part = byte();
    const type = Math.floor(part / 16) % 8;
    requireData([1, 2, 3, 4, 6, 7].includes(type), 'ENTRY_TYPE');
    let declared = part % 16;
    let multiplier = 16;
    while (part >= 128) {
      part = byte();
      declared += (part % 128) * multiplier;
      requireData(Number.isSafeInteger(declared) && declared <= 98304, 'ENTRY_SIZE');
      multiplier *= 128;
      requireData(Number.isSafeInteger(multiplier), 'ENTRY_SIZE');
    }
    let baseOffset;
    let baseOid;
    if (type === 6) {
      part = byte();
      let distance = part % 128;
      while (part >= 128) {
        part = byte();
        distance = (distance + 1) * 128 + part % 128;
        requireData(Number.isSafeInteger(distance), 'OFS_BASE');
      }
      baseOffset = row.offset - distance;
      requireData(distance > 0 && baseOffset < row.offset && starts.has(baseOffset), 'OFS_BASE');
    } else if (type === 7) {
      requireData(cursor + 20 <= end, 'REF_BASE');
      baseOid = pack.subarray(cursor, cursor + 20).toString('hex');
      cursor += 20;
      requireData(decoded.rows.some(candidate => candidate.oid === baseOid), 'REF_BASE');
    }
    const compressedStart = cursor;
    let inflated;
    try { inflated = inflateSync(pack.subarray(cursor, end), { maxOutputLength: 98304, info: true }); }
    catch { throw new InvalidData('ZLIB_FRAME'); }
    requireData(inflated.engine.bytesWritten === end - cursor, 'ZLIB_TRAILING');
    requireData(inflated.buffer.length === declared, 'ENTRY_SIZE');
    frames.set(row.offset, { ...row, type, end, declared, compressedStart, baseOffset, baseOid, inflated: inflated.buffer });
  }
  const verified = new Map();
  const visiting = new Set();
  const resolve = (offset, recursion = 0) => {
    requireData(recursion <= 64, 'DATA_DEPTH');
    if (verified.has(offset)) return verified.get(offset);
    requireData(!visiting.has(offset), 'DELTA_CYCLE');
    visiting.add(offset);
    const frame = frames.get(offset);
    requireData(frame !== undefined, 'REF_BASE');
    let type;
    let body;
    let depth = 0;
    if (frame.type < 5) {
      type = ['unused', 'commit', 'tree', 'blob', 'tag'][frame.type];
      body = frame.inflated;
    } else {
      const baseOffset = frame.baseOffset ?? decoded.rows.find(row => row.oid === frame.baseOid)?.offset;
      requireData(baseOffset !== undefined, 'REF_BASE');
      const base = resolve(baseOffset, recursion + 1);
      body = reconstruct(base.body, frame.inflated);
      type = base.type;
      depth = base.depth + 1;
    }
    const oid = createHash('sha1').update(`${type} ${body.length}\0`).update(body).digest('hex');
    requireData(oid === frame.oid, 'OBJECT_HASH');
    const result = { ...frame, body, type, depth, oid };
    visiting.delete(offset);
    verified.set(offset, result);
    return result;
  };
  for (const row of rows) resolve(row.offset);
  return { version, rows: rows.map(row => verified.get(row.offset)), depth: rows.length ? Math.max(...[...verified.values()].map(row => row.depth)) : 0 };
};

const outcomes = [];
let checkedEntries = 0;
for (const fixture of data.fixtures) {
  const pack = Buffer.from(fixture.packBase64, 'base64');
  const index = Buffer.from(fixture.indexBase64, 'base64');
  assert.equal(hex(pack), fixture.packSha256);
  assert.equal(hex(index), fixture.indexSha256);
  assert.equal(pack.subarray(-20).toString('hex'), fixture.packSha1);
  assert.equal(pack.length, fixture.packBytes);
  assert.equal(index.length, fixture.indexBytes);
  const actual = validate(pack, index);
  assert.equal(actual.version, fixture.version);
  assert.equal(actual.rows.length, fixture.entries.length);
  assert.equal(actual.depth, fixture.maxDepth);
  for (const [position, entry] of actual.rows.entries()) {
    const witness = fixture.entries[position];
    assert.equal(entry.offset, witness.offset);
    assert.equal(entry.end, witness.end);
    assert.equal(entry.compressedStart, witness.compressedStart);
    assert.equal(entry.declared, witness.declaredBytes);
    assert.equal(entry.type, witness.type);
    assert.equal(entry.oid, witness.oid);
    assert.equal(entry.crc, witness.crc32);
    assert.ok(entry.body.equals(Buffer.from(witness.bodyBase64, 'base64')));
    assert.equal(hex(entry.body), witness.bodySha256);
    if (witness.programBase64 !== null) assert.ok(entry.inflated.equals(Buffer.from(witness.programBase64, 'base64')));
    checkedEntries++;
  }
  outcomes.push({ id: fixture.id, status: 'FORMAT_DATA_VERIFIED', entries: actual.rows.length, depth: actual.depth, proposedProfile: fixture.profile });
}
assert.equal(data.fixtures.length, 13);
const originalObjectIds = neutral.files.filter(file => /^\.git\/objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/.test(file.path)).map(file => file.path.slice(13).replace('/', '')).sort();
assert.deepEqual(data.fixtures[0].entries.map(entry => entry.oid).sort(), originalObjectIds);
assert.deepEqual(data.fixtures[1].entries.map(entry => entry.oid).sort(), originalObjectIds);
assert.equal(data.fixtures.find(fixture => fixture.id === 'P03').entries[1].basePrefixHex, '8000');
assert.equal(data.fixtures.find(fixture => fixture.id === 'P07').entries[1].programBase64, Buffer.from([0x80, 0x80, 4, 0x81, 0x80, 4, 0x80, 1, 33]).toString('base64'));
assert.equal(data.fixtures.find(fixture => fixture.id === 'P08').entries[1].programBase64, Buffer.from([0x84, 0x80, 4, 2, 0x95, 1, 1, 2]).toString('base64'));

const resealIndex = index => hash(index.subarray(0, -20), 'sha1').copy(index, index.length - 20);
const mutation = descriptor => {
  const fixture = data.fixtures.find(candidate => candidate.id === descriptor.fixture);
  let pack = Buffer.from(fixture.packBase64, 'base64');
  const index = Buffer.from(fixture.indexBase64, 'base64');
  const count = fixture.count;
  const crcStart = 1032 + count * 20;
  const offsetStart = 1032 + count * 24;
  const largeStart = 1032 + count * 28;
  let repairPack = false;
  let repairCrc = false;
  let repairIndex = true;
  switch (descriptor.mutation) {
    case 'pack-trailer': pack[pack.length - 1] ^= 1; break;
    case 'index-trailer': index[index.length - 1] ^= 1; repairIndex = false; break;
    case 'pack-reference': index[index.length - 21] ^= 1; break;
    case 'crc': index[crcStart] ^= 1; break;
    case 'fanout-bucket': index.writeUInt32BE(1, 8); break;
    case 'duplicate-oid': index.copy(index, 1052, 1032, 1052); break;
    case 'duplicate-offset': index.writeUInt32BE(12, offsetStart); index.writeUInt32BE(12, offsetStart + 4); break;
    case 'outside-offset': index.writeUInt32BE(0x7fffffff, offsetStart); break;
    case 'unsafe-large-offset': index.writeBigUInt64BE(9007199254740992n, largeStart); break;
    case 'version': pack.writeUInt32BE(4, 4); repairPack = true; break;
    case 'type-zero': pack[12] &= 0x8f; repairPack = true; repairCrc = true; break;
    case 'ofs-zero': pack[fixture.entries[1].compressedStart - 2] = 0; repairPack = true; repairCrc = true; break;
    case 'ofs-interior': pack[fixture.entries[1].compressedStart - 2] = 127; repairPack = true; repairCrc = true; break;
    case 'ref-missing': pack.fill(0, fixture.entries[1].compressedStart - 20, fixture.entries[1].compressedStart); repairPack = true; repairCrc = true; break;
    case 'trailing-byte': pack = Buffer.concat([pack.subarray(0, -20), Buffer.from([0]), pack.subarray(-20)]); repairPack = true; repairCrc = true; break;
    default: assert.fail(`Unknown descriptor ${descriptor.mutation}`);
  }
  if (repairCrc) {
    for (let row = 0; row < count; row++) {
      const oid = index.subarray(1032 + row * 20, 1052 + row * 20).toString('hex');
      const position = fixture.entries.findIndex(entry => entry.oid === oid);
      const entry = fixture.entries[position];
      const end = fixture.entries[position + 1]?.offset ?? pack.length - 20;
      index.writeUInt32BE(crc(pack.subarray(entry.offset, end)), crcStart + row * 4);
    }
  }
  if (repairPack) {
    hash(pack.subarray(0, -20), 'sha1').copy(pack, pack.length - 20);
    pack.copy(index, index.length - 40, pack.length - 20);
  }
  if (repairIndex) resealIndex(index);
  return { pack, index };
};
const rejection = (id, pack, index, expectedStage) => {
  let actual;
  try { validate(pack, index); } catch (error) { if (!(error instanceof InvalidData)) throw error; actual = error.stage; }
  assert.equal(actual, expectedStage, `${id} rejection stage`);
  outcomes.push({ id, status: 'DATA_REJECTED_AS_SPECIFIED', stage: actual });
};
for (const fixture of data.malformed) rejection(fixture.id, Buffer.from(fixture.packBase64, 'base64'), Buffer.from(fixture.indexBase64, 'base64'), fixture.expectedStage);
for (const descriptor of data.negatives) {
  const mutated = mutation(descriptor);
  rejection(descriptor.id, mutated.pack, mutated.index, descriptor.expectedStage);
}
assert.equal(outcomes.length, 31);
console.log(JSON.stringify({
  role: 'SAME_AUTHOR_DATA_CHECK_ONLY', runtime: { version: process.version, path: process.execPath, sha256: hex(await readFile(process.execPath)) },
  checkerSha256: hex(await readFile(fileURLToPath(import.meta.url))), fixtureSha256: hex(input),
  checkedEntries, formatSets: 13, withinProposedProfileSets: 12, validFormatDepthRefusalSets: 1,
  malformedSets: data.malformed.length, descriptorRefusals: data.negatives.length,
  unchangedWorkflowMappings: 6, outcomes, productExecutions: 0, nativeGitExecutions: 0,
}));
