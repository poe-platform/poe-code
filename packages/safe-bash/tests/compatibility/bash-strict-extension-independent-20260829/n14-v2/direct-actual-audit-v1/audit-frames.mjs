import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
const root = new URL('./', import.meta.url);
const author = new URL('../../../bash-surface-independent-20260829/virtual-comparison-direct-activation-v2/actual-run-v1/', root);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function admitted(url, bytes, sha256) {
  const stat = fs.lstatSync(url);
  if (!stat.isFile() || stat.size !== bytes) throw Error('regular/exact-size admission');
  const buffer = fs.readFileSync(url);
  if (buffer.length !== bytes || hash(buffer) !== sha256) throw Error('hash admission');
  return buffer;
}
const manifest = JSON.parse(admitted(new URL('capture/manifest.raw', root), 2684, 'b67a32f83a604a948e18f87fffbe327eb7fc20196fe540ede7ec0cbd86593976'));
const envelope = manifest.captureArchive;
const encoded = admitted(new URL('RAW-CAPTURE.json.gz.base64', author), envelope.encodedBytes, envelope.encodedSha256);
const compressed = Buffer.from(encoded.toString('ascii').trim(), 'base64');
if (compressed.length !== envelope.gzipBytes || hash(compressed) !== envelope.gzipSha256) throw Error('compressed identity');
const decoded = zlib.gunzipSync(compressed, { maxOutputLength: envelope.decodedBytes });
if (decoded.length !== envelope.decodedBytes || hash(decoded) !== envelope.decodedSha256) throw Error('decoded identity');
const data = JSON.parse(decoded.toString('utf8'));
const summarize = value => Array.isArray(value) ? { type: 'array', length: value.length, firstKeys: Object.keys(value[0] ?? {}), first: Object.fromEntries(Object.entries(value[0] ?? {}).map(([key, item]) => [key, typeof item === 'string' && item.length > 300 ? { length: item.length, prefix: item.slice(0, 80) } : item])) } : typeof value;
console.log(JSON.stringify({ schema: 'independent-raw-frame-admission-v1', at: new Date().toISOString(), envelope, keys: Object.fromEntries(Object.entries(data).map(([key,value])=>[key,summarize(value)])), noExtraction: true, noProductEvaluation: true }, null, 2));
