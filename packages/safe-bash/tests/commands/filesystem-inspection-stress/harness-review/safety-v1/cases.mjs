const file = (path, bytes = new Uint8Array()) => ({ path, type: 'file', base64: Buffer.from(bytes).toString('base64') });
const directory = path => ({ path, type: 'directory' });
const numbered = (count, operation) => Array.from({ length: count }, (_, index) => operation(index, String(index).padStart(4, '0')));
const treeLimits = { maxArguments: 128, maxArgumentBytes: 4096, maxEntries: 128, maxDirectoryEntries: 128, maxDepth: 4, maxPathBytes: 1024, maxMetadataBytes: 131072, maxOutputBytes: 32768, maxSteps: 262144 };
const fileLimits = { maxSniffBytes: 65536, maxReadFileBytes: 65536, maxInputBytes: 131072, maxOutputBytes: 4096, maxChunkBytes: 1024, maxEntries: 64, maxSteps: 16384, maxArgumentBytes: 4096, maxDurationMs: 4000 };

export const caps = { childWallMs: 5000, heapMiB: 128, observedRssBytes: 268435456, captureBytes: 65536, wholeWallMs: 30000, telemetryEntries: 1024, ipcBytes: 524288, maxChildren: 1, retries: 0 };

export function buildCases() {
  const emptyNames = numbered(64, (_index, suffix) => `${'a'.repeat(124)}${suffix}`);
  const dpNames = numbered(64, (_index, suffix) => `${'a'.repeat(123)}${suffix}q`);
  const sortNames = numbered(64, (_index, suffix) => `${'a'.repeat(508)}${suffix}`);
  const sortEntries = numbered(64, (index) => {
    const order = (index * 37) % 64;
    return order % 2 === 0 ? directory(`/root/${sortNames[order]}`) : file(`/root/${sortNames[order]}`);
  });
  const jsonEntries = numbered(8, (_index, suffix) => file(`/json-${suffix}`, Buffer.from(`${' '.repeat(8189)}[`)));
  const headerEntries = numbered(32, (index, suffix) => {
    const bytes = Buffer.alloc(512);
    if (index % 4 === 0) {
      bytes.fill(97);
      bytes.set(Buffer.from(`%PDF-9.${index % 10}\n`));
    } else if (index % 4 === 1) {
      bytes.set(Buffer.from('ustar'), 257);
      bytes.set(Buffer.from('9999999\0'), 148);
      bytes[400] = index;
    } else if (index % 4 === 2) {
      bytes.set(Buffer.from('MZ'));
      bytes.writeUInt32LE(0xfffffff0 - index, 60);
    } else {
      bytes.set(Buffer.from('SQLite format 4\0'));
      bytes[17] = index;
    }
    return { ...file(`/header-${suffix}`, bytes), characterization: ['invalid-PDF-version', 'invalid-tar-checksum', 'out-of-sample-PE-offset', 'non-SQLite-magic'][index % 4] };
  });
  const links = numbered(32, (_index, suffix) => ({ path: `/link-${suffix}`, type: 'symlink', target: '\u0001'.repeat(4096) }));
  const common = { execution: 'actual-Shell.exec with one explicitly registered command and readonly fixture VFS', allowedMutations: 0, nativeCalls: 0, resetsWithinInvocation: 0 };
  return [
    { id: 'T-empty-many', family: 'tree', ...common, args: ['-i', '--noreport', '-I', '|'.repeat(255), '/root'], limits: treeLimits,
      entries: [directory('/'), directory('/root'), ...emptyNames.map(name => file(`/root/${name}`))],
      expected: { mode: 'exact-success-with-static-proof', stdout: `/root\n${emptyNames.join('\n')}\n`, stderr: '', exitCode: 0, proof: 'emptyNormalization', oldRowAllocationBytes: 2113536,
        qualification: 'Completion is valid after normalization; no timing requirement or mandatory quota failure. Semantic success without a frozen-source normalization/precharge proof is HOLD.' } },
    { id: 'T-DP-cumulative', family: 'tree', ...common, args: ['-i', '--noreport', '-I', `${'*a'.repeat(8)}z`, '/root'], limits: { ...treeLimits, maxSteps: 4096 },
      entries: [directory('/'), directory('/root'), ...dpNames.map(name => file(`/root/${name}`))],
      expected: { mode: 'tree-work-rejection', stdout: '', stderr: '', code: 'EFBIG', proof: 'dpNonEliminated',
        qualification: 'Must reject from cumulative noneliminated filter work before child lstat/output, not a sort/other limit. A suffix or equivalent optimization invalidating this stress makes the row HOLD/unexercised, not a pass or product bug. No adaptive fixture rewrite.' } },
    { id: 'T-sort-many', family: 'tree', ...common, args: ['-i', '--noreport', '--dirsfirst', '/root'], limits: { ...treeLimits, maxSteps: 4096 },
      entries: [directory('/'), directory('/root'), ...sortEntries],
      expected: { mode: 'tree-work-rejection', stdout: '', stderr: '', code: 'EFBIG', proof: 'sortByteCost',
        fullOrderIfWorkEliminated: `/root\n${[...sortNames.filter((_name, index) => index % 2 === 0), ...sortNames.filter((_name, index) => index % 2 === 1)].join('\n')}\n`,
        qualification: 'Frozen proof must meter compared common-prefix bytes and cover both name and dirsfirst passes. The low cap exercises name-sort cost; second-sort accounting still needs static proof, not a fabricated runtime claim. Genuine work elimination requires separate adjudication, not a blanket pass.' } },
    { id: 'F-JSON-cumulative', family: 'file', ...common, args: ['-b', '--mime', ...jsonEntries.map(entry => entry.path)], limits: fileLimits, chunkBytes: 1024,
      entries: [directory('/'), ...jsonEntries],
      expected: { mode: 'file-json-work-limit', line: 'text/plain; charset=us-ascii\n', exitCode: 1, proof: 'jsonCumulative', minimumOpenedFiles: 2, maximumOpenedFiles: 7, maximumClassifiedFiles: 1,
        qualification: 'Each bounded operand must fit alone under the disclosed accounting; the combined scan must exceed16384 without operand resets. If a new coefficient invalidates that premise, HOLD for an additive reseal, not relabel a single-operand limit as cumulative proof.' } },
    { id: 'F-header-many', family: 'file', ...common, args: ['-b', '--mime', ...headerEntries.map(entry => entry.path)], limits: { ...fileLimits, maxSniffBytes: 1024, maxInputBytes: 32768, maxSteps: 32768 }, chunkBytes: 128,
      entries: [directory('/'), ...headerEntries],
      expected: { mode: 'bounded-header-characterization', exitCode: 0, lines: 32, bytesRead: 16384, stderr: '', proof: 'headerBounds',
        qualification: 'Require one bounded complete stream/classification per operand, correct MIME/charset record shape and no excessive offset reads. Record classifications without promoting them to valid-file/security/native-format certification.' } },
    { id: 'F-metadata-many', family: 'file', ...common, args: links.map(entry => entry.path), limits: { ...fileLimits, maxSteps: 32768 },
      entries: [directory('/'), ...links],
      expected: { mode: 'file-text-admission-limit', exitCode: 1, proof: 'textPreAdmission', maximumReadlinks: 1, firstLine: `${links[0].path}: symbolic link to ${'\\u{1}'.repeat(4096)}\n`,
        qualification: 'First expanded line cannot fit4096 bytes. Require a relevant family limit, no content reads/mutation, and empty stdout or only a bounded prefix of this exact first line if escaping streams. Static pre-admission/cumulative policy proof is mandatory; smoke timing cannot prove pre-allocation safety.' } },
  ];
}
