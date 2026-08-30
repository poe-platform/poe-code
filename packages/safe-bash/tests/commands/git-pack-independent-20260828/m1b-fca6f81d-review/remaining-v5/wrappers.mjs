import { createHash, webcrypto } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function demand(condition, label) { if (!condition) throw new Error(label); }
function loose(type, bytes) {
  const object = Buffer.concat([Buffer.from(type + ' ' + bytes.length + '\0'), bytes]);
  const oid = createHash('sha1').update(object).digest('hex');
  const compressed = deflateSync(object);
  return { type, oid, path: '.git/objects/' + oid.slice(0, 2) + '/' + oid.slice(2), bodyHex: bytes.toString('hex'), objectHex: object.toString('hex'), compressedHex: compressed.toString('hex'), compressedSha256: hash(compressed) };
}
export function createWrappers(targetOid) {
  demand(typeof targetOid === 'string' && /^[a-f0-9]{40}$/.test(targetOid), 'TARGET_OID');
  const tree = loose('tree', Buffer.concat([Buffer.from('100644 payload\0'), Buffer.from(targetOid, 'hex')]));
  const commit = loose('commit', Buffer.from(`tree ${tree.oid}\nauthor Independent <independent@example.invalid> 0 +0000\ncommitter Independent <independent@example.invalid> 0 +0000\n\nM1B supported-query wrapper\n`));
  return { targetOid, tree, commit, args: ['show', commit.oid + ':payload'] };
}
export async function validateWrappers(wrapper, expectedBody) {
  demand(Buffer.isBuffer(expectedBody) && expectedBody.length <= 131072, 'EXPECTED_BODY');
  const blobFrame = Buffer.concat([Buffer.from('blob ' + expectedBody.length + '\0'), expectedBody]);
  const expectedOid = Buffer.from(await webcrypto.subtle.digest('SHA-1', blobFrame)).toString('hex');
  demand(expectedOid === wrapper.targetOid, 'EXPECTED_BLOB_IDENTITY');
  const treeBody = Buffer.concat([Buffer.from([49, 48, 48, 54, 52, 52, 32, 112, 97, 121, 108, 111, 97, 100, 0]), Buffer.from(expectedOid, 'hex')]);
  for (const row of [wrapper.tree, wrapper.commit]) {
    const body = Buffer.from(row.bodyHex, 'hex');
    demand(body.length <= 1024 && /^[a-f0-9]*$/.test(row.bodyHex) && row.bodyHex.length % 2 === 0, 'WRAPPER_BODY_BOUND');
    const framed = Buffer.concat([Buffer.from(`${row.type} ${body.length}\0`), body]);
    const oid = Buffer.from(await webcrypto.subtle.digest('SHA-1', framed)).toString('hex');
    demand(oid === row.oid && framed.toString('hex') === row.objectHex && row.path === '.git/objects/' + oid.slice(0, 2) + '/' + oid.slice(2), 'WRAPPER_OBJECT_IDENTITY');
    const compressed = Buffer.from(row.compressedHex, 'hex');
    const decoded = inflateSync(compressed, { info: true, maxOutputLength: 2048 });
    demand(decoded.engine.bytesWritten === compressed.length && decoded.buffer.equals(framed) && hash(compressed) === row.compressedSha256, 'WRAPPER_COMPRESSED_IDENTITY');
  }
  demand(wrapper.tree.type === 'tree' && wrapper.tree.bodyHex === treeBody.toString('hex'), 'TREE_POINTS_TO_PACKED_BLOB');
  const commitText = Buffer.from(wrapper.commit.bodyHex, 'hex').toString('utf8');
  demand(wrapper.commit.type === 'commit' && commitText === `tree ${wrapper.tree.oid}\nauthor Independent <independent@example.invalid> 0 +0000\ncommitter Independent <independent@example.invalid> 0 +0000\n\nM1B supported-query wrapper\n`, 'COMMIT_POINTS_TO_TREE');
  demand(JSON.stringify(wrapper.args) === JSON.stringify(['show', wrapper.commit.oid + ':payload']), 'SUPPORTED_QUERY');
  return true;
}
