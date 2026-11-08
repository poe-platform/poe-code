import { exact, integer, text } from './wire.mjs';
import { list } from './receipt-schema.mjs';
export function validateLoadAttestation(value, session, manifest) {
  const record = exact(value, ['v','session','kind','files']);
  if (record.v !== 3 || record.session !== session || record.kind !== 'loadAttestation') throw Error('load report identity');
  const seen = new Set();
  list(record.files, 128, value => {
    const file = exact(value, ['path','bytes','sha256']); text(file.path, 256); integer(file.bytes, 0, 2097152); text(file.sha256, 64);
    const bound = manifest.files.find(row => row.path === file.path);
    if (!bound || !bound.roles.includes('worker') || bound.sha256 !== file.sha256 || bound.bytes !== file.bytes || seen.has(file.path)) throw Error('load report bound identity'); seen.add(file.path);
  });
  if (manifest.engineReachable.some(path => !seen.has(path))) throw Error('incomplete actual engine load report');
  return record;
}
