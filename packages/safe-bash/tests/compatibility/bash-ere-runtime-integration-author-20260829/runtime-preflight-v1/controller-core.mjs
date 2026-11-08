import { createHash } from 'node:crypto';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function ownRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('record required');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (JSON.stringify(Reflect.ownKeys(descriptors)) !== JSON.stringify(keys)) throw new Error('own keys/order');
  for (const key of keys) if (!Object.hasOwn(descriptors[key], 'value')) throw new Error('accessor');
  return value;
}
export function completion(exitCode, signal, rows, expectedIds, unsafe) {
  if (unsafe || signal !== null || exitCode !== 0) throw new Error('unsafe/nonzero completion');
  if (!Array.isArray(rows) || rows.length !== expectedIds.length) throw new Error('result cardinality');
  rows.forEach((row, index) => {
    ownRecord(row, ['id', 'status', 'retired']);
    if (row.id !== expectedIds[index] || row.status !== 'PASS' || row.retired !== true) throw new Error('result identity/outcome/retirement');
  });
  return true;
}
export function grant(value, sealSha, expectedHash, raw) {
  if (sha(raw) !== expectedHash) throw new Error('ROOT raw grant digest');
  ownRecord(value, ['action', 'sealSha256', 'sourceTree', 'packageSha256', 'transportReceipt', 'preexecReceipt', 'rootReceipt']);
  if (value.action !== 'execute-core70-v1' || value.sealSha256 !== sealSha || value.sourceTree !== 'da4e1cc187022255521879b00db2ac77674f79d9' || value.packageSha256 !== '4f90df04dba998f184473254bb450f9e085b9fc9d5994dc91a21a7ccf1d1d66e') throw new Error('grant binding');
  for (const key of ['transportReceipt', 'preexecReceipt', 'rootReceipt']) if (typeof value[key] !== 'string' || !/^[0-9a-f]{40}$/.test(value[key])) throw new Error('receipt format');
  return { formatAndDigestOnly: true, qualification: 'ROOT must externally authorize the exact raw hash; these strings alone do not authenticate acceptance.' };
}
