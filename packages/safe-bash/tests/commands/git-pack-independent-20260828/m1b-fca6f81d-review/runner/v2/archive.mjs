import { gunzipSync } from 'node:zlib';
import { demand, sha256, relative } from './primitives.mjs';

function field(header, start, length) {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  const value = bytes.subarray(0, end < 0 ? bytes.length : end);
  demand(end < 0 || bytes.subarray(end).every(byte => byte === 0), 'TAR_FIELD_PADDING');
  return value.toString('utf8');
}
function octal(header, start, length) {
  const value = field(header, start, length).trim();
  demand(/^[0-7]+$/.test(value), 'TAR_OCTAL');
  const number = Number.parseInt(value, 8);
  demand(Number.isSafeInteger(number), 'TAR_INTEGER');
  return number;
}
export function readArchive(compressed, expected) {
  demand(compressed.length === expected.bytes && sha256(compressed) === expected.sha256, 'ARCHIVE_IDENTITY');
  const raw = gunzipSync(compressed, { maxOutputLength: 33554432 });
  const files = new Map();
  let offset = 0;
  let ended = false;
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      demand(raw.length - offset >= 1024 && raw.subarray(offset).every(byte => byte === 0), 'TAR_TERMINATOR');
      ended = true;
      break;
    }
    const checksum = octal(header, 148, 8);
    let actual = 0;
    for (let index = 0; index < 512; index++) actual += index >= 148 && index < 156 ? 32 : header[index];
    demand(checksum === actual && field(header, 257, 6) === 'ustar', 'TAR_HEADER');
    demand(header[156] === 48 || header[156] === 0, 'TAR_REGULAR_ONLY');
    demand(field(header, 157, 100) === '' && field(header, 345, 155) === '', 'TAR_NO_LINK_PREFIX');
    const name = field(header, 0, 100);
    demand(name.startsWith('package/'), 'TAR_ROOT');
    const filename = relative(name.slice(8));
    const size = octal(header, 124, 12);
    const mode = octal(header, 100, 8);
    demand(size <= 8388608 && [0o644, 0o755].includes(mode) && !files.has(filename), 'TAR_FILE_ADMISSION');
    const body = raw.subarray(offset + 512, offset + 512 + size);
    demand(body.length === size, 'TAR_EXTENT');
    files.set(filename, { path: filename, mode, bytes: size, sha256: sha256(body), body });
    demand(files.size <= 910, 'TAR_MEMBER_LIMIT');
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  demand(ended && files.size === 910 && files.has('README.md'), 'TAR_COMPLETE');
  const rows = [...files.values()].map(({ body, ...row }) => row).sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  demand(JSON.stringify(rows) === JSON.stringify(expected.files), 'TAR_COMPLETE_MAP');
  const manifest = JSON.parse(files.get('package.json').body.toString('utf8'));
  demand(Object.keys(manifest.dependencies ?? {}).length === 0 && Object.keys(manifest.optionalDependencies ?? {}).length === 0 && Object.keys(manifest.peerDependencies ?? {}).length === 0, 'PACKAGE_ZERO_DEPENDENCIES');
  return files;
}
