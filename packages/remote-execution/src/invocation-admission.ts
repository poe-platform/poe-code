/** Cwd follows the shell's Unicode string contract, independently of the
 * negotiated byte filename/argv profile. Call after octet/size admission. */
export function assertLogicalCwd(cwd: readonly number[]): void {
  if (cwd[0] !== 47) throw new TypeError('Absolute logical cwd required');
  // The process description is the admitted indexed array, not a caller's
  // iterator (which can substitute names or acquire speculative dependencies).
  const bytes = new Uint8Array(cwd.length);
  for (let index = 0; index < bytes.length; index++) bytes[index] = cwd[index];
  try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new TypeError('Lossless Unicode logical cwd required'); }
}
