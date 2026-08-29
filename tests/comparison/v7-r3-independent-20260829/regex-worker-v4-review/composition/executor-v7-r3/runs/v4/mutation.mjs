import { own, requireValue, hash } from './common.mjs';

export const mutationReplacement = "throw Error(\"DRIFT_MUST_NOT_EVALUATE\");\n";
export const mutationInitial = () => ({state:'NOT_ENTERED',bytesWritten:0,primaryPresent:false,primary:null});
export function mutateOwned(owner, filename, original, replacement, status) {
  status.state = 'ENTERED';
  try {
    owner.write(filename, Buffer.from(replacement), {bytes:Buffer.byteLength(original),sha256:hash(Buffer.from(original))}, (stage,count) => {
      if (stage === 'truncated') status.state = 'TRUNCATED';
      if (stage === 'writing') { status.state = 'WRITING'; status.bytesWritten = count; }
      if (stage === 'written') { status.state = 'WRITTEN'; status.bytesWritten = count; }
    });
    status.state = 'COMMITTED';
  } catch (error) { status.primaryPresent = true; status.primary = error === undefined ? 'undefined' : error === null ? 'null' : String(error?.code ?? error).slice(0,128); throw error; }
}
export function mutationExpected(status, original, replacement) {
  const value = own(status,['state','bytesWritten','primaryPresent','primary']);
  const input = Buffer.from(original), output = Buffer.from(replacement);
  requireValue(typeof value.primaryPresent === 'boolean' && (value.primary === null || typeof value.primary === 'string') && Number.isSafeInteger(value.bytesWritten) && value.bytesWritten >= 0 && value.bytesWritten <= output.length, 'MUTATION_SCHEMA');
  if (['NOT_ENTERED','ENTERED'].includes(value.state)) { requireValue(value.bytesWritten === 0, 'MUTATION_UNENTERED_COUNT'); return input; }
  if (value.state === 'TRUNCATED') { requireValue(value.bytesWritten === 0, 'MUTATION_TRUNCATED_COUNT'); return Buffer.alloc(0); }
  if (value.state === 'WRITING') return output.subarray(0,value.bytesWritten);
  requireValue(['WRITTEN','COMMITTED'].includes(value.state) && value.bytesWritten === output.length && (value.state !== 'COMMITTED' || !value.primaryPresent), 'MUTATION_UNKNOWN_STATE');
  return output;
}
export function mutationMatches(status, original, replacement, actual, mode) {
  const expected = mutationExpected(status,original,replacement);
  requireValue(mode === 0o644 && actual.length === expected.length && hash(actual) === hash(expected), 'MUTATION_ARTIFACT_MISMATCH');
  return true;
}
