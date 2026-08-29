import { lstat, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('./', import.meta.url));
await writeFile(root + 'FINALIZE-STARTUP.json', JSON.stringify({ at: new Date().toISOString(), sourceOnly: true, children: 0 }) + '\n', { flag: 'wx', mode: 0o600 });
const save = (name, value) => writeFile(root + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  process.argv = [process.argv[0], 'source-reader.mjs', '08', JSON.stringify([
    { file: 'arrayfunc.c', start: 535, end: 556 }, { file: 'arrayfunc.c', start: 906, end: 935 },
    { file: 'execute_cmd.c', start: 1808, end: 1843 }, { file: 'subst.c', start: 4283, end: 4300 },
    { file: 'shell.c', start: 759, end: 778 }, { file: 'builtins/let.def', pattern: 'evalexp|return', limit: 12 },
    { file: 'builtins/set.def', pattern: 'SHORT_DOC', limit: 2 }, { file: 'builtins/common.c', start: 80, end: 95 }
  ])];
  await import('./source-reader.mjs');
  assert(!process.exitCode, 'FINAL_SOURCE_READ_REFUSAL');
  const arithmetic = await readFile(root + 'corrected-arithmetic.stdout.raw');
  assert.equal(hash(arithmetic), '5e2d784b8fd333972e6e413f4c3478163462a3c1abf8cc5ff7173963420440bd');
  const parserNotes = arithmetic.toString('utf8').split('\n').flatMap((line, index, lines) => /parseArithmetic|source\.trim|tokens\.length|literal.*0n/.test(line) ? [{ line: index + 1, text: line, next: lines.slice(index + 1, index + 4) }] : []);
  await save('ARITHMETIC-PARSER-SOURCE.json', { blob: '223101946d13ac9b44f4a898f58fd16004ba86b9', parserNotes, execution: 'UNRUN' });
  const design = JSON.parse(await readFile(root + 'binding/design-0.stdout.raw', 'utf8'));
  const ids = ['U06', 'U07', 'U17', 'U27', 'U28', 'U31', 'U32', 'U33', 'U34', 'U35', 'U36'];
  const originals = ids.map(id => { const row = design.cases.find(item => item.id === id); assert(row && typeof row.program === 'string'); return { ...row, version: 'ORIGINAL_UNCHANGED', expectedRuntime: null, execution: 'UNRUN', invocationProfile: 'GNU53_DEFAULT_ONESHOT_C' }; });
  const overlays = [
    { id: 'S-U06-PARTIAL-v1', program: 'set -uz; printf "set-status:%s\\n" "$?"; printf "%s\\n" "$missing"; printf "after\\n"', question: 'Observe incremental u mutation separately from invalid-tail status and subsequent fatal read.' },
    { id: 'S-U07-LIST-STATUS-v1', program: 'set -u; set -o; printf "list-status:%s\\n" "$?"; printf "after\\n"', question: 'Preserve complete raw listing and subsequent status; no output filtering or invented option labels.' },
    { id: 'S-U27-INPUT-UNIT-v1', program: 'set -u; printf "%s\\n" "${#a[@]}"; printf "same-unit\\n"\nprintf "next-unit:%s\\n" "$?"\n', question: 'Distinguish nonfatal DISCARD from FORCE_EOF and same-line versus next parsed unit.' },
    { id: 'S-U28-PRESENCE-v1', program: 'set -u; a=(); printf "len:%s|guard:%s\\n" "${#a[@]}" "${a[@]+present}"', question: 'Do not collapse existing empty array object/length with aggregate expansion presence; presence tuple unmeasured.' },
    { id: 'S-ARITH-SUBSHELL-v1', program: '(set -u; let "missing++"; printf "child-after\\n")\nprintf "parent:%s\\n" "$?"\n', question: 'Record actual isolated fatal status and parent continuation; no inherited root-status golden.' },
    { id: 'S-ARITH-SUBSTITUTION-v1', program: 'set -u; result=$(let "missing++"); printf "status:%s|result:%s\\n" "$?" "$result"', question: 'Record assignment substitution status and parent continuation without -e.' },
    { id: 'S-U31-STDIN-v1', program: originals.find(row => row.id === 'U31').program, invocationProfile: 'GNU53_NONINTERACTIVE_STDIN', question: 'Same literal source through reader loop rather than ONESHOT -c; preserve both raw profiles.' }
  ].map(row => ({ ...row, version: 'SOURCE_PROPOSED_V1', expectedRuntime: null, execution: 'UNRUN', invocationProfile: row.invocationProfile ?? 'GNU53_DEFAULT_ONESHOT_C' }));
  await save('FIXTURES-v1.json', { sourceOnly: true, referenceSourceVersion: 'GNU 5.3.15', nativeBinaryQualified: false, designCommit: '90c109913cf2a1ec5b39ba0c4eb0518caca01147', originals, overlays, originalCount: 11, overlayCount: 7, semanticExecutions: 0, originalGoldensChanged: false });
  const reads = [];
  for (const name of await readdir(root)) if (/^SOURCE-0[1-8]-RESULT.json$/.test(name)) reads.push(JSON.parse(await readFile(root + name, 'utf8')));
  const identities = [...new Map(reads.flatMap(row => row.identities).map(row => [row.role + ':' + row.name, row])).values()];
  identities.push({ role: 'FROZEN_PRODUCT_STORED_BLOB', name: 'arithmetic.ts', bytes: 9922, sha256: '5e2d784b8fd333972e6e413f4c3478163462a3c1abf8cc5ff7173963420440bd', authority: '223101946d13ac9b44f4a898f58fd16004ba86b9' });
  const sourceBytesRead = reads.reduce((sum, row) => sum + row.sourceBytesRead, 0) + 395210 + 9922 * 2;
  assert(sourceBytesRead <= 12 * 1024 * 1024 && identities.length <= 64);
  const metadata = await Promise.all(['AUTHORITY-RESULT.json', 'binding/RESULT.json', 'product/RESULT.json'].map(async name => JSON.parse(await readFile(root + name, 'utf8'))));
  for (const result of metadata) assert(result.records.every(row => row.closed));
  const summary = { date: '2026-08-29', status: 'ELEVEN_ROWS_SOURCE_MAPPED_NATIVE_UNRUN', originalIDs: ids, sourceFiles: identities.length, sourceBytesRead, failedStage05ReadBytesCharged: 395210, correctedArithmeticReadBytesCharged: 19844, sourceReadLimitBytes: 12582912, nativeExecutions: 0, productExecutions: 0, successfulSourceReadStages: reads.length, preservedPreparationRefusals: ['product arithmetic derived-object exit128', 'SOURCE-05 missing successful arithmetic authority'], metadataChildrenClosed: metadata.reduce((sum, row) => sum + row.childrenClosed, 0) + 1, extraClosedMetadataRole: 'corrected git cat-file blob observed by outer shell', plannedExplicitProcessRolesThroughPublication: 47, maximumOwnedProcesses: 48, originalOPENStatesPreserved: true, full950PackageExecutedOrRebuilt: false, liveHEADUsedAsSource: false, references: identities };
  await save('SUMMARY.json', summary);
  const files = [];
  const walk = async (directory, prefix = '') => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))) {
      const name = prefix + entry.name; const pathname = directory + '/' + entry.name;
      if (entry.isDirectory()) await walk(pathname, name + '/');
      else { const status = await lstat(pathname); assert(entry.isFile() && !entry.isSymbolicLink() && status.size <= 8 * 1024 * 1024); const bytes = await readFile(pathname); if (/\.(?:md|mjs)$/.test(name)) assert(!bytes.toString('utf8').split('\n').some(line => /[ \t]+$/.test(line)), 'NEW_CODE_DOC_WHITESPACE'); files.push({ path: name, bytes: status.size, mode: (status.mode & 0o777).toString(8), sha256: hash(bytes) }); }
    }
  };
  await walk(root.slice(0, -1));
  await save('SEAL.json', { files, aggregateBytes: files.reduce((sum, row) => sum + row.bytes, 0), canonicalRowsSha256: hash(JSON.stringify(files)), sourceOnly: true, captureModeAuthority: 'Owned creation and observed lstat; not Git file mode' });
} catch (error) { await save('FINALIZE-FAILURE.json', { message: error.message, stack: error.stack }); process.exitCode = 1; }
