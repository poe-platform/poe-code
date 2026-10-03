export const largeObjectIoWorkload = Object.freeze({
  size: 104857600,
  expectedSequentialSha256: '4cbf988462cc3ba2e10e3aae9f5268546aa79016359fb45be7dd199c073125c0',
  expectedPositionedSha256: '5838873e1c81b0cddbcdda6a5d43367e38a7e85e6599eaa4384bc23ec2a30545',
});

export function objectIoCases(protocol) {
  const cases = [];
  for (const delayMs of [0, 5]) {
    for (const { chunkBytes, callerBytes, maxTransferBytes, profile, pages } of [
      { chunkBytes: 65536, callerBytes: 65536, maxTransferBytes: 65536, profile: 'matched-64KiB', pages: [1, 4, 16] },
      { chunkBytes: 262144, callerBytes: 262144, maxTransferBytes: 262144, profile: 'matched-256KiB', pages: [1, 4] },
      { chunkBytes: 1048576, callerBytes: 1048576, maxTransferBytes: 1048576, profile: 'matched-1MiB', pages: [1] },
      { chunkBytes: 262144, callerBytes: 65536, maxTransferBytes: 65536, profile: 'mismatch-256KiB-page-64KiB-io', pages: [1, 4] },
    ]) {
      for (const workingPages of pages) cases.push({ profile, workload: protocol,
        configuration: { size: protocol.size, chunkBytes, workingPages, delayMs, callerBytes, maxTransferBytes } });
    }
  }
  if (protocol.largeWorkload) cases.push({ profile: 'large-64KiB', workload: protocol.largeWorkload,
    configuration: { size: protocol.largeWorkload.size, chunkBytes: 65536, workingPages: 1,
      delayMs: 0, callerBytes: 65536, maxTransferBytes: 65536 } });
  return cases;
}
