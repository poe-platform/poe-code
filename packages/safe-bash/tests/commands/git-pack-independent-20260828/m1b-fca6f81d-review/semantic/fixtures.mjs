import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const maximumBody = 131072;
const maximumPack = 262144;
const maximumEntries = 64;
const names = ['invalid', 'commit', 'tree', 'blob', 'tag'];

function requireData(condition, message) {
  if (!condition) throw new Error(`UNSAFE_FIXTURE: ${message}`);
}

export function digest(bytes, algorithm = 'sha256') {
  return createHash(algorithm).update(bytes).digest('hex');
}

function bytesFor(value = {}) {
  let bytes;
  if (typeof value.hex === 'string') {
    requireData(/^(?:[0-9a-f]{2})*$/.test(value.hex), 'hex');
    requireData(value.hex.length <= maximumBody * 2, 'hex extent');
    bytes = Buffer.from(value.hex, 'hex');
  } else if (typeof value.base64 === 'string') {
    requireData(value.base64.length <= Math.ceil(maximumBody / 3) * 4, 'base64 extent');
    bytes = Buffer.from(value.base64, 'base64');
    requireData(bytes.length <= maximumBody && bytes.toString('base64') === value.base64, 'base64 form');
  } else if (typeof value.text === 'string') {
    requireData(Buffer.byteLength(value.text) <= maximumBody, 'text extent');
    bytes = Buffer.from(value.text);
  } else if (value.repeat) {
    const { byte, count } = value.repeat;
    requireData(Number.isInteger(byte) && byte >= 0 && byte <= 255, 'repeat byte');
    requireData(Number.isInteger(count) && count >= 0 && count <= maximumBody, 'repeat extent');
    bytes = Buffer.alloc(count, byte);
  } else {
    bytes = Buffer.alloc(0);
  }
  return bytes;
}

function integer32(value) {
  requireData(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, 'uint32');
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function variable(value) {
  requireData(Number.isSafeInteger(value) && value >= 0, 'size value');
  const output = [];
  do {
    const part = value % 128;
    value = Math.floor(value / 128);
    output.push(part | (value ? 128 : 0));
  } while (value);
  return Buffer.from(output);
}

function header(type, size) {
  requireData(Number.isInteger(type) && type >= 0 && type <= 7, 'storage type');
  requireData(Number.isSafeInteger(size) && size >= 0, 'declared size');
  let remaining = Math.floor(size / 16);
  const output = [(type << 4) | (size % 16) | (remaining ? 128 : 0)];
  while (remaining) {
    const part = remaining % 128;
    remaining = Math.floor(remaining / 128);
    output.push(part | (remaining ? 128 : 0));
  }
  return Buffer.from(output);
}

function distanceBytes(value) {
  requireData(Number.isSafeInteger(value) && value > 0, 'backward distance');
  const output = [value % 128];
  while ((value = Math.floor(value / 128))) {
    value--;
    output.unshift(128 | (value % 128));
  }
  return Buffer.from(output);
}

function checksum(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function objectId(type, bytes) {
  requireData(names[type] !== undefined && type !== 0, 'logical type');
  return createHash('sha1').update(`${names[type]} ${bytes.length}\0`).update(bytes).digest('hex');
}

export function buildPack(spec) {
  requireData(Array.isArray(spec.entries) && spec.entries.length <= maximumEntries, 'entry bound');
  let bodyExtent = 0;
  for (const entry of spec.entries) {
    const body = entry.body ?? {};
    const extent = typeof body.hex === 'string' ? body.hex.length / 2 : typeof body.base64 === 'string' ? Math.ceil(body.base64.length / 4) * 3 : typeof body.text === 'string' ? Buffer.byteLength(body.text) : body.repeat?.count ?? 0;
    requireData(Number.isSafeInteger(extent) && extent >= 0 && extent <= maximumPack - bodyExtent, 'aggregate body extent');
    bodyExtent += extent;
  }
  const objects = spec.entries.map(entry => {
    const body = bytesFor(entry.body);
    const logicalType = entry.logicalType ?? 3;
    const oid = entry.indexOid ?? objectId(logicalType, body);
    requireData(/^[0-9a-f]{40}$/.test(oid), 'index oid');
    return { body, logicalType, oid };
  });
  const records = [];
  const offsets = [];
  let offset = 12;
  for (const [index, entry] of spec.entries.entries()) {
    const object = objects[index];
    const type = entry.storageType ?? (entry.storage === 'ref' ? 7 : entry.storage === 'ofs' ? 6 : object.logicalType);
    let payload = object.body;
    if (type === 6 || type === 7) {
      if (entry.literalResult) {
        const base = objects[entry.base];
        requireData(base && object.body.length <= 1024, 'literal-result bound');
        const pieces = [variable(base.body.length), variable(object.body.length)];
        for (let position = 0; position < object.body.length; position += 127) {
          const part = object.body.subarray(position, position + 127);
          pieces.push(Buffer.from([part.length]), part);
        }
        payload = Buffer.concat(pieces);
      } else if (entry.copyBase) {
        const base = objects[entry.base];
        requireData(base && base.body.length > 0 && base.body.length <= 255, 'copy-base size');
        payload = Buffer.concat([variable(base.body.length), variable(object.body.length), Buffer.from([0x90, base.body.length])]);
      } else payload = bytesFor({ hex: entry.programHex ?? '' });
    }
    const options = { level: entry.level ?? 9 };
    if (entry.dictionaryHex !== undefined) options.dictionary = bytesFor({ hex: entry.dictionaryHex });
    let compressed = entry.compressedHex === undefined ? deflateSync(payload, options) : bytesFor({ hex: entry.compressedHex });
    if (entry.requireCompressedBytes !== undefined) requireData(compressed.length === entry.requireCompressedBytes, 'exact zlib feed boundary');
    if (entry.truncateZlib !== undefined) {
      requireData(Number.isInteger(entry.truncateZlib) && entry.truncateZlib > 0 && entry.truncateZlib <= compressed.length, 'zlib truncation');
      compressed = compressed.subarray(0, -entry.truncateZlib);
    }
    if (entry.secondMember) compressed = Buffer.concat([compressed, deflateSync(Buffer.from('B'), { level: 9 })]);
    if (entry.suffixHex !== undefined) compressed = Buffer.concat([compressed, bytesFor({ hex: entry.suffixHex })]);
    let prefix = Buffer.alloc(0);
    if (entry.prefixHex !== undefined) prefix = bytesFor({ hex: entry.prefixHex });
    else if (type === 7) {
      requireData(objects[entry.base] !== undefined, 'REF base descriptor');
      prefix = Buffer.from(objects[entry.base].oid, 'hex');
    } else if (type === 6) {
      requireData(Number.isInteger(entry.base) && entry.base >= 0 && entry.base < index, 'OFS base descriptor');
      prefix = distanceBytes(offset - offsets[entry.base]);
    }
    const record = Buffer.concat([header(type, entry.declared ?? payload.length), prefix, compressed]);
    requireData(record.length <= maximumPack && offset + record.length <= maximumPack - 20, 'pack extent');
    offsets.push(offset);
    records.push(record);
    offset += record.length;
  }
  const originalCrc = records.map(checksum);
  if (spec.crcRecordMutation === 'header') records[0][0] ^= 1;
  if (spec.crcRecordMutation === 'base') records[1][1] ^= 1;
  let content = Buffer.concat([Buffer.from(spec.signature ?? 'PACK'), integer32(spec.version ?? 2), integer32(spec.headerCount ?? records.length), ...records]);
  if (spec.emptyTrailing) content = Buffer.concat([content, Buffer.from([0])]);
  const packHash = createHash('sha1').update(content).digest();
  let pack = Buffer.concat([content, packHash]);
  if (spec.badPackChecksum) pack[pack.length - 1] ^= 1;
  if (spec.truncatePackBytes !== undefined) pack = pack.subarray(0, spec.truncatePackBytes);
  let rows = objects.map((object, index) => ({ oid: object.oid, offset: offsets[index], crc: originalCrc[index], sourceIndex: index }));
  rows.sort((left, right) => Buffer.compare(Buffer.from(left.oid, 'hex'), Buffer.from(right.oid, 'hex')));
  if (spec.indexMutation === 'reverse') rows.reverse();
  if (spec.indexMutation === 'duplicateOid') rows[1].oid = rows[0].oid;
  if (spec.indexMutation === 'duplicateOffset') rows[1].offset = rows[0].offset;
  if (spec.indexMutation === 'firstOffset13') rows.find(row => row.offset === 12).offset = 13;
  if (spec.indexMutation === 'offsetOutside') rows[0].offset = pack.length;
  if (spec.indexMutation === 'crc') rows[0].crc = (rows[0].crc ^ 1) >>> 0;
  const buckets = new Array(256).fill(0);
  for (const row of rows) buckets[Number.parseInt(row.oid.slice(0, 2), 16)]++;
  let total = 0;
  const fanout = buckets.map(amount => integer32(total += amount));
  if (spec.indexMutation === 'fanout') fanout[0] = integer32(1);
  const large = [];
  const offsetRows = rows.map((row, index) => {
    if ((spec.indirect || spec.indexMutation === 'unsafe64' || spec.indexMutation === 'badSlot') && index === 0) {
      const value = Buffer.alloc(8);
      value.writeBigUInt64BE(spec.indexMutation === 'unsafe64' ? 0xffffffffffffffffn : BigInt(row.offset));
      large.push(value);
      return integer32(spec.indexMutation === 'badSlot' ? 0x80000001 : 0x80000000);
    }
    return integer32(row.offset);
  });
  if (spec.emptyLargeSlot) large.push(Buffer.alloc(8));
  const packCopy = Buffer.from(packHash);
  if (spec.indexMutation === 'packCopy') packCopy[0] ^= 1;
  const indexBody = Buffer.concat([Buffer.from('ff744f6300000002', 'hex'), ...fanout, ...rows.map(row => Buffer.from(row.oid, 'hex')), ...rows.map(row => integer32(row.crc)), ...offsetRows, ...large, packCopy]);
  const index = Buffer.concat([indexBody, createHash('sha1').update(indexBody).digest()]);
  if (spec.indexMutation === 'checksum') index[index.length - 1] ^= 1;
  requireData(index.length <= 4096, 'index fixture extent');
  return { pack, index, stem: packHash.toString('hex'), targetOid: objects.at(-1)?.oid ?? null, construction: { records: records.length, recordCrcComputedBeforeDeclaredMutation: true, crcRecordMutation: spec.crcRecordMutation ?? null, outerPackShaRecomputed: !spec.badPackChecksum && spec.truncatePackBytes === undefined, outerIndexShaRecomputed: spec.indexMutation !== 'checksum' } };
}

function frozenPair(data, id) {
  const row = data.packs.find(value => value.id === id);
  requireData(row !== undefined, 'frozen fixture id');
  const pack = Buffer.from(row.packBase64, 'base64');
  const index = Buffer.from(row.indexBase64, 'base64');
  requireData(pack.length === row.packBytes && digest(pack) === row.packSha256, 'frozen pack binding');
  requireData(index.length === row.indexBytes && digest(index) === row.indexSha256, 'frozen idx binding');
  return { pack, index, stem: row.packSha1, targetOid: row.target?.oid ?? null, construction: { frozenId: id } };
}

export function createFixture(data, spec) {
  const files = data.neutral.files.filter(row => !spec.removeLoose || !data.removeExactly.includes(row.path)).map(row => ({ path: row.path, mode: row.mode, bytes: Buffer.from(row.base64, 'base64'), type: 'file' }));
  const pairs = (spec.packs ?? []).map(row => row.frozen ? frozenPair(data, row.frozen) : buildPack(row.build));
  requireData(pairs.length <= 3, 'pair count');
  let targetOid = null;
  let lastStem = null;
  for (const pair of pairs) {
    const stem = `.git/objects/pack/pack-${pair.stem}`;
    if (spec.omit !== 'pack') files.push({ path: stem + '.pack', mode: 0o644, bytes: pair.pack, type: 'file' });
    if (spec.omit !== 'idx') files.push({ path: stem + '.idx', mode: 0o644, bytes: pair.index, type: 'file' });
    targetOid = pair.targetOid;
    lastStem = stem;
  }
  for (const extra of spec.extra ?? []) {
    const path = extra.path.replace('@PACK@', lastStem ?? 'MISSING_PAIR');
    requireData(!path.includes('@') && !path.includes('..') && !path.startsWith('/'), 'extra path');
    files.push({ path, mode: extra.type === 'directory' ? 0o755 : 0o644, bytes: bytesFor(extra.body), type: extra.type ?? 'file' });
  }
  requireData(files.length <= 80 && new Set(files.map(row => row.path)).size === files.length, 'file inventory');
  requireData(files.reduce((sum, row) => sum + row.bytes.length, 0) <= 524288, 'fixture file bytes');
  const args = (spec.args ?? ['rev-parse', '--show-toplevel']).map(value => value === '@TARGET@' ? targetOid : value);
  requireData(args.every(value => typeof value === 'string'), 'target argv');
  return { files, args, lastStem, facts: pairs.map(pair => ({ stem: pair.stem, packBytes: pair.pack.length, packSha256: digest(pair.pack), indexBytes: pair.index.length, indexSha256: digest(pair.index), construction: pair.construction })) };
}
