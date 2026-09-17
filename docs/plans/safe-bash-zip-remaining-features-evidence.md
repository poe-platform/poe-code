# ZIP remaining-features evidence and qualification plan

## From-CRLF implementation qualification — 2026-09-16

Baseline: clean current `main`, `15ef5e17045a59b924a7a90a7001b0cbb6232241`.
Read root and package AGENTS.md; changes are confined to the three assigned
ZIP modules, the memory-fixture line-ending tests and this document. No README,
SafeJS, dependency, host fallback or root CLI/SDK change. Both invocation paths
use the same virtual ZIP command parser and implementation.

Reproduction before product edits: six new focused tests for `-ll`,
`--from-crlf` and `--from-c`, each with STORE and DEFLATE, all failed because
ZIP returned 16 instead of 0. The current parser explicitly rejected `-ll`
and reserved `--from-crlf`. After implementation the same tests pass and
extraction returns `610a620d630a` for input `610d0a620d630a1a`. Archive size is
the transformed six bytes and CRC is `0x0f28185c`, independently checked with
native ZIP metadata and Python zlib. Original source size remains available
for existing source statistics; compression and suffix selection precede
conversion. Symlink targets and unselected members remain untouched.

Oracle: Darwin arm64, Node v22.22.2, Apple-modified Info-ZIP 3.0 at
`/usr/bin/zip`, SHA-256
`493a7f270b2cb3ea4f5cf153f735939bdce8b1bad48dce56d6ba89b495064271`.
Native subprocesses ran only as ad hoc test oracles, in the exclusively owned
ignored `out/zip-from-crlf` directory, with explicit PATH `/usr/bin:/bin`,
LC_ALL C and TZ UTC. Twenty short input/method observations were captured,
including empty, CR, repeated CR, LF, Ctrl-Z, final CR, repeated Ctrl-Z,
binary and mixed endings. Capture SHA-256:
`c4fbe3cbe18519f243d814f38baf9ec8db20b2f5a02bc935166f22b14a33440b`.
Additional probes checked STORE 16,383-byte and DEFLATE 65,535-byte sentinel
positions and `-l -ll`, `-ll -l`, `-lll`: last option wins.

Inspected bounded text sources from LuaDist/zip revision
`f6cfe48f6bc5bf2d505a0e0eb265ce4cb238db89`: zipup.c SHA-256
`70e76470de23ee35266b2064483747b526f066e13bcf7e1568c9005b7b9f050d`,
deflate.c SHA-256
`fd3947369a7a43e2c4b56f7f9770b2baeb130c3532bc09cfbb122f877e3b8001`.
`file_read` reserves a sentinel LF, drops CR immediately preceding LF including
the sentinel, and suppresses one Ctrl-Z at each read's end. First-read binary
detection controls conversion. Pure control-only input is left unchanged.
STORE emits no binary warning; nonquiet DEFLATE emits the ignored-binary warning.
Transport chunks do not determine native read boundaries.

Retained controls cover positive extraction and CRC/size; empty and binary
negative controls; STORE sentinel positions -1/0/+1; first binary detection
positions; reused producer buffers with chunk sizes 1, 2, 7, 16,382, 16,383,
16,384, 32,768 and 65,535; CR/LF split across chunks and final partial chunks;
pre-aborted empty/binary/text and cancellation between conversion turns;
last-option-wins; STORE suffix selection; symlink and existing-member regressions.
Tests create only memory VFS files. Existing `-l` tests remain enabled.

**Partial support, not feature completion:** STORE native read behavior is
implemented; DEFLATE text is limited to its verified initial 65,535-byte read.
Later native DEFLATE reads depend on match selection and sliding-window state,
which the existing codec interface does not expose. Larger text DEFLATE inputs
fail before archive publication instead of approximating native behavior.
Binary detected in the first read retains original owned bytes without this
text limit. BZIP2 from-CRLF conversion is explicitly refused unless suffix
selection chooses STORE. Later DEFLATE windows, BZIP2, other native builds,
platforms and nonregular device read schedules remain unqualified. No exhaustive
Info-ZIP parity or completion claim is made.

Final product/test SHA-256 values (paths relative to packages/safe-bash):

| File | SHA-256 |
| --- | --- |
| src/commands/archive/zip.ts | 62af687322e78c7e6e3159dbd6a5f30980dae226e88535c5c94fef46527c42b5 |
| src/commands/archive/zip/options.ts | fdd689150d4e5b9fc4f84ae2a3a7eac924a2cf11dd6a1bb002d82d5c3a41ac33 |
| src/commands/archive/zip/line-endings.ts | b62e4d0c3063e24ff4973d024a40f3cb432fc5e9d5308a3c2020d31aae02f0c8 |
| tests/commands/zip-line-endings.test.ts | 8a2034d9f8b030de3bc3846f24b10ce0e52bc8072259dc86f0922319080a8677 |

Delivery remains working-tree changes only. No commit, push, verified remote
main delivery or release was requested or performed.

Verification for this revision:

- Final stable `TZ=UTC LC_ALL=C node --import tsx --test
  --test-concurrency=1 packages/safe-bash/tests/commands/zip*.test.ts
  packages/safe-bash/tests/commands/unzip.test.ts
  packages/safe-bash/tests/plugins/zip*.test.ts`: 1,021 passed, zero
  failures/cancellations/skips/TODOs, 25,799.315333 ms.
- `npm run build:workspaces -- --workspace=virtual-bash`: successful six
  uncached builds in the maintained declared closure.
- Normal-import built SDK `Shell` plus `agentCommands`, memory VFS: short
  STORE and DEFLATE creation/extraction using both new option spellings passed.
- Final stable `npm run typecheck --workspace=virtual-bash`: exit 0, source
  and tests, all 26 maintained consumer groups and required negative validators.
  Compile-only; not additional runtime qualification.
- Manual visual QA: `npm run screenshot-poe-code -- --no-header -o
  out/zip-from-crlf/conversion-stdout.png bash --root
  out/zip-from-crlf/visible --cwd / -c SOURCE`. SOURCE used virtual printf
  to create mixed CRLF/CR/LF/final Ctrl-Z text, stdout ZIP with `-ll0` and
  `--from-crlf` redirected to archives, and unzip piped to xxd; then repeated
  with `00ff0d0a` binary input and nonquiet `-ll`. Inspected the full image:
  readable STORE/DEFLATE displays, both exact `610a620d630a` extractions,
  ignored-binary warning and unchanged `00ff0d0a`. PNG SHA-256
  `c3bc6d4a18339a5ecf62f9c38ae482698b3e825a09a63da3a11eba64e3e86010`.
  Its preparation used 75 cached builds and a fresh root bundle; it is visual
  QA, not the uncached selected build gate.
- The initial screenshot tried direct real-VFS archive publication and showed
  the existing atomic-owned-staging restriction, with no positive extraction.
  That image was inspected and is not counted as positive conversion QA
  (SHA-256 `923a1039e89da00320435344ce547c179cd2ed9998c0d61646b18f07cac1976a`).
  Its preparation completed 75 uncached existing builds. A verification run
  improperly overlapped that rebuild: five test files failed to load SafeJS's
  temporarily absent dist/safe-fs-core.js (659 passes, five file failures).
  The concurrent typecheck returned 2 after 26 positive groups, without
  completing negative validators. Neither failed run is a passing gate;
  the stable test rerun above passed after rebuild completion. No SafeJS
  source was edited and no failure was suppressed.

Absolute `/out` is the previously recorded read-only volume; only the existing
ignored workspace fallback was used for exclusively task-owned scratch. These
results are focused checks, not a full repository unit run.

Package-required independent review compared 634 native extractions across
every byte value in `A<byte>CRLF Ctrl-Z`, STORE boundary/multi-read tails and
admitted first DEFLATE reads: all matched. Reviewer confirmed that declared
later-DEFLATE/BZIP2 exclusions prevent a feature-completion claim. It reproduced
a diagnostic-order discrepancy: binary warning preceded the adding line.
A focused assertion failed before correction; warnings are now queued between
member name and compression summary, matching native output. The test passes
for binary STORE and DEFLATE. Reviewer made no product edits or builds and
purged only its own scratch. The earlier screenshot/test/typecheck results
precede this final diagnostic-order correction; subsequent checks are recorded
separately below.

The first guarded lint completed with one test-only `no-regex-spaces` error
in the warning-order assertion and two existing docx warnings. Replaced that
regex assertion with byte-exact string equality, retaining the diagnostic
control; the focused test passed after build completion. An intervening test
attempt overlapped screenshot preparation and failed module loading, and is
not counted as acceptance. Final workspace build after the warning fix again
completed six uncached declared builds. Final visible QA repeated the same
stdout workflow after that build: the full inspected screenshot shows the
warning after `adding: binary`, readable compression summary, both exact text
extractions and unchanged binary bytes. PNG SHA-256
`8d47862c07fab7eb145acc0cf4327aba91d32d69d271d6614ce89d4a8908501d`.
Final screenshot preparation completed 75 uncached builds and the root bundle;
Final acceptance test/typecheck runs began only after that build completed.
Final exact ZIP-wide command above: 1,021 passed, zero failures/cancellations/
skips/TODOs, 16,126.500458 ms, including the exact warning-order assertion.
Final post-correction `npm run typecheck --workspace=virtual-bash`: exit 0,
source/tests, all 26 maintained consumer groups and required negative validators.
Final stable `npm run lint:eslint`: exit 0, complete guarded traversal of
15,493 configured/linted subjects, zero errors and two existing docx warnings.
No lint policies, exclusions or warning limits changed. Final normal-import
built SDK STORE/DEFLATE controls passed again after the correction.
Final `git diff --check`: exit 0. Purged only task-owned oracle artifacts,
sources, screenshots, fixtures and logs after recording and inspection.
The feature remains incomplete due to the explicit later-DEFLATE exclusion;
successful local gates do not change that scope or imply delivery/release.

## Revision and scope

Inspected current `main` at `c75f0499a1fe7a5b4f5455779eed99cb4ee6cbab` on
2026-09-16. Applicable instructions: root `AGENTS.md` and
`packages/safe-bash/AGENTS.md`. Assignment covers the ZIP inventory/evidence;
it does not execute the subsequent implementation/release pipeline.
The requested compatibility matrix did not exist at this revision. The reserved
option gap was validated against the actual parser before any edits.
Only the two ZIP planning documents were added. No product/test/config/README,
SafeJS, dependency, CLI/SDK contract or existing evidence changes were needed.
The existing `.poe-code/pipeline/steps.yaml` edit was preserved.

The [compatibility matrix](safe-bash-zip-compatibility-matrix.md) distinguishes
implemented bounded support, reproduced missing syntax, intentional restrictions,
non-target builds and unverified semantics. No feature implementation is claimed
complete. Every feature still needs independently bound positive, negative,
boundary, cancellation and neighboring regression controls. This audit's probes
are concrete evidence, not new tests that encode rejection as the desired future
feature behavior.

| Inspected baseline file | SHA-256 |
| --- | --- |
| `src/commands/archive/zip.ts` | `4c0363f7ef2f1c5f1da8c74cbecaa04acfc039de8179bb26a32ca5f17b550039` |
| `src/commands/archive/unzip.ts` | `c69b399454c8a469ccbc3b92493ee218c07bca7a0db81dfa52097f3e31f62152` |
| `src/commands/archive/zip-format.ts` | `b0f9b29025503d69fef545ebbe8887a87849761205e5652240f05d09bea7e317` |
| `src/commands/archive/zip/options.ts` | `f80aa91ba6b54ae7ed666c905f225af2625812ce02d8a0e8db504a5a6ea8d31c` |
| `src/commands/archive/zip/zip64.ts` | `b8825ac1698da8887ae65eabbe8a109256b4dd86319e852a0fca9e082f1e3bfb` |
| `src/commands/archive/zip/crypto.ts` | `3670d19cc4edcd21f342e8202901f7d50907cbf41fa384394324c7c42006488f` |
| `docs/ZIP.md` | `4c66d3da638925d23a4da5ccc66c022eea84eda68ebe4c333523bfe1738f806e` |
| `package.json` | `f0c3ee8e363af179c4c5b95357c81c87e0742b4cdfcf89388535f896009dfce1` |

Paths in that table are relative to `packages/safe-bash`. Related option helpers,
UnZip argument/safety handling and current ZIP command/plugin tests were inspected.
The manifest declares `dependencies: {}`, but also development dependencies
(`@noble/hashes` 2.4.0, pako 3.0.1, memfs 4.56.10, tsx, TypeScript,
workspace libraries and others), required peer `poe-code >=13.0.0`, and optional
peer `yaml 2.9.0`. Empty regular dependencies is not a package-wide
dependency-free claim or a complete transitive runtime import audit.
No declarations were changed and no runtime dependencies were added.

## Environment and isolated oracles

Actual host: Darwin 24.6.0, arm64, kernel
`xnu-11417.140.69.710.16~1/RELEASE_ARM64_T6020`; Node v22.22.2;
Apple clang 17.0.0 (`clang-1700.0.13.5`), target
`arm64-apple-darwin24.6.0`, CommandLineTools compiler/SDK.
Tests used the inherited host runtime timezone (not forcibly pinned); thus their
pass count does not certify a specific TZ profile. Native syntax and cross-read
probes used an explicit environment containing only
`PATH=/usr/bin:/bin`, `LC_ALL=C`, `TZ=UTC`, cwd inside the scratch oracle directory.
America/Chicago/DST, UTF-8 locale, Linux, Windows and other native profiles were
not executed and remain Unverified.

`docker` and `podman` were unavailable. This is a dedicated host-directory
test environment, not container/process isolation or a product fallback.
All product fixtures used `createMemoryFileSystem`; only test-oracle artifacts
and source builds used host files. Absolute `/out` creation failed with
`Read-only file system`. The existing ignored repository `out/` directory was
used instead, under the exclusively task-created `out/safe-bash-zip-audit/`.
Scratch sources, binaries, archives and logs are purged after use; the setup
and results below are retained as reviewable qualification instructions.

### Pinned source acquisition and builds

From the repository root, create a fresh task-owned scratch directory. Download
these exact source archives and verify SHA-256 before extracting:

| Source | Immutable archive URL | SHA-256 |
| --- | --- | --- |
| Zip 3.0 | `https://codeload.github.com/LuaDist/zip/tar.gz/f6cfe48f6bc5bf2d505a0e0eb265ce4cb238db89` | `82631795a124b0dff92979286c74095be5e5f45ceb4183935985ed2839f26490` |
| UnZip 6.00 | `https://codeload.github.com/LuaDist/unzip/tar.gz/b2592fd6ac2dbf800130be3c64332317aff17f12` | `400b7e93aebe2da3742df87697acf134ec77afafac6f24c3b1cda0e80bd20372` |

Acquisition command shape: `curl -fLsS --max-time 40 URL -o SCRATCH/archive.tar.gz`,
then `shasum -a 256 SCRATCH/archive.tar.gz`, then
`tar -xzf SCRATCH/archive.tar.gz -C SCRATCH`. These are pinned mirrors, not
claims of authenticated pristine upstream release tarballs. Preserve source
LICENSE/COPYING files when retaining or redistributing them.

In the extracted Zip source, the successful selected-target build command was:

```sh
make -f unix/Makefile zip CFLAGS='-std=gnu89 -I. -DUNIX -O2 -DBZIP2_SUPPORT -DLARGE_FILE_SUPPORT -DUNICODE_SUPPORT -DHAVE_DIRENT_H -DHAVE_TERMIOS_H -DUIDGID_NOT_16BIT' LFLAGS2='-lbz2'
```

The initial `make -f unix/Makefile generic` and retry with `CC='cc -std=gnu89'`
failed: old configure probes generated false missing-libc flags, resulting in
conflicting `memset`, `memcpy`, `memcmp` declarations. The explicit-flags
`zips` target built the working `zip` executable but subsequently failed linking
`zipnote` (`_crc32` missing). The narrower `zip` target completed with status 0.
Do not report the whole `zips` target as successful; auxiliary tools were not used.
No source patches were applied to either oracle.

In extracted UnZip source:

```sh
make -f unix/Makefile generic CC='cc -std=gnu89 -Wno-implicit-function-declaration'
```

This completed with status 0 (legacy prototype and obsolete linker-flag warnings).
Copy the built `zip` and `unzip` into `SCRATCH/oracle/`, then run those explicit
paths with `-v`, Zip `-so`, and UnZip `-hh`; never resolve ambient tools in unit
fixtures. The Zip oracle links the host bzip2 1.0.8 library only as a test tool.

| Actual binary | Version/build | SHA-256 at capture |
| --- | --- | --- |
| constructed Zip | Zip 3.0, July 5 2008; compiled Sep 16 2026 | `f175f1aca8767e1f583dcde7a45e08393b5ed117798d733e437870e6141c4f8d` |
| constructed UnZip | UnZip 6.00, April 20 2009; compiled Sep 16 2026 | `4fc3b3516b4c8e4dd8d319a1be0254dd12b124f4e3af83852c3ba058dfff7c2d` |

Zip reported USE_EF_UT_TIME, BZIP2_SUPPORT (1.0.8, 13-Jul-2019),
SYMLINK_SUPPORT, LARGE_FILE_SUPPORT, ZIP64_SUPPORT, UNICODE_SUPPORT,
STORE_UNIX_UIDs_GIDs, UIDGID_NOT_16BIT, encryption 2.91 (05 Jan 2007).
UnZip reported COPYRIGHT_CLEAN, SET_DIR_ATTRIB, SYMLINKS, TIMESTAMP,
UNIXBACKUP, USE_EF_UT_TIME, USE_UNSHRINK, USE_DEFLATE64, UNICODE_SUPPORT
(UTF-8), MBCS (MB_CUR_MAX=4), LARGE_FILE_SUPPORT, ZIP64_SUPPORT,
VMS_TEXT_CONV, decryption 2.11 (05 Jan 2007). It did not report BZIP2 support.
Binary digests bind this capture; embedded build dates/toolchain differences can
change digests on rebuild. Always record the rebuilt digest and actual `-v` output.

The host `/usr/bin/zip` and `/usr/bin/unzip` were also queried read-only. Both are
Apple-modified 3.0/6.00, compiled July 20 2025 by the same Apple LLVM 17 family.
Apple Zip reports Unix time, symlinks, large files, ZIP64, new/old UID/GID extras
(UIDGID_16BIT), encryption 2.91; it omits BZIP2 and Unicode build controls.
Apple UnZip reports directory attrs, symlinks, timestamps, backup, Unix time,
unshrink, Deflate64, large files, ZIP64, VMS text, decryption 2.11; no Unicode/BZIP2.
A copied Apple UnZip binary (digest
`2246c1d0fee8aeda25a3b99c35b8f65f9b8f1d224971c92095072c2092ec70de`)
was killed with SIGKILL/status 137. Its failed copied-binary cross-read attempt
is excluded; constructed UnZip subsequently supplied successful cross-read evidence.

## R: reproduced option gap with passing controls

Executed from repository root using `node --import tsx --input-type=module`
with the following module on stdin. This is an ad hoc reproduction command;
it is not a maintained script or canonical unit test. The oracle directory must
be built first. Product fixtures remain entirely in memory.

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fixture, execute } from './packages/safe-bash/tests/commands/zip-standard-flags.helpers.ts';
const oracle = resolve('out/safe-bash-zip-audit/oracle/zip');
const cases = [
  ['A','adjust-sfx'], ['b','temp-path','.'],
  ['db','display-bytes'], ['dc','display-counts'], ['dd','display-dots'],
  ['dg','display-globaldots'], ['ds','dot-size','1m'],
  ['du','display-usize'], ['dv','display-volume'],
  ['DF','difference-archive'], ['e','encrypt'], ['F','fix'], ['FF','fixfix'],
  ['FI','fifo'], ['g','grow'], ['J','junk-sfx'], ['k','DOS-names'],
  ['ll','from-crlf'], ['lf','logfile-path','log'], ['la','log-append'],
  ['li','log-info'], ['L','license'], ['P','password','fixture'],
  ['RE','regex'], ['s','split-size','64k'], ['sp','split-pause'],
  ['sv','split-verbose'], ['sb','split-bell'], ['sc','show-command'],
  ['sd','show-debug'], ['sf','show-files'], ['so','show-options'],
  ['TT','unzip-command','unzip'], ['v','verbose'], ['', 'version'],
  ['su','show-unicode'], ['sU','show-just-unicode'], ['UN','unicode','warn'],
  ['H'], ['?'],
];
for (const [short, long, value] of cases) {
  const fs = await fixture();
  const before = await fs.readFile('/work/sample.zip');
  const args = long ? ['--'+long, ...(value ? [value] : [])] : ['-'+short];
  const actual = await execute('zip', fs, [...args, 'sample.zip', 'binary']);
  assert.equal(actual.exitCode, 16, JSON.stringify(args));
  assert.deepEqual(await fs.readFile('/work/sample.zip'), before);
  const control = await execute('zip', fs, ['-q', 'control.zip', 'binary']);
  assert.equal(control.exitCode, 0, control.stderr);
  const native = spawnSync(oracle, [...args, '-h'], {
    cwd: resolve('out/safe-bash-zip-audit/oracle'),
    env: { PATH:'/usr/bin:/bin', LC_ALL:'C', TZ:'UTC' },
    encoding:'utf8', timeout:2000,
  });
  assert.equal(native.status, 0, native.stdout + native.stderr);
}
```

Actual result: 40/40 product rejections at 16, 40/40 preserved original archives,
40/40 product create controls at 0, 40/40 native syntax controls at 0.
The 35 currently reserved names plus three Unicode build names and two help
aliases are covered. This experiment tests long forms except the short-only
aliases. Full short-switch grouping/negation and native operation semantics are
not proven by the syntax control and remain Unverified. `TT` is intentionally
restricted because the assignment prohibits arbitrary host-process fallback.

### Native byte-level examples beyond syntax

In the isolated oracle cwd, write six bytes `61 0d 0a 62 0d 0a` to `text`.
Execute explicit oracle paths with the same C/UTC environment:

```sh
zip -q -ll crlf.zip text
unzip -p crlf.zip
zip -q -P fixture encrypted.zip text
unzip -P fixture -p encrypted.zip
```

All four native commands returned 0. First cross-read produced four bytes
`61 0a 62 0a`; password cross-read produced the original six bytes.
The commands above abbreviate the explicit scratch binary paths, not ambient PATH.
Only fixture passwords were used. Native archives were loaded as bytes into
memory VFS before product execution. Product `zip -ll sample.zip binary`
returned 16 with `unsupported option: -ll`. Product
`unzip -p encrypted.zip` returned 2 with
`unzip: ZIP encryption is unsupported\n`.
Plain product create and `unzip -p` controls succeeded. This validates actual
line-conversion and traditional-encryption workflow gaps; helper-only crypto
tests are not reader/writer encryption support.

### Reserved short-switch neighboring defect: `-mm`

The source table labels `mm` "not used", but its dispatch explicitly rejects
the switch to prevent confusion with `-MM`. A smallest separate reproduction
was executed with `execute('zip', await fixture(), ['-mm','mm.zip','binary'])`:
product returned 0, created the archive and removed `/work/binary`.
The isolated native command `zip -mm mm.zip text` returned 16 with
`-mm not supported, Must_Match is -MM`, retaining the native source.
The existing `-q control.zip binary` passing control retains its source.
This is a validated parser compatibility defect with destructive source effects,
not a new feature to implement. It is recorded for a separate TDD fix; this
inventory assignment makes no product change. It is outside R's 40 unsupported
option cases and the focused suite's existing assertions did not detect it.

### UnZip option rejections

Using `execute` and `fixture` from the command above, execute ordinary UnZip
with each of these argument prefixes followed by `sample.zip`:

```js
const prefixes = [
  ['-c'], ['-f'], ['-u'], ['-t'], ['-T'], ['-v'], ['-z'], ['-h'], ['-hh'],
  ['-a'], ['-aa'], ['-b'], ['-bb'], ['-B'], ['-C'], ['-D'], ['-DD'],
  ['-j'], ['-L'], ['-LL'], ['-M'], ['-n'], ['-q'], ['-qq'],
  ['-P','fixture'], ['-x','binary'], ['-K'], ['-X'], ['-:'], ['-^'],
  ['-U'], ['-UU'], ['-Z'],
];
const fs = await fixture();
for (const args of prefixes) {
  assert.equal((await execute('unzip', fs, [...args,'sample.zip'])).exitCode, 2);
}
assert.equal((await execute('unzip', fs, ['-p','sample.zip','binary'])).exitCode, 0);
```

Actual result: 33/33 rejected at 2 and the pipe control passed at 0.
These are parser-gap reproductions with a passing neighbor, not assertions of
correct negative native behavior. Platform/DLL controls absent from the available
builds were not executed. UnZip environment-default behavior and method/extra-field
semantics without valid independent fixtures remain source findings/Unverified
execution cells, not fabricated behavioral passes.

## APPNOTE and public-test source pins

Downloaded `https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT`:
FINAL 6.3.10, replaces 6.3.9, revised Nov 01 2022. Digest
`0b993022a7d320a0bf704e6980bea36fafd17a6066ab994db0a0c16278a50cd6`.
Preserve CRLF bytes when verifying. This mutable URL requires digest admission;
do not silently update the pinned revision. PKWARE rights/permission terms apply;
the specification is referenced, not vendored.

Tags were resolved using `git ls-remote URL refs/tags/TAG refs/tags/TAG^{}`;
annotated tags were peeled to commits. Fetch test files via
`https://raw.githubusercontent.com/OWNER/REPO/COMMIT/PATH`, with
`curl -fLsS --max-time 30 URL -o SCRATCH/FILE`, then `shasum -a 256`.

| Project / tag / commit | Inspected path | SHA-256 |
| --- | --- | --- |
| libarchive v3.8.1 / `9525f90ca4bd14c7b335e2f8c84a4607b0af6bdf` | `libarchive/test/test_read_format_zip.c` | `3b951e483088d9a93b8a3717155118a9b311af77a36ba3cb4ca1369e3518d187` |
| CPython v3.13.7 / `bcee1c322115c581da27600f2ae55e5439c027eb` | `Lib/test/test_zipfile/test_core.py` | `b0f623e9d85806fd18ca9ce3e1cfdba3d6479a7e360641fe92577a3140744802` |
| Go go1.25.1 / `56ebf80e57db9f61981fc0636fc6419dc6f68eda` | `src/archive/zip/reader_test.go` | `75de0b2316deb615ad117d86e92f2bb84316d9ddc0a44471f6c48db7874c3e7c` |
| Go same commit | `src/archive/zip/writer_test.go` | `2016a65e7980b737c6feaab56606675068345e7d17c9a304dd3d062e424d4881` |

Fetched and inspected repository `COPYING` (libarchive) and `LICENSE` (CPython,
Go) from those same commits. The matrix maps useful named cases to requirements
and records BSD/PSF/per-file provenance obligations. No copied upstream tests,
large fixtures, external library dependency or online unit fixture was introduced.
Mapped upstream tests are candidate requirements, not completed adaptations or
passing upstream-suite results.

## Current regression result and verification limits

Executed once, uncached, from repository root:

```sh
node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/zip*.test.ts packages/safe-bash/tests/commands/unzip.test.ts packages/safe-bash/tests/plugins/zip*.test.ts
```

Result: 863 tests, 863 passes, 0 failures, 0 cancelled, 0 skipped, 0 TODO;
12,410.319959 ms reported duration. This focused ad hoc ZIP route is not the
maintained full workspace unit/pre-push gate. Its native-named tests include
committed snapshot comparisons; their pass does not mean they launched current
native tools. The separate explicit oracle probes above establish actual native
availability and their narrowly scoped observations.

No source changes were made, so no new TDD test, build, full `npm test`, broad
lint or visual CLI screenshot was warranted for this inventory task. Documentation
verification includes matrix/native inventory comparison, pin/hash checks,
relative-link checks and `git diff --check`. The inherited unrelated edit does
not enter this evidence or the deliverable.

Final documentation checks matched all 109 active source-table entries (including
conditional entries and aliases) to matrix rows, verified every recorded current
file/source/oracle digest, and passed code-fence, relative-link and whitespace
checks. `git diff --no-index --check /dev/null PATH` was used for each new document;
both produced no whitespace diagnostics (status 1 denotes the new-file diff).
Native `-mm` source preservation was additionally confirmed by reading its exact
unchanged six bytes. All task scratch data was then removed.

Not measured: full option cross-product, all five acceptance controls per row,
multi-gigabyte ZIP64, incremental gated-source output, resource/RSS isolation,
FIFO host behavior, no-echo prompting, split/SFX/recovery/log/display semantics,
AES/LZMA/PPMd/other codecs, all extra-field payloads, every native malformed
status, maintained full release gates, deployed provider behavior, unavailable
platform/build profiles and upstream-suite execution. These exclusions are open
qualification work, never passes. Source guards prove a missing code path but
do not substitute for independently valid format fixtures.

## Delivery

Local commit: none. Remote-main delivery: not requested/performed.
Release/publication: not requested/performed. The source revision above binds
the inspected baseline, not a claimed delivered implementation revision.

## Current-revision revalidation

This section records a new execution of the requested inventory assignment,
preserving the pre-existing uncommitted audit above. Current branch is `main`;
HEAD remains `c75f0499a1fe7a5b4f5455779eed99cb4ee6cbab`. All six requested
archive source digests, `docs/ZIP.md` and the package manifest match the baseline
table above. Worktree source was tested; this is not a committed-archive gate.
The inherited document digests before this addendum were:

| Existing document | SHA-256 before this work |
| --- | --- |
| compatibility matrix | `5f302e304ac5bd79feb142bd1a30e08517e51eea812744a5f98ac2e09ad5f29b` |
| evidence plan | `29fe2bf17445ac8a71c8e1f369d40b552bc54fc00a721e6890ff007b5abff659` |

No product change is claimed: this assignment inventories and reproduces gaps,
pins sources and constructs test oracles. Implementing the later feature tasks
in the inherited remaining-features pipeline is separate work. Fast assertions
against current code were run before document changes. An assertion expecting
every short spelling to reject **failed at `-dc` (actual 0, expected 16)**,
revealing additional misdispatch. That finding is retained below rather than
changing the feature scope or treating acceptance as implementation.
The original plan, pipeline config, SafeJS and README remain untouched by this
work. No new dependency, product host-process invocation or public API was added.

### Dependency and environment facts

The manifest still has empty regular `dependencies`, development dependencies,
required `poe-code` peer and optional `yaml` peer as described above. Inspection
also found actual ZIP runtime import edges: compression `codec.ts` imports
`@poe-code/office-package/compression`; Zip/UnZip safety imports
`retainFileSystemCleanup` from `poe-code/safe-fs/core`. Thus even this ZIP path
must not be described as dependency-free merely from `dependencies: {}`.
No complete package-wide transitive runtime audit is claimed.

Host profile: macOS 15.7.7, arm64, Darwin 24.6.0; Node v22.22.2;
`/usr/bin/python3` is Python 3.9.6; Apple clang 17.0.0
(`clang-1700.0.13.5`), target `arm64-apple-darwin24.6.0`.
The shell's `TZ` was initially unset. Product regression profiles explicitly use
`TZ=UTC LC_ALL=C` and `TZ=America/Chicago LC_ALL=en_US.UTF-8` in separate child
processes. These runs do not override shell-local ZIP timestamp configuration
or mutate the parent environment.

`docker`, `podman` and `go` are unavailable: their execution cells remain
Unverified. The existing host source-build approach is an isolated, exclusively
task-owned scratch directory, **not OS/container isolation**. Creation of
`/out/safe-bash-zip-revalidation` again failed with read-only-filesystem errno 30.
Scratch used the ignored repository directory
`out/safe-bash-zip-revalidation` instead and is purged after verification.
All product source/archive fixtures use memory VFS. Host files are restricted
to oracle source builds, oracle fixture capture and temporary run logs.

### Fresh source and oracle admission

The exact source archive URLs and APPNOTE URL above were fetched again, bounded
by a 35-second request timeout. Their downloaded SHA-256 digests match all
recorded pins. Before extracting either native source archive, SHA-256 was
checked, and every member was admitted as a relative ordinary file/directory
without a `..` component; links and special members were refused.
The two successful build commands above were rerun unchanged and each returned
0. Only built `zip` and `unzip` were copied to the task-owned `oracle/` directory.
Their new binary digests exactly match the prior capture:

| Tool | Version / SHA-256 |
| --- | --- |
| constructed Zip | Zip 3.0, 2008-07-05; compiled 2026-09-16; `f175f1aca8767e1f583dcde7a45e08393b5ed117798d733e437870e6141c4f8d` |
| constructed UnZip | UnZip 6.00, 2009-04-20; compiled 2026-09-16; `4fc3b3516b4c8e4dd8d319a1be0254dd12b124f4e3af83852c3ba058dfff7c2d` |

Zip's actual feature list again reports Unix time, BZIP2 1.0.8, symlinks,
large files, ZIP64, Unicode, new UID/GID fields, UIDGID_NOT_16BIT and encryption
2.91. UnZip reports directory attributes, symlinks, timestamps, UNIXBACKUP,
Unix time, unshrink, Deflate64, Unicode, MBCS, large files, ZIP64, VMS text and
decryption 2.11; no BZIP2 or unreducing capability.
The earlier MBCS profile needs refinement: under **C/UTC**, this same binary
reports `UNICODE_SUPPORT [char coding: other]`, `MB_CUR_MAX = 1`; under
**en_US.UTF-8/America/Chicago**, it reports UTF-8 and `MB_CUR_MAX = 4`.
The compile-time feature and runtime locale profiles are separate facts.
Only `-v` was observed under the latter native profile; all native operation
probes below use C/UTC. There is no Linux or cross-platform qualification.

Additional provenance hashes freshly checked:

| Pinned source artifact | SHA-256 |
| --- | --- |
| Zip `zip.c` | `dcab6456678d2040fa05af40e78e3bcb12e854bf00d700930837672d86ec7413` |
| Zip `LICENSE` | `8ecd6c1bab449127eb665cef1561e73a8bce52e217375f6f466939e137b1e110` |
| UnZip `LICENSE` | `7469b81d5d29ac4fd670f7c86ba0cb9fa34f137a2d4d5198437d92ddf918984b` |
| libarchive `COPYING` | `30e556b3959e3985d66efefec5eaac51d4995053caa1d3cffe6eb916f146f229` |
| CPython `LICENSE` | `78b12c3a81360b357002334f0e70ea0e92eebf7a9b358805c03c48484945f3bb` |
| Go `LICENSE` | `911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad` |

All four upstream test-file hashes match their earlier table. No upstream test
or fixture was adapted or vendored; exact named candidate mappings were added
to the matrix with per-file/repository licensing obligations. The locally
installed Python 3.9.6 oracle is **not** CPython v3.13.7 suite execution. A source
pin or inspected test function is not a test pass.

### Short and long spelling reproductions

Use the R module above and its 40-case list, append `['mm']`, and replace the
single long-option preference with this inner loop. Product cases remain in
memory and every spelling has a fresh independent passing create control:

```js
for (const [short, long, value] of cases) {
  for (const arg of [
    ...(short ? ['-' + short] : []),
    ...(long ? ['--' + long] : []),
  ]) {
    const fs = await fixture();
    const before = await fs.readFile('/work/sample.zip');
    const source = await fs.readFile('/work/binary');
    const actual = await execute('zip', fs, [
      arg, ...(value ? [value] : []), 'sample.zip', 'binary',
    ]);
    const archivePreserved = Buffer.from(await fs.readFile('/work/sample.zip'))
      .equals(Buffer.from(before));
    let sourcePreserved;
    try {
      sourcePreserved = Buffer.from(await fs.readFile('/work/binary'))
        .equals(Buffer.from(source));
    } catch (error) {
      assert.equal(error.code, 'ENOENT');
      sourcePreserved = false;
    }
    if (actual.exitCode === 16) {
      assert.equal(archivePreserved, true, arg);
      assert.equal(sourcePreserved, true, arg);
    }
    console.log(arg, actual.exitCode, archivePreserved, sourcePreserved);
    assert.equal((await execute('zip', await fixture(), [
      '-q', 'control.zip', 'binary',
    ])).exitCode, 0);
  }
}
```

Actual denominator: **41 cases, 78 spellings, 73 status-16 rejections** with
archive/source preservation, **five non-rejections**, and **78 passing create
controls**. The five non-rejections are defects/context misdispatch, not supported
features:

| Product invocation prefix, then `sample.zip binary` | Status | Exact observable effect |
| --- | ---: | --- |
| `-dc` | 0 | Removes `binary` member; source preserved; stdout warning about options ignored with `-d`, then `deleting: binary\n`. |
| `-dd` | 0 | Removes `binary` member; source preserved; stdout `deleting: binary\n`. |
| `-lf log` | 12 | Original sample/source preserved; treats `log.zip` as archive and emits `\tzip warning: log.zip not found or empty\n`; no logging workflow. |
| `-TT unzip` | 0 | Creates `unzip.zip`, adds `sample.zip` and `binary`, then prints `test of unzip.zip OK\n`; original sample/source preserved. |
| `-mm` | 0 | Rewrites archive and deletes source; stdout `updating: binary (stored 0%)\n`. |

Native counterparts were executed on fresh copies of a one-member `x` archive:
`zip -dc sample.zip x` returns 0 and updates `x` with `0/1` count progress;
`-dd` updates `x` at 0; `-lf log` updates at 0 and creates `log.log`;
`-TT 'EXPLICIT_ORACLE_UNZIP -tqq'` consumes the command argument and updates at
0; `-mm` returns 16 with `-mm not supported, Must_Match is -MM`, preserving
archive/source. These native runs do not invoke product commands. The `-TT`
case without `-T` proves argument consumption only, **not command execution**.
The future product test-command workflow remains restricted to registered
virtual commands and explicit supported parsing.

The 40 non-`mm` cases were also syntax-probed with **both** native short/long
spellings, explicit oracle executable, cwd inside `oracle/`, environment only
`PATH=/usr/bin:/bin LC_ALL=C TZ=UTC`, and a two-second timeout:
**77/77 returned 0 when followed by `-h`**. This expands the earlier long-form
syntax result, but does not certify native short grouping or negation semantics.
The earlier 33 ordinary UnZip rejections were rerun with a fresh `-p` binary
control for **each** prefix: **33/33 rejected at 2; 33/33 controls passed**.

UnZip environment defaults were separately reproduced for each variable using
`execute('unzip', await fixture(), ['sample.zip', 'binary'], {},
{ env: { [variable]: '-p' } })`, where `variable` is `UNZIP` or `UNZIPOPT`.
Both return **1**, print `Archive:  sample.zip\narchive comment\n`, prompt for
overwrite on stderr and treat stdin EOF as None; existing source bytes survive.
An initial expected status 0 assertion failed and was corrected to this actual
status, preserving the discrepancy. For each, explicit product
`-p sample.zip binary` returns 0 and the exact binary bytes. Independently,
native `unzip plain.zip x` with only C/UTC/PATH and the selected variable set
to `-p` returns 0 with `78` and no extraction prompt. **2/2 native controls and
2/2 explicit product controls pass**; environment-default behavior is Missing.
Absent ZipInfo mode defaults and combined-variable precedence remain Unverified.

### Native operation probes and failure controls

A fresh native directory per option contained only six-byte `binary`
(`61 0d 0a 62 0d 0a`) and its successful baseline `zip -q sample.zip binary`.
The source time was pinned to Unix seconds 1704164646. Run the R option list
using its long spelling, value sample and `sample.zip binary`; for `DF`, `F`
and `FF`, insert `--out result.zip` before `binary`. All runs use explicit
constructed binaries, C/UTC, stdin EOF and two-second process timeout.
Forty processes completed; **their exit results are observations, not 40 passes**:

| Native status | Options |
| --- | --- |
| 0 (33 contexts) | temp-path, display-bytes/counts/dots/globaldots/usize/volume, dot-size, difference-archive, fifo, grow, junk-sfx, DOS-names, from-crlf, logfile-path, log-append/info, license, password, regex, split-verbose/bell, show-debug/files/options/unicode/just-unicode, unzip-command, verbose/version, unicode, H, ? |
| 3 (one context) | adjust-sfx on ordinary tiny archive with a source operand |
| 16 (five contexts) | encrypt without a terminal, fix/fixfix with an extra operand, split-size/split-pause updating an existing unsplit archive |
| 9 (one context) | show-command displays command and exits |

The explicit denominator is 33 + 1 + 5 + 1 = **40**. Counts are derived from the
captured option list, not from statuses being called passes. For status 0,
`DOS-names`, `from-crlf` and
`password` changed sample bytes; other options preserved them in these specific
fixed-time contexts. Every native source was preserved. `logfile-path log`
created `log.log`; difference-archive created `result.zip` for the unchanged
selection. None establishes changed/new-only differences, actual FIFO I/O,
progress thresholds, log append/redaction or prompt behavior.
Native `-ll` cross-read returned `61 0a 62 0a`; native password `fixture`
cross-read returned the original six bytes, both at 0.

Additional compact operation controls, after fresh `zip -q plain.zip x` on a
one-byte `x` source:

| Exact native commands / fixture | Result and exclusion |
| --- | --- |
| Prefix `MZ` (two bytes) to plain archive; `zip -A sfx.zip` | Status 3, `reading archive fseek: Invalid argument`; excluded as a successful prefix control. |
| Prefix `MZ` plus 62 zero bytes; `zip -A sfx.zip`; `unzip -p sfx.zip` | Both 0; adjustment reports 64 bytes; cross-read `78`. Prefix is data and never executed. |
| `zip -J sfx.zip`; `unzip -p sfx.zip` | Both 0; new first four bytes `50 4b 03 04`; cross-read `78`. |
| `zip -F plain.zip --out F.zip` | Status 3, failed seek to central directory, suggests `-FF`; intact tiny repair is not a passing oracle control. |
| `zip -FF plain.zip --out FF.zip`; `unzip -p FF.zip` | Both 0; scans/copies `x`; cross-read `78`. Damaged/truncated recovery is not qualified. |
| `zip -q -0 -s 64k split.zip large` | 0; `large` is 70,000 deterministic bytes from Python `random.Random(42).getrandbits(8*70000).to_bytes(70000,'little')`. |
| Inspect split volumes | `.z01`: 65,536 bytes, first signature `50 4b 07 08`; final `.zip`: 4,628 bytes. |
| `zip -q -s 0 split.zip --out joined.zip`; `unzip -p joined.zip` | Both 0; byte equality with all 70,000 input bytes. Missing/order/descriptor/encryption and publication failure controls remain Unverified. |

To re-run native commands, replace `zip`/`unzip` in this table with absolute
task-owned executable paths; preserve each fixture and earlier failure before
creating its new independent control. No ambient native executable is admitted
as a unit-test dependency.

### Independent format refusals and dispatch exclusions

Load oracle archives as owned bytes into `fixture(bytes)` and execute
`unzip -p sample.zip`; provide a fresh plain `-p sample.zip binary` control for
each refusal. Host files below are oracle capture input only; product VFS remains
memory-backed:

| Independent input | Product result |
| --- | --- |
| Native Zip password fixture, 196 bytes | 2, `unzip: ZIP encryption is unsupported\n`. |
| Python method-14 fixture, 120 bytes | 2, `unzip: ZIP unsupported general purpose flags\n` (LZMA EOS flag). |
| Native adjusted 64-byte-prefix archive, 217 bytes | 2, `unzip: ZIP overlapping spans, gaps or self-extracting prefix are unsupported\n`. |
| Native final split volume, 4,628 bytes | 2, `unzip: ZIP multi-disk archive is unsupported\n`. |

All four independent plain pipe controls returned 0. Deterministic LZMA fixture
creation with local Python 3.9.6:

```python
output = io.BytesIO()
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_LZMA) as archive:
    info = zipfile.ZipInfo('x', (2024, 1, 2, 3, 4, 6))
    info.compress_type = zipfile.ZIP_LZMA
    archive.writestr(info, b'x')
with zipfile.ZipFile(io.BytesIO(output.getvalue())) as archive:
    assert archive.read('x') == b'x'
```

Fixture SHA-256:
`8db94eeb30c05d8324b73a957bae873c2871f399950e67ce5f9991489296a023`.
This is a test-only standard-library oracle, not a runtime dependency or copied
upstream test. An earlier fixture without pinned DOS time had a different digest
and is excluded from deterministic fixture proof.

Method dispatch mutations used a one-byte STORE `x` archive from `archiveBytes`,
changing both local method at offset 8 and central method at `central+10` to
1,2,3,4,5,6,9,10,14,16,18,19,20,93,94,95,96,97,98,99. All **20/20** rejected
at 2 with `unsupported compression method`; **20/20** unchanged STORE controls
returned 0. Their stored payload is **not a valid representation for those
methods**, so valid legacy/AES/PPMd/other codec interoperability remains Unverified.
Likewise strong-encryption records, digital signatures, masked directories and
unknown extra semantics without independent valid inputs are source findings,
not completed interoperability reproductions. The matrix explicitly distinguishes
Missing dispatch from Unverified valid-fixture behavior.

### ZIP64 sentinel and source/output reproduction

Executed in memory with `TZ=UTC node --import tsx --input-type=module`, importing
`fixture`, `execute`, `archiveBytes`, `streamZipArchive`, `readZipArchive` and
`settings` from their inspected package paths:

```js
const limits = settings({ limits: {
  maxEntryBytes: 0x100000000, maxTotalBytes: 0x100000000,
  maxArchiveBytes: 0x100000000,
} });
const signal = new AbortController().signal;
const bytes = await archiveBytes([{ name: 'x', body: Buffer.from('x') }]);
assert.equal((await readZipArchive(bytes, limits, signal)).entries.length, 1);
const entry = {
  name: 'x', data: Uint8Array.of(0), size: 0xffffffff, method: 8, crc32: 0,
  modified: new Date('2024-01-02T03:04:06Z'), mode: 0o100644,
  directory: false, symlink: false,
};
await assert.rejects(async () => {
  for await (const chunk of streamZipArchive({
    entries: [entry], comment: new Uint8Array(),
  }, limits, signal)) assert.fail('unexpected output');
}, /ZIP entry byte limit exceeded/);

let writes = 0, reached = false;
const controller = new AbortController();
const reason = new Error('gated input cancelled');
const source = (async function* () {
  yield Uint8Array.of(120);
  assert.equal(writes, 0);
  reached = true;
  controller.abort(reason);
  controller.signal.throwIfAborted();
})();
await assert.rejects(execute('zip', await fixture(), ['-q', '-', '-'], {}, {
  signal: controller.signal, stdin: source,
  stdout: { async write() { writes++; } },
}), error => error === reason);
assert.equal(reached, true);
assert.equal(writes, 0);
const control = await execute('zip', await fixture(), ['-q', '-', '-'], {}, {
  stdin: (async function* () { yield Uint8Array.of(120); })(),
});
assert.equal(control.exitCode, 0);
assert.equal(control.stdout.length, 269);
```

Both corrected reproductions completed successfully. The synthetic sentinel
entry proves early advertised-size refusal only, not a valid large compressed
payload or native large-file interoperability. Large **configured limits alone
are admitted for small inputs**: an initial hypothesis expecting those settings
to reject was false. Its preliminary catch also matched its own assertion text,
so that harness output is explicitly excluded as evidence. The corrected
sentinel probe checks the actual failure outside that catch. A preliminary
diagnostic expectation (`uncompressed byte`) was corrected to the actual
`entry byte` diagnostic. No product guard was weakened.
The source probe proves no output before input advances to its second pull and
preserves the cancellation reason; it does not certify all output enrollment,
chunk reuse, backpressure, codec cancellation or resource limits.

### Fresh regression and document verification

Executed the same focused suite twice, independently and uncached, from root:

```sh
TZ=UTC LC_ALL=C node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/zip*.test.ts packages/safe-bash/tests/commands/unzip.test.ts packages/safe-bash/tests/plugins/zip*.test.ts
TZ=America/Chicago LC_ALL=en_US.UTF-8 node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/zip*.test.ts packages/safe-bash/tests/commands/unzip.test.ts packages/safe-bash/tests/plugins/zip*.test.ts
```

| Runtime profile | Tests / passes / failures / cancelled / skips / TODO | Duration |
| --- | --- | --- |
| C/UTC | 863 / 863 / 0 / 0 / 0 / 0 | 12,771.115584 ms |
| en_US.UTF-8/America/Chicago | 863 / 863 / 0 / 0 / 0 / 0 | 13,230.186791 ms |

These are existing neighboring regression tests, not new tests certifying every
missing feature, and not maintained full build/lint/unit/release gates. Snapshot
oracle tests do not imply current native process execution. No visual output or
product code changed, so no screenshot, source TDD fix, build or broad lint is
claimed. The fast failing assertions above are gap validation, not maintained
tests encoding erroneous behavior as the desired implementation.

Inventory verification matches all 109 active source pairs to matrix rows and
checks the 85 enabled native option rows separately. The matrix addendum explicitly
enumerates APPNOTE 4.4.1–28, all 4.6.1 third-party IDs, split signatures and
per-method flag semantics. Unverified semantic cells and deliberate restrictions
remain separate from syntactic support. Relative links, fenced blocks, source
pins and whitespace are checked before task-owned scratch removal.

Delivery remains: **no local commit; no push requested/performed; no successful
release/publication claimed**. No missing feature has newly satisfied all five
acceptance dimensions. Native FIFO streams, terminal password/no-echo prompts,
progress timing, changed difference selections, temp cross-device publication,
log failure/append/redaction, virtual test commands, damaged recovery, full
split/cancellation cross-products, large ZIP64, authenticated AES, PPMd, all
metadata/encoding/platform profiles and upstream suite execution remain open.

Final documentation verification passed: all 109 active native source pairs
mapped; 85 enabled native option rows counted; all 37 APPNOTE 4.6.1 IDs explicitly
enumerated; all 36 named public-test candidates found at their pins; local links,
fenced blocks and whitespace validated. `git diff --check` passed;
`git diff --no-index --check /dev/null` for each untracked document produced no
whitespace diagnostics (status 1 is the expected new-file diff). Task-owned
scratch was removed after these checks. Preliminary source-symbol verifier
failures came from conflating C `DEFINE_TEST(name)` with Python `def name(` and
were corrected without altering any candidate name or upstream source.

## User workflow follow-up

Executed on 2026-09-16 against current `main` base
`c75f0499a1fe7a5b4f5455779eed99cb4ee6cbab` plus the following uncommitted package
changes. This follow-up supersedes the five baseline short-switch misdispatches
above; it preserves all original observations and exclusions. The pre-existing
pipeline/remaining-features plan edits and both audit documents were present at
turn entry. SafeJS and README were untouched. No dependency declarations,
runtime dependencies, host fallback or public CLI/SDK options were added.

| Current changed package input | SHA-256 |
| --- | --- |
| `src/commands/archive/zip.ts` | `c987784168f452b1bdfec2697cbd6011856b36f24cf475d92a84a29a536825d3` |
| `src/commands/archive/zip/options.ts` | `90caf0f62586aeec3c51ea4d04c57fd12800a0c3afb091f9f72aa523634ad7f4` |
| `tests/commands/zip-help.test.ts` | `b9891783b8885e09fed7637ee85ce0fdbf85e6f2d65c9a589bac7521e0c11df3` |
| `scripts/integration-inputs.test.mjs` | `d7ca692c995fa1892c557de6ca027e29f6b56616e2da89a8d0e73fb3cf2b4873` |

### Revalidate, fail first, then fix

Added ten fast in-memory failing tests, one for each of `dc`, `dd`, `lf`, `TT`,
`mm` with and without grouped `q`, using:

```sh
node --import tsx --test packages/safe-bash/tests/commands/zip-help.test.ts
```

Baseline result: 24 tests, 14 passes, ten failures; every new case returned 0
instead of expected 16 for the exact operand list `sample.zip binary` (without
the separate value used in the earlier audit). This reconfirms actual parser
misdispatch rather than assuming the older reproduction applies.
The fix checks the five reserved two-character switches at each short-option
offset before dispatching single-character flags. Help still exits immediately
when encountered first; attached option values and filenames after `--` retain
their existing parsing boundaries. Product logic stays inside safe-bash.

The first post-fix run exposed a test-only strict comparison of memory-VFS
Uint8Array with a Buffer; the equal byte payloads had different prototypes.
The assertion now compares Uint8Array bytes. This harness failure was corrected
without changing product behavior and is excluded as a product regression.
Added ten further tests covering negation, attached values, trailing options,
help order, ZIPOPT defaults, literal filenames and diagnostic cancellation.
Final focused result: **34/34 pass**, zero failures/skips/TODOs, 659.613291 ms.
The edited existing test file is explicitly asserted in integration discovery.

Acceptance is scoped to **safe reserved-option dispatch**:

| Dimension | Executed control |
| --- | --- |
| Positive | Ordinary `-q control.zip binary` creation per refusal; `-h` before reserved option succeeds; each literal `-OPTION` source after `--` creates the named member. |
| Negative | Ten short/grouped refusals return 16, preserve archive/source bytes and namespace, and do not pull stdin. |
| Boundary | Per option: attached `=value`, negation suffix, option after operands, reserved option before help, and ZIPOPT defaults. |
| Cancellation | Abort during the first diagnostic stdout write; each command rejects with the exact reason, preserves archive/source bytes, and allows a fresh successful create. |
| Neighbor | Existing delete, move, comments, freshen, line conversion, test, ZIP64, codecs, extraction, ownership and plugins in both full focused ZIP profiles. |

### Fresh isolated native and source controls

Absolute `/out` creation again failed with read-only-filesystem errno 30.
Used exclusively task-owned ignored `out/safe-bash-zip-user-edge/` for source
builds, oracle artifacts, temporary logs and screenshot, purged after verification.
This is directory isolation on Darwin 24.6.0 arm64 / Node v22.22.2, **not an OS
sandbox**. Downloaded both pinned source archives above with a 35-second timeout,
verified their exact SHA-256, admitted only relative ordinary file/directory
members without parent components, and ran the two earlier exact build commands.
Both builds returned 0. Both binary digests match the earlier capture exactly.
Native `-v` again confirms the recorded feature lists: Zip BZIP2 1.0.8,
ZIP64/large-file/Unicode/symlink/new-UID-GID/encryption 2.91; UnZip
unshrink/Deflate64/ZIP64/large-file/Unicode/decryption 2.11 with no BZIP2 or
unreducing support. C/UTC runtime reports MBCS maximum 1 / coding other.
No Linux/container or other feature build is newly qualified.

For each of the five collisions, create a fresh directory with one-byte source
`binary` (`78`) and execute absolute oracle `zip -q sample.zip binary` at 0.
Then execute these commands with only `PATH=/usr/bin:/bin LC_ALL=C TZ=UTC`,
stdin EOF and a two-second process timeout:

| Native command after baseline create | Status / effect |
| --- | --- |
| `zip -dc sample.zip binary` | 0; count progress `0/1`; archive/source bytes preserved. |
| `zip -dd sample.zip binary` | 0; update progress; archive/source bytes preserved. |
| `zip -lf log sample.zip binary` | 0; creates `log.log`; archive/source bytes preserved. |
| `zip -TT 'ABSOLUTE_ORACLE_UNZIP -tqq' sample.zip binary` | 0; consumes command value; archive/source bytes preserved. This omits `-T`, so execution of the command is unverified. |
| `zip -mm sample.zip binary` | 16; native diagnostic says Must_Match is `-MM`; archive/source preserved. |

Every native baseline create and subsequent `unzip -p sample.zip binary`
control passed at 0 with exact `78` output: **5/5 creates, 5/5 cross-reads**.
Product unit tests never invoke these host binaries.

Rerun R's exact 40-case list plus `['mm']` using **both** short/long spellings,
the new absolute constructed Zip path and a fresh memory fixture/control for
each spelling. Assert source bytes as `Uint8Array.from(binary)` as well as
archive bytes. Result: **41 cases, 78/78 product status-16 refusals,
78/78 archive/source preservation checks, 78/78 independent product creates**;
the 77 non-`mm` native spelling-plus-`-h` syntax controls return 0. Native `mm`
is the separate negative operation control above. This reproduces missing
syntax, not all operational/terminal/logging/disk-splitting feature behavior.

Fresh downloads of the pinned APPNOTE and four named public-test sources again
match all five previously recorded hashes. No upstream source/fixture was
adapted; licensing and candidate mappings above remain applicable. Pinned
upstream suite execution is still **Unverified**, not inferred from downloads.

### Regression and visual checks

Reexecuted the two exact UTC and America/Chicago focused ZIP commands from the
earlier regression section, uncached:

| Profile | Tests / pass / fail / cancelled / skips / TODO | Duration |
| --- | --- | --- |
| C/UTC | 883 / 883 / 0 / 0 / 0 / 0 | 23,246.369041 ms |
| en_US.UTF-8/America/Chicago | 883 / 883 / 0 / 0 / 0 / 0 | 24,525.853167 ms |

`npm run test:runner --workspace=virtual-bash` passes **522/522** tests,
zero failures/skips/TODOs, 19,349.686834 ms, including exact current integration
discovery membership. The focused suites are not a full repository `npm test`.
`npm run build:workspaces -- --workspace=virtual-bash` returned 0 through its
declared selected workspace closure (six builds), including guarded package
build and compression assets. No locally generated release was attempted.

Used the existing `npm run screenshot` renderer with `--no-header -o
out/safe-bash-zip-user-edge/dispatch.png` and an inline Node/tsx module importing
actual public `Shell`, `archiveCommands`, and the in-memory fixture. The module
prints and executes `zip -OPTION sample.zip binary` for all five options,
asserts status 16, then prints/executes `zip -q control.zip binary` at 0, and
disposes the Shell in `finally`. Visually inspected the generated screenshot:
all five complete diagnostics and statuses are readable, and the create control
is visible at 0. This validates the safe-bash virtual CLI/SDK dispatch path using
the same command factories; poe-code's host CLI has no ZIP subcommand to use
with `screenshot-poe-code`. Screenshot SHA-256 before purge:
`8790f1fc730f630e254f8c43ccd8dbf51f8324cd0297039a38f884ed62b331f1`.
No screenshot test or persistent QA script was added.

The four still-missing/restricted features are not complete implementations.
All earlier format, terminal, FIFO, recovery, split, encoding, large-file and
platform exclusions remain open. Delivery: **no local commit, no requested or
performed push, no remote-main delivery/release/publication claim**.

Final maintained checks: `npm run typecheck --workspace=virtual-bash` returned
0, including source/tests and 26 current consumer groups plus their maintained
negative validators; its summary correctly records zero runtime acceptance
executions. Guarded root `npm run lint:eslint` returned 0 with complete traversal,
15,493 configured/linted subjects, zero errors and two warnings (existing unused
variables in unrelated docx tests, preserved). No lint exclusions or rules changed.
Document verification maps all **109/109** active native source option pairs and
finds all **36/36** named public-test candidates at the authenticated pins; fenced
blocks are balanced. An initial verifier confused a source filename with a test
symbol and omitted class-qualified symbols; the corrected verifier distinguishes
both and passes without changing source, pins or candidate names. `git diff
--check` and new-document whitespace checks produce no diagnostics (new-file
diff exit 1 is expected). All task-owned scratch artifacts are removed after use.

## Native ZIP CLI displays follow-up (2026-09-16)

This execution uses current `main` base
`ac9156bba02cd71780599094cf172bd726c7221f` plus the explicitly listed working
changes below. Historical source pins and results above remain historical.
The pre-existing edit to `safe-bash-zip-remaining-features.md` is preserved.
No SafeJS source, README, dependency declarations, root public API or release
configuration was changed. Runtime dependencies remain empty. Product commands
use the existing codecs, memory/VFS contracts, signals, limits and ZipScope
cleanup; no native process or host filesystem fallback was introduced.

### Revalidation and fail-first controls

Before implementing the display options, the expanded existing in-memory
`zip-help.test.ts` returned **45 tests, 26 passes, 19 failures**, zero skipped or
TODO cases, 433.150792 ms. These reproduce current rejection of information,
listing, command/options and operational display options. Existing reserved
`dc`/`dd` refusal tests were replaced by positive native-option controls; `lf`,
`TT` and `mm` refusals remain. The existing integration discovery explicitly
registers both edited test files, so no new discovery exception is needed.

Additional failing controls preceded corrections for short `-version` versus
long `--version`, debug with deferred information, separate literal password
values, retained `-dd-` interval and scanned size before LF conversion. The
independent review required by package AGENTS reproduced debug warnings and
filesystem errors that exposed URL credentials, plus grouped password-shaped
literal paths. Its temporary module resolver only allowed investigation while
root build outputs were unavailable; that workaround is **excluded from the
final maintained validation**. It changed no files or runtime dependencies.
The subsequent retained in-memory tests cover these cases.

An old neighboring test asserted grouped `-du` meant delete/update. Native
`-du` is display-uncompressed-size, and the new implementation correctly
returned 0. The conflict control now passes separate `-d -u`, preserving the
actual conflicting-action assertion alongside grouped `-uf` and `-df`.
An exploratory positive URL-name fixture returned the existing unsafe ZIP-name
refusal, rather than creation. Its expected status was corrected to 2 without
weakening name validation; a valid `x?token=private` filename independently
checks successful progress redaction. An initial fixture assertion called a
nonexistent memory-FS `exists` method; it was corrected to inspect `readdir`.
These harness errors do not establish product failures or accepted exceptions.

### Fresh isolated native oracle and argument grammar

Downloaded the same pinned LuaDist archive listed above and verified SHA-256
`82631795a124b0dff92979286c74095be5e5f45ceb4183935985ed2839f26490` before
extracting it into task-owned scratch. The exact selected `make ... zip` command
from the earlier construction section again succeeded. This oracle is Zip 3.0
on Darwin 24.6.0 arm64, built with the explicit BZIP2/large-file/Unicode flags;
it is not a Linux or all-build qualification. Current executable SHA-256:
`f175f1aca8767e1f583dcde7a45e08393b5ed117798d733e437870e6141c4f8d`.
Native invocations use an absolute executable path, fresh isolated fixture
directories, stdin EOF, captured streams, a three-second timeout, and
`PATH=/usr/bin:/bin LC_ALL=C TZ=UTC`. Preliminary Apple `/usr/bin/zip` probes
are a separate build profile, not substituted for the pinned oracle.
Native sources/tools are test oracles only; no upstream source or test was
incorporated into runtime or canonical unit fixtures.

| Spelling / exact native control | Observed grammar, stream and status |
| --- | --- |
| `-v` alone | Implementation/version information on stdout, 0; no archive operation. |
| `--verbose`, `-qv`, `-vv` alone, stdin EOF | Binary stdin-to-stdout ZIP, 0; verbose progress and totals on stderr. |
| `--version --bad`; `-L --bad` | Immediate information/license exit on stdout, 0; later bad option ignored. An earlier bad option still fails. |
| `-vq a x`; `-qv a x` | Later quiet/verbose wins: respectively silent and verbose operation, 0. |
| `-version` | Grouped short argument, not long version; 16 in pinned native build. Product also refuses at 16 without claiming encryption/split support. |
| `-sc a x -qi x` | Options and consumed list move before operands, terminating list with `@`; processed command and Interrupted diagnostic on stdout, 9. |
| `-sc a x --include=x` | Attached list value stays attached; no synthetic `@`; stdout, 9. |
| `-sc a -- -Pprivate` | Literal terminator preserves option-shaped filename, stdout, 9; product additionally redacts credential-shaped paths. |
| `-sc a x --bad`; `-so --bad` | All arguments validated before deferred display; argument diagnostic on stdout, 16. |
| `-so`; `-sd -so` | Options table on stdout, 0; debug prefixes deferred table with `sd: Command line read`. |
| `-sf a x` (100,000-byte x) | `Would Add/Update:\n  x\nTotal 1 entries (100000 bytes)\n`, stdout, 0. |
| `-qsf a x`; `-sf- a x` | Totals only on stdout, 0; negated show-files still exits without writing an archive. |
| `-sf missing` | Missing input archive, stdout, 18. |
| `-sf a` | `Archive contains` plus input member names and original sizes, stdout, 0. |
| `-sf a -U x`; `-sf a -d x` | Would Copy/Delete selection, original uncompressed sizes, stdout, 0. Copy listing needs no output archive. |
| `-sf a x -O missing/out` | Listing succeeds at 0 without resolving or creating output parent. |
| `-sf a -x '*'` | No operands to select from, stdout, 16. |
| `-sf -FS a x` after an unchanged create | Lists x at 0 even when filesync would otherwise find it current. |
| `-sf -f a x`; `-sf -u a x` after unchanged create | Zero selected entries, listing at 0. |
| `-dcdbdudv a x y`, x=100,000 bytes and y=6 bytes | `1>1:   0/  2 [   0/ 97K] updating: x (97K) ...`, then `1>1:   1/  1 [ 97K/   6] ...`, stdout, 0. |
| `-0ldbduv a x`, x=`a\nb\n` | Byte counter 4 and displayed original size 4; verbose `(in=6) (out=6)` and totals 6 after CRLF conversion, stdout, 0. |
| `-ds VALUE -h`, `-ds=VALUE -h`, `--dot-size=VALUE -h` | Required value supports separated or attached spelling; empty restores 10 MB; 0 disables dots; digits plus optional case-insensitive kmgt; at most eight characters. Bare values below 1024 imply MB. |
| Values `1`, `1023`, `32K`, `32768`, `01m`, `1g`, `1t` | Accepted before help at 0. |
| Values `-1`, `1024`, `31k`, `1kb`, `1.5m`, `1e`, ` 32k`, `100000000` | Refused before help at 16. Native includes numeric warnings for certain malformed values; product suppresses supplied values in size diagnostics to avoid leaking secrets. |
| `-0 -ddds32k -dd- a x` with 65,536-byte x | Negation retains configured size in this native build and continues per-file dots, 0. |
| `-0 -ds0 -dd a x`; `-0 -ds0 -dg a x` | Explicit zero remains zero; global mode still terminates its display with a newline. |

Long names remain case-sensitive; exact names or unique abbreviations are
accepted, ambiguous prefixes such as `--ver`, `--show`, and `--display` fail at
16. Native-unimplemented names remain in abbreviation resolution (including
show-Unicode names) so missing capabilities cannot make prefixes falsely unique.
Long flag options reject attached `=value`/empty `=` and nonnegatable `-` suffixes.
Fresh pinned native immediate-token controls confirm `-L=`/`-L=value` and
`-h=` exit at 0 before their remaining token text, whereas `-v=` and `-so=`
refuse at 16. Pinned native `--version=` terminates with signal 5 (no output);
that native parser failure is not copied into the virtual host. Product
`--version=` safely refuses at 16, a precise negative-status restriction.
Display byte/count/usize/volume/dots/globaldots and show-files are negatable;
dot-size, command/debug/options/license/verbose/version are not. Two-character
short options take precedence at every grouped-option offset. Value options
consume the remaining attached text or the next argument. Options after
operands are processed; `--` is legal only after archive and makes subsequent
paths literal. ZIPOPT/ZIP_OPTS continue to supply defaults before explicit
arguments; the current byte/value admission and parsing contracts are reused.

### Bounded profile and precise exclusions

Information content is deliberately truthful: this private virtual ZIP
implementation has no injected native compiler identity or independent release
version metadata. `--version`/lone `-v` identify the implementation and actual
STORE/DEFLATE/BZIP2, single-volume/ZIP64 facilities; they do not assert an
Info-ZIP build, ambient environment, encryption or unrestricted large files.
`-L` prints the repository's MIT license and distinguishes it from the native
Info-ZIP license. `-so` lists only supported declarative long-option mappings,
with actual arity and negation, rather than a native build's feature table.
No capability or unsupported option is counted as implemented by printing it.

`-sf` traverses/filters via existing VFS selection and reads an existing input
archive when needed. It does not read source payloads, stdin member data,
symlink target payload, comments, or publish/delete/move/test output. `-@` still
reads bounded stdin filename lists. Unknown input-stream sizes display zero;
no host FIFO or TTY probing is performed. Existing bounded ZIP-name, metadata,
archive-reader, identity/alias and size restrictions remain. Listing totals
are uncompressed original/scanned sizes; copy/delete byte-progress counters
use stored sizes. Volume display is truthfully `1>1` in the single-volume
profile; split archives remain unsupported.

Dot **syntax and bounded byte-interval displays** are implemented, including
zero, units, quiet global output and order/negation. **Exact native dot counts,
codec-buffer phase and timed scanning dots are not qualified or claimed.**
For example, pinned native STORE with `-ddds32k` emits four buffer-driven dots
for 65,536 bytes; the bounded implementation emits two byte-interval dots.
Native DEFLATE and BZIP2 emit different counts on the same lengths, and native
global dots count write-buffer events rather than exact byte intervals.
Per-file progress remains staged until bounded preparation/publication; global
file dots precede atomic publication and streamed dots follow awaited output
writes. These differences are explicit in extended help. Dot native-parity
rows remain Restricted/Open; tests of the byte-interval profile are not passes
for those excluded native-buffer/timing requirements. Unsafe-integer multiplied
dot sizes (for example `9999999t`) refuse at 16; native large integer behavior
outside Number-safe budgets is not copied or certified.

Command/debug/diagnostic rendering escapes control characters and redacts
password-shaped short/grouped/literal arguments and their separated values,
credential assignments, and URL userinfo/query/fragment. Debug step messages
contain no user paths or ambient information. Provider errors and ordinary
progress/warnings also apply redaction; actual argv, VFS names and ZIP member
bytes are not rewritten. Malformed URL-shaped diagnostics are redacted as a
whole. Native's password echo in `-sc` is intentionally not reproduced;
encryption/password operations and logging remain unsupported. Arbitrary
secret bytes in unannotated ordinary text cannot be inferred; archive comments
are user-requested comment output, not a claim of secret-content detection.

### Acceptance controls and manual QA plan

| Feature | Positive / negative / boundary / cancellation / neighbor controls |
| --- | --- |
| Information/license | Denied FS and stdin; truthful output/status/streams; bad prior and ignored later args; abbreviations, negation/value refusal, grouped/lone/long -v, ZIPOPT; abort first output write and fresh create; full ZIP neighbors. |
| Command/options/debug | Processed list order/attached values; later unknown rejection; table only implemented options; escaped names and separate/grouped credentials; abort output and source pulls with exact reason; debug filesystem diagnostics and binary create/cross-read controls. |
| Show-files | Names/totals and archive-only/delete/copy/filter/filesync modes; missing archive and selector errors; quiet/negative/literal/output-parent/comments/move/test controls; abort output with fresh invocation; archive/source/namespace preservation and denied payload writes. |
| Counters | Selected counts/scanned sizes, archive ordering, copy/delete stored sizes and LF-conversion original sizes; invalid values and negation; two entries and filtering; abort output/input; original binary extraction and neighboring operations. |
| Byte-interval dots (restricted native parity) | Independent STORE boundary lengths 32 KB ±1 and 64 KB, serialized global sizes, exact byte extraction; invalid/unsafe sizes; zero/default/units/grouping/ZIPOPT/order/quiet; abort output/input; streaming binary stdout untouched. Native buffer/timed dots remain excluded above. |

Execute visible QA through the existing renderers; these are manual steps,
not a checked-in QA script or screenshot test:

1. Run `npm run screenshot-poe-code -- -o TASK_SCRATCH/poe-help.png --help`.
   Inspect actual poe-code help for available surface commands and readable
   layout. Do not invent a host ZIP subcommand; this command proves host CLI
   inventory only, not virtual ZIP execution.
2. Run `npm run screenshot-poe-code -- --no-header -o
   TASK_SCRATCH/zip-displays.png bash --root TASK_SCRATCH/visible --cwd / -c
   SOURCE`. The inline shell source creates its fixtures via virtual printf,
   then executes `zip --version`, `zip -dcdbdudv - binary > out.zip`, `zip -sf
   out.zip`, `zip -sc out.zip binary`, a debug password-option refusal, quiet
   global STORE dots via `zip -0qdgds32k - large > dots.zip` and `unzip -p out.zip binary | xxd -p`. Print section
   markers/statuses to make each result identifiable. The explicitly scoped
   real VFS adapter is a manual visible-path fixture, not a host-command fallback
   or a disk-writing unit fixture.
3. Visually inspect complete information text, counter alignment, listing
   totals, command status 9, diagnostic redaction, quiet dots and the extracted
   hex bytes `00ff800d0a41`. Separately use public Shell/SDK command factories
   with the memory fixture to assert byte equality and dispose Shell in finally.
   No renderer screenshot alone proves binary equality or CLI/SDK parity.
4. Record final source/test hashes, command results and screenshot hashes below,
   then purge exclusively task-owned scratch. Absolute `/out` is currently
   read-only (mkdir returned errno 30), so ignored `out/zip-cli-options/` is the
   task-owned fallback, consistent with the earlier recorded environment.

### Final revision-bound proof and executed visual QA

Final product/test inputs (working tree on the base above):

| Input under `packages/safe-bash/` | SHA-256 |
| --- | --- |
| `src/commands/archive/zip.ts` | `0c35df0ee26acb855c6c5fee7a7dda4a5f43601970b9ca44623cdf8c5d759f8a` |
| `src/commands/archive/zip/options.ts` | `e5fd3fbca0a588f470211f0c4ef763907c9f4b02fb3b85dc2ac6597cb6f8a32b` |
| `src/commands/archive/zip/help.ts` | `52e3faf8b632c7c0e0b3dd00e7793ddd35ee93454a7834a44ab226485b45a25e` |
| `tests/commands/zip-help.test.ts` | `5a5666e0227bcf28aeef02711e217b6f42dcfcf83f78879fcf7e2556ca198fbc` |
| `tests/commands/zip-standard-flags.test.ts` | `74abcd7d0361d26214fdefd55e4e1dab666cc756392c679aa2735b510e4bc448` |

All new unit fixtures remain memory-backed and perform no host file writes.
Owned-byte argv are positively accepted for `-v`; non-UTF8 byte filenames
refuse at 2 before any filesystem access for all inspected information/display
paths, preserving the existing UTF-8 pathname restriction even before help.
These negative controls are not claims of native arbitrary-byte filename parity.

Executed uncached final checks on Node v22.22.2 / Darwin 24.6.0 arm64:

| Command / profile | Final observed result |
| --- | --- |
| `node --import tsx --test packages/safe-bash/tests/commands/zip-help.test.ts` | **112/112**, zero failures/cancellations/skips/TODOs; 760.474292 ms. |
| Earlier exact ZIP-wide command, `TZ=UTC LC_ALL=C` | **961/961**, zero failures/cancellations/skips/TODOs; 17,835.759333 ms. |
| Same ZIP-wide command, `TZ=America/Chicago LC_ALL=en_US.UTF-8` | **961/961**, zero failures/cancellations/skips/TODOs; 17,865.739 ms. |
| `npm run test:runner --workspace=virtual-bash` | **522/522**, zero failures/cancellations/skips/TODOs; 34,447.411583 ms; current exact discovery assertions retained. |
| `npm run build:workspaces -- --workspace=virtual-bash` | **0**, final selected declared workspace closure: six observed builds, guarded source capture/compile and compression asset stages. |
| `npm run typecheck --workspace=virtual-bash` | **0**, source/tests and 26 current consumer groups, with maintained negative validators; zero runtime executions reported by typecheck. |
| `npm run lint:eslint` | **0**, complete guarded traversal, 15,493 configured/linted subjects, zero errors and two unchanged docx warnings; no rules/exclusions altered. |
| Inline public `runBash` SDK execution with injected memory FS | Create/counter, archive listing, command status 9, version, and extraction all passed; extracted bytes exactly `00ff800d0a41`; runBash disposes each owned Shell. |
| Independent final normal-import leak probes | Seven validated credential controls passed without a resolver; debug ordinary creation/extraction also preserved all six source bytes and readable progress. |

The two final ZIP profiles ran beside compile-only typechecking after all build
mutations finished. Durations therefore include cohost load and are not
comparative performance claims. These are scoped ZIP regressions plus maintained
build/type/lint/discovery checks, not a full repository `npm test`, all exported
runtime consumer gate, native upstream suite or successful release.

Visual QA completed through **actual `screenshot-poe-code` paths**, not just an
SDK render. Inspected all three generated PNGs before purge:

| Image | Inspection / restriction | SHA-256 |
| --- | --- | --- |
| `poe-help.png` | Host help is readable and exposes `bash` with an explicitly scoped FS. This supersedes the earlier follow-up's claim that only an SDK rendering path was available. | `e559722fdece2bfda8e61837b7e7e56945f49530eede55714b1b0cc29dab11d4` |
| `zip-displays.png` | Version, command status 9 and redacted password refusal 16 are readable. Direct file publication failed with the **existing** real-adapter lack of atomic owned staging; subsequent archive-only listing correctly failed at 18. Global dots preceded that refusal. This is a negative capability control, not a passing archive create/extract. | `495658e91f8159e22394d4a5c43e0e1ab7237a3994309e8ebc18acbd2728723d` |
| `zip-stream-displays.png` | Positive native stdout workflow uses `zip -dcdbdudv - binary > out.zip` and `zip -0qdgds32k - large > dots.zip`. Counters align, archive listing shows one six-byte binary member, command returns 9, unsupported password returns 16 with redaction, two quiet byte-interval dots appear, and extraction displays exact `00ff800d0a41` via virtual xxd. | `709e850fb1301dc1ea750e7cc8ba60808cfcd689e26e4a8dd44d016b2d978541` |

No stronger real-filesystem publication capability, native host zip fallback,
root integration fix, or source-byte rewrite was added to make a screenshot
pass. The stdout archive and shell redirection are explicit existing public
features; they do not promote that real adapter to atomic ZIP publication.
The successful initial host-help and direct visible screenshot preparations
rebuilt the existing broad predev closure uncached. The unchanged positive
stream screenshot reused its existing Turbo cache; it is a visual workflow
check, **excluded as an uncached build gate**. The final selected workspace build
above ran separately and uncached.

Preliminary verification failures remain disclosed: running a selected build
beside screenshot predev briefly caused dependent declarations to disappear;
a later predev compile capture correctly refused a source-size change while
edits were still in flight. A ZIP run overlapping that build had two import
failures for unavailable SafeFS bundle outputs. These runs were discarded as
qualification and rerun after stable source/build inputs. The initial lint
reported eight repeated-space-regex style errors in new tests; these were
corrected explicitly (no --fix, no test weakening), and final lint passes.
The first typecheck included the nonexistent `exists` fixture call described
above; final typecheck was rerun after its correction and final rebuild.

Final acceptance remains **the implemented bounded CLI profile**. Exact native
buffer/timed-dot parity, arbitrary-byte names, native build identity, full large
integer/native/platform profiles, logging/encryption/splits, and the historical
remaining-format restrictions above remain excluded/open; this work does not
close those matrix rows as native-parity completion. Task-owned scratch was
purged after checks and hash/visual recording. Delivery: **no local commit; no
push requested/performed; no verified remote-main delivery or release claimed**.

### Current-main revalidation: password abbreviation display boundaries

Revalidated on 2026-09-16, `main` at
`ac9156bba02cd71780599094cf172bd726c7221f`, with the existing uncommitted ZIP
implementation and evidence preserved. The initial focused suite passed
112/112 (638.253375 ms); the requested information, listing, counter and dot
grammar was already present in those working-tree inputs. This follow-up does
not attribute those existing edits to this execution or replace earlier proof.

A new memory-backed failing test reproduced disclosure of `private` in
`zip -qsc out.zip -- --pas private binary`: native password abbreviations were
not recognized by display redaction. An attached short password value ending
in `P` also incorrectly suppressed the following unrelated path. Shared
password-argument classification now recognizes `--pas` through `--password`,
attached `=` values, and the first grouped short `P` value boundary. It serves
both public argument text and show-command's next-value redaction, without
changing parsing, argv, VFS paths, ZIP names, codecs, budgets or cleanup.

The retained test covers all seven inspected long/short spellings, separated
values, attached values, empty attached values, quiet show-command, literal
terminators, visible neighboring paths and unchanged namespace. Empty literal
paths retain the existing refusal at 2; password options outside `--` remain
unsupported at 16. Cancellation on display output rejects with the exact
reason, preserves namespace and permits a subsequent successful archive create.
The first post-fix test included an empty literal pathname and incorrectly
expected 9; that fixture was corrected to assert the existing status 2 and
exercise empty attached values separately. No pathname restriction was relaxed.

Additional oracle checks used Apple `/usr/bin/zip`, SHA-256
`493a7f270b2cb3ea4f5cf153f735939bdce8b1bad48dce56d6ba89b495064271`,
Zip 3.0 with Apple modifications on Darwin arm64. Native `-sc` prints literal
abbreviated/separated and grouped/attached password-shaped arguments on stdout
and exits 9; its encryption option is supported, unlike the virtual profile.
The probes used stdin EOF, a three-second timeout and only
`PATH=/usr/bin:/bin LC_ALL=C TZ=UTC`; repeated controls ran inside task-owned
empty oracle scratch. These corroborate argument boundaries and deliberate
redaction, not pinned-oracle/platform/encryption parity. Earlier native-build
qualification and exclusions remain unchanged; no oracle enters runtime.

Revision-specific SHA-256 inputs, relative to `packages/safe-bash/`:

| Input | SHA-256 |
| --- | --- |
| `src/commands/archive/zip.ts` | `f05c61b2bbbd6b3c02fa1a727ffb20e111b232909780d6992a5d70c873e0b949` |
| `src/commands/archive/zip/options.ts` | `54e285a37d66549e93b80b3a8b26a96dcbeaa09b4e6f1b809cda03294bbd47b4` |
| `src/commands/archive/zip/help.ts` | `52e3faf8b632c7c0e0b3dd00e7793ddd35ee93454a7834a44ab226485b45a25e` |
| `tests/commands/zip-help.test.ts` | `44fa1e0ff9dc64d6fc6f145542220fa17c1a4b378da5bfcbb392dfdda901ac14` |
| `tests/commands/zip-standard-flags.test.ts` | `74abcd7d0361d26214fdefd55e4e1dab666cc756392c679aa2735b510e4bc448` |

Executed checks on Node v22.22.2 / Darwin arm64:

- Focused `zip-help.test.ts`: **113/113**, no failures/skips/TODOs,
  692.72375 ms. The new focused test failed before the product fix.
- Exact ZIP-wide command printed earlier, `TZ=UTC LC_ALL=C`: **962/962**,
  no failures/skips/TODOs, 15,752.75525 ms, after dependency build completion.
  An earlier overlapping run failed on missing generated SafeJS/SafeFS imports
  during screenshot predev rebuild; it is excluded from qualification. Source
  changes to those packages were neither needed nor made.
- `npm run typecheck --workspace=virtual-bash`: **0**; 26 consumer groups and
  maintained negative validators; compile-only, not runtime acceptance.
- `npm run build:workspaces -- --workspace=virtual-bash`: **0**, six declared
  workspace builds executed uncached through the maintained dependency closure.
- Public `runBash` with injected memory FS: show-command status 9, abbreviated
  and grouped credential redaction, visible neighboring paths, archive creation
  with counters, six-byte listing and extraction `00ff800d0a41` all passed.
  This uses normal public imports and existing SDK-owned Shell disposal.

Manual QA executed via `npm run screenshot-poe-code -- --no-header -o IMAGE
bash --root out/zip-cli-revalidation/visible --cwd / -c SOURCE`:

1. Inspected `displays.png`; its full options table clipped earlier sections
   from the viewport. It is excluded as proof of those invisible sections.
2. Captured and inspected `command.png`: complete truthful version text,
   `zip -qsc archive -- --pass private -qPprivateP binary --paths visible`,
   redacted credentials, preserved neighboring names, status 9, debug refusal
   16 and the first 17 lines of the supported option table. SHA-256:
   `d168b9ca2e5165b684e51218927662493334357fdce7974e91420291f49bfb03`.
3. Captured and inspected `counters.png`: virtual printf creates the six-byte
   binary fixture; `zip -dcdbdudv - binary > archive.zip` succeeds with aligned
   counts/bytes/usize/single-volume display; listing and hex extraction preserve
   all bytes. Virtual `printf '%65536s' x` creates the dot fixture;
   `zip -0qdgds32k - large > dots.zip` shows two quiet byte-interval dots at 0.
   Quiet and negated listing show totals only. SHA-256:
   `f25f7c186ae4d42eaeac38d1e3476fb7d21b61bf3128376963d30d34bc320786`.

The initial screenshot predev closure ran uncached (75 observed build tasks,
all successful) and bundled the actual host CLI. Later unchanged screenshots
reused its cache and are visual checks, not uncached build gates. The explicit
real VFS root is only a manual fixture; positive archives use existing stdout
streaming and shell redirection, without claiming atomic real-FS ZIP publishing.
Absolute `/out` remains read-only; this execution uses ignored task-owned
`out/zip-cli-revalidation/` as the previously documented fallback.

Exact native codec-buffer/timed dots remain **Restricted/Open**, not complete
native parity. Native identity, unsupported encryption/logging/splits and all
earlier format/name/budget/platform exclusions remain in force. No README,
runtime dependencies, root APIs or SafeJS source files were edited. This
follow-up has no local commit, requested push, remote-main delivery or release.

### Final quiet-dot budget control

A final audit reproduced a second missing quiet-mode behavior with a fast
failing memory-backed test: `zip -0qddds32k quiet.zip large`, with 65,536 STORE
bytes and `maxTextBytes: 1`, returned 2 despite having no visible output.
Suppressed per-entry progress still calculated and admitted its dots. The
progress append now exits before rendering when quiet; global dots remain
visible and continue using the existing text budget. An isolated Apple native
control with the same source length and switches returned 0 with zero stdout
and stderr bytes. Native oracle fixture files are separate from unit fixtures.

The retained test positively verifies quiet creation, zero display bytes and
all 65,536 stored bytes; nonquiet per-entry and quiet global displays refuse at
2 under the one-byte text budget and leave no output archive. It also aborts a
quiet streaming source with exact-reason rejection and runs a successful fresh
binary creation. No text budget or publication contract was loosened.

Final product/test SHA-256 changes relative to the immediately preceding table:

| Input under `packages/safe-bash/` | SHA-256 |
| --- | --- |
| `src/commands/archive/zip.ts` | `2bafa3c1235b7d15c631db7be5ab7f758d4a11fb9b1ef5f757a1416ff8f88ef8` |
| `tests/commands/zip-help.test.ts` | `df278de9c45f183742c5938380d3207a67f2d51fc318fb3a1f547bade71ea53d` |

Options/help/neighbor-test hashes remain as in the preceding table. The
preceding 113/962-test results describe the earlier redaction revision, not
this final quiet-dot revision. Final focused result: **114/114**, no
failures/cancellations/skips/TODOs, 1117.892958 ms (alongside build/lint load).
The selected maintained workspace build was rerun after the quiet change:
**0**, six uncached declared dependency-closure builds.

Final ZIP-wide command (`TZ=UTC LC_ALL=C`, exact command above): **963/963**,
no failures/cancellations/skips/TODOs, 17,542.006833 ms, after all screenshot
dependency builds settled. Final public `runBash` memory SDK controls also
passed quiet per-entry output suppression and abbreviated/grouped credential
redaction with preserved neighboring names.

Executed and inspected a fourth short screenshot through the same actual
`screenshot-poe-code` bash path: `quiet-final.png`, SHA-256
`fe0ee56778073db136e15b1e56ead876481d18830cce0d138290481af2d8fba6`.
Virtual printf produces 65,536 bytes; quiet per-entry dots emit nothing and
return 0, quiet global dots visibly emit two byte-interval dots and return 0,
quiet listing reports the correct total, and show-command remains redacted at
9 with both neighboring names visible. This final screenshot predev closure
also rebuilt uncached (75 successful observed tasks) and bundled the CLI;
the separately selected maintained workspace build remains the scoped build
gate. Earlier dot parity restrictions remain unchanged.

Final `npm run typecheck --workspace=virtual-bash`: **0**, all 26 maintained
consumer groups and negative validators checked after final rebuild; no runtime
execution is claimed by this compile-only result.

Final `npm run lint:eslint`: **0**, complete guarded traversal of 15,493
configured subjects, zero errors and two existing warnings outside this change.
The initial lint also passed but was rerun to bind this result to the final
quiet-dot source/test revision. No lint rules or exclusions were changed.
Final `git diff --check`: **0**. Task-owned screenshot/oracle/log scratch was
purged after inspection and recording; unrelated edits remain preserved.
Delivery remains local working-tree changes only: no commit, push, verified
remote-main delivery or release was performed or claimed.

### Preserved-working-tree audit of the requested CLI profile

Reexecuted on 2026-09-16, main at
`ac9156bba02cd71780599094cf172bd726c7221f`, Node v22.22.2 / Darwin arm64.
The requested options, information exits, displays and their retained tests
were already present in the initial dirty working tree. No additional missing
behavior was reproduced in this audit; no product or test code was changed.
Earlier uncommitted edits and all earlier evidence are preserved. This section
records fresh execution, not authorship of that implementation or a new fix.

The four source/test SHA-256 values match the final quiet-dot revision above:
zip.ts `2bafa3c1235b7d15c631db7be5ab7f758d4a11fb9b1ef5f757a1416ff8f88ef8`,
options.ts `54e285a37d66549e93b80b3a8b26a96dcbeaa09b4e6f1b809cda03294bbd47b4`,
help.ts `52e3faf8b632c7c0e0b3dd00e7793ddd35ee93454a7834a44ab226485b45a25e`,
zip-help.test.ts `df278de9c45f183742c5938380d3207a67f2d51fc318fb3a1f547bade71ea53d`.

Fresh checks:

- `node --import tsx --test packages/safe-bash/tests/commands/zip-help.test.ts`:
  **114/114**, zero failures/cancellations/skips/TODOs, 670.659791 ms.
- The exact ZIP-wide command above with `TZ=UTC LC_ALL=C`: **963/963**,
  zero failures/cancellations/skips/TODOs, 13,380.587875 ms. Completed before
  screenshot preparation to avoid changing build outputs during tests.
- `git diff --check`: **0**. No new build/type/lint gate is claimed; the previous
  final revision's checks remain separately recorded above.

Manual QA executed and inspected, using the actual host CLI:

1. Created a task-owned, explicitly scoped real-VFS fixture root under ignored
   `out/zip-display-audit-20260916/visible`. Absolute `/out` creation failed with
   a read-only filesystem; the existing documented workspace fallback was used.
2. Ran `npm run screenshot-poe-code -- --no-header -o
   out/zip-display-audit-20260916/displays.png bash --root
   out/zip-display-audit-20260916/visible --cwd / -c SOURCE`, with these virtual
   shell steps: `zip --version`; `zip -qsc archive -- --pas private binary` and
   status; virtual printf of bytes `00ff800d0a41`; `zip -dcdbdudv - binary >
   archive.zip` and status; `zip -sf archive.zip`; `unzip -p archive.zip binary
   | xxd -p`; virtual printf of 65,536 STORE bytes; `zip -0qddds32k - large >
   quiet.zip` and status; `zip -0qdgds32k - large > dots.zip` and status.
3. Inspected the generated PNG. All output is visible and readable: truthful
   version text, both password-shaped arguments redacted with neighboring
   `binary` preserved, command status 9, aligned entry/byte/size/volume counters,
   creation status 0, one six-byte member, exact extraction hex, silent quiet
   per-entry dots at 0, and two visible quiet global dots at 0. SHA-256:
   `410ee280183164e3735870737418addbe15a53a64b520f75955c881872b306fe`.
4. Screenshot preparation succeeded with 75 cached build tasks and a fresh
   host bundle. This is visual QA, explicitly excluded as an uncached build
   gate. Purged only this audit's task-owned fixture and PNG after inspection.

The earlier positive, negative, boundary, cancellation and neighboring controls
remain in the executed suite. Native codec-buffer/timed dots, arbitrary-byte
filenames, native build identity, encryption/logging/splits and earlier format,
budget and platform exclusions remain Restricted/Open. No new native oracle
qualification, exhaustive compatibility completion or atomic real-FS archive
publication is claimed. Positive visual archives use existing stdout streaming
and shell redirection. No README, dependencies, root APIs or SafeJS edits.
Delivery: no local commit, push, remote-main verification or release performed.

### Independent user-path stress review: credential URLs without authority slashes

Executed on 2026-09-16, current `main`
`ac9156bba02cd71780599094cf172bd726c7221f`, Node v22.22.2 / Darwin arm64,
preserving all initial uncommitted ZIP work. A different agent performed the
package-required independent stress review. It reproduced a new disclosure in
memory: `zip -sc out.zip -- https:user:private-value@example.test/path` returned
9 and printed the password. Debug and listing warnings also disclosed it.
These are valid credential-bearing URLs according to the existing URL parser;
the display guard previously only recognized authority slashes and HTTP slash
markers. No native behavior is used as authority to permit credential disclosure.

A fast memory-backed test failed before the fix (HTTP with no authority
slashes, status 9). The existing public-text codec now admits HTTP, HTTPS, FTP,
WS and WSS scheme markers to URL sanitization, refusing noncanonical authority
forms as `[redacted URL]`. No pathname, argv, archive-name or payload mutation
was introduced. The retained test covers all five schemes with zero, one and
two slashes in command, debug and listing displays; malformed credential URLs;
visible neighboring `binary` and `notes:ordinary` paths; quiet show-command;
exact-reason cancellation; unchanged namespace; and successful subsequent
binary creation/extraction. No runtime dependency, host fallback, README,
SafeJS or root API change was made.

Revision-specific SHA-256 changes from the preserved audit above:

| Input under `packages/safe-bash/` | SHA-256 |
| --- | --- |
| `src/commands/archive/zip/options.ts` | `9dd6470f08d7527d8d596d922925525796426a6ec2692c96bf7035752b5abdaa` |
| `tests/commands/zip-help.test.ts` | `bfab555252dcc79efa1eec36ded3b8d60e288553bc7e67dd31be21ae472e0787` |

zip.ts and help.ts retain the preserved audit hashes. Fresh baseline ZIP-wide
execution passed **963/963**, 12,994.69975 ms. Post-fix focused execution passed
**115/115**, 661.219667 ms; that focused run preceded adding listing assertions
to the same test. Final exact ZIP-wide command printed above, `TZ=UTC LC_ALL=C`,
passed **964/964**, 15,600.761792 ms, with zero failures/cancellations/skips/TODOs,
including the final listing assertions. The maintained selected workspace build
completed uncached at 0 with six declared closure builds. Public `runBash`
normal-import memory SDK controls passed malformed display grammar, ZIPOPT
immediate version, redacted command paths, counters/listing, exact extracted
`00ff800d0a41`, and final command/debug/listing URL redaction. These are scoped
checks, not a full repository unit or consumer-runtime gate.

Manual QA steps executed through the actual visible host CLI:

1. Absolute `/out` refused creation as read-only; used the previously documented
   ignored fallback `out/zip-user-edge-20260916/visible` as explicit VFS root.
2. Ran `npm run screenshot-poe-code -- --no-header -o
   out/zip-user-edge-20260916/edges.png bash --root
   out/zip-user-edge-20260916/visible --cwd / -c SOURCE`. SOURCE exercised
   `--ver` ambiguity at 16, `--verbose=` at 16, ZIPOPT quiet plus immediate
   `--versi` at 0, abbreviated-password literal redaction at 9, six-byte stdout
   archive creation with counters, quiet listing, exact binary hex extraction,
   silent quiet entry dots and visible quiet global dots at 0.
3. Inspected the complete PNG: all those outputs were visible and readable,
   counters aligned and no credentials printed. SHA-256:
   `80bb73155ba11165763413e3e6c9216f62cc3fdb31c07778d49e2e5d6982e9d4`.
   This initial screenshot preceded the new URL fix; its 75 cached preparation
   builds and fresh host bundle are visual QA, not an uncached build gate.
4. After the fix, captured and inspected `redaction.png` through the same
   screenshot command/root with SOURCE running zero-slash HTTPS show-command,
   zero-slash HTTPS debug warning, one-slash FTP listing warning, quiet archive
   listing and hex extraction. All outputs are visible: `[redacted URL]` in
   each display, neighboring paths preserved, statuses 9/12/0, correct six-byte
   total and exact extraction. SHA-256:
   `6ff72eb18ad2c250b5ce6375e982f3b8c75973d93d4fa757975107daa1c97612`.
   Final screenshot preparation ran 75 successful uncached existing build tasks
   plus the host bundle. The selected six-build workspace route above remains
   the focused maintained build gate; no competing build ran during ZIP tests.

Final `npm run typecheck --workspace=virtual-bash`: **0**, all 26 maintained
consumer groups and required negative validators; compile-only, no runtime
acceptance implied. Final screenshot/typecheck/lint execution shared cohost load;
test/build durations are not comparative performance claims.
The initial lint run returned 2 with zero code errors and two existing docx
warnings; it is **not a passing gate**. Its guarded traversal reported SafeJS
ancestor-directory identity drift (size 544 to 576) during screenshot rebuild
preparation. No SafeJS source changes or lint exclusions were made. Lint was
rerun after all build tasks finished to obtain stable filesystem inputs.
Final stable `npm run lint:eslint`: **0**, complete traversal of 15,493
configured/linted subjects, zero errors, two existing docx warnings, zero gaps.
No lint policies/exclusions were changed. Final `git diff --check`: **0**.
Purged only this execution's task-owned screenshots, fixture root and logs
after visual inspection and recording. All initial unrelated edits remain
preserved; no local commit, push or release was performed.

Native buffer/timed-dot parity, native build identity, arbitrary-byte filenames,
encryption/logging/splits and earlier format/budget/platform restrictions remain
open. Positive visible archives use existing stdout streaming and shell
redirection, without claiming atomic real-adapter archive publication. No local
commit, push, verified remote-main delivery or release is claimed.

## Commit validation — 2026-09-16

Fresh validation of the seven-file ZIP CLI parity change before its atomic
local commit on main:

- `TZ=UTC LC_ALL=C node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/zip*.test.ts packages/safe-bash/tests/commands/unzip.test.ts packages/safe-bash/tests/plugins/zip*.test.ts`: 964 passed, zero failures/cancellations/skips/TODOs.
- `npm run build:workspaces -- --workspace=virtual-bash`: exit 0, six uncached declared closure builds.
- `npm run typecheck --workspace=virtual-bash`: exit 0, all 26 maintained consumer groups and required negative validators.
- `npm run lint:eslint`: exit 0, complete traversal of 15,493 configured subjects, zero errors, two existing docx warnings, zero gaps.
- `git diff --check`: exit 0.

The prior recorded screenshot QA covers the unchanged product source. No new
product code was changed during commit validation. Absolute `/out` remained
read-only; task-owned logs used ignored `out/zip-commit-check` and were purged
after inspection. These are focused ZIP checks, not a full repository unit run.
The requested delivery is a local commit; no push or release is claimed.

## Later from-CRLF reads — 2026-09-16, current-main working tree

This execution started on main at `15ef5e17045a59b924a7a90a7001b0cbb6232241`
with six existing modified paths: this evidence document, its associated plan,
zip.ts, zip/options.ts, zip/line-endings.ts and zip-line-endings.test.ts.
Those edits were preserved. The earlier clean-baseline qualification above is
historical; it does not describe this execution's dirty starting tree.
Read root and package AGENTS.md. No staging, commit, push or release is included.

Revalidated the actual remaining gap: the starting partial implementation's
90 focused tests passed, but text DEFLATE beyond its first 65,535-byte read
was explicitly refused. Updated the refusal expectations to verified positive
conversion/extraction controls before product edits. The seven-test reproduction
had four passes and three failures: the 65,536-byte text input and binary bytes
at/after the first detection window returned 2 with the native-window-limit
diagnostic. A separate fast help test also failed before adding the -ll line.
The existing -ll parser and --from-crlf/--from-c normalization remain intact.

The package-local read model uses owned collected bytes and the existing codec
for encoding. It models the Unix internal DEFLATE compressor's 32 KiB sliding
window, 262-byte minimum lookahead, hash chains, fast/lazy match advancement and
level-specific search profiles solely to determine native file_read capacity.
Absolute dictionary positions avoid window copying. Transport chunk boundaries
never substitute for compressor reads. Yield checkpoints cover detection,
refills and match work; no invocation-owned host resource or fallback was added.
Existing original-entry/total-byte admission remains before shrinking; converted
bytes determine ZIP CRC and uncompressed size in local/central/descriptor/ZIP64
records, while original source size remains the progress/statistics input.
Suffix/compression selection remains before conversion; links and directories
remain excluded. Binary input returns the original owned payload.

Native semantics are deliberately retained: the reserved LF sentinel can drop
a bare CR at a read boundary; one trailing Ctrl-Z is suppressed per read, and
an emptied read consumes one more byte or retains CR at EOF. A zero-length
Ctrl-Z read means EOF. First-read binary classification controls conversion;
later binary can produce the native corruption warning. STORE stays quiet on
binary; quiet mode suppresses conversion warnings. -l/-ll still use the last
parsed option, including the grouped -lll control.

Oracle binding: Darwin arm64, Node v22.22.2, Apple-modified Info-ZIP 3.0,
/usr/bin/zip SHA-256
`493a7f270b2cb3ea4f5cf153f735939bdce8b1bad48dce56d6ba89b495064271`.
Processes were isolated ad hoc oracles only, in task-owned ignored
out/zip-ll-followup with PATH=/usr/bin:/bin, LC_ALL=C and TZ=UTC. Native archive
payload/CRC/size/method observations used independent Python zipfile extraction.
The same bounded, regular-text-admitted LuaDist revision and source hashes
recorded above were rechecked, not included in product code or canonical tests.

All **780/780** native observations matched conversion bytes by SHA-256:
360 boundary observations at 16,383/65,535/98,303/131,071 +/-1, three markers
(CR-X-CRLF-Ctrl-Z, Ctrl-Z-X-CRLF, binary-CRLF), levels 0 through 9;
420 pattern observations across random printable, mixed, dense CRLF/repeated CR,
lazy-match text, sentinel and repeated Ctrl-Z inputs, seven lengths from
65,534 through 140,000, and levels 0 through 9. Native capture hashes:
`7bcf24eda0190201989414bfe86a2a53119218bc0834f4be4d13d97293704666`
(boundaries),
`5291af5a703499c1de725826c08c2aa455ff0975b4f51104fd1bd385fcbfb0ea`
(patterns). These captures are observations, not timing/performance claims.
Dense text at 140,000 bytes exposes a neighboring control: levels 4/5/8/9
produce 100,001 bytes, levels 1/2/3/6/7 produce 100,002. This prevents treating
all levels as the level-6 read schedule.

The retained independent fixture contains **360 native observations**:
180 boundary records (STORE and levels 1/3/6/9) and 180 pattern records
(three lengths, six patterns, all ten levels). Tests synthesize inputs in memory;
no subprocess oracle or filesystem writes enter canonical unit tests. All records
check converted size and native SHA-256. STORE and level-6 records additionally
create/extract archives and compare native method/CRC/size; the dense 140,000-byte
control verifies actual command creation/extraction for every profile. Further
tests cover reused stdin buffers at 511/512, 16,383, 32,768 and 65,535 +/-1,
final partial chunks, CR/LF across transport boundaries, descriptors and ZIP64,
original byte-budget rejection/exact admission, early/late binary warnings,
quiet output, binary producer reuse, pre-aborted empty/binary/text inputs,
cancellation in later DEFLATE work at levels 1/6/9, and actual Shell cancellation
with source closure, unchanged existing archive/namespace and subsequent exec.
Existing short/empty/pure-control/mixed-ending, suffix, symlink, archive-neighbor
and -l regression tests remain enabled.

Candidate SHA-256 (paths relative to packages/safe-bash):

| Input | SHA-256 |
| --- | --- |
| src/commands/archive/zip.ts | 4fc90790cef7572f56cf9bbd4827b74ef7ed7921a1174624cb97bbb22cb52871 |
| src/commands/archive/zip/options.ts | fdd689150d4e5b9fc4f84ae2a3a7eac924a2cf11dd6a1bb002d82d5c3a41ac33 |
| src/commands/archive/zip/line-endings.ts | 179060f7e18eec0134a4cd42c142a766d1a80bb415f0baba3600e1f6af194d8f |
| src/commands/archive/zip/help.ts | 2444f68722d878ed7339823a5d56accd9e65880734ebd9528d6e2c46f81d766d |
| tests/commands/zip-line-endings.test.ts | e773ab96579b21d8df06ca223ddc41d730d6a3f1f6bf8552132136e62794f138 |
| tests/commands/fixtures/zip-from-crlf-infozip.json | f7df2e645479bcd852e3e55be831f0237405d053aba7e477223649287fbc275b |

Exclusions remain explicit: BZIP2 conversion still refuses its unqualified native
read profile unless suffix selection chooses STORE; alternate Info-ZIP builds
(including zlib-backed compressors), non-Unix platforms and native device/short
read schedules are not qualified. Existing package buffering, configured limits,
archive-format and atomic-real-adapter restrictions remain. The prior first-window
DEFLATE restriction is removed for the qualified internal-compressor profile;
this does not certify all Info-ZIP features or a full repository release gate.
No new dependency, README, SafeJS source, root API, CLI/SDK split or host-process
fallback was introduced. Absolute /out again refused creation as read-only;
the existing ignored workspace fallback contains only this execution's scratch.

Final verification of the candidate hashes above:

- `TZ=UTC LC_ALL=C node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/zip*.test.ts packages/safe-bash/tests/commands/unzip.test.ts packages/safe-bash/tests/plugins/zip*.test.ts`: **1,421/1,421 passed**, zero failures/cancellations/skips/TODOs, 31,240.356875 ms. This includes 490 line-ending tests. An earlier ZIP-wide run passed 1,331 before adding the remaining profile controls; it is not the final denominator.
- `npm run build:workspaces -- --workspace=virtual-bash`: exit **0**, six uncached builds from maintained declarations.
- `npm run typecheck --workspace=virtual-bash`: exit **0**, source/tests, all 26 maintained current consumer groups and required negative validators. Compile-only, not runtime acceptance.
- `npm run lint:eslint`: exit **0**, complete traversal of **15,493/15,493** configured/linted subjects, zero errors, two existing docx warnings, zero gaps. No lint policy or exclusion changes.
- Normal-import `runBash` from `poe-code` and memory filesystem from `poe-code/safe-bash`: both flag spellings with STORE and DEFLATE extracted `610a620d630a`; later-window SDK extraction returned 65,539 bytes. All five SDK controls passed through the existing public SDK.
- Additional isolated native late-binary probe: 65,535 A bytes plus `00ff0d0a1a` yielded 65,538 bytes, suffix `414100ff0a`, exact `-ll used on binary file - corrupted?` warning at status 0; `-qll6` yielded identical bytes and empty stdout. Retained command tests independently check that warning, quiet suppression and producer-reuse ownership.
- Final source/fixture SHA-256 verification and `git diff --check`: **0**. No source changed after these build/typecheck/visual checks; the last document update records outcomes only.

Manual visible CLI QA executed and the full PNG inspected:

1. Ran `npm run screenshot-poe-code -- --no-header -o out/zip-ll-followup/cli.png bash --root out/zip-ll-followup/visible --cwd / -c SOURCE`. SOURCE displayed the new help line; created mixed CRLF/bare CR/LF/final Ctrl-Z text with virtual printf; wrote stdout archives using -ll0 and --from-crlf; extracted both through unzip/xxd. Both visible outputs were exactly `610a620d630a`.
2. SOURCE then created 65,536 padded text bytes plus CR-X-CRLF-Ctrl-Z, compressed/extracted beyond the former DEFLATE limit, and displayed size **65,539** plus suffix `20202020410d580a`. Binary creation visibly warned that -ll was ignored and extraction preserved `00ff0d0a`. A final -l then -ll archive extracted the same six converted text bytes. All output was readable, with the expected progress/warning layout.
3. Screenshot preparation completed 75 successful uncached existing workspace builds plus the host bundle, exit 0. This is visible-host preparation; the selected six-build route above remains the focused maintained build gate. PNG SHA-256: `237615ea39bdc5a83419f667091e9b4dfd20787becf1d9a564b787147d3c8c4a`.

Typecheck overlapped screenshot preparation, and the final tests overlapped lint;
both completed successfully. Cohost load and differing test denominators make
durations unsuitable for performance comparisons. These are focused ZIP checks,
not a full repository unit run or release gate. Task-owned temporary source
downloads, observations, fixture root, PNG and logs were purged after inspection
and proof recording. The independent canonical JSON fixture remains maintained
test data. Original unrelated edits remain preserved; no local commit, verified
remote-main delivery or successful release is claimed.

### September 16, 2026 current-tree revalidation

Revalidated on `main` at HEAD
`15ef5e17045a59b924a7a90a7001b0cbb6232241`, including the pre-existing
uncommitted candidate. The five source/test/fixture hashes rechecked in this
execution match the candidate table above exactly. The requested conversion
gap is already addressed in this working tree; no remaining defect was
validated, so no new failing test, source change or speculative simplification
was introduced. Existing edits were preserved.

- Fresh line-ending run: **490/490 passed**, zero failures, cancellations,
  skips or TODOs, 3,750.387583 ms, using the line-ending test file with
  `TZ=UTC LC_ALL=C node --import tsx --test --test-concurrency=1`.
- Fresh neighboring run of `zip*.test.ts`, `unzip.test.ts` and plugin
  `zip*.test.ts` with the same runner/environment: exit **0**. Output was
  discarded; no new per-test count or duration is asserted for that run.
- Fresh isolated regular-file native comparison: **360/360** retained fixture
  records matched extracted bytes by SHA-256, uncompressed size, CRC and
  compression method. Inputs were independently synthesized from the fixture
  specifications and extracted with Python zipfile. `/usr/bin/zip` SHA-256
  remains `493a7f270b2cb3ea4f5cf153f735939bdce8b1bad48dce56d6ba89b495064271`.
  Oracle environment was `PATH=/usr/bin:/bin LC_ALL=C TZ=UTC`.
- An attempted native STORE pipe probe returned status **16** with
  `zip -0 not supported for I/O on pipes or devices`; its partial archive is
  not accepted evidence. Regular-file checks above qualify the conversion
  profile, not native pipe/device parity. Product unit stdin ownership controls
  remain enabled and passed.
- `/out` creation again failed with a read-only-filesystem error. The isolated
  oracle used a unique `out/zip-ll-revalidation-*` directory and removed it in
  `finally`; no generated native files or temporary logs remain.
- `git diff --check`: exit **0** before this documentation-only addition.

The previously recorded build, typecheck, lint, public SDK and screenshot proof
remains bound to the unchanged candidate hashes; those checks were not rerun in
this execution. BZIP2, alternate compressors/platforms, native short-read/device
schedules and full-repository/release exclusions above remain in force. No
README, SafeJS, runtime dependency, host fallback, local commit, push or release
was introduced or claimed by this revalidation.

### September 16, 2026 additional user edge-case review

Reviewed the same dirty candidate on main at
`15ef5e17045a59b924a7a90a7001b0cbb6232241`. Rechecked zip.ts,
zip/options.ts, zip/line-endings.ts and zip-line-endings.test.ts SHA-256;
all match the candidate table above. No new defect was reproduced, so product
code and existing tests were preserved without speculative fixes.

- Fresh line-ending suite: **490/490 passed**, no failures, cancellations,
  skips or TODOs; 5,244.475208 ms.
- Fresh neighboring ZIP/unzip/plugin suite: **1,421/1,421 passed**, no failures,
  cancellations, skips or TODOs; 33,286.743667 ms. Both used the previously
  documented UTC/C-locale Node runner with test concurrency 1.
- Additional isolated regular-file Info-ZIP oracle: **1,410/1,410** extracted
  size/SHA-256 comparisons matched `zipFromCrlf`. Inputs comprised all 341
  sequences of length 0 through 4 over CR/LF/Ctrl-Z/A, 256 inputs consisting
  of A + each possible byte + CRLF + Ctrl-Z, and 36 longer inputs. The first
  597 inputs ran STORE and DEFLATE level 6; longer inputs ran levels
  0/1/3/4/6/9. Longer input lengths before the five-byte CR-CR-LF-Ctrl-Z-Ctrl-Z
  suffix were 16,382/16,383/16,384/65,534/65,535/65,536/98,000/140,000/250,000.
  Generation used Python Random seed 91626, alternating repeated
  `abcdefgh\r\nabc\rX\x1a` and random bytes from A/B/CR/LF/Ctrl-Z or printable
  ASCII plus CR/LF/Ctrl-Z. Native output was independently extracted with
  Python zipfile, then compared with the TypeScript converter.
- Native binding remains `/usr/bin/zip` SHA-256
  `493a7f270b2cb3ea4f5cf153f735939bdce8b1bad48dce56d6ba89b495064271`,
  with PATH=/usr/bin:/bin, LC_ALL=C and TZ=UTC. These additional observations
  compare conversion bytes, not compressed stream identity or warning text;
  maintained command tests supply extraction/CRC/format/warning, transport
  ownership, budgets, cancellation and neighboring regression controls.
- Absolute `/out` was read-only again. This review's unique ignored
  `out/zip-user-edge-*` native scratch was removed after comparison.

No source change required new build/typecheck/lint or visual CLI validation;
previous proof remains bound to unchanged candidate hashes. The existing
BZIP2, alternate build/platform, native pipe/device/short-read and full-gate
exclusions remain. This finite review does not claim every possible edge case.
No README, SafeJS, runtime dependency, host fallback, commit, push or release
was changed or claimed.


## From-CRLF commit validation — 2026-09-16

Fresh checks for the user-requested local commit of all eight changed files:

- `TZ=UTC LC_ALL=C TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/zip*.test.ts packages/safe-bash/tests/commands/unzip.test.ts packages/safe-bash/tests/plugins/zip*.test.ts`: **1,421 passed**, zero failures/cancellations/skips/TODOs; 36,970.2805 ms.
- `npm run build:workspaces -- --workspace=virtual-bash`: exit **0**, six uncached declared workspace closure builds.
- Stable `npm run typecheck --workspace=virtual-bash -- --report ../../out/zip-commit-type-report`: exit **0**, source/tests, all 26 maintained consumer groups and required exact negative checks. An earlier run during screenshot build preparation returned 2 despite successful logged compilations; it is not counted as a passing gate. No source change was needed for the stable rerun.
- `npm run lint:eslint`: exit **0**, 15,493 configured/linted subjects, zero errors, two warnings, complete traversal.
- `npm run screenshot-poe-code -- --no-header -o out/zip-commit-help.png bash -c 'zip -h'`: exit **0**. Inspected the PNG: readable aligned help includes `-ll` and `--from-crlf`. Screenshot preparation used cached workspace builds and a fresh host bundle; it is visual QA, not the uncached build gate above.
- `git diff --check`: exit **0** before committing.

Product source and tests were preserved during validation. These are focused
ZIP checks, not a full repository unit run. Task-owned ignored logs, report
and screenshot were purged after review. The plan's from-CRLF commit status
is included in the local atomic commit; no push, remote-main delivery or
release is requested or claimed.

## Incremental ZIP creation — September 16, 2026

Revalidated on current `main`, HEAD
`d5bc0802f1b79de7e723f256e593453344cba6aa`. The initial index and working
tree were clean. Applicable root and package AGENTS.md were read; no SafeJS,
README, dependency, root API or unrelated source was edited. This section
qualifies the working-tree candidate below, not historical ZIP proof or a release.

### Reproduction and implementation

Fast failing controls preceded implementation:

- `ZIP consumes a live source incrementally after emitting its header` failed
  with zero input pulls instead of one: the existing writer only used `data`.
- `ZIP stdout rejects its header before draining stdin` failed with one pull
  instead of zero: command preparation drained input before sink admission.
- `ZIP live sink rejection cancels a pending cooperative VFS read` failed its
  retirement assertion. DEFLATE had prefetched a read before publishing a partial
  output slab, and generator retirement could wait indefinitely for that read.
- Invalid expected-size/work-budget admission failed before its fix: NaN reached
  the source and was reported as a size change rather than rejected at admission.

Live entries now carry uncompressed ByteSource input, codec level and an optional
expected size. The writer preflights all metadata before its first yield, publishes
local headers before pulling sources, measures CRC/size incrementally, drives the
existing raw-DEFLATE/BZIP2 codecs and writes signed descriptors. Central records
retain metadata and measured compressed sizes, without retaining live payloads.
Buffered `readZipArchive`/`writeZipArchive` callers retain their convenience APIs;
buffered entries preserve compression, extras, comments, ordering and ZIP64 offsets.
Live entries are single-use and receive final measured metadata after consumption.

File creation stages an empty file through existing owned staging, then awaits
atomic conditional append operations using the returned identity after each write.
Publication uses the existing destination/parent comparison contract only after
source completion and progress-text admission. Cleanup preserves replaced staging
files. No unchecked path append, new runtime dependency or host fallback was added.
Reader retirement blocks later input acquisition, shares its completion/error
barrier, and closes cooperative pending VFS reads with a source-local signal.
Sink/dot failures initiate that retirement before returning the archive generator.

### Qualified profiles and limits

| Profile | Access and retention |
| --- | --- |
| New stdout archive, STORE/DEFLATE/BZIP2 | Incremental input and output; descriptors; codec workspace remains bounded by existing codec contracts. |
| New archive from stdin | Incremental input and staged file/stdout output; descriptors; compressed profiles commit to the selected codec. |
| New VFS archive, STORE/suffix STORE or forced descriptors | Incremental regular-file reads and conditional staged writes; expected length and post-read source identity are checked. |
| Ordinary VFS adaptive compression | Buffered: choosing STORE when compression expands requires complete size comparison before committing the local header. |
| Update/freshen/delete/copy, existing input, integrity testing, latest-time and interactive comments | Existing bounded buffered profile; no incremental source/archive-reader claim. |
| `-l`/`-ll` conversion | Existing buffered conversion/native-read-schedule profile; no streaming conversion claim. |
| VFS without streaming reads | Existing `maxBufferedFileBytes` fallback, with no host-process fallback. |
| VFS without atomic staging and conditional-write authority | Streaming file publication refuses before payload acquisition. The current real CLI adapter lacks staging; memory staging is qualified here. |

Unknown sizes/CRC require descriptors. Consequently classic stdin output with
`-fz-` now uses extraction version **20**, descriptor flag 8 and classic widths,
instead of the previous buffered version 10. Its existing regression test now
checks those requirements and still verifies extraction. This is an intentional
wire-header change, not a claim of byte-identical native archives. Known empty VFS
files retain STORE under forced descriptors; stdout retains its existing selected
compression profile. CLI and SDK use the same command; no new arguments were added.

Input chunks are admitted against entry/total/expected-size limits before CRC work
and owned copies. Whole serialized metadata, known payloads and descriptor/end
overhead are admitted before metadata retention; unknown compressed output is
admitted before publication. Members, paths, depth, extras, comments and work have
their existing limits. Output sinks retain existing awaited output-budget admission.
Classic aggregate/archive spans remain capped at `0xfffffffe` even with forced
ZIP64; this change does not add multi-gigabyte or seekable archive processing.
Buffered profiles remain limited by `maxEntryBytes`, `maxTotalBytes` and
`maxArchiveBytes`; they do not acquire constant-payload-memory behavior.

`onRetention` reports serialized local/central metadata bytes and conservative
owned-input-slab admission bytes. With chunkSize 512 the producer-reuse controls
retain at most **1,024 input-slab admission bytes** and **102 metadata bytes** for
the single `live` member, independently of tested payload length. Two slabs account
for the consumer's old reference while its replacement is admitted. These counters
exclude caller/provider slabs, codec/output workspace, JavaScript object overhead,
VFS storage and buffered convenience results. They are bounded logical-retention
evidence, **not process RSS, sandbox isolation or an aggregate host-memory quota**.
Headers and codec blocks may precede payload publication; no per-input-chunk flush
or immediate compressed-payload emission is promised, particularly for BZIP2.
Opaque/uncooperative sources cannot be forcibly stopped; cooperative settlement
and close are awaited. Already completed stdout writes cannot be undone.

### Controls and manual QA

Maintained memory-only controls cover STORE/DEFLATE/BZIP2 producer reuse at
0/1/511/512/513/65,535/65,536/65,537 bytes; descriptors; exact entry/total/archive
budget admission and one-byte rejection; work rejection; invalid expected sizes;
size mismatch; metadata preflight; classic/ZIP64 mixed buffered neighbors;
source failure; early sink rejection; gated EOF and actual slow-sink backpressure.
The gated DEFLATE source publishes payload before its 16 input slabs are drained
and stops pulling while the sink is held. Cancellation covers local header,
payload, descriptor, central and end records; staged acquisition/write/publication;
pending cooperative input; cleanup settlement and subsequent successful use.
Unacquired sources remain unpulled; ordinary iterator retirement does not execute
an unstarted async generator's finally. Conditional replacement and missing
publication authority are negative controls, not successful publication cases.
Existing update/copy, alias, conversion, text attributes, move, options, unzip and
plugin suites remain enabled; no new test file or registration exclusion was added.

Executed manual QA plan:

1. Run `npm run screenshot-poe-code` with explicit real VFS root and commands to
   create STORE, stream stdin through stdout ZIP, extract via unzip/xxd, and create
   forced-descriptor output. Inspect the full PNG.
2. Confirm readable progress and refusal diagnostics. Observed stdout extraction
   `73747265616d696e67` (`streaming`). STORE/descriptor file publication correctly
   refused unavailable atomic staging on this adapter; these are negative CLI
   observations, not real-adapter publication successes.
3. Through normal `poe-code` public `runBash` and `poe-code/safe-bash` memory FS
   imports, create/extract STORE files, classic streamed stdin and forced-descriptor
   files. All **3** controls passed with exact `hello`/`streaming` output.
4. Generate six independent-oracle archives in isolated ignored scratch using the
   public SDK, then read with Python zipfile: STORE/DEFLATE/BZIP2, each classic and
   forced ZIP64, 65,537 bytes with 777-byte transport slabs. All **6** had the
   expected method, descriptor flag and exact extracted bytes. Native tooling and
   disk writes remained outside canonical unit fixtures.

Screenshot preparation completed 75 uncached workspace builds and the host bundle,
exit 0. PNG SHA-256:
`0c7b4d3bc562e6804d036ae94f0f284ca3b742a2ac4d1c286469eb6f583025fe`.
Later telemetry/type-only test refinements do not change the visible command flow.
Absolute `/out` was read-only; task-owned scratch used the existing ignored `out/`
fallback and is purged after recording results. No native ZIP pipe/device parity,
deployed-provider behavior, full repository test gate, commit, push, remote-main
delivery or successful release is claimed.

Candidate SHA-256 (paths relative to packages/safe-bash):

| Input | SHA-256 |
| --- | --- |
| src/commands/archive/zip-format.ts | eb677f0bcc9d870b10128e92bf0805933d629a6b221d4f348b7133a4a4543379 |
| src/commands/archive/zip.ts | 5927c7df92cabd00318ad83141db997fbb1562b35064f86322d23cf42b8d92af |
| src/commands/archive/zip/safety.ts | 6dee6877a63560a1fec12b0eab1d4da65f093af836691fe01762a18ff0216101 |
| tests/commands/zip-format.test.ts | 9864f05a927bb16c9b7d9479499e922c8a0d8a1fe36ac75be7015d3ffe717714 |
| tests/commands/zip-review.test.ts | 556eadb9a9da853cf367eac2e01caccb3d4f6c7dfcfdf30f40a3532d97849b92 |
| tests/commands/zip-standard-flags.test.ts | 3d51d009fad64c1837794953bfc618d961fc69e376f5d3294da9d18a823bf67a |

Final stable-source verification:

- `TZ=UTC LC_ALL=C TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/zip*.test.ts packages/safe-bash/tests/commands/unzip.test.ts packages/safe-bash/tests/plugins/zip*.test.ts`: **1,469/1,469 passed**, zero failures/cancellations/skips/TODOs; 18,768.571583 ms.
- `npm run build:workspaces -- --workspace=virtual-bash`: exit **0**, six uncached builds from maintained declarations, after final product-source changes.
- `npm run typecheck --workspace=virtual-bash -- --report ../../out/zip-stream-final-type-report`: exit **0**, maintained source/tests, consumers and required exact negative validators. The earlier run caught four test-only ByteSource-vs-AsyncIterator errors; tests now explicitly acquire iterators. That failed run is not a passing gate.
- Public SDK **3/3** and isolated Python **3.9.6** zipfile **6/6** controls passed as detailed above.
- Candidate source hashes rechecked against the table; `git diff --check`: exit **0** before final results recording.

An intermediate test run overlapped build removal/recreation of imported SafeJS
declarations and ended with module-not-found failures (**143 passes/19 failures**).
No source fix or test relaxation was made for that run. The final complete run
above followed settled build output. Earlier superseded lint processes were
terminated to avoid competing full traversals after source refinements; they are
not passing lint gates. Cohost/build load excludes duration comparisons. These
are focused ZIP checks, not `npm test` for the whole repository or release proof.

- Final `npm run lint:eslint`: exit **0**, complete **15,493/15,493** configured
  subjects, zero errors, four warnings (two existing docx warnings and two unused
  mock readStream parameters in this candidate's ZIP review test). No lint policy,
  exclusion or rule was changed. This final traversal completed after test iterator
  corrections; superseded traversals are not counted.
- Final typecheck covered all **26** maintained current consumer groups and the
  required negative validators; compile-only, not runtime-service acceptance.
- Task-owned oracle data, visible-root files, screenshot, reports and temporary
  logs were purged after review. Final owned-file diff/hashes were rechecked; no
  unrelated edits, local commit, push or release was introduced.

### Current-main implementation revalidation — September 16, 2026

This execution started on main at `d5bc0802f1b79de7e723f256e593453344cba6aa`
with the eight dirty files listed in the preceding candidate already present.
They were preserved. The earlier statement that the initial tree was clean
describes the preceding execution, not this one. Root and package AGENTS.md
were read. The incremental source, descriptor, metadata retention and owned
staging implementation was already present; no speculative rewrite was made.

Fresh initial format/review controls passed **198/198**, including gated source,
slow sink, producer reuse, budgets, phase cancellation and identity cleanup.
One additional gap was concretely reproduced: direct `streamZipArchive` of an
empty classic archive yielded its 22-byte end record with a 21-byte archive
budget. The new memory-only test failed with `Missing expected rejection`
before the product edit. Admission of end-record/comment/ZIP64 overhead now
runs before metadata retention or end-record allocation, including zero members.
Buffered convenience collection previously supplied a later budget check;
the new guard also protects direct streaming callers before emission.

The added control checks exact and one-byte-short budgets for classic and
forced ZIP64 empty archives, with empty and nonempty comments. It also checks
cancellation before emission and after the end record, preserving reason
identity. Neighboring nonempty live and buffered controls remain enabled.

Candidate SHA-256 superseding only two rows of the preceding table:

| Input relative to packages/safe-bash | SHA-256 |
| --- | --- |
| src/commands/archive/zip-format.ts | 56345d34288897410eeb3254d7285077ce3c4e1cc76660cf39ab3ac666507646 |
| tests/commands/zip-format.test.ts | dd1eb09b79aab019926adeeb1f90c00ab9821ae65bfa4c0a1b21e65cf23753f9 |

Fresh verification:

- Final format/review run: **199/199 passed**, zero failures, cancellations,
  skips or TODOs; UTC/C locale, disabled tsx cache, concurrency 1.
- Full neighboring `zip*.test.ts`, `unzip.test.ts` and plugin ZIP suites:
  dot-reporter run exited **0** after the product guard was added. The later
  cancellation assertions were separately covered by the final 199-test run.
- `npm run build:workspaces -- --workspace=virtual-bash`: exit **0**, six
  uncached workspace builds selected through maintained declarations.
- `npm run typecheck --workspace=virtual-bash`: exit **0**, source/tests,
  all 26 maintained current consumer groups and required negative validators;
  compile-only, not runtime or service acceptance. Temporary report cleaned
  by the maintained runner.
- `npm run lint:eslint`: exit **0**, complete traversal of **15,493/15,493**
  configured subjects, zero errors and four warnings (the same docx and
  pre-existing ZIP mock-parameter warnings recorded above). No lint rules,
  selection or exclusions changed.
- `git diff --check`: exit **0**.

The qualified streaming/buffered profiles, logical retention counter exclusions
and publication-authority limitations above remain unchanged. No RSS isolation,
streaming adaptive compression/update/copy, native pipe/device parity or deployed
provider claim is added. Prior screenshot/SDK/native-oracle proof binds the
preceding candidate; those checks were not rerun for this budget-only guard.
No visible CLI layout or arguments changed. No SafeJS, README, runtime dependency,
host-process fallback, commit, push, remote-main delivery or release was changed
or claimed. No temporary logs or fixtures were written by this execution.


### 2026-09-16 STORE admission follow-up

This execution inspected the existing dirty streaming implementation on main at
`d5bc0802f1b79de7e723f256e593453344cba6aa`, preserving the pre-existing ZIP
and other edits. The original incremental-input gap no longer reproduced:
the initial zip-format, zip-review and zip-standard-flags run passed 495 tests,
including gated EOF, slow sinks, early sink rejection and cooperative cleanup.

A new memory-only failing control validated a narrower remaining issue:
STORE retained a 512-byte owned input slab before rejecting insufficient archive
capacity (observed payload admission 512, expected 0). The writer now checks
known STORE output size against remaining archive capacity before slab copying.
Compressed methods retain their existing output admission after codec production;
this change makes no new codec-workspace or caller-buffer allocation guarantee.

The final control covers classic and ZIP64 one-byte-short rejection, zero owned
payload admission on rejection, source-finally cleanup, exact-boundary success
and decoded payload equality. Existing phase cancellation, producer-reuse,
mixed-neighbor and publication controls remain enabled. All maintained ZIP
command and plugin test files ran with the dot reporter and exited 0:
`node --import tsx --test --test-reporter=dot packages/safe-bash/tests/commands/zip*.test.ts packages/safe-bash/tests/plugins/zip*.test.ts`.
Focused ESLint on the edited source/test files and `git diff --check` exited 0.

Final dirty-source SHA-256 identities:

| File | SHA-256 |
| --- | --- |
| zip-format.ts | `8b6df2a07e88947c91fae19b332fd340930a2f15ba371baca8bdd221f43caae5` |
| zip.ts (preserved) | `5927c7df92cabd00318ad83141db997fbb1562b35064f86322d23cf42b8d92af` |
| zip/safety.ts (preserved) | `6dee6877a63560a1fec12b0eab1d4da65f093af836691fe01762a18ff0216101` |
| zip-format.test.ts | `f4303ed93079e80dfba03ba1c1332f14f353288f71befcdf861d022558a4a0a6` |

The qualified profiles above remain in force: adaptive file compression and
update/copy use bounded buffered access; streaming publication requires the
existing provider staging/identity authority. Counters measure logical slab
admission and serialized metadata, excluding caller buffers, codec workspace,
provider storage and buffered convenience results; no process RSS claim is made.
No visible CLI layout or arguments changed, so screenshots were not rerun for
this admission-only guard. No SafeJS, README, dependency, host fallback, commit,
push or release was changed. This is scoped dirty-candidate verification, not a
full repository gate or remote-main/release qualification. No temporary logs
or generated fixtures were retained.

`npm run typecheck --workspace=virtual-bash` also exited 0: source/tests,
26 maintained current consumer groups and required negative validators. Its
compile-only report was cleaned by the maintained runner; this is not runtime
provider acceptance.

### 2026-09-16 empty-input work admission review

Reviewed current main at `d5bc0802f1b79de7e723f256e593453344cba6aa`
with the eight pre-existing dirty ZIP/evidence files preserved. Root and package
AGENTS.md were read. Initial ZIP/unzip command and plugin regression run exited
0; the original incremental-source gap remains covered by existing gated EOF,
slow-sink, producer-reuse, early rejection and staging/identity controls.

A new memory-only failing test reproduced `Missing expected rejection`:
eight empty source chunks bypassed a four-step work budget. No input slabs or
payload output existed to trigger the previous work accounting. Empty chunks
now consume one work step and yield cooperatively before another pull; nonempty
slab/output admission keeps its existing accounting. This bounds empty-input
draining without adding runtime dependencies or changing codecs/contracts.

The control covers STORE, DEFLATE and bzip2 rejection on the fourth empty pull,
producer-finally cleanup, exact four-step STORE success with three empty chunks
and decoded empty payload equality. Cancellation during empty input preserves
the reason and closes the producer for all three methods. Existing publication
failure/phase cancellation and neighboring buffered/update/copy controls remain
enabled. Final uncached UTC/C-locale command:

```sh
TZ=UTC LC_ALL=C TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 --test-reporter=spec packages/safe-bash/tests/commands/zip*.test.ts packages/safe-bash/tests/commands/unzip.test.ts packages/safe-bash/tests/plugins/zip*.test.ts
```

Result: **1,472/1,472 passed**, zero failures, cancellations, skips or TODOs.
Focused ESLint on zip-format.ts and zip-format.test.ts and `git diff --check`
exited 0. This is scoped dirty-candidate verification, not a full repository,
remote-main or release gate. No new native-oracle or screenshot qualification:
the fix changes internal empty-input admission, with no CLI arguments/layout
changes. Existing qualified buffered/update/copy and staging-authority limits
remain; retention counters describe logical slabs/serialized metadata, excluding
caller buffers, codec workspace, provider storage and convenience results.
There is no process RSS isolation claim. SafeJS, README and unrelated edits were
preserved; no commit, push or release was made. No temporary fixtures/logs were
retained.

| Changed candidate input | SHA-256 |
| --- | --- |
| src/commands/archive/zip-format.ts | `88b647fb9c0387e2ab3c07501a488578f2ec20f031db19f3cc2db6f1bd14074b` |
| tests/commands/zip-format.test.ts | `c62db3a82e2f7cd3905754becaed5ebd649d9fbea1f86a7ac222bfa763bc2f57` |

`npm run typecheck --workspace=virtual-bash` exited 0 for source/tests,
26 maintained current consumer groups and required negative validators.
It used existing built declarations (zero builds) and cleaned its report;
this is compile-only proof, not a fresh build or runtime provider acceptance.

### Commit verification — September 16, 2026

At the user's request to run tests and commit all pending changes, the eight
related ZIP source, test and plan files were verified together on main:

- The uncached UTC/C-locale ZIP/unzip command and ZIP plugin regression command
  above passed again, using the dot reporter (exit 0).
- `npm run typecheck --workspace=virtual-bash` passed source/tests, all 26 current
  public consumer groups and required negative validators (exit 0, zero builds).
- `npm run lint:eslint` completed repository discovery and linted 15,493 inputs:
  zero errors, four warnings, exit 0. Two warnings concern unused mock parameters
  in zip-review.test.ts; the other two concern unrelated DOCX tests.
- `git diff --check` passed.

The guarded lint wrapper rejected positional file arguments before linting;
its supported repository-wide invocation above completed successfully. This is
focused runtime regression and package compile verification, with repository-wide
ESLint, rather than a full repository unit/build gate. The incremental ZIP task's
local commit status is recorded with this atomic commit. No push or release was
requested; remote-main delivery and publication remain unverified.

### 2026-09-16 ZIP64 sentinel and independent-field promotion

Started on clean current main at `52271eba09d31e9417fc4964646fbe3f6b6122e0`.
Root and package AGENTS.md were read; SafeJS and unrelated inputs were preserved.
Incremental input/output, owned slabs, codecs, cooperative cleanup and staged
publication were already implemented. The previous classic-size caps were
therefore revalidated against an existing streaming writer before extension.

Two new fast memory-only controls failed before implementation:

- `zip64Extra([-1], ...)` did not reject; numeric encoders could also mutate an
  end-record destination before discovering an invalid later counter.
- A live source declaring `0xffffffff` bytes failed expected-size admission
  before its header, even with sufficient explicitly configured ZIP64 limits.

Further failing controls caught stale disk numbers in a reused end-record buffer
and an end record whose absolute archive span exceeded safe representability.
Encoders now validate all counters before mutation/allocation, write disk fields
explicitly, and admit complete safe spans. Directory parsing uses subtraction
for bounded span comparisons instead of adding untrusted wide counters.

Expanded size, compressed size and local offset now promote independently at
`0xffffffff`; ZIP64 extras retain only required fields in specification order.
Forced ZIP64 and prospective wide descriptors retain the required wide size
fields. Automatic wide descriptors retain a classic central local-offset field
while that offset fits. A later member can gain only a wide central offset;
its local and central extraction versions agree even with a classic descriptor.
Directory size and start promote independently; exactly 65,535 members now
cause a ZIP64 end record. Locator offsets identify the actual ZIP64 end record,
with a single-disk locator. Extra-field growth and newly required end overhead
are admitted before affected metadata/header publication; STORE admits known
output/end overhead before owned input copying.

The arbitrary `0xfffffffe` ZIP64 admission caps were removed from the existing
streaming path and buffered reader. All configured entry, aggregate, archive,
member, metadata, path, work and output limits remain enforced; defaults are
unchanged. Classic local headers still refuse a payload requiring wide sizes
after publication. Unknown sources select wide descriptors prospectively when
configured input/compressed-output limits permit a sentinel crossing. `-fz-`
propagates disabled policy through both stdout/staged streaming and buffered
writing. CLI and public SDK retain the same command/options; no new arguments,
runtime dependencies or host-process fallback were introduced.

#### Automated controls and scope

Virtual-counter field/end/descriptor encoder controls cover `0xfffffffe`,
`0xffffffff`, `0x100000000`, safe maximum counters, 65,534/65,535/65,536 counts,
independent expanded/compressed/offset fields, independent directory fields,
absolute locator correctness, unsafe/fractional/negative values and disabled
ZIP64. Signed and unsigned classic/wide descriptor encoders are exercised;
existing parser fixtures independently validate all four forms and malformed
descriptors. A tiny virtual-size DEFLATE fixture checks actual local and central
records with expanded size alone promoted; its payload is deliberately not a
multi-gigabyte DEFLATE stream and it establishes record encoding, not successful
expanded-payload extraction. Small unknown-length live STORE output verifies
automatic widths, classic central offset, exact decoded bytes and producer
cleanup. Disabled required widths refuse before acquisition, and cancellation
after the wide local header preserves reason identity without pulling input.

Neighboring gated EOF, slow-sink backpressure, reused producers, exact/one-byte
budgets, empty-source work, phase cancellation, codec/source/sink failure,
identity/staging cleanup, mixed members, update/copy and unzip controls remain
enabled. Pure record encoders are synchronous; cancellation belongs to their
stream publication controls. A separate agent reviewed the four owned source/test
files and found no validated blocking defect; it changed no files or gates.

Final source identities (paths relative to packages/safe-bash):

| Input | SHA-256 |
| --- | --- |
| src/commands/archive/zip/zip64.ts | `ccd3aab29f630f9d08608e87d370b18df536cca8048ffc9826644df810becb81` |
| src/commands/archive/zip-format.ts | `da8ad556beb0745b1b93863b9de5db996cdafc5f74386f6ae1d1522bc8aa7b3b` |
| src/commands/archive/zip.ts | `ddbe5f4880213d0f2d84c7bb55839398989cf0bc4a1225605cee89b9f8910960` |
| tests/commands/zip-format.test.ts | `5db72559772bda70d2c3db0e281da2ad35db8f15af2e94d123577a19193991c3` |

Executed verification:

- Final uncached UTC/C-locale Node run, concurrency 1, of command `zip*.test.ts`,
  `unzip.test.ts` and plugin `zip*.test.ts`: **1,483/1,483 passed**, zero failures,
  cancellations, skips or TODOs; 24,125.29425 ms.
- `npm run build:workspaces -- --workspace=virtual-bash`: exit **0**, six uncached
  builds from maintained workspace/dependency declarations, after final edits.
- `npm run typecheck --workspace=virtual-bash`: exit **0**, final source/tests,
  all 26 current consumer groups and required negative validators passed;
  compile-only proof.
- `npm run lint:eslint`: exit **0**, complete guarded traversal, 15,493/15,493
  configured subjects, zero errors and four existing warnings (two DOCX and two
  ZIP review mock parameters). No lint rule, selection or exclusion changed.
  A direct file-lint invocation was also clean but is not counted as the required
  guarded gate. Final `git diff --check` exited **0**.
- Public `runBash` plus memory FS: **2/2** classic/forced ZIP64 stdin archives
  extracted `stream` through the shared command.
- Final-source isolated Python zipfile oracle: **6/6 passed**, 65,537-byte archives using
  777-byte source chunks, STORE/DEFLATE/BZIP2 each classic/forced ZIP64; exact
  method, descriptor flag and extracted bytes were checked. Disk/native tooling
  stayed outside canonical unit fixtures and product code.
- Real CLI screenshot inspected: readable `wide: stream` and `classic: stream`.
  PNG SHA-256 `fe82143c2be1102295ed450a6b7308a03542d063676b3ab3dcdc43dcba2f2d68`.
  Screenshot preparation completed 75 workspace builds and the host bundle.
  An overlapping test run failed with seven module-not-found file tasks while
  this build recreated SafeJS declarations (1,089 passes); it is excluded from
  passing proof. The final 1,483-test run followed settled SafeJS build outputs.

#### Separate bounded large-artifact manual QA — planned, not executed

This plan supplies interoperability checks beyond virtual-counter proof. It is
not a canonical unit fixture, host fallback or an executed multi-GB claim.

1. Use isolated explicit scratch with at least 5 GiB free, a 600-second deadline,
   one archive at a time and cleanup on success/failure. Run the package's direct
   streaming writer into an explicitly supplied awaited disk sink in a manual
   harness. Do not collect the archive or payload. Use a reused 64 KiB source
   slab, no runtime dependencies, STORE and two live members `large` and `tail`.
   Set both timestamps to `2026-09-10T01:02:04Z`, no comments/custom extras,
   regular file mode, expected lengths `0xffffffff` and 1, respectively.
   Set maxEntryBytes/maxTotalBytes to `0x100000000`, maxArchiveBytes to
   4,294,968,000 and maxPatternSteps to 200,000; preserve all other defaults.
2. With automatic ZIP64, inspect records using seeked bounded reads before
   asking independent readers to stream extraction/CRC verification. Expected:
   `large` local span 64 bytes, wide signed descriptor 24 bytes, central expanded
   and compressed fields `0xffffffff`, ZIP64 values both 4,294,967,295 and classic
   local offset 0. `tail` local offset **4,294,967,383** (`0x100000057`), local
   header 43 bytes, extraction version 45, classic signed descriptor 16 bytes;
   its classic size fields are 1 and only its central offset is `0xffffffff`,
   with a one-value ZIP64 offset extra. Central entry spans are 80 and 71 bytes.
3. Expected directory start **4,294,967,443** (`0x100000093`), size **151**, count
   **2**; classic directory size stays 151 and start is `0xffffffff`. ZIP64 end
   record/locator target **4,294,967,594** (`0x10000012a`); locator disk 0, disk
   count 1. Total archive span **4,294,967,692** (`0x10000018c`). Compare streaming
   extraction CRC/digest with independently generated expected data; use at least
   Python zipfile and an available native ZIP reader, recording exact versions.
4. Repeat with first length `0xfffffffe` and `0x100000000`, increasing the latter
   run's maxTotalBytes to `0x100000001` to admit its one-byte tail, deriving spans
   from actually selected widths; record all central expanded/compressed/offset
   values. Repeat unknown-length first input and forced ZIP64. Check disabled
   ZIP64 rejects a required known width before input acquisition. Check a
   one-byte-short archive budget, cancellation during payload and subsequent
   reuse, with owned scratch removed and no buffered multi-GB result.

Executed proof excludes multi-GB artifacts, actual dynamic streaming threshold
crossings, process RSS/isolation, native pipe/device parity and deployed-provider
publication. Encoder virtual counters establish boundary fields, not runtime
throughput or large-file reader support. Buffered adaptive compression/update/copy
and non-streaming VFS fallback retain their existing bounded profiles; streaming
file publication still requires genuine staging/conditional-write authority.
Absolute `/out` was unavailable; the documented ignored workspace `out/` fallback
held task-owned temporary logs, screenshot and oracle files, purged after review. README,
SafeJS, exports and test selection were preserved. No commit, push, verified
remote-main delivery or successful release is claimed.

## ZIP64 current-worktree revalidation — 2026-09-16

Baseline HEAD: `52271eba09d31e9417fc4964646fbe3f6b6122e0`, on `main`.
The ZIP64 source, tests and evidence above were already modified at task entry;
they were preserved. The four ZIP64 source/test SHA-256 values match the final
identities recorded above exactly. Archive admission `src/commands/archive/internal.ts`
is unchanged, SHA-256
`a1e8c4b8ba9806a762aba474672d365c0096ddf8c29359cee21b031d85fbb69d`.
Its existing settings accept positive safe-integer configured limits without a
classic ZIP cap; default and buffered-filesystem limits remain in force.

Revalidation found the requested record encoders and incremental source/output
path already present. No additional product change was justified by the focused
controls, so no new failing-test reproduction or product edit is claimed here.
This is working-tree qualification, not proof that HEAD alone contains ZIP64.

Executed fresh checks, with no overlapping build:

- `TZ=UTC LC_ALL=C node --import tsx --test --test-concurrency=1
  packages/safe-bash/tests/commands/zip-format.test.ts`: 183 passed, zero failures,
  cancellations, skips or TODOs; 1,264.51275 ms. Includes independent sentinel
  neighbors, directory/count/locator records, safe-number rejection, all four
  descriptor widths/signature forms, live input limits and producer cleanup,
  mixed members, disabled policy and cancellation controls.
- `TZ=UTC LC_ALL=C node --import tsx --test --test-reporter=dot
  --test-concurrency=1 packages/safe-bash/tests/commands/zip*.test.ts
  packages/safe-bash/tests/commands/unzip.test.ts
  packages/safe-bash/tests/plugins/zip*.test.ts`: exit 0. This run used the
  existing maintained fixtures and neighboring command/public-plugin controls;
  the dot reporter does not supply a summary denominator.
- Package-required independent read-only review: 21 memory-only assertions
  passed for independent member widths, sentinel neighbors, descriptor forms
  including signature-valued CRC, count boundaries and unsafe-value rejection.
  No confirmed blocking defect; reviewer edited no files and ran no builds.
- `git diff --check`: exit 0 before this documentation addition.

No build, lint, screenshot, native oracle or multi-GB manual check was rerun in
this revalidation; the earlier executions remain separate evidence. The bounded
large-artifact manual QA above remains planned, not executed. Actual multi-GB
streaming threshold crossings, large-file interoperability, deployed-provider
publication and runtime memory measurements remain excluded. README, SafeJS,
dependencies, exports, CLI/SDK surfaces and existing edits were preserved.
No commit, push, remote-main verification or release was performed.

### Follow-up admission correction on the same revision

The original ZIP64 edits were present at entry and preserved. An independent
read-only review validated one additional gap: a forced ZIP64 STORE member with
both extraction versions downgraded to 10 was accepted. A new memory-only test
failed before the fix (`Missing expected rejection`, exit 1). Admission now
requires version at least 45 whenever central size, compressed size, offset or
disk fields, or local size fields, require ZIP64. Existing BZIP2 version 46 and
classic admission rules remain in force; no dependencies or public APIs changed.

The new control independently exercises central expanded size, compressed size,
offset and both local sizes: versions 10/20 reject and version 45 accepts each
otherwise identical fixture. It also checks pre-cancellation reason identity.
Existing sentinel-neighbor, count, descriptor, mixed-member, limit, cleanup and
cancellation controls remain the surrounding feature proof. Independent review
of the fix and the classic descriptor neighbor passed 2/2 selected tests.

Final source identities for this follow-up:

- zip-format.ts: `8ed0d0922630f9defabd2f1481a9234e31a55838f67aee71d659443bb3d90098`
- zip-format.test.ts: `22cc012c8417bbe484f32c90a524020bde99dda372ef423cdcd62e982aec693b`

Fresh final focused format tests and the uncached UTC/C-locale command
`zip*.test.ts`, `unzip.test.ts` and plugin `zip*.test.ts` run passed (dot reporter,
exit 0). The selected maintained workspace build passed, six dependency-closure
builds. No screenshot was rerun for this binary-format admission-only correction.
`npm run typecheck --workspace=virtual-bash` passed source/tests, all 26 current
consumer groups and required negative validators (compile-only). Final
`git diff --check` passed.
Final `npm run lint:eslint` passed the guarded repository traversal: 15,493
configured subjects linted, zero errors and four existing warnings (two DOCX,
two ZIP review mock parameters), exit 0. No lint selections or rules changed.
The bounded large-artifact QA remains planned, not executed; actual multi-GB
threshold crossings and interoperability remain excluded. No commit, push,
remote-main verification or release was performed for this follow-up.

### User edge-case review — ZIP64 end extraction version, 2026-09-16

Review baseline remains main HEAD `52271eba09d31e9417fc4964646fbe3f6b6122e0`
with the existing ZIP64 source/tests/plans modified at entry. Those edits were
preserved; this review adds one narrow reader correction and its tests.

Confirmed gap: the ZIP64 end record admitted only extraction version 45,
although member admission already supports version 46 (BZIP2). A memory-only
Info-ZIP fixture with only its end extraction version changed to 46 extracted
the expected bytes with Python 3.9.6 `zipfile` using `BytesIO`, but the new package
test failed with `ZIP64 unsupported end-record extraction version` (exit 1).
The reader now accepts 45/46 and still rejects unsupported end versions.
The prior version-46 negative mutation now uses unsupported version 47.

New controls admit 45 and 46 with exact decoded-byte verification, reject 44,
47 and 65535, enforce a one-byte-short archive limit, and preserve pre-abort
reason identity for every version. Existing classic, four descriptor forms,
independent sentinel/count/directory fields, mixed members, streaming cleanup,
budgets and cancellation tests supply neighboring regression controls.
The final format suite passed **185/185**, zero failures, cancellations, skips
or TODOs. A separate read-only agent independently passed the same 185 controls
and found no blocking defect in the narrow version change.

Final source SHA-256 identities:

- `src/commands/archive/zip/zip64.ts`: `9459ebc8b0ab5b2bf53369540e5d5b91f76642bb43869f6d3fa4d960018564ec`
- `src/commands/archive/zip-format.ts`: `8ed0d0922630f9defabd2f1481a9234e31a55838f67aee71d659443bb3d90098`
- `tests/commands/zip-format.test.ts`: `b15909942a4c0784fdbce4e0e023689bd0b47fdeea8c340c4f3a172980de04e5`

Fresh uncached UTC/C-locale Node regression run, concurrency 1, of command
`zip*.test.ts`, `unzip.test.ts` and plugin `zip*.test.ts` passed **1,485/1,485**,
zero failures, cancellations, skips or TODOs; 39,788.977375 ms. This final run
followed the settled selected build. The earlier overlapping dot-reporter run
also exited 0 but is not used for the final denominator.
The selected maintained workspace build passed (six dependency-closure builds).
`npm run typecheck --workspace=virtual-bash` passed source/tests, 26 current
consumer groups and required negative validators (compile-only proof).
`npm run lint:eslint` completed the guarded traversal with **15,493/15,493**
configured subjects, zero errors and four existing warnings (two DOCX, two ZIP
review mock parameters), exit 0. No rules or selection were changed.
Final `git diff --check` passed.
This binary-format correction does not change rendered CLI output; no screenshot
was rerun. No dependencies, host fallback, exports, README or SafeJS edits were
added. No multi-GB artifact was produced: the bounded manual QA above remains
planned, and actual threshold-crossing interoperability and memory measurements
remain exclusions. No commit, push, remote-main delivery or release is claimed.

### Commit verification — 2026-09-16

Fresh uncached UTC/C-locale ZIP/unzip command and plugin regression tests passed
1,485/1,485 with zero failures, cancellations, skips or TODOs. The selected
maintained workspace build passed all six dependency-closure builds. Workspace
typechecking passed source/tests, all 26 current consumer groups and required
negative validators. Repository ESLint passed all 15,493 configured subjects
with zero errors and four warnings. These six files are committed together as
the automatic ZIP64 improvement; no push or release is authorized or claimed.
Temporary verification logs used ignored workspace `out/` because filesystem
root `/out` is read-only; logs are purged after verification.

## Traditional ZipCrypto integration — current main, 2026-09-16

Baseline HEAD: `1afbd97b572cb5ed6aea0a08d598c187a8786623`, branch `main`,
clean index/worktree at entry. This is qualification of the modified working
tree, not HEAD-only, remote-main, published-package or release proof.

### Revalidation and failing controls before fixes

The reader explicitly rejected flag 1, and ZIP's options resolver reserved
password/encrypt as unsupported. `zip/crypto.ts` already provided the traditional
byte transform with native vectors, but no archive/password integration.
The initial memory-only `zip -P` command control failed **16 != 0** before the
implementation. Later focused failures established raw password bytes being
mistaken for UTF-8 metadata, missing SDK archive-option forwarding, missing CLI
entropy injection, one-attempt interactive extraction, and wrong-password exit
status **2 != 82**. Each was reproduced before its correction. Later failing controls established
that credential-text filtering hid a fixed capability diagnostic, and a mutable
typed entropy callback error could leak contextual text. Fixed capability errors
now bypass that filtering and callback errors are rebuilt from fixed codes.

Fresh isolated Apple Info-ZIP 3.0/native UnZip 6.00 and Python 3.9.6 observations
also established the pinned profile: encrypted STORE uses extraction version 10
and descriptor flag 8; `-P=foo` supplies `foo`; empty supplied ZIP passwords are
rejected with status 16; all-wrong extraction returns 82; mixed plain/encrypted
wrong-password extraction returns 1 and emits the plain neighbor. New memory-only
controls failed before the version-10, empty-command-password and status fixes.
Native BZIP2 creation returned status 19, "Compression method bzip2 not enabled";
this is an unavailable oracle, not a passed bidirectional BZIP2 control.

An independent read-only reviewer reproduced a recursive "Nothing to do"
suggestion leaking `-P` values. Stored diagnostic argv now redacts the exact
password positions, including attached/long/default-environment forms. The
reviewer's fresh reproduction showed `[redacted]`, and canonical controls cover
recursive suggestions/debug progress. Existing show-command redaction remains.

### Implemented profile and capabilities

New members compress before encryption, with fresh per-member keys. Eleven
injected cryptographic entropy bytes plus the CRC/time verifier form each
12-byte encryption header. Live sources use the existing byte pipeline, codecs,
signals, budgets and writer descriptor/ZIP64 accounting. Buffered inputs retain
the existing bounded profile. Retained ciphertext preserves descriptor/time
binding through copy, update and comments. Strong/AES encryption stays refused.

`ArchiveCommandsOptions.zipHost` supplies explicit entropy and no-echo password
callbacks. Invocation cleanup is enrolled before host work and drains admitted
cooperative callback work using the existing ZIP/extraction scopes. Callback
exceptions are converted to fixed public errors without calling internal-error
diagnostics with password-bearing host errors. Root cancellation retains its
original reason. Deterministic entropy exists only in fixtures; no product RNG,
terminal, ambient-host-state or process fallback is introduced in the package.

`zip -P` and long/attached/clustered forms encrypt new non-directory members;
empty supplied passwords are rejected with status 16 according to native ZIP.
Empty interactive input and mismatched confirmation also return 16; empty input
is refused before confirmation. `zip -e` requests
and confirms a nonempty password through the injected no-echo host. Raw owned
argv password bytes preserve identity; text passwords use UTF-8. The format API
also encodes/decodes empty password bytes, separately from native command rules.
Extraction allows at most three fresh interactive attempts after header-verifier
rejection and reuses verified passwords. Wrong-password members are skipped;
all-wrong selection returns 82 and mixed successful selection returns 1.

The verifier is not authentication: final expanded length and CRC must succeed
before encrypted member publication. File/symlink publication remains owned and
staged by the existing extraction scope; encrypted `unzip -p` buffers a bounded
member before writing. Low-level `decodeZipEntry` remains streaming and may yield
unverified chunks: its caller must require successful EOF before publication.
`zip -T` validates encrypted serialized entries using the supplied password.

Minimal SDK/CLI wiring carries the same archive options through `runBash`.
The noninteractive `poe-code bash -c` CLI injects Node cryptographic entropy, so
supplied-password stdout commands work. Named ZIP publication still requires
the existing owned atomic staging authority; the real-filesystem adapter refuses
that path. Shell stdout redirection retains its explicitly weaker output contract.
It has no no-echo prompt provider: `zip -e` and
passwordless encrypted extraction fail with the precise diagnostic
`ZIP no-echo password capability is unavailable`, status 2. SDK callers can
explicitly supply both capabilities; no SafeJS change is required. The host
contract and configuration are documented in `packages/safe-bash/src/contracts/zip.md`.

### Revision-bound controls and native proof

The focused memory-only matrix includes STORE/DEFLATE/BZIP2, buffered/live
sources, descriptor/no-descriptor output, empty/Unicode/raw-byte passwords,
mixed plain/encrypted members, encrypted empty members, independent member
passwords, comments, ciphertext-preserving copy/update, `-T`, `-p`, and three
prompt attempts. Negatives cover wrong passwords, deliberately colliding header
verifiers, final CRC/length mismatch, truncated headers, EOF, confirmation
mismatch, absent/malformed/failing capabilities and diagnostic redaction.
Boundaries cover exact/one-byte-short archive budgets and decoded member limits.
Cancellation controls cover pre-abort identity, active cipher/input retirement,
host entropy and no-echo prompt work, and registered cleanup reuse. Existing ZIP,
ZIP64, codec, ownership and extraction tests supply neighboring regression proof.

Frozen native oracle captures: six STORE/DEFLATE archives for ASCII, Unicode and
non-UTF8 byte passwords in `tests/commands/fixtures/zip-crypto-infozip.json`.
These are passive native data; canonical tests use only memory and never spawn
or write fixture files. Fresh isolated final-source oracle checks passed:
**6 native-to-virtual** reads, **24 virtual-to-native UnZip** reads and **24
virtual-to-Python** reads (three passwords, two methods, two descriptor requests,
buffered/live output); additionally **12 virtual BZIP2-to-Python** reads passed.
All comparisons used exact 60-byte payloads; random headers came from explicit
Node cryptographic entropy in the oracle host. Native tools and scratch files
never entered product fallback paths. The failed native BZIP2 writer probe and
native empty-password rejection are recorded separately above.

Current source/test SHA-256 identities:

- `src/commands/archive/zip-format.ts`: `9f3c07319189e91d9739a47e8eac96638d529d0e9fb8e0795d10200701b3382b`
- `src/commands/archive/zip/crypto.ts`: `7f38801815815cd87a76beff5b57fdf91a74b261531f1cdae6108d825074cfcc`
- `src/commands/archive/zip.ts`: `67020ba74c19ede3941a065a3e8abf87ae774025f92147f8f7fe9c22cf819011`
- `src/commands/archive/unzip.ts`: `feeb7305e89b6d41f41ab242aa9a0eb588e2fb3c4d1c7e88bd263579ffd365de`
- `tests/commands/zip-crypto.test.ts`: `87b46fd2f1d637e7db9b11f4909ae78db3c46042aaa9059ce383c5db3171d3c9`
- native JSON fixture: `d70d2f3edc33af2f72724fe82d257af6332021d38f6fe99ed1bae7573ee69df1`

SDK/CLI source identities:

- `src/sdk/bash.ts`: `75da96b3be93419516c52c7eaff308b87370866f09a67b7ae3ef5d839de531c1`
- `src/cli/commands/bash.ts`: `3285996b607efefbb092ef60b1d51ca0d0ae68217be003ef21ce6caaeea77d89`

Final-source focused controls passed **92/92**; ZIP/unzip command and plugin
regressions passed **1,549/1,549**, with zero skips, cancellations or TODOs.
SDK/CLI focused controls passed **23/23**. Selected maintained workspace build
passed all six declared dependency-closure builds; final package typechecking
passed source/tests, all 26 current consumer groups and required negative
validators. The earlier repository lint route passed ESLint, types and workflows;
final-source ESLint also passed all 15,493 configured subjects with zero errors
and four existing warnings.

The full maintained `npm test` reached and passed the complete virtual-bash unit
stage: **39,680 passed, 823 skipped, zero failures/cancellations/TODOs**, plus
**522/522** package runner controls. Skips are exclusions, not passed optional
profiles. The earlier shared repository stage and intervening declared unit
stages completed successfully. The subsequent SafeJS stage reported two
5-second timeouts in `src/run.promise-aliases.test.ts`, for the full native
workflow with pending=false/true. This task's broad run was stopped after those
failures while other SafeJS files remained queued; it is **failed/incomplete**,
not a passing repository gate. An isolated retry using the same maintained
Vitest configuration reproduced both timeouts: **17 passed, 2 failed**, exit 1.
The initial root-only retry selected no files and is excluded from passing
proof. SafeJS source was preserved as requested; no timeout increase or source
repair was applied. Later declared workspace stages are not qualified by this
interrupted run.

Final-source `npm run screenshot-poe-code` preparation passed **75/75 uncached
workspace builds** and root bundling. Both screenshots were visually inspected:
ZIP help renders the password options legibly; the stdout encryption/decryption
workflow displays the exact `payload`, then the precise missing no-echo
capability diagnostic. The final shell command's status 2 is intentional negative
capability evidence; the screenshot wrapper exits 0. The previous named-ZIP
workflow screenshot only demonstrated staging refusal and is excluded from
positive workflow evidence. Screenshot SHA-256 identities before purge:

- Help: `afb53d2b910e1c3f4012e74a5b1932908bbf23459dfca415cf134b5926cc36ed`
- Workflow: `85c4f90476b20af49b31d86f1a7f6771d9fe84a1df35cd883085ae45dab961aa`

`git diff --check` passed. Temporary oracle programs, logs, captures, screenshots
and CLI scratch files use ignored workspace `out/` because filesystem `/out` is
read-only; only this task's artifacts are purged after inspection.
Earlier failing intermediate checks are excluded from passing evidence.

### Exclusions

Isolated native PTY probes confirmed matched input succeeds (status 0),
mismatched confirmation fails (16), and empty input immediately fails (16)
without requesting confirmation. Passwords were not echoed and failed cases
created no archive. Inputs used CR; the initial LF probe timed out and was killed,
and is excluded from passing evidence. Memory controls reproduce the empty and
confirmation ordering/status. Full terminal cancellation parity and CLI no-echo
terminal parity remain excluded. A colliding verifier followed by CRC/decompression failure terminates
without another interactive attempt; only header-verifier rejection retries.
No bidirectional native BZIP2 writing proof, empty-password native ZIP archive
creation, AES/strong encryption, cryptographic authentication, multi-GB artifact,
RSS measurement or deployed-provider publication is claimed. Source streams
and ZIP stdout retain the existing nontransactional partial-output cancellation
profile. Cleanup depends on cooperative injected hosts; opaque uncooperative
promises cannot be forcibly retired. The scoped proof is not full ZIP native
equivalence. README, SafeJS source and runtime dependencies remain unchanged.
No commit, push, remote-main delivery or successful release is claimed.

### September 16, 2026 current-main revalidation

At HEAD `1afbd97b572cb5ed6aea0a08d598c187a8786623` on `main`, the working
tree already contained the password integration described above. This is dirty
working-tree proof, not proof that the integration is committed on remote main.
Revalidation could not reproduce the stated missing integration: `zip -P`
creates encrypted members and the current tests exercise reader/writer and
command password workflows. No product change was made in this revalidation;
existing edits, including SDK/CLI wiring, were preserved.

Fresh checks:

- `node --import tsx --test packages/safe-bash/tests/commands/zip-crypto.test.ts`:
  92 passed, zero failures, skips, cancellations or TODOs. These include positive,
  negative, boundary, cancellation and neighboring-member controls.
- `node --import tsx --test --test-reporter=dot packages/safe-bash/tests/commands/zip*.test.ts packages/safe-bash/tests/commands/unzip.test.ts`:
  exit 0. The dot reporter supplies no aggregate count; no new numerical total
  is claimed for this regression run.
- `npx vitest run --config vitest.root.config.ts src/sdk/bash.test.ts src/cli/commands/bash.test.ts`:
  23 passed across two files, exit 0.

SHA-256 rechecks of `zip/crypto.ts`, `zip-format.ts`, `zip.ts`, `unzip.ts` and
`zip-crypto.test.ts` exactly match the revision-bound identities above. The
existing native cross-read captures remain earlier evidence for those bytes;
native tools were not rerun in this revalidation. No new build, full repository
gate, screenshot, terminal capability or release proof is claimed. The documented
CLI no-echo capability failure and all exclusions above remain applicable.
SafeJS, README and runtime dependencies were untouched.

### Follow-up revalidation — 2026-09-16

Repeated qualification at main HEAD
`1afbd97b572cb5ed6aea0a08d598c187a8786623`, preserving the integration edits
already present at entry. The missing-integration claim remains unreproduced;
no product correction or refactor was justified. Fresh crypto controls passed
92/92 (zero failures, skips, cancellations or TODOs); SDK/CLI controls passed
23/23. The fresh concurrency-1 ZIP/unzip command **and plugin** regression run
using Node's dot reporter exited 0; no aggregate count is inferred from dots.
`git diff --check` passed. The five source/test hashes rechecked in the preceding
section still match the recorded revision identities.

Only this evidence addition was authored in this follow-up. Native cross-read
proof remains the earlier recorded proof for matching bytes; no new native,
build, repository-wide gate or screenshot qualification is claimed. The no-echo
CLI capability failure, earlier SafeJS gate timeouts and all stated exclusions
remain applicable. No README, SafeJS, runtime dependency or product source was
changed, and no commit, push or release was performed.

### Additional user-workflow edge controls — 2026-09-16

At main HEAD `1afbd97b572cb5ed6aea0a08d598c187a8786623`, preserved all
preexisting integration edits and added two memory-only command controls:

- Interactive `unzip -p` switches from a verified cached password to a different
  member password, prompts exactly twice, and emits both encrypted members and
  their plain neighbor in archive order without password diagnostics.
- `unzip -l` and `unzip -p archive.zip plain` operate on a mixed archive without
  acquiring either password or entropy capabilities. Listing exposes no payload.

Fresh crypto run: 94 passed, zero failures, cancellations, skips or TODOs.
Fresh SDK/CLI run: 23 passed. The concurrency-1 ZIP/unzip command and plugin
regression run exited 0; its dot reporter does not establish an aggregate count.
Focused ESLint for `zip-crypto.test.ts` and `git diff --check` both exited 0.
No product defect was reproduced and no product code was changed. These are
positive regression additions, not evidence of a failing-then-fixed defect.

Revision-specific SHA-256 identities:

| Input | SHA-256 |
| --- | --- |
| `zip/crypto.ts` | `7f38801815815cd87a76beff5b57fdf91a74b261531f1cdae6108d825074cfcc` |
| `zip-format.ts` | `9f3c07319189e91d9739a47e8eac96638d529d0e9fb8e0795d10200701b3382b` |
| `zip.ts` | `67020ba74c19ede3941a065a3e8abf87ae774025f92147f8f7fe9c22cf819011` |
| `unzip.ts` | `feeb7305e89b6d41f41ab242aa9a0eb588e2fb3c4d1c7e88bd263579ffd365de` |
| `zip-crypto.test.ts` | `7083fdae66454513b2662a2bd47f1ebd9c7e5c061431ed7e52b52cae57b2c0a0` |

Product hashes remain unchanged from the earlier native cross-read evidence;
native tools were not rerun here. No new screenshot, build, full repository gate,
terminal no-echo parity, commit, push or release proof is claimed. The existing
CLI no-echo capability failure and all preceding exclusions remain applicable.
Only these tests and this evidence section were authored in this pass; SafeJS,
README and runtime dependencies were untouched.


## Remaining operation, logging and virtual testing qualification — 2026-09-16

Base: main `84678cd61a25c33e338a6a146e7c2ce17e2b2b37`. These are live,
uncommitted source/test controls, bound to the hashes below; not a frozen Git
revision, delivered commit or release. The unrelated edit in
`safe-bash-zip-remaining-features.md` was preserved. SafeJS, README, root CLI/SDK
code and runtime dependencies were not edited. Shell argv uses the existing
shared CLI/SDK command implementation without new configuration or dependencies.

### Validated defects and failing controls

The initial memory-only suite failed **8/8** positive probes at parser rejection
for short/long difference and grow, temporary path, junk-SFX, logging and custom
testing. Subsequent independent native Zip 3.0 probes established difference
size/time selection, delete/copy refusal, unchanged empty output, filesync's
current/no-output rule, grow replacement/deletion rebuild, and difference move
eligibility. A failing move control reproduced removal of an unchanged source
absent from the difference output. That source now remains.

Other failed-before-fixed controls: unchanged `-DF -u/-f` returned 12 instead of
publishing empty output; default `-T` did not dispatch a virtual command; virtual
unzip rejected `-tqq`; grow with ZIP64 changes produced central/local mismatch;
malformed overlapping grow input retained **86 bytes** before rejection;
registered stdout-spool cleanup settled before delayed owned scratch retirement;
quiet log info/warnings were missing; recursive selection archived its own log.
Native log opening failure returned 16, now retained; write/limit failures return
11 with bounded diagnostics rather than failing again through the failed sink.

The first independent cross-read attempt accidentally reused the grown base for
difference generation and thus expected a member from a correctly empty delta:
that was an oracle-fixture error. The corrected separate-fixture cohort passed
Python **36/36**, but BSD tar failed **4/36**, all buffered BZIP2 with descriptors.
The local known compressed span was zero, reproduced by a fast field-level test.
Buffered classic BZIP2 descriptor records now retain their known CRC/size spans;
unknown live source records remain unchanged. Retention of grow records now runs
only after full nonoverlap/coverage proof. These initial cohorts are failures,
not passes or a claim of an external-tool defect.

### Implemented behavior and controls

- Difference requires a named base and separate output, selects new members and
  size/DOS-time differences, applies update/freshen freshness, rejects delete/copy,
  and preserves comments/base bytes. Filesync-current publishes nothing. Empty
  differences are valid archives. Move removes only represented sources.
- Grow additions retain owned validated local bytes, including descriptors and
  ZIP64. Replacement/deletion/explicit format changes rebuild. Both paths use
  conditional owned staged replacement; no in-place append, host fallback or
  damaged-existing-archive success is introduced. Duplicate untouched archive
  members remain; conflicting flattened source names fail.
- Temporary paths are authorized VFS directories with known identity and truthful
  per-path staging/mutation capabilities. Named create/update/freshen/copy/delete/
  filesync/separate output use them. Stdout is spooled there and owned scratch is
  cleaned after emission or failure. Registered cleanup waits through delayed
  retirement. No provider-specific branching or host copy was added.
- Junk-SFX accepts a complete adjusted/unadjusted embedded archive only after
  local/central/span/decoded-size/CRC validation, then rewrites without the prefix.
  It never executes bytes. Invalid CRC, fake signatures, trailing bytes, archive
  limits and aliasing refuse publication. Ordinary parsing remains strict.
- Logs use VFS conditional byte writes. Overwrite/append/info, quiet screen output
  with retained eligible log messages, extension handling, aliases/recursive source
  conflicts, raw password redaction, exact/one-byte-short append budgets and
  cooperative write cancellation are controlled. Persistent completed log bytes
  are intentional effects; a late log failure cannot undo prior publication.
- Default test dispatch is registered virtual `unzip -tqq`; custom test dispatch
  uses literal argv, explicit quote/escape grammar and `{}` substitution (or an
  appended staged path). No host unzip process is spawned. Default raw password
  argv identity is preserved. Status, exception, child-output limits, preallocation
  argv limits and cancellation prevent publication and source removal. Standalone
  unchanged tests avoid rewriting; filesync-current/stdout preserve skip rules.

Final focused controls: **111/111**, including positive, negative, exact/neighbor
byte boundaries, pre-abort identity, active cancellation, publication refusal,
owned retirement, comments, aliases, duplicate names, separate output, registered
Shell dispatch and neighboring move/encryption/filesync controls. Full selected
ZIP/unzip command and plugin controls: **1,654/1,654**, zero failures, cancellations,
skips or TODOs. Discovery/ownership runner: **109/109**. Final scoped ESLint and
`git diff --check` pass. Selected maintained workspace build
`npm run build:workspaces -- --workspace=virtual-bash` passes its declaration-derived
six-workspace closure. `npm run typecheck --workspace=virtual-bash` passed source/
tests, 26 current consumer groups and expected negative consumers; the final local
cleanup change and new tests additionally receive the maintained source/tests
compiler check. These are scoped checks, not a full repository npm test/lint gate.

Final-source independent reads: **36/36 Python**, **36/36 BSD tar**, four operations
(grow, difference, temporary stdout, junk-SFX) × three methods × classic/forced
ZIP64/descriptor controls. Exact `NEW payload` bytes were compared. Archives and
oracle streams stayed in memory. Oracles: Python **3.9.6**, BSD tar **3.5.3** /
libarchive **3.7.4**, zlib **1.2.12**, liblzma **5.4.3**, bz2lib **1.0.8**. The local
Darwin Info-ZIP Zip 3.0 cannot write BZIP2 (status 19); that unavailable native
writer cell is not a pass. Native operation/log fixture directories were isolated
and immediately removed; no native tool entered product command paths.

Visible QA: ran `npm run screenshot-poe-code -- -o /dev/stdout -- bash -c 'zip -h2'`.
Its uncached predev workspace build succeeded, but PNG publication failed because
the renderer requires an adjacent atomic temporary file under `/dev`. Absolute
`/out` is read-only on this host. Consequently the same terminal renderer consumed
actual built CLI output in memory; the operations/logging section was rasterized
and visually inspected without persisting generated evidence. Text alignment,
option labels and complete virtual-command diagnostics are legible. This is
in-memory visual proof; there is no saved screenshot artifact or successful
screenshot-file publication claim.

### Explicit exclusions and ownership limits

This pass qualifies the stated operation/message profile, not every Unix ZIP
feature or deployed backend. It does not implement `-A`, `-F/-FF`, split-volume
features, authenticated encryption or platform metadata expansion. Prefix scans
are bounded by work/archive budgets and `min(64,maxMembers)` candidates. Grow
updates and temporary stdout retain the existing buffered source profiles and
can hold separately bounded input, member payload and original local-record
copies; no constant-payload-retention/RSS claim is made. Cross-provider publication
requires the actual filesystem's owned staging support; otherwise it fails and
cleans owned scratch. No real/S3/WebDAV deployment is certified by memory fixtures.

Native wall-clock log banners, argv dumps and log-summary byte formatting are
excluded; logs contain bounded redacted command messages. Virtual child output
is bounded and discarded to prevent raw child-error secret disclosure. Supported
custom syntax is literal argv, not a host shell. No new no-echo/terminal capability
or arbitrary process command support is inferred.

Trusted registered commands must read staged data without mutating it. An
external stage mutation invalidates publication and cleanup identity: existing
archives remain intact, but changed scratch bytes are preserved and cleanup
failure is reported, rather than deleting someone else's changes. The negative
control verifies this explicitly. Cancellation cannot undo completed effects or
preempt uncooperative host callbacks. Product contracts are updated in
`packages/safe-bash/src/contracts/zip.md`; README remains untouched.

No local commit, push, remote-main verification, issue closure or release was
performed or claimed. This task had no Git delivery assignment.

### Final live input SHA-256 identities

Paths are relative to `packages/safe-bash`.

| Input | SHA-256 |
| --- | --- |
| `src/commands/archive/zip.ts` | `ee9100bf77d4136deeb1c45515146ac46b2909d7248aa0968c4034c3e1a1fb47` |
| `src/commands/archive/zip-format.ts` | `838e6df4af899d1aa032716df1c9ee16f131c67648735c1109500fea91fde1f6` |
| `src/commands/archive/unzip.ts` | `17205538f2565ec4fdcdf77dc2eea46c694031d25985cece4b8b5b6a858d7fa6` |
| `src/commands/archive/unzip/arguments.ts` | `81c19d239c9404b1a47d2d5e9bdc25f9f8966d320c2315798155b0021190bfa0` |
| `src/commands/archive/zip/grow.ts` | `ec9d17075f71eddb0003871b2008c0c7d19ae35ea0a46a3cfe18164bd114c402` |
| `src/commands/archive/zip/log.ts` | `1a9dd5a8b17e4581148ced7a215309768b29f1823202297c9e11fcad346358c9` |
| `src/commands/archive/zip/sfx.ts` | `3bfd4acc929de4deff156749034a42ff1d0f256738da75645b1a80798a148920` |
| `src/commands/archive/zip/test-command.ts` | `9cf0b91d95e0009d36547387841daa304ea51582bdd47e9a81ccac1377a6dd31` |
| `src/commands/archive/zip/safety.ts` | `2de2f7cfb690b116e76ef4e9c4f8c5ce78c88f7fc09e835d318c5e70344e8789` |
| `src/commands/archive/zip/options.ts` | `b9a53928e46ec9c5ae052339d8e4a187ab2686ba9a833403b49463071fc98fb7` |
| `src/commands/archive/zip/help.ts` | `67cebd83b7a2b9e6ff3d8adedc228d3a1a6b46955e3a40e8c2da79e0f3062d35` |
| `src/contracts/zip.md` | `c8b09774cee6118113ac6169e99fe81162437bf43ed422ad149eee8461e27ef8` |
| `tests/commands/zip-remaining-operations.test.ts` | `c66c969520893131ad7e963a303eb1b0690ced369f0eb0e49c6b950d744a6f5f` |
| `tests/commands/zip-standard-flags.helpers.ts` | `051afb50af88417243b6ff20d637c1f6f8f8e25dadbf4695b50332027cc1f118` |
| `tests/commands/zip-crypto.test.ts` | `5b0d10c2998e4a32ad8e68dbd60142882b2bde4624a02de5a585630e273a0035` |
| `tests/commands/zip-help.test.ts` | `437f88092de9bb7b4743cba344fd57aaf4d20738c672beb347631b84c429611b` |
| `scripts/integration-inputs.test.mjs` | `b0c8cebb056bfbdb2aaabf8919e5f31992f851f55cea543011e30bb239a4aa03` |

### Repeat-request revalidation — 2026-09-16

The implementation above was already present as uncommitted edits when this
request was revalidated on main `84678cd61a25c33e338a6a146e7c2ce17e2b2b37`.
All **17/17** listed SHA-256 identities match the current files. The stated
missing-feature gap therefore does not reproduce against this working tree;
no additional product changes or duplicate tests were justified. Existing edits,
including the separate plan edit, were preserved.

Fresh execution of `zip-remaining-operations.test.ts`, `zip-move.test.ts`,
`zip-filesync.test.ts` and `zip-atomic-ownership.test.ts` passed **158/158**
controls, with zero failures, cancellations, skips or TODOs. Separately,
`zip-crypto.test.ts`, `zip-help.test.ts`, `zip-comments.test.ts` and
`zip-entry-comments.test.ts` passed, as did the integration-input ownership
runner. Scoped ESLint covering zip.ts, grow/log/SFX/test-command modules and
the remaining-operation tests passed; `git diff --check` passed.

This repeat check adds no new native-oracle, screenshot, build, typecheck,
deployed-provider or full-repository gate claim. The prior qualification and
explicit exclusions remain applicable to the authenticated live inputs.
No README, SafeJS, runtime dependency, product source or test was edited in this
repeat pass. No commit, push or release was performed.

### Additional current-tree revalidation — 2026-09-16

Revalidated on `main` at `84678cd61a25c33e338a6a146e7c2ce17e2b2b37`.
All 17 final live input SHA-256 identities above still match. The requested
implementation and its controls were already present at task entry; the stated
missing-feature gap was not reproduced, so no product correction or refactor
was made. All preexisting edits were preserved.

Fresh concurrency-1 memory controls passed **158/158** across remaining
operations, move, filesync and atomic ownership. Neighboring crypto, help,
archive/entry comments and integration-input discovery controls passed
**364/364**. Both runs reported zero failures, cancellations, skips or TODOs.
An initial invocation used the unavailable Node reporter `summary` and failed
before test execution; it is excluded from passing evidence. The subsequent
runs used the default TAP reporter. `git diff --check` passed.

Only this evidence addition was authored. No new native-oracle, visual, build,
typecheck, lint, deployed-provider or repository-wide qualification is claimed;
the earlier revision-matching qualification and all explicit exclusions remain
applicable. README, SafeJS, runtime dependencies, product source and tests were
untouched. No commit, push, remote-main delivery or release was performed.

### User edge-case QA and source-log preservation — 2026-09-16

Working tree on main `84678cd61a25c33e338a6a146e7c2ce17e2b2b37`, with the
previous remaining-feature implementation already present as uncommitted edits.
The feature absence did not reproduce, but two memory-only source-preservation
controls failed before correction:

- An existing `run.log` selected by `zip -lf run -R sample.zip '*.log'`
  was overwritten with its own alias-refusal diagnostic despite status 16.
- With `maxMembers: 2`, recursive selection failed before visiting `run.log`;
  its original contents were overwritten with the directory-limit diagnostic.

Log opening now validates and reserves a new destination without truncating an
existing file. Bounded, redacted messages retain owned bytes until source
selection completes. Only successful disjoint selection permits overwrite or
append. Alias refusal or incomplete selection reports to the screen, preserving
existing log/source bytes. Deferred opening failure retains status 16 and
prevents archive publication and move-source removal; subsequent log writes keep
status 11. The package contract records this safety behavior. Completed log writes
and archive publication remain intentional effects under the preceding contract.

New controls cover overwrite, append, quiet, debug and info alias refusals,
selection-budget refusal, an explicitly excluded log, and deferred opening
failure. Existing exact/short byte boundaries, active cancellation, pre-abort,
publication failures, redaction and owned cleanup controls also pass. A separate
review added 17 memory-only virtual test-command controls for quoting, empty
arguments, tabs, embedded/repeated placeholders, rejected syntax and combined
stdout/stderr byte boundaries; it found no new test-command product defect.
Its exact test path is registered in integration-input discovery.

Final direct Node/tsx concurrency-1 execution of all `zip*.test.ts` and
`unzip.test.ts` passed **1665/1665**. A separate actual Shell/registry workflow
returned status 16, emitted the alias diagnostic on stderr and preserved the
existing log bytes. The maintained selected build route
`npm run build:workspaces -- --workspace=virtual-bash` passed (six declared
dependency-closure builds). `git diff --check` passed. The maintained
`npm run typecheck --workspace=virtual-bash` passed source/tests and all 26
current consumer groups; expected negative type controls returned 2. This is
compile-only evidence, not runtime/service certification. Maintained guarded
`npm run lint:eslint` completed with exit 0, zero errors and four warnings
(docx operation-types, docx table-model and two zip-review unused-argument
warnings). It reported complete traversal of 15,499 configured subjects. This
live lint invocation began before the final small source corrections and does
not provide a per-subject final-source hash manifest. An earlier redundant
reviewer lint run was intentionally canceled (143) and is excluded from passing
evidence; no guard failure or lint errors were observed in the completed run.

This QA authored only the log preservation fix in zip.ts/log.ts, focused tests,
the exact discovery entry, the ZIP contract and this evidence addition. All
preexisting edits, including the separate plan document, were preserved. No
README, SafeJS or runtime dependency was changed. No new native-oracle,
screenshot, deployed-provider or whole-repository test certification is claimed.
The preceding interoperability evidence applies to its stated inputs; the
current log changes are qualified by the fresh controls above. No commit, push,
remote-main delivery or release was performed.

Final live SHA-256 identities (paths relative to `packages/safe-bash`):

| Input | SHA-256 |
| --- | --- |
| `src/commands/archive/zip.ts` | `193d42f8c8bc293f9090fbf02c53cf160b95e7c0193aab4c938ab3bf02a22a6e` |
| `src/commands/archive/zip/log.ts` | `173d7412f4cbbe2baf129397a28e2c6a90d4f7530b1ce50e1f45da42b2731838` |
| `src/contracts/zip.md` | `9139f1f36a168a1d695c1837ffa195b513bd3336e04cfac23f7781044b0a9d24` |
| `tests/commands/zip-remaining-operations.test.ts` | `c9bc84d1fb5019a9c366059aa11d5f0f335bf32117edcb7c1e325b35ba49ffef` |
| `tests/commands/zip-test-command-review.test.ts` | `1b80d156c6104cacc8c24164c66f8ae27e1f2cca5a2d512169c47df6a003d414` |
| `scripts/integration-inputs.test.mjs` | `9b94571a9bcc70b8f64076a7c54f9361a385cced8225207d9246bfec798a6218` |

### Commit qualification — 2026-09-16

Fresh checks of the combined ZIP archive-operation changes passed:

- All ZIP/unzip command tests: 1,665 passed, zero failures, skips or cancellations.
- Maintained test-runner checks: 522 passed, zero failures, skips or cancellations.
- Selected workspace build with its six declared dependency builds.
- Maintained package typecheck, including source/tests, consumers and expected
  negative controls.
- Maintained repository ESLint: complete traversal, zero errors, four warnings.
- Short and extended ZIP help screenshots were inspected; `git diff --check` passed.

The broader 1,174-file package runtime suite was intentionally stopped after
the focused ZIP checks passed; it is not claimed as passing qualification.
No repository-wide test, remote-main delivery or release is claimed. Temporary
check logs and screenshots were kept in the ignored worktree `out` directory
because the host `/out` root is read-only, and removed after inspection.


## FIFO, DOS names and bracket-list option qualification — 2026-09-16

Base: `main` at `f594b9c34cdf09fc085aa258d962d40ad6fed3a7`.
This section qualifies live uncommitted inputs authenticated below, not a frozen
commit, remote-main delivery or release. Entry working tree was clean. Product
logic stayed in safe-bash; README, SafeJS sources, dependency declarations and
root CLI/SDK sources were untouched. There are no new runtime dependencies,
provider branches or product native-process fallbacks.

### Reproduction and independent native profile

Corrected memory-only initial controls failed 10/10 before implementation:
`-k`, `-FI` and `-RE` rejected at argument parsing, while special sources were
ignored by the current selector. The first attempt contained string writeFile
fixtures, which the byte-only memory filesystem rejected; those setup failures
are excluded from product evidence. The byte fixtures were corrected before
product edits. Later failing controls reproduced FIFO filesync/difference
skipping a size-zero producer and DOS archive fallback clearing Unicode flags.
Independent review reproduced both and found a ZIP64 size-sentinel boundary
issue; each received a fast failing control before correction.

Native source: the existing pinned LuaDist Zip revision
`f6cfe48f6bc5bf2d505a0e0eb265ce4cb238db89`, archive SHA-256
`82631795a124b0dff92979286c74095be5e5f45ceb4183935985ed2839f26490`.
The archive hash was checked and regular/directory-only relative paths admitted
before extraction. Built without source patches using the selected `zip` target
and the exact explicit CFLAGS/LFLAGS2 in the earlier pinned-build section.
Oracle executable SHA-256:
`f175f1aca8767e1f583dcde7a45e08393b5ed117798d733e437870e6141c4f8d`.
Native `-so` exposes FI, k and RE. RE is therefore applicable to this pinned Unix
build; it enables bracket-list globs and is already enabled by default. There is
no general regex engine requirement. Apple-modified Darwin Zip 3.0 was separately
probed; neither Darwin profile certifies Linux, Windows or DOS builds. Source
shows Windows/MSDOS bracket-default conditionals; execution on those profiles
is **Unverified**. A profile omitting an option is **N/A for that profile**, not
a passing option cell; no such omitted-option executable was available here.

Native per-name probes establish `longfilename.extension` → `LONGFILE.EXT`,
`.hidden` → `HIDDEN`, `a.b.c` → `A.B`, `foo..bar` → `FOO.`,
`foo+ bar.txt` → `FOOBAR.TXT`, and component conversion
`longdirectory/name.txt` → `LONGDIRE/NAME.TXT`. CON and AUX.TXT remain unchanged.
Punctuation controls cover spaces, plus/comma/semicolon/equal/brackets versus
retained punctuation. `-j` runs before component conversion. Differently spelled
names collapsing to one DOS name return native 16; no auto-numbering is inferred.
The initial combined-name oracle collided and returned 16, so individual archives
were used for name mapping. Incorrect initial expectations that `+.txt` was empty
and that filtered-empty creates must return 12 were corrected from native controls:
`+.txt` becomes TXT; a valid empty filtered archive returns 0.

Native filter-order probes: `-i binary @ -k` selects source `binary` into BINARY;
`-k ... -i binary` converts the filter to BINARY and excludes lowercase `binary`.
With `-k` first, `*` is stripped from filters and selects nothing. `-k -R '*.txt'`
and `-R '*.txt' -k` return 12. `-RE -i '[a].txt'` selects only a.txt.
Those are native quirks, rather than a license to introduce general regex matching.
Three isolated native FIFO producer probes passed: empty, three-byte text, and
five-byte binary streams, each with a regular neighboring member and exact byte
comparison. A negated-FI control ignored the FIFO and retained the regular member.
Native FIFOs existed only in isolated oracle temporary directories, immediately
removed; native subprocesses never entered product command execution.

### Bounded product behavior and acceptance dimensions

The package contract in `src/contracts/zip.md` defines ordering and restrictions.
VFS mode `0010000` identifies a FIFO, with a special `character` carrier in the
current filesystem type domain. FI requires an existing explicit VFS byte stream
and path `streamingRead: true`; false, unknown or missing readers refuse. Disabled
FIFO modes and unrelated character devices are ignored. Ordinary readFile is
never a FIFO fallback; the real adapter continues to reject special nodes.
The existing scoped VFS forwards readStream through actual Shell/SDK dispatch.
No new filesystem interface or host binding was added.

FIFO collection owns reused producer chunks, propagates the existing signal and
chunk size, enforces remaining entry/total bytes and existing filesystem work
limits, then uses owned staging/publication. Empty streams are valid. Producer
failure, cancellation and changed metadata refuse publication. FIFO move refuses
without producer admission or source deletion. Filesync/difference conservatively
consume every eligible producer rather than treating zero stat size as a content
snapshot; update/freshen retain their existing date eligibility rules.

DOS selection retains original source paths and recursion prefixes. Include/exclude
and recursive selection precede `-j`, then component conversion. Include/exclude
filters parsed after k are DOS-converted; R filters use the final k setting.
The existing raw-path filter policy remains: j does not rewrite filter paths.
New converted members have DOS creator/attributes and ASCII names, with retained
Unicode comments keeping their original encoding flag. Archive fallback preserves
existing Unicode member spelling/encoding; untouched member metadata/payload remain.
K ignores y and reads its target. No reserved-name device semantics are introduced.

| Feature | Positive | Negative | Boundary | Cancellation | Neighbor |
| --- | --- | --- | --- | --- | --- |
| FI | Explicit source bytes, empty streams, actual Shell dispatch | Missing/false/unknown capability, producer failure, disabled mode, move refusal | Exact/short entry and total bytes, endless empty-chunk work exhaustion | Pre-abort identity; active producer cancellation with retirement and no publication | Regular files, character devices, FS/DF, owned reused bytes |
| k | Name mappings, recursive separators, j, uppercase R source, DOS fields | Empty/restricted names, invalid forms, collisions preserving archive and move sources | 8/9 stem and 3/4 extension, multiple dots, control/Unicode restrictions | Pre-abort; active source cancellation closes owned stream | Filters, excludes, symlink target, Unicode without k, Unicode archive fallback/comments |
| RE | Short/long bracket selection, existing Unix default | Negation/value refusal, general regex-looking input stays literal | Exact/one-byte-short argv; bounded matcher work exhaustion | Pre-abort; active matcher-yield cancellation | Includes/excludes, no-wild, maintained range and archive tests |

Final focused memory controls: **68/68**, zero failures, cancellations, skips or
TODOs. Registered by literal path in integration-input discovery. Wider ZIP/unzip
command/plugin controls: **1746/1746**; product inputs were final, and the later
fixture-only non-null TypeScript assertion has no emitted runtime effect and
receives the fresh 68/68 run. Discovery/ownership controls: **109/109**. Final scoped
ESLint and git diff whitespace checks pass. Selected maintained workspace build
passes its declaration-derived six-workspace dependency closure. Maintained
source/tests and consumer typecheck results are recorded in the final-check
addendum below; no repository-wide npm test/lint gate is inferred.

### Interoperability defect found during positive cross-reading

Initial in-memory product archives passed Python **12/12** and BSD tar **11/12**.
Buffered BZIP2 plus ZIP64 and descriptors was refused by BSD tar as truncated.
A fast field control failed with a zero local ZIP64 size instead of six bytes.
Buffered BZIP2 descriptors now retain known local sizes/CRC, including ZIP64.
The independent review's synthetic 4 GiB boundary control then failed: both local
32-bit size sentinels were set but only one ZIP64 value was emitted. Both known
values are now retained. The synthetic boundary checks record shape without
allocating a 4 GiB fixture; it does not certify a real 4 GiB payload or RSS.
Unknown live-source descriptor spans stay zero and retain their existing profile.

Final independent product reads: Python **12/12**, BSD tar **12/12**, three methods
(store/deflate/BZIP2) × classic/forced ZIP64/descriptor/ZIP64+descriptor.
Exact six-byte binary producer output was compared for the DOS member PIPE;
Python also checked CRCs. Product archives/oracle streams stayed in memory.
Oracles: Python 3.9.6; BSD tar 3.5.3 / libarchive 3.7.4, zlib 1.2.12,
liblzma 5.4.3, bz2lib 1.0.8. The initial failing tar cell is retained as a failure,
not counted as an unavailable tool or blamed on the tool.

### Visual proof, exclusions and delivery limits

Ran maintained screenshot-poe-code for actual built CLI extended ZIP help. Its
uncached normal build completed. The first screenshot used an extra argument
terminator and showed missing command input; excluded from ZIP visual proof.
The corrected `bash --command='zip -h2'` screenshot captured the final viewport.
The same renderer separately captured built CLI help's selection section using
virtual head/tail, visibly showing RE, k and FI and their capability restrictions.
Those images were inspected: option labels, explanatory text and line wrapping
are readable. No screenshot tests or design-language change were introduced.

Portable DOS conversion intentionally rejects non-ASCII, backslashes and controls
rather than reproducing unsafe native Unicode/raw-name corruption. General
regex syntax is excluded. FI materializes a regular member, unlike native Unix
FIFO external mode metadata. FI uses bounded buffering, not constant-retention,
RSS bounds or arbitrary preemption of uncooperative trusted callbacks. This
qualifies explicit memory/synthetic VFS sources, not deployed real/S3/WebDAV
FIFO support. Unknown capabilities fail instead of being promoted. The existing
filter-before-flattening policy, conservative FIFO FS/DF consumption, refusal of
FIFO move, and preserved Unicode archive fallback are explicit restricted profile
choices. Split/fix/SFX adjustment and unrelated platform metadata remain outside
this task. Other native host/build/locale profiles remain unverified.

The first broader test attempt ran while screenshot predev rebuilt declarations:
two plugin imports failed for missing transient safe-js dist/safe-fs-core.js.
No SafeJS source was changed; after builds settled, all 1746 controls passed.
The first typecheck caught an optional test-fixture stream method invocation;
a fixture-only non-null assertion corrected it. Initial lint also found yield-less
negative fixture generators, subsequently corrected. These failed attempts do not
count as passes. Source/build fixtures and oracle failures were not weakened.

Host `/out` creation returned read-only filesystem. Temporary oracle sources,
binaries, logs and screenshots used only task-owned ignored `out/zip-fifo-oracle`
and are purged after checks/inspection. No local commit, push, remote-main
verification, issue closure or release was requested or performed.

### Live input SHA-256 identities

Paths below are relative to repository root.

| Input | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/archive/zip.ts` | `9572f6125a08d3a83386015b85a99bd41e85c3466eef597b942dcf2304893d8a` |
| `packages/safe-bash/src/commands/archive/zip-format.ts` | `21128bac77b54911d7ceb91d441aeab79e76d31114091d7aaf6156b3a7fef66d` |
| `packages/safe-bash/src/commands/archive/zip/options.ts` | `66a54668458d3d00e76f0fed1186cb9fe315c87364f26b02d455037749c3d6e5` |
| `packages/safe-bash/src/commands/archive/zip/safety.ts` | `0bb5905b7b02b2564e09b17079be1195026471e0621dbd4adc98623b2a643131` |
| `packages/safe-bash/src/commands/archive/zip/names.ts` | `8c35c5491ed2f87ea5fba3f1aa6ded78e92f003473952cd78a83addba921d242` |
| `packages/safe-bash/src/commands/archive/zip/help.ts` | `60f58fb97e7a30867e5caa751255790214629e05e8717764c3ad3f62dd81f390` |
| `packages/safe-bash/tests/commands/zip-fifo-names.test.ts` | `f01a6ce7111de4c034d2a70efbd35803b26e905bcd79cb7249f18105475bfeb4` |
| `packages/safe-bash/scripts/integration-inputs.test.mjs` | `276db35d20a296de65ce277b4b8ffee207a8e87ccefaea00450fdacb7d7c973d` |
| `packages/safe-bash/src/contracts/zip.md` | `1b19b70d329fd519906cfefe06dbd07183f1e072c4342797632ebee71684bb5f` |
| `docs/plans/safe-bash-zip-compatibility-matrix.md` | `0a278580fd408103aef43756e56855e2d31f440d9727a59e834d1f2abf7352d6` |

### Final maintained checks

The maintained `npm run typecheck --workspace=virtual-bash` rerun passed
source/tests, historical compile-only controls and all **26** current consumer
groups. Expected negative consumers returned 2; the final overall status was
`typecheck-passed-not-runtime-acceptance`, cleanup true, zero runtime executions.
All **10/10** live input hashes above were rechecked after qualification and
still match. The final fixture-only assertion receives fresh **68/68** focused
controls. `git diff --check` passes. No additional gate, delivery or deployed
provider claims are introduced. Task-owned scratch was purged after inspection.

### Repeat-request current-tree revalidation — 2026-09-16

Revalidated on `main`, HEAD `f594b9c34cdf09fc085aa258d962d40ad6fed3a7`.
Unlike the initial implementation run above, this run entered with the FIFO,
DOS-name and RE implementation already present as tracked edits and untracked
`names.ts` / `zip-fifo-names.test.ts`. Those existing changes were preserved.
All ten input SHA-256 identities in the preceding table were recomputed and
matched. The stated missing-option gap does not reproduce in these live inputs;
no additional product or test changes were justified or made. SafeJS, README,
dependencies, CLI/SDK sources and unrelated edits were preserved.

Fresh command (from repository root):

```sh
node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/zip-fifo-names.test.ts packages/safe-bash/tests/commands/zip-pattern-ranges.test.ts packages/safe-bash/tests/commands/zip-archive-source-patterns.test.ts packages/safe-bash/tests/commands/zip-filesync.test.ts
```

Result: **116/116 passed**, zero failed, cancelled, skipped or TODO, in 3.762 s.
This includes positive, negative, boundary, active/pre-abort cancellation and
neighboring controls for the three features, plus archive source fallback,
filesync and native bracket-range regressions. Memory fixtures and actual
Shell/SDK dispatch remain covered. This is a focused live-tree revalidation,
not a frozen-commit, full-suite, fresh native-oracle or visual qualification.
The pinned-build applicability, ordering, native proof and exclusions above
remain bound to the matching inputs; other profiles are not newly qualified.

An initial `npm test --workspace=virtual-bash -- tests/commands/zip-fifo-names.test.ts`
attempt was stopped: the maintained runner appends its entire discovered test
inventory, so that argument does not restrict discovery. That interrupted run
is not counted as a pass or a product failure. The explicit focused command
above completed successfully. Only this evidence note was added during this
revalidation; no commit, push, remote-main delivery or release was performed.

### Subsequent original-task revalidation — 2026-09-16

Current `main` remains at `f594b9c34cdf09fc085aa258d962d40ad6fed3a7`.
Read root and package AGENTS.md; preserved the existing implementation and all
unrelated edits. Recomputed the ten live input hashes above: **10/10 match**.
The same explicit four-file focused command above freshly passed **116/116**
controls in 3.731 s, with zero failures, cancellations, skips or TODOs.
`git diff --check` passed. The missing-feature gap again does not reproduce;
no additional product changes or refactoring were justified. Existing native
build applicability, ordering and restricted-profile exclusions remain as
recorded, with no fresh oracle, screenshot, full-suite or deployed-provider
qualification claimed. Only this evidence entry was added; no commit, push or
release was performed.

### User-workflow edge-case review — 2026-09-16

Reviewed current `main` at HEAD `f594b9c34cdf09fc085aa258d962d40ad6fed3a7`
with the pre-existing dirty FIFO/DOS/RE implementation preserved. No missing
option or additional product defect reproduced. Added six memory-only regression
controls to the already registered `zip-fifo-names.test.ts`:

- A producer yielding no chunks creates a DOS-named empty member that extracts
  successfully (distinct from yielding one empty chunk).
- Synchronous stream acquisition failure preserves the existing archive/source.
- Failure on the first producer read retires the producer and preserves both.
- An excluded FIFO never needs stream capability or producer admission.
- A deterministic metadata change after EOF prevents archive publication.
- An empty DOS directory component refuses publication; `-j` first discards
  that directory component and successfully archives the basename.

The initial metadata-change fixture used a same-millisecond VFS write and did
not guarantee a changed timestamp; its expected rejection failed. Corrected the
fixture to explicitly report an mtime increment after EOF. No product change
was made to accommodate this fixture error, and the failed attempt is not a pass.

Fresh validation:

- Four-file focused command recorded above: **122/122 passed**, no failed,
  cancelled, skipped or TODO controls, 3.078 s.
- Before new tests, ZIP/unzip command/plugin glob suite: **1746/1746 passed**,
  23.897 s. After adding the six controls, the same suite with Node's dot
  reporter exits 0 (**1752 controls**, unchanged discovery plus six).
- `node --test packages/safe-bash/scripts/integration-inputs.test.mjs`:
  **109/109 passed**, 24.964 s, including literal test registration controls.
- `npx eslint packages/safe-bash/tests/commands/zip-fifo-names.test.ts` and
  `git diff --check`: passed.
- `npm run typecheck --workspace=virtual-bash`: passed source/tests,
  historical compile-only controls and all 26 current consumer groups;
  expected negative consumers exited 2, cleanup true, no runtime executions.

Current test SHA-256:
`9769fad0cddd97e3b6e343f836bb8fbdd300f287c4d847df7d5c72ea3a3650fa`.
The earlier table's test identity describes the earlier 68-control revision;
this review's test revision has 74 controls. Product inputs were not edited.
Existing native-build applicability, transformation ordering, restricted ASCII
DOS profile, bounded glob semantics and provider exclusions remain as recorded
above. No new native-build profile, deployed-provider, full repository gate or
visual qualification is inferred from these tests. No visual/product code,
SafeJS, README, runtime dependencies or CLI/SDK interfaces were changed.
No commit, push, remote-main delivery or release was performed.

### Commit preparation validation — 2026-09-16

The user requested running tests and committing all pending changes. Preserved
the existing ZIP implementation and regression controls; no product fixes were
needed during this validation. Fresh checks passed:

- ZIP command tests: **1680/1680**, no failures, cancellations, skips or TODOs.
- Unzip command tests selected from guarded discovery: **59/59**.
- `npm run test:runner --workspace=virtual-bash`: **522/522**.
- `npm run build:workspaces -- --workspace=virtual-bash`: passed the declared
  six-workspace build closure.
- `npm run typecheck --workspace=virtual-bash`: passed source/tests, historical
  compile-only controls, source consumers and all 26 consumer groups; the three
  negative consumers returned their expected status 2.

These focused checks cover this package change; these results do not claim a
full repository test run, new native-build qualification or remote release.

Repository `npm run lint:eslint` also passed: 15,501 configured inputs
linted, zero errors and four warnings. `git diff --check` passed. The commit
includes this validation record and marks the FIFO/name task commit stage done.

## Split-volume implementation — 2026-09-16

Base: current main, HEAD `fdba816493d8a7777ea553ac7e3bba72bbbe0afd`.
Root and package AGENTS.md were read. The worktree started clean. This section
qualifies the live, uncommitted inputs below, not an immutable candidate commit.
SafeJS, README, dependency declarations and root CLI/SDK sources were preserved.

### Reproduction and failing controls

Before product changes, the memory-only `zip-volumes.test.ts` invoked
`zip -q -0 -s 64k archive.zip file` on 150,000 deterministic bytes.
It failed in 0.483 s: status **16**, expected **0**. Current source explicitly
refused multi-disk archives/locators/members. This reproduces the original gap;
historical split exclusions above did not substitute for current validation.

Additional fast failing controls exposed and then verified fixes for records
straddling disks, native bare-number size semantics, pause descriptor flags,
a source symlink targeting an output volume, cooperative stage retirement,
wide per-disk sentinel counts, locators pointing to a preceding disk, default
split copy, four-byte signature output accounting, and extraction overwriting
a preceding input volume. Neighboring tests caught a missing unresolved-final-
disk rejection and the now-stale assertion that show-options omits split-size.
The structural rejection stayed enforced; the option inventory was updated.
Fixture-only mistakes (nonexistent `fs.exists`, treating readdir entries as
strings, a scratch-relative import, and a noUncheckedIndexedAccess error) were
corrected; failed attempts are not counted as passes.

### Qualified behavior and ownership

`zip/volumes.ts` implements integer split-size admission, split names/signatures,
VFS input resolution, record-preserving partitioning, disk-relative central
offsets, ZIP64 offsets/locators and staged publication. Existing STORE, DEFLATE,
BZIP2, ZipCrypto, ByteSource/ByteSink, signals and limits remain in use.
No runtime dependency or native product fallback was added.

`zipHost.volume` is a trusted explicit VFS-path resolver for preceding zero-based
disks; the named archive is final. Missing, repeated, out-of-order structural
sets, aliases and unsafe backing entries are refused. Payload CRC/length checks
cover changed/reordered content. ZIP64 four-byte disk extras and locators whose
end record resides on a preceding disk have positive and negative controls.
Unzip protects every resolved input volume from destination replacement,
including renamed destinations through the existing extraction checks.

`-s` and `--split-size` accept kmgt units, a 64 KiB minimum, zero or `-` for
recombination. Bare values below 1024 mean MiB; other bare values mean bytes.
Files use `.z01/.z02/.../.zip` and an initial `50 4b 07 08` signature.
Payloads cross disks; complete local/central headers, descriptors and end records
do not. Exact rollover produces no empty trailing disk or unreferenced padding.
Copies preserve splitting unless `-s0` explicitly recombines. A separate
`-O` is required for split input modification/copy.

`-sp` enables descriptors and requires the explicit trusted `volumePrompt`
capability for staged transitions; `-sv` reports volume/path/size and `-sb`
rings before prompts. False refuses publication; callbacks borrow the command
signal and must cooperate with cancellation. No ambient terminal/stdin discovery
is introduced. Shell and direct SDK dispatch use the same parser/options.
Virtual `-T` validates a separately owned staged single-disk encoding first,
including custom test invocation; there is no native test fallback.

Every output destination is preflighted, including actual source targets reached
through symlinks, and every volume is staged before the first publication.
Split stages use distinct owned prefixes so acquiring more than 64 volumes does
not depend on exhausting one shared 64-attempt staging-name pool. A parent
capability probe now queries the directory without pretending to create a file
over it; an actual Shell root-directory control reproduced that mismatch.

Publication is **per-volume**, conditionally checked, final `.zip` last.
Before first publication, stage faults, destination faults, rejected prompts,
budget failure and cancellation preserve every existing destination. A controlled
second-publication failure proves the documented weaker outcome: first volume
changed, later volumes intact, every owned stage retired. There is no VFS
all-volume rollback/transaction promise. Unrelated staging-like directories and
their content survive. Registered cleanup waits for cooperative stage retirement.
Shell output accounting charges all staged volume bytes, including the signature.
Sources are removed only after whole-set success through the existing move path.

### Isolated native oracle proof and defect

Downloaded the same pinned Zip source archive documented earlier:
`f6cfe48f6bc5bf2d505a0e0eb265ce4cb238db89`, source tar SHA-256
`82631795a124b0dff92979286c74095be5e5f45ceb4183935985ed2839f26490`.
The earlier explicit `unix/Makefile zip` flags built successfully with no patches.
Binary SHA-256: `f175f1aca8767e1f583dcde7a45e08393b5ed117798d733e437870e6141c4f8d`.
Native invocations used an explicit binary path, scratch cwd and
`env -i PATH=/usr/bin:/bin LC_ALL=C TZ=UTC`; product tests used memory VFS only.

Native `zip -q -0 -s64k native.zip file` on bytes `i % 251`, length 150,000,
produced lengths **65,536 / 65,536 / 19,090**. A compact fixture retains the
actual native prefix/tail and volume lengths, with deterministic payload recipe,
rather than huge repeated encoded payloads. Native volume SHA-256 identities:

| Volume | SHA-256 |
| --- | --- |
| native.z01 | `90de43d6280aade31abf2d2c9e70eeabfdcb2865e90436aaa627cdffef76a350` |
| native.z02 | `30aa9462dce97629a67892b7b5d0b70fa9a5c8bcc4006fb48666ca30e26a4c10` |
| native.zip | `d1d89eec240cf76c5ef229cdcb5379e0f637c8d42cc8698d43b60a60c220c58c` |

The fixture positively extracts and recombines with the product through explicit
VFS resolution. Independently, the pinned native tool recombined four product
**two-volume**, 70,000-byte STORE profiles: ZIP32, forced ZIP64, ZipCrypto and
descriptors. Python 3.9 zipfile extracted all four, including password validation,
with byte equality and payload SHA-256
`9dc177c2fde29dea8e7c29f7ddf147b7c449c99d049c62f3aac0a5933ecf76a3`.
A native-generated two-volume control also recombined/extracted successfully.

Do not count the initial **three-volume** native recombination attempts as
passes: the pinned tool returned 0 but produced only 131,149 bytes for plain
product recombination, 131,177 for forced ZIP64, and 131,149 for encryption;
Python raised EOFError. The same native tool truncated its **own** 150,000-byte
three-volume archive into 131,164 bytes and failed Python extraction identically.
This establishes a native-oracle defect for that cohort. Product three-volume
round trips and the native fixture cross-read pass; native three-volume
recombination remains unqualified. No oracle source or product code was patched
to hide that defect.

### Executed Markdown visual QA

1. In memory VFS, place a 70,000-byte file; configure explicit resolver and
   cooperative approving prompt. Run `zip -0 -s64k -sp -sv -sb archive.zip file`.
   Expect two volumes, descriptor flag, a transition prompt/bell, accurate
   65,536/4,608-byte split reports and status 0.
2. Run `unzip -t archive.zip`. Expect file OK and status 0.
3. Run `zip -s0 archive.zip -O joined.zip`, then `unzip -t joined.zip`.
   Expect copying/OK, both status 0.
4. Render actual Shell dispatch through the maintained general `npm run screenshot`
   command and inspect the PNG. All expected commands, progress, reports and
   statuses were visible and legible; bell bytes were checked separately in
   byte-level controls because the renderer drops control characters.
   The root poe-code launcher is not the memory-VFS capability host.

Screenshot SHA-256:
`db9f72443c472110c47203e427c036d77b5f323edf7c56c3d91cc2a1391af715`.
The first render failed because a scratch import ascended one directory too far;
the corrected render exited 0 and was visually inspected. This is ad hoc QA,
not a screenshot test. Scratch rendering/capture files are not maintained QA
scripts and are purged after evidence recording.

### Revision identities

Paths are repository-relative; this table excludes the evidence file itself.

| Input | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/archive/internal.ts` | `59f10ef05672d7bab0b44ea4bd38c037f16e3ba76e841959e5863a57536d4276` |
| `packages/safe-bash/src/commands/archive/unzip.ts` | `29556be83943aa0f46f2a40ac800f0fd1c95cfc326272ec5ed2c64995e38763e` |
| `packages/safe-bash/src/commands/archive/unzip/safety.ts` | `fc8237058c8f43a3d962c77a23dd8cea3cd461df73929b3a5b1e22522444c213` |
| `packages/safe-bash/src/commands/archive/zip-format.ts` | `efb49a79900b43273d541ff68f8efe48597ef2a8158af0cd2c0008f911dd7ca7` |
| `packages/safe-bash/src/commands/archive/zip.ts` | `a1233b166760681267353ea7a293e796fbcdac0f2e1922e99baf36072a260a4d` |
| `packages/safe-bash/src/commands/archive/zip/volumes.ts` | `85c81c26f114b010095fe0893422fe8a0c2db4f69fe0f9d263a82a747f7286cc` |
| `packages/safe-bash/src/commands/archive/zip/zip64.ts` | `7d03f4df10c221e215fa779327fa97ff7b52236d561c871584187654ae0e028b` |
| `packages/safe-bash/src/commands/archive/zip/safety.ts` | `cca749587878acb89eeb7cf9e0ccb5c597feca535b8acae122401c8c34ee6a71` |
| `packages/safe-bash/src/commands/archive/zip/options.ts` | `16220a853f3c19afcca96fe0d2fd12f159bfe56484cc8492d7b768936d780d5b` |
| `packages/safe-bash/src/commands/archive/zip/help.ts` | `13785329cf85c2c6b7d0538cdb4e0700f6e8b760d4fcc1a3577839056bf6754e` |
| `packages/safe-bash/src/commands/archive/zip/log.ts` | `5a79566f257bbfdffa99b15833e231532523d50f1b89f02c536bc4f3a812b074` |
| `packages/safe-bash/tests/commands/zip-volumes.test.ts` | `9a93f3634564457473f81f84f003a9c23ad816ad2a106379847b38afdeb3e26e` |
| `packages/safe-bash/tests/commands/zip-help.test.ts` | `f69d1b055bbaafc18639c53f0fd654b5a2c6d052174f4243729d0d86d957bfce` |
| `packages/safe-bash/tests/commands/fixtures/zip-volumes-infozip.json` | `c7ecc9d153c337a3f13065dd933c8885577c38100d464ce3c17a54966bd4cb28` |
| `packages/safe-bash/scripts/integration-inputs.test.mjs` | `88fc80b6a33781c778eb63df6e6db96681a0c42f3223131ba1eb52e2960fa512` |
| `packages/safe-bash/src/contracts/zip.md` | `ebfd51e25da2f4cce51b06f27e3a5fb6cdfdee5c4d8537d3774f5708ed49ffed` |

### Exclusions and qualification limits

This is a bounded VFS profile, not universally complete Info-ZIP/media parity.
Input and output retain archive buffers under existing source/entry/archive
limits; there is no one-volume memory or RSS guarantee. Oversized records,
65,535-plus output disks, SFX/recovery plus splitting, removable-media changes,
opaque/uncooperative host cancellation, transactions/all-volume rollback and
cryptographic volume authentication are not claimed. Stale excess volumes are
not deleted. The native file format cannot distinguish otherwise valid,
identical payload-only volumes by a per-volume identity tag.

Explicit-size pause, verbose and bell behavior is qualified; lone `-sp`,
native diagnostic byte-for-byte parity, the separate legacy `-dv` progress
presentation, arbitrary option cross-products and other native build/OS profiles
are not newly qualified. Existing ASCII DOS-name, bounded glob, traditional-
encryption and other recorded restrictions remain. Named real-adapter staging,
deployed S3/WebDAV services, new CLI prompt/resolver bindings, full repository
gates, a full fresh compatibility-matrix sweep and release publication are not
inferred from these focused checks.

Absolute `/out` creation freshly failed with Read-only file system. Task-owned
scratch used ignored repository `out/zip-volumes-oracle` and is purged after
inspection. No commit, push, remote-main verification, issue closure or release
was requested or performed. Final validation results follow below.

### Independent review and final controls

The independent stress reviewer reproduced destructive logfile aliases to
preceding input volumes and generated output volumes. Failing memory-VFS tests
preceded the fix: logfile protection now checks the complete resolved input and
actual destination sets before opening the log. Existing archive bytes survive
rejected direct and symlink aliases. The reviewer also reproduced needless
grouping of ZIP64 end records and incorrect dereferencing of stored `-y`
dangling symlinks; both received failing tests and focused fixes.

Persisted boundary controls qualify individual ZIP64 end-record rollover:
65,332-byte payload produces volume lengths 65,536/42 (end record before
locator rollover); 65,312-byte payload produces 65,536/22 (locator before legacy
EOCD rollover). Both parse and pass actual virtual `unzip -t` through the explicit
resolver. Comment lengths 65,450, 65,500 and 65,514 produce final volumes of
65,472, 65,522 and exactly 65,536 bytes. Stored dangling symlink bytes round-trip
without resolving a nonexistent target. These are memory-only unit controls.

Final checks on the identities above:

- Focused split-volume tests: **86/86**, no failures, skips or cancellations.
- ZIP/unzip neighboring controls: **1,838/1,838**, no failures, skips or
  cancellations; selected test concurrency was one.
- Selected maintained build closure:
  `npm run build:workspaces -- --workspace=virtual-bash` passed, six declared
  build tasks selected from the maintained workspace dependency graph.
- `npm run typecheck --workspace=virtual-bash` passed all 26 current consumer
  groups; the three negative consumer validators returned expected exit 2.
  This establishes type acceptance, not runtime/provider qualification.
- Integration input-runner tests: **109/109**; maintained workspace
  `npm run test:runner --workspace=virtual-bash`: **522/522**.
- Final screenshot rerender exited 0, was inspected and retained the exact
  SHA-256 recorded above. Split reports, prompt, test and recombine statuses
  remained legible and successful.
- Root guarded `npm run lint:eslint` completed with exit 0, zero errors and
  four existing unrelated warnings. The final receipt reports complete coverage;
  no guard, ownership or input-drift exclusion was added for this work.
- `git diff --check` passed. Task-owned ignored scratch was purged after
  recording checks and revision identities; unrelated `out` contents survive.

These focused gates do not replace the excluded full repository gate.

### Current-main revalidation, 2026-09-16

The implementation request was revalidated against main at
`fdba816493d8a7777ea553ac7e3bba72bbbe0afd` plus the existing uncommitted
working-tree changes. Split-volume implementation, fixtures and controls were
already present before this revalidation. The six SHA-256 identities above for
`volumes.ts`, `zip64.ts`, `zip-format.ts`, `zip.ts`, `unzip.ts` and
`zip-volumes.test.ts` were recomputed and match exactly. This is working-tree
proof, not proof that these changes are committed or delivered on remote main.

Fresh uncached checks:

- `node --import tsx --test packages/safe-bash/tests/commands/zip-volumes.test.ts`:
  86/86 pass, zero failures, skips, cancellations or TODOs.
- `node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/zip*.test.ts packages/safe-bash/tests/commands/unzip.test.ts packages/safe-bash/tests/plugins/zip-commands.test.ts packages/safe-bash/tests/plugins/zip-safety.test.ts`:
  1,838/1,838 pass, zero failures, skips, cancellations or TODOs.
- `git diff --check`: exit 0.

The stated missing split-volume support is not reproducible on this candidate;
no product code was changed during this revalidation. Positive, negative,
boundary, cancellation and neighboring regression controls were rerun, including
the memory-VFS Shell/SDK parity control. Existing edits, SafeJS and README were
preserved. No new dependencies, native fallback, scratch files, commit or push
were introduced. Build, typecheck, lint, native-oracle capture and screenshots
were not rerun in this documentation-only revalidation; their earlier receipts
remain historical. All exclusions above, including explicit host capabilities
and per-volume rather than transactional publication, still apply.

### Repeat-request verification, 2026-09-17 UTC

Fresh verification of the repeated original request began at approximately
02:29 UTC (2026-09-16 local time), on the same main HEAD
`fdba816493d8a7777ea553ac7e3bba72bbbe0afd` and pre-existing dirty candidate.
The six source/test SHA-256 identities listed in the preceding revalidation
were recomputed and still match. The same uncached commands passed again:
focused volume controls **86/86**, neighboring ZIP/unzip controls
**1,838/1,838**, zero failures, skips, cancellations or TODOs; neighboring
execution took 30.083 seconds. `git diff --check` passed before this entry.

No missing split-volume implementation was reproduced, so no product changes
or speculative refactor were made. Only this receipt was appended; all existing
edits were preserved. This repeat run qualifies positive, negative, boundary,
cancellation and neighboring regression controls on the working tree, including
explicit resolver/prompt capabilities, encrypted payloads, copy/recombine,
owned stage cleanup and the per-volume publication limitation. It does not
renew historical native-oracle, screenshot, build, typecheck or lint receipts,
prove remote delivery, or remove any exclusions recorded above. No commit,
push or release was performed.

### User-workflow edge review, 2026-09-17 UTC

Review at 02:35 UTC used main HEAD
`fdba816493d8a7777ea553ac7e3bba72bbbe0afd` plus the pre-existing dirty
candidate. Split support was present; initial focused controls passed 86/86.
Additional memory-VFS workflows reproduced two stale-input defects before
fixing product code:

- A later resolver callback replaced a previously read `.z01` file with a
  same-length file of different identity. Both recombine and extraction
  incorrectly succeeded from cached bytes (two failing assertions).
- A resolver callback replaced the final `.zip` file with a same-length file.
  Extraction incorrectly succeeded from the cached final volume. Recombine
  already rejected this case through its separate original-archive check
  (one failing assertion and one passing neighboring control).

`resolveZipVolumes` now captures the final volume stat before invoking resolver
callbacks, checks it after resolution, and rechecks every previously read
volume after all resolver callbacks and reads. It uses existing scope operations,
signal and identity/size/mtime/ctime checks. No dependencies, host discovery,
fallback, format changes or new host capabilities were introduced.

Six additional controls cover both commands: preceding-volume replacement,
final-volume replacement and cancellation during the new revalidation pass.
They prove rejection before extraction directory creation or recombine
publication, preservation of an existing destination, preservation of input
bytes on cancellation, no generated volume stages, and preservation of the
replacement files owned by the resolver. Earlier positive, negative, minimum-size,
exact-rollover, descriptor, encrypted, copy/recombine and neighboring controls
remain active. Canonical fixtures remain memory-only.

Fresh final checks:

- Focused volume controls: **92/92**, zero failures, skips, cancellations or TODOs.
- ZIP/unzip neighboring command/plugin controls: **1,844/1,844**, zero failures,
  skips, cancellations or TODOs; uncached, test concurrency one, 40.858 seconds.
- Maintained selected build closure:
  `npm run build:workspaces -- --workspace=virtual-bash`: exit 0, six builds.
- `npm run typecheck --workspace=virtual-bash`: exit 0, source/tests and all
  26 current consumer groups passed; three negative validators returned their
  expected exit 2. This is type acceptance, not runtime/provider qualification.
- Root guarded `npm run lint:eslint`: exit 0, complete receipt, zero errors and
  four warnings in unchanged files. No lint exclusions or waivers were added.
- `git diff --check`: exit 0. Task-owned scratch logs/rendering files were
  purged after recording results; unrelated `out` contents were preserved.
- Ad hoc screenshot: actual memory-VFS Shell dispatch created three volumes,
  tested the archive successfully and rejected recombine after resolver mutation
  with `ZIP input volume changed while reading`, exit 2. The maintained
  `npm run screenshot` renderer exited 0; the PNG was visually inspected and
  all commands, split sizes, statuses and the diagnostic were legible.
  SHA-256: `6cc1baecbb3ecefd273484513a4101b1c1c2772161e6f7efce8e9cd1f4adcb35`.

Final working-tree identities:

| Input | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/archive/zip/volumes.ts` | `2f1296efab88b6fd9fa46b7b71b2ac07ce7040c55c1c9afdade9639fb7ccd371` |
| `packages/safe-bash/tests/commands/zip-volumes.test.ts` | `daeab4def93ddd75103b4bbe33b5446eb97c281b58486d39b7654ddfc1a2ceaf` |

These checks detect observable stat changes during resolution; they do not
establish a coherent cross-volume snapshot, a lease, an ABA defense or detection
of changes a provider does not expose through identity/metadata. Publication
remains per-volume: without VFS transactions, completed publications cannot be
rolled back as one archive. Existing explicit resolver/prompt and target-profile
exclusions still apply. No fresh external oracle capture, full repository unit
gate or deployed provider qualification was performed. README, SafeJS and all
unrelated edits were preserved. This is local dirty-candidate proof; no commit,
push or release was performed.

## Commit validation, 2026-09-16

The complete maintained `npm run test:unit --workspace=virtual-bash` route
executed all 1,176 discovered TypeScript test files. Runner controls passed
522/522. The workspace suite reported 40,798 tests: 39,974 passed, 823 skipped,
zero assertion failures and one cancellation from a public cleanup timeout.
This run was not a green full-suite result.

The cleanup refusal assertion compared large runtime manifest objects, producing
oversized diffs. Two bounded-message regression checks failed before replacing
that comparison with the equivalent boolean identity assertion. This test-only
fix was committed separately as `ef6beb446`. Subsequent cleanup runs also
encountered intermittent delays in other cases; idle sleep inhibition alone did
not eliminate them. The final complete cleanup-file rerun passed 22/22 with
zero failures, cancellations or skips, in 59.240 seconds. The full workspace
suite was not repeated after the diagnostic fix.

The selected maintained build closure passed:
`npm run build:workspaces -- --workspace=virtual-bash`.
Workspace typechecking passed, including all 26 current consumer groups and
expected negative validators. Repository guarded ESLint passed before and after
the test-only fix, with zero errors and four warnings in unchanged files.
`git diff --check` passed. These are local checks; no push or release was requested.

## SFX offset adjustment and explicit archive recovery, 2026-09-16

### Current-main validation and implemented profile

Work began on clean local main at
`dec0204649d3f028e87bc29b643b00b268e5a664`. Root and package AGENTS.md were read.
The first five memory-VFS controls all failed before implementation: ordinary
`unzip -t` rejected an unadjusted SFX with missing-EOCD diagnostics, `zip -A`
returned unsupported-option status 16, and `-F`/`-FF` returned status 16 for
missing end records and orphan locals. Existing `-J` SFX validation was present;
this is an extension of that implementation, not a claim it was absent.

The focused `zip/repair.ts` uses existing strict ZIP parsing, ZIP64 fields/end
encoders, decoding codecs and CRC verification. Ordinary unzip now accepts fully
validated adjusted/unadjusted ZIP32/ZIP64 SFX without executing prefix bytes;
ordinary parsing still rejects damaged directories, gaps, overlaps and trailing
bytes. Reader prefix support is explicit. `-A` adjusts owned bytes while retaining
the exact inert prefix, local records and compressed payloads. It validates CRCs
before publication and is idempotent for already adjusted archives.

`-F` rebuilds end metadata from a complete validated central directory. `-FF`
also scans local records when central metadata cannot be proved. Candidates
must pass strict metadata/path/span/descriptor checks and expanded-size/CRC
validation. Existing central metadata is preferred, including symlink types.
Bounded payload spans are skipped even when corrupt. An archive embedded inside
an outer local payload is not reinterpreted as an SFX during repair. Unknown-size
descriptors need verified unique record boundaries; ambiguous or unresolved
payloads cannot nominate embedded members. Local UT access/creation timestamps
are never promoted to modification time.

Both recovery modes require a named separate `-O` output. Direct and symlink
aliases are rejected. Recovered bytes are strictly read and decoded before
existing owned atomic VFS staging/publication. No host-process fallback or new
runtime dependency was added. Existing ByteSource/ByteSink, signal, filesystem
identity and owned cleanup contracts are reused. Source and existing destination
bytes survive rejected recovery and cancellation during stage acquisition.
Shell and direct command SDK dispatch share arguments, bytes and statuses.

Salvage with verified members returns status 0; excluded corrupt, duplicate,
ambiguous or truncated members get an explicit partial-recovery warning. Failed salvage with no
verified members or unusable `-F` central metadata returns status 3. Explicit
recovery work/decode exhaustion returns status 4. Work accounts for input,
scanning, synthetic candidate bytes and decoded verification bytes; candidates
are bounded by maxMembers. Existing archive/path/entry/total limits still apply.

### Positive, negative, boundary, cancellation and regression proof

The final focused file has **63/63** passing memory-only controls, zero skips,
failures, cancellations or TODOs. They include adjusted/unadjusted ZIP32/ZIP64
SFX, idempotent adjustment, missing/truncated EOCD and central metadata, orphan
locals, STORE/DEFLATE/BZIP2, signed/unsigned classic/wide descriptors, internal
gaps, trailing junk, overlap and duplicate references, duplicate names, corrupt
payloads, embedded local signatures, complete embedded ZIPs, fake and ambiguous
descriptors, traversal names and verified central symlink extraction protection.
Boundary controls cover empty archives/SFX, exact archive bytes, path/entry/total/
member limits and recovery work exhaustion. Cancellation controls cover both
cooperative scanners and all three commands during owned stage acquisition,
including preserved source/destination and absence of leaked .zip stages.

Additional failing controls preceded fixes for ZIP64 local recovery, preservation
of verified central symlink metadata, ambiguous descriptors, a complete embedded
archive and access-only UT timestamps. The first neighboring run found an obsolete
test expecting `--fix` to remain unsupported. That assertion now uses the still
unsupported `--show-unicode`; rejection coverage was preserved. A later typecheck
found three TS2532 errors in test byte mutations; explicit known-index non-null
assertions fixed them. Those failed attempts are not green validation receipts.
Final quiet-output review also reproduced three failures before fixing success
progress for `-q -A`, `-q -F` and `-q -FF`. A fourth control keeps partial-recovery
warnings visible under `-q`; quiet mode does not hide data-loss diagnostics.

Maintained selected build closure passed after the final runtime change:
`npm run build:workspaces -- --workspace=virtual-bash` (six declared build tasks).
Maintained `npm run test:runner --workspace=virtual-bash` passed **522/522**;
the new canonical test is registered by its exact path in integration-input tests.
Final neighboring/type/lint results are recorded below after settlement. The first
guarded lint attempt ended with signal 143 and no receipt; it is incomplete, not
a pass. Earlier intermediate checks do not certify the final source identities.

### Isolated native oracles and executed Markdown visual QA

Native commands ran only as isolated test oracles, with explicit binary paths,
scratch cwd and `PATH=/usr/bin:/bin LC_ALL=C TZ=UTC`, no inherited credentials.
Bindings were admitted as bounded regular files before hashing/execution:

| Oracle | SHA-256 |
| --- | --- |
| Apple Info-ZIP Zip 3.0, `/usr/bin/zip` | `493a7f270b2cb3ea4f5cf153f735939bdce8b1bad48dce56d6ba89b495064271` |
| Apple Info-ZIP UnZip 6.00, `/usr/bin/unzip` | `2246c1d0fee8aeda25a3b99c35b8f65f9b8f1d224971c92095072c2092ec70de` |

Native `-FF` returned 0 for orphan-local salvage, including an unchecked corrupt
payload. Native `-F` returned 3 without EOCD, even with a complete remaining
central directory, and with no central directory. Native `-A` returned 0 and
reported correcting a nine-byte prefix. Product `-F` deliberately supports the
bounded, fully verified complete-central/no-EOCD case; that is stronger recovery
than this native build, not byte/status parity for that input. Product excludes
unchecked corrupt payloads and labels partial salvage. No native code was changed.

Native UnZip `-t` and Python zipfile testzip independently accepted both product
repair captures: five members each, status 0/no bad member. Output identities:
`product-F.zip` = `05b6201250bd8421c7453ebe0b9c6fae8db2e1f1a989bc740024557b312d6cec`;
`product-FF.zip` = `8b7890937df6eb72e651e5e7f0a517330f0f68e8f55a569f36ce2ea91ff9123a`.
These qualify those captures, not every native format/tool version.

Executed ad hoc visual steps (memory VFS through actual Shell dispatch):

1. Place an inert-prefixed two-member archive; run `unzip -t sample.zip`.
   Expect both members OK and status 0, with no prefix execution.
2. Run `zip -A sample.zip`; expect adjusted-offset diagnostic and status 0.
3. Remove central/end metadata and corrupt the second member; run
   `zip -FF damaged.zip -O recovered.zip`. Expect explicit partial warning,
   status 0 and only the verified member in `unzip -t recovered.zip`.
4. Run `zip -F damaged.zip -O refused.zip`; expect structure diagnostic,
   an explicit suggestion to use separate-output `-FF`, and status 3.
5. Render the actual dispatch with maintained `npm run screenshot`; inspect PNG
   for legible diagnostics/member results/statuses. All were visible and correct.

Screenshot SHA-256:
`974c6ca362801622da18625dc734db254f632c0edc788af67e1f7f697e930549`.
The final render also included `zip -h`, quiet success for `-A`/`-F`, and quiet
partial `-FF`: success progress was absent while the warning remained legible.
Final render SHA-256:
`391cd18d8868d77581645581d477b5da5135eb4022556d8e521beb02f14a5c25`.
The root poe-code launcher does not provide this memory-VFS fixture; the maintained
general renderer was used to capture its actual shell host. This is ad hoc QA,
not a maintained screenshot test or QA script. Absolute `/out` creation failed
with read-only-filesystem errno 30; task-owned ignored repository `out/zip-repair*`
scratch is purged after receipts. Unrelated scratch is preserved.

### Final working-tree revision identities

These repository-relative inputs are bound by SHA-256; evidence itself excluded.

| Input | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/archive/zip/repair.ts` | `f0331d26ce3b4da1592afc3ea387db98462752daf11fd438fc051f4249f55e8e` |
| `packages/safe-bash/src/commands/archive/zip-format.ts` | `b4b78c1bd29f79261a133215338238c37a309d4b3fc1adc4aefe5cb102a78673` |
| `packages/safe-bash/src/commands/archive/zip.ts` | `6b1b11d4c61e8f65040688faf93d80233f212becb1ac787a0c97bb246ef8a64b` |
| `packages/safe-bash/src/commands/archive/unzip.ts` | `968a4191b6542f4660ae05a8337aa1d635fb6b90d4e87b1bb45cb31c81d40c8e` |
| `packages/safe-bash/src/commands/archive/zip/zip64.ts` | `e46a420debd9cc9b7c24c027bcb3fb82967456c1c96f8e6f2e6e24f723ffe7e8` |
| `packages/safe-bash/src/commands/archive/zip/options.ts` | `2e5b8ff794cef1a0b4a56ed883ce84fc322056c478e3780d79006e68196839dc` |
| `packages/safe-bash/src/commands/archive/zip/help.ts` | `9079084aaa850625833a53d90be091e2e7662316c1f1f832d5f341f758075dbb` |
| `packages/safe-bash/src/contracts/zip.md` | `c498b6e19f441547d556ccadb44d4fd77400deec9e9a15fbeaf392e47ef78bfc` |
| `packages/safe-bash/tests/commands/zip-repair.test.ts` | `17d4379b4b254f8d07b104c018501cecea175eda9a08bf1d9a2479e5454a9514` |
| `packages/safe-bash/tests/commands/zip.test.ts` | `01f602611ab304e1cafef3bc6fd59a60585690eba23943b4a5e105bde2308f00` |
| `packages/safe-bash/scripts/integration-inputs.test.mjs` | `2fc6119f83cfede0febef1d53b44f1afd1a511ec90792af4a87a296e3e8493d4` |

### Exclusions and qualification limits

This is bounded single-file recovery, not arbitrary media/split recovery or all
native option cross-products. Modification/selection, split/grow/move and repair
cannot be combined. Recovery stops when a safe local end cannot be established;
it does not promise later-member salvage across unknown corrupt payload spans.
Unknown-size descriptors followed by non-record gaps/junk are conservatively
refused. Metadata-shaped local headers within an apparent SFX prefix can cause
explicit repair to refuse that SFX interpretation; ordinary validated SFX reads
remain independent of this conservative recovery anchor.

Local-only salvage cannot reconstruct absent central Unix types/comments or
archive comments; it uses conservative regular-file/directory defaults. End-record
reconstruction may lose damaged archive comments. Recovery publishes a plain ZIP;
prefix preservation is qualified for `-A`, not recovery output. Unchecked payload copying,
encrypted recovery without a supplied password, required ZIP32-to-ZIP64 offset
promotion, arbitrary ZIP64-sized in-memory payloads and exact native diagnostic/
prompt byte parity are excluded. Existing codec/crypto/name limits remain active.
Known input/stat/identity validation is not a lease, transactional snapshot or
ABA guarantee. Buffers remain subject to existing byte limits, not an RSS promise.

No full repository unit gate, deployed real/S3/WebDAV service qualification,
full compatibility-matrix sweep or new root CLI capability binding is inferred.
README, SafeJS and unrelated edits were preserved. This is local working-tree
proof: no commit, push, verified remote-main delivery, issue closure or release
was requested or performed.

### Final settled validation

- Focused memory-only recovery/SFX controls: **63/63**, zero failures, skips,
  cancellations or TODOs; 0.869 seconds.
- Final uncached ZIP/unzip neighboring command/plugin controls: **1,907/1,907**,
  zero failures, skips, cancellations or TODOs; test concurrency one,
  33.447 seconds. The command selected zip*.test.ts, unzip.test.ts and the two
  ZIP plugin files under packages/safe-bash, including the new focused file.
- Final maintained selected build closure passed (six declared workspace builds).
- Final `npm run typecheck --workspace=virtual-bash` passed source/tests and all
  26 current consumer groups; three negative validators returned expected exit 2.
  This establishes type acceptance, not runtime/service qualification.
- Final guarded `npm run lint:eslint` returned 0 with a complete receipt:
  15,505 configured subjects linted, zero errors and four warnings in unchanged
  files. No guard/ownership exclusions or diagnostic waivers were added.
  Full raw log SHA-256 before purge:
  `acd1beab7ae805a026aee3d8ab235ca6273bf5bd0139d690b8eeb52ea91732be`.
- Final native/Python recapture on the listed runtime revision reproduced both
  output SHA-256 identities above, native status 0 and Python testzip None,
  five members each. The final help/default/quiet screenshot was inspected.
- All eleven maintained source/test/registration identities were recomputed
  against this table. `git diff --check` passed. Task-owned scratch is purged;
  unrelated artifacts remain. No commit, push or release was performed.

These focused controls certify the bounded profile and exclusions above; they
do not substitute for the excluded full repository/release gates. Complete,
well-formed empty archives remain valid in both modes; failed local salvage
with no verified members returns structure status 3.

### Current-main follow-up: truncated orphan header diagnostics

Revalidated on main at base `dec0204649d3f028e87bc29b643b00b268e5a664`
with the existing dirty implementation preserved. The initial focused suite
passed 63/63; the broad feature gap was already implemented in the working tree.
Three new memory-only tests then failed concretely: after a verified local
member, a final 4-, 14-, or 29-byte orphan local header was ignored and
`partial` was false. The local salvage loop now scans complete four-byte
signatures and marks an incomplete fixed header partial before reading fields.
It retains bounded payload skipping, cooperative cancellation and work charging.

Current identities supersede only these two rows of the earlier table:

| Input | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/archive/zip/repair.ts` | `0d04d5b7ae3fcf5107be1fd95bce7e321c02720f0ff550ac0c0f8e3eb444ceef` |
| `packages/safe-bash/tests/commands/zip-repair.test.ts` | `f05a95f7a9f3a2360c4dedd2f1c58ba66d623418aaa89f77a69641c188e41b57` |

Validation on these bytes:

- Focused `node --import tsx --test --test-reporter=dot
  packages/safe-bash/tests/commands/zip-repair.test.ts`: all 66 tests passed.
- Neighbor controls: `node --import tsx --test --test-reporter=dot
  --test-concurrency=1 packages/safe-bash/tests/commands/zip*.test.ts
  packages/safe-bash/tests/commands/unzip.test.ts
  packages/safe-bash/tests/plugins/zip-commands.test.ts
  packages/safe-bash/tests/plugins/zip-safety.test.ts`: exit 0.
- Focused ESLint on the two changed files and `git diff --check`: exit 0.
  This follow-up did not repeat repository-wide guarded lint or a release gate.
- `npm run typecheck --workspace=virtual-bash`: exit 0, source/tests and
  26 current consumer groups accepted; three negative validators returned
  expected exit 2. Existing built declarations were used (zero builds);
  this is compile acceptance, not runtime or publication proof.
- Positive salvage, negative corrupt/embedded candidates, exact byte/work/member
  boundaries, cooperative scanning/staging cancellation and neighboring strict
  reads are exercised by the focused suite. New controls additionally assert
  status 0, a visible quiet-mode partial warning and unchanged damaged source.
- Ad hoc memory-VFS command dispatch rendered with `npm run screenshot`:
  `zip -q -FF sample.zip -O repaired.zip` warned explicitly, then
  `unzip -t repaired.zip` verified the good member. The PNG was inspected:
  legible warning, member OK and both statuses 0. SHA-256 before purge:
  `70727dfa7b53c9b62b86b28c77442225b6ead52de56ace2433f833a794478750`.

Exclusions above remain active. Fewer than four residual bytes cannot establish
a local signature and are not classified as a lost member. No new native-oracle
capture or exact native diagnostic parity is claimed by this follow-up.
Absolute `/out` remains read-only; the single task-owned ignored
`out/zip-repair-header-followup.png` was used and purged. README, SafeJS and
other existing edits were preserved; no commit, push or release was performed.

### Current-main follow-up: single verification of complete central metadata

Revalidated on main at base `dec0204649d3f028e87bc29b643b00b268e5a664`;
the existing dirty SFX/repair implementation and unrelated changes were preserved.
The initial 66 focused tests passed. A new memory-only test failed with
`ZIP recovery total byte limit exceeded`: a complete archive containing one good
and one corrupt four-byte member exhausted an exact eight-byte total budget
because recovery decoded members again after the initial complete-archive check.

Complete and reconstructed central directories now share one member verification
path. Complete central metadata requires no signature rescan after a CRC failure:
`-FF` retains verified members and labels partial recovery, while `-F` returns
structure status 3. Cancellation and resource failures still escape; work and
decoded-byte budgets remain cumulative, without resetting counters or weakening
ordinary parsing. An all-corrupt complete archive returns structure status 3.

| Input | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/archive/zip/repair.ts` | `c006b4772bdfe902c84d01a8dbb7a180df1c8cebebbfc1a102164602e1f3d064` |
| `packages/safe-bash/tests/commands/zip-repair.test.ts` | `e50718893b60f2d0476a7670ee426cc33e92182d619a4b5f99394ddc2e0185d5` |

Validation:

- Focused recovery suite: 67/67 passed. New controls cover positive partial
  salvage at the exact total-byte boundary, negative `-F`, insufficient budget,
  visible partial diagnostics, unchanged damaged source, preserved destination
  on failure and successful verification of the published separate output.
  Existing cooperative scan/stage cancellation and strict neighboring controls
  remain active.
- ZIP/unzip command and plugin neighbors passed with concurrency one using the
  same explicit selection as the earlier follow-up. This run preceded the final
  additional command assertions in the new focused test; the complete focused
  suite was rerun after those assertions were added.
- Maintained `npm run build:workspaces -- --workspace=virtual-bash` passed all
  six builds in its declared closure. Focused ESLint on the two changed files
  and `git diff --check` passed.
- `npm run typecheck --workspace=virtual-bash` passed source/tests and all 26
  current consumer groups against rebuilt declarations; three negative
  validators returned expected exit 2. Compile acceptance does not establish
  runtime or publication acceptance.
- Ad hoc memory-VFS command output was rendered using `npm run screenshot` and
  inspected: the partial warning, verified good member and both status 0 results
  are legible. PNG SHA-256 before purge:
  `6911dcb7853643b090fdf3a884f57770a6935eae0bdbd7fd3aaf9f858eec832e`.
  Absolute `/out` is read-only; task-owned ignored
  `out/zip-repair-budget-followup.png` was used instead and purged.

Earlier bounded-profile exclusions remain active. No new native-oracle capture,
exact native diagnostic parity, full repository gate or service qualification
is claimed. No runtime dependency or host-process fallback was added. README,
SafeJS and unrelated edits were preserved. No commit, push or release performed.

### Current-main user review: malformed bounded local extras

Revalidated on main at base `dec0204649d3f028e87bc29b643b00b268e5a664`
with the pre-existing dirty SFX/repair work preserved. The initial focused suite
passed 67/67. A new memory-only failing test demonstrated that a malformed extra
TLV in a bounded classic local record stopped `-FF` before a later valid member:
expected `before, after`, actual `before`. The rejected payload contained a valid
embedded local record, providing an independent false-member control.

Recovery now skips the entire rejected record when a classic non-descriptor
header bounds its payload within the input, then resumes scanning. It marks the
result partial and never scans that payload for apparent members. Unverifiable
ZIP64 extra data, descriptors and spans beyond EOF still stop recovery; their
end cannot safely be inferred. Ordinary parsing and `-F` remain strict.

| Input | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/archive/zip/repair.ts` | `badbeba4dc074667c229ab91fb38abbdf2e94bb005edb63e42a716ec17df324e` |
| `packages/safe-bash/tests/commands/zip-repair.test.ts` | `cb7e8989f46424ec910af43bd2799a1e182b68cc48cb66fcfbb6e63ea089aa61` |

Validation on these live inputs:

- Focused recovery: 73/73 passed, zero skips/TODOs. Six new controls cover
  later-member salvage, rejection of the embedded member, visible quiet partial
  warning, unchanged source and verified separate output, empty-payload boundary,
  conservative descriptor/ZIP64/truncation stops and command scan cancellation
  preserving both source and pre-existing destination. Existing work/byte limits,
  cooperative scan/stage cancellation, traversal and symlink controls also pass.
- ZIP/unzip neighbors: 1,917/1,917 passed, zero skips/TODOs, via
  `node --import tsx --test --test-concurrency=1
  packages/safe-bash/tests/commands/zip*.test.ts
  packages/safe-bash/tests/commands/unzip.test.ts
  packages/safe-bash/tests/plugins/zip*.test.ts`. The broad run preceded a
  cancellation test title correction only; the final focused file was rerun.
- `npm run build:workspaces -- --workspace=virtual-bash` passed all six
  declared build tasks. `npm run typecheck --workspace=virtual-bash` passed
  source/tests and all 26 current consumer groups; three negative validators
  returned expected exit 2. These are compile checks, not release proof.
- Guarded root `npm run lint:eslint` passed with a complete receipt, exit 0,
  zero errors and four warnings in untouched files (docx operation types, docx
  table model and two ZIP review unused arguments). All 15,505 configured
  subjects were linted; no lint policy or exclusions were changed.
- Executed visual QA: rendered actual memory-VFS dispatch using
  `npm run screenshot`; inspected legible `zip -q -FF` partial warning followed
  by `unzip -t` verifying `before` and `after`, both status 0. Screenshot SHA-256:
  `ebaf3b1066983385962030db76ffa061612128feeeb770f39b5443b7a5ec8372`.
  Absolute `/out` creation failed with read-only filesystem; the task-owned ignored
  `out/zip-repair-malformed-extra.png` was used instead and purged after inspection.

All prior bounded-profile exclusions remain active, particularly no salvage
promise across unknown corrupt spans, no split/media recovery or exact native
diagnostic/prompt parity. The broad neighboring run includes maintained isolated
and captured native oracles; it is not a new native oracle qualification of the
malformed-extra case. No full repository test gate or universal edge-case proof
is claimed. No dependency, host fallback, public API or README change was made.
SafeJS and all unrelated edits were preserved. No commit, push or release performed.

### Commit validation — 2026-09-17

User requested tests and a commit of all pending changes. Validation of the
current working tree:

- Selected maintained workspace build passed all six declared build tasks.
- Package typecheck passed source/tests and all 26 current consumer groups,
  including expected failures from the three negative validators.
- Guarded root ESLint passed: 15,505 configured subjects, zero errors and four
  warnings. No lint configuration or exclusions changed.
- Package runner checks passed 522/522. Focused ZIP/unzip command and plugin
  tests passed 1,917/1,917, without failures, cancellations, skips or TODOs.
- Full package unit run completed: 40,871 tests, 40,045 passes, two failures,
  one cancellation and 823 skips. The failing native-data npm-script control
  exceeded its subprocess timeout, the unchanged-host discovery control
  exceeded its child deadline, and a public-cleanup control exceeded its
  15-second test deadline. A rerun of all three affected files passed 73/73
  with no failures, cancellations or skips.
- A second full run encountered different timeout failures in GNU patch parity
  and a network redirect-cap control; both passed an isolated rerun (2/2).
  The second full run was stopped after more than 400 completed files. These
  observations do not establish a clean full-package unit gate or prove the
  cause of the timing instability. No timeout was raised, assertion weakened
  or test excluded to produce a pass.

Commit delivery is local only; no push, remote-main verification or release
was requested for this validation. Task-owned temporary logs used the existing
ignored workspace `out/` fallback because absolute `/out` is read-only, and
were purged after inspection.

## Metadata/name/platform audit — 2026-09-17

Baseline: current local `main`, commit
`39eb9cef7d9b76a6ceb3d34b1fa2daf8aba18b87`. This section qualifies the
working-tree revision by file hashes below; it is not remote-main or release
proof. Inspected `zip-format.ts`, `zip/safety.ts`, `zip/dates.ts`,
`zip/comments.ts`, `unzip.ts` and the extraction identity/publication contract.
Only a reproduced permission defect required product changes.

### Validated defect and repair

A FAT-created central entry with DOS external attribute bit 0 set was decoded
as `0100644` instead of `0100444`; a read-only directory was decoded as
`0040755` instead of `0040555`. Native Darwin UnZip restored `0444` and `0555`.
The writer also rejected correct retained read-only metadata as a file-attribute
mismatch. After correcting initial fixture mistakes (unsupported extraction
quiet flag and the empty-directory checksum), the six targeted tests produced
three failures and three passing controls before implementation: both read-only
cases and the retained writer failed; writable file/directory and explicit Unix
modes passed. No production assertion or diagnostic was relaxed.

`attributeMode` now shares DOS/Unix mode decoding between reader and writer.
DOS read-only clears write bits from the existing default permissions. Explicit
nonzero Unix/macOS modes remain authoritative, including permissionless regular
files and symbolic links. FAT upper attribute bits cannot manufacture a Unix
symlink. Original creator/external fields, payload, comments and extras remain
retained. Extraction uses the existing conditional staging and directory
metadata operations; there is no new API, CLI option, dependency or host fallback.
CLI and SDK continue to share the same archive commands.

### Revision-specific controls

Added 19 memory-only cases to the already registered `zip-format.test.ts`.
Its compact wire fixture now accepts entry comments and derives ordinary
checksums from its payload; malformed-input controls remain enabled.

| Area | Positive, negative and boundary controls | Cancellation and neighbors |
| --- | --- | --- |
| DOS/Unix attributes | Read-only/writable files and directories; FAT upper bits ignored; creator 3/19 modes `0100000`, `0100640`, `0120777`; contradictory retained mode fails before first output | Abort during staged acquisition preserves old member/archive and leaves no temporary entry; pre-aborted reader/writer; existing device/socket, directory and symlink cases |
| Names/encodings | Korean, emoji, accented and leading-BOM UTF-8; matching/conflicting Unicode paths; CP437 existing case; invalid UTF-8 comments/extras; leading/interior/trailing name NUL refused | Existing decoder/source cancellation and local/central filename/Unicode/flag mismatch cases |
| Comment fields | Archive and member lengths 0, 1, 65,534, 65,535 accepted; 65,536 refused before output; configured text cap enforced; raw legacy comment retained with CRC-bound Unicode extra | Existing comment cursor cancellation, producer reuse, byte/work caps and NUL input grammar |
| Unicode/opaque extras | Unicode-comment TLV lengths 65,534/65,535 accepted; 65,536 refused by writer; configured extra cap; invalid UTF-8 and CRC refused; copy retains raw bytes/opaque field; comment replacement removes stale Unicode CRC field | Existing streaming metadata cancellation, duplicate/malformed extras and timestamp mismatch cases |
| Dates/platform | DOS minimum/maximum valid dates and zero sentinel; invalid date, second, minute and hour refused; signed UT endpoints; odd seconds immediately around Chicago spring/fall DST transitions retain their absolute instant | Existing DOS midnight/year carry, date filters, latest-time cancellation and publication regressions |
| Namespaces/identity | Duplicate names retain two payloads/order; `-p` concatenates, `-o` publishes the last regular member; unknown archive/destination identity refuses overwrite and preserves bytes, while `-p` remains usable | Existing hardlink archive aliases, parent/root symlinks, escaping link targets, identity races and cleanup controls |
| Rewrite policy | Existing six `-X`/`-X-` spelling/order cells preserve untouched opaque extras and rewrite selected members; copied Unicode comment/payload retained, changed comment drops stale CRC extra | Existing update/copy, compression, directories, symlinks and cancellation controls remain in the broad run |

### Public source adaptations and host oracle cells

Re-fetched pinned public sources; their digests exactly match the earlier pins:
Go `writer_test.go` (`2016a65e…4881`), CPython `test_core.py`
(`b0f623e9…4802`) and libarchive `test_read_format_zip.c`
(`3b951e48…187`). New tests independently adapt requirements from Go
`TestWriterComment`, `TestWriterUTF8`, `TestWriterTime`, `TestWriterCopy`,
`TestWriterDirAttributes`; CPython Unicode-path/invalid-extra/NUL cases; and
libarchive `test_symlink`. They use our compact memory fixture and constrained
VFS expectations, not upstream disk fixtures or a copied upstream test body.
Prior Go BSD, CPython PSF and libarchive BSD/per-file provenance and license
references remain applicable. These are adaptations, not upstream-suite execution.

| Platform/tool | Executed observation | Availability/limits |
| --- | --- | --- |
| Darwin 24.6.0 arm64; Apple UnZip 6.00, LLVM 17.0.0 build dated Jul 20 2025 | DOS file/directory `0444`/`0555`; writable file `0644`; explicit Unix `0640`; UTF-8 Korean filename created with correct bytes; symlink targets `unix-mode`; non-symlink UT mtime exactly `1710057601` (odd second after Chicago DST jump) | Available; explicit `TZ=America/Chicago`, `LC_ALL=en_US.UTF-8`; Unicode display output contains replacement glyphs, despite correct created name |
| Same native UnZip, Unicode comment probe | A valid `0x6375` extra spelling `café 🐯` with raw comment `legacy` lists `legacy` | Available; proposed display gap not validated against this oracle, so behavior unchanged |
| Linux host tools | No new execution | Unavailable in this session; not a pass |
| Windows host tools/filesystem | No new execution | Unavailable in this session; no Windows permissions, code-page or DST qualification |
| Other native builds/backends | No new execution | Unverified; earlier captures do not certify this revision |

Native extraction was confined to task-owned scratch paths, with a normal
`022` creation mask. Python 3.9.6 only inspected `lstat`/`readlink` observations;
it is not execution of the pinned CPython 3.13.7 suite. Symlink mode was `0777`;
its host mtime was creation time, not the archived UT time, and is excluded from
timestamp parity. No native utility is part of product execution or unit setup.

Oracle input SHA-256: permission reproduction `883f80672e736ef29c417cd54ceaa54fd693b2f1d52e0ba1236f80451c1c44ea`;
Unicode-comment probe `473ef72996dfb73ff7f937594e6cef052135057699978ff4536115f234c965bf`;
six-member platform probe `9453fa83616deb2be5b308ff9b32696eca0fae96add1b739805a1fb09e8d5e78`.
The platform probe uses DOS read-only file/directory, writable DOS file, Unix
mode file, Korean file and relative symlink, all at `2024-03-10T08:00:01Z`.

### Intentional constraints and exact consequences

- Absolute paths, parent traversal, empty/dot path components and embedded name
  NUL are refused rather than normalized/truncated. Extraction returns status 2
  and does not publish the refused member. CPython's NUL truncation is deliberately
  not adopted. Earlier successfully published members need not be rolled back.
- UTF-8 flag/path extra conflicts, bad CRC, unsupported Unicode-extra versions,
  invalid UTF-8, duplicate extras and local/central conflicts remain strict errors.
  Native builds that ignore some malformed extras do not relax this policy.
- Raw comment bytes are preserved, not translated to a universal display encoding.
  Unicode-comment extras are validated/retained but do not override displayed raw
  comments; terminal comment display stops at NUL. Edited input follows existing
  fgets/NUL grammar and field limits. This is not every native encoding profile.
- DOS fields express local wall time at two-second resolution; new odd-second DOS
  values round upward, while UT retains whole absolute seconds and discards
  milliseconds. UT is signed 32-bit; timestamps fail when no supported field can
  represent the requested retained time. DOS range is 1980–2107.
- Nonzero Unix/macOS upper modes are authoritative; otherwise defaults and DOS
  read-only/directory hints apply. Device/socket modes remain refused; archived
  FIFO payloads become regular VFS files, not host FIFOs. Set-id/sticky bits are
  not restored by extraction (`mode & 0777`). Symlink mode/time restoration is
  not promised. Unknown creator fields are retained, not interpreted as Unix.
- File extraction/publication requires explicit atomic owned staging and
  publication/cleanup methods; directories require conditional directory creation
  and metadata methods. Missing capabilities fail with status 2. Permission/time
  restoration follows the target provider's capability flags: with
  `permissions:false`, read-only metadata is advisory and provides no privacy or
  write-protection guarantee. With `timestamps:false`, archived times are not
  restored. No implicit host implementation substitutes for missing capabilities.
- Existing regular destinations with unknown backing identity cannot be
  overwritten; archive aliases are refused. Existing symlink destinations and
  escaping ancestor/target chains remain refused. Listing/byte inspection can
  succeed without granting destructive extraction capability.

### Verification and exclusions

- Focused final metadata file: 204/204 under America/Chicago and UTF-8, no failures,
  cancellations, skips or TODOs. The broad run below preceded fixture typing-only
  corrections; the corrected final file was rerun.
- `TZ=UTC LC_ALL=C node --import tsx --test --test-concurrency=1
  packages/safe-bash/tests/commands/zip*.test.ts
  packages/safe-bash/tests/commands/unzip.test.ts
  packages/safe-bash/tests/plugins/zip*.test.ts`: 1,936/1,936, no failures,
  cancellations, skips or TODOs, 25,924.806208 ms.
- America/Chicago UTF-8 run of format, entry-comments, latest-time and unzip:
  314/314, no failures, cancellations, skips or TODOs.
- Selected maintained workspace build: all six declared build tasks passed.
- Visual QA used `npm run screenshot` on actual memory-VFS `unzip -l` and `-o`
  dispatch, then inspected restored modes. The full image is legible; Korean
  characters lack font glyphs, without filename byte loss. PNG digest
  `cce9fd3733b2afa5814d43517668755abe0747e4e1068287898dd793bcca95f0`.

Compile/lint final results and final source hashes are recorded below. No full
repository unit gate, deployed VFS backend, unavailable
platform or universal metadata/native parity is claimed. SafeJS and unrelated
edits, README, dependencies and public APIs were preserved. Delivery is
working-tree only: no commit, push, remote-main verification or release requested.
Absolute `/out` was read-only; task-owned ignored `out/zip-metadata-audit/` is
the temporary fallback and is purged after inspection.

Final stable package typecheck passed source/tests and all 26 maintained consumer
groups, with three expected exit-2 negative validators. Earlier attempts failed
on fixture-only typing: explicit undefined in an exact optional property, an
untyped reflective stat result, and `device/inode` instead of actual `dev/ino`
fields. These were corrected; no compiler policy or production type was weakened.
The final 204-case run after all corrections passed, including the control that
removes actual stat identity fields rather than irrelevant properties.

Built normal-import SDK `Shell` with `agentCommands` and memory VFS separately
verified the six-member platform probe: DOS/Unix modes, archived odd-second
mtime, Korean filename/payload bytes and relative symlink target. Its first
payload assertion compared Buffer with Uint8Array prototypes despite equal
bytes; correcting the expected byte-array type passed without product changes.
This is an SDK runtime spot check, not a packed-consumer or deployed-backend gate.

Final stable guarded `npm run lint:eslint` passed with a complete receipt:
15,505 configured subjects linted, exit 0, zero errors and four warnings in
untouched docx operation/table and ZIP review test files. No lint policy,
exclusions, held evidence or warning threshold changed. The stable run kept
product/test bytes unchanged throughout; `git diff --check` also passed.

Final SHA-256, relative to `packages/safe-bash`:

| File | SHA-256 |
| --- | --- |
| src/commands/archive/zip-format.ts | `2d3fc7d4570e7619c7d536ed412c72d05f8f2648d078f0febf11c7ff5fa7e9bb` |
| tests/commands/zip-format.test.ts | `637e4f3a540b64930fd39a2195b7a480e900af8016f75f8136fda3cab3c723e8` |
| src/commands/archive/zip/safety.ts (unchanged) | `cca749587878acb89eeb7cf9e0ccb5c597feca535b8acae122401c8c34ee6a71` |
| src/commands/archive/zip/dates.ts (unchanged) | `3ff74ac883e576faf089e187d3af8e409961ccf35975966d80cd5533078393d4` |
| src/commands/archive/zip/comments.ts (unchanged) | `c82a1f6596377523b06eafbee81c4143c209cebb3b9f79ca5256199949509de2` |
| src/commands/archive/unzip.ts (unchanged) | `968a4191b6542f4660ae05a8337aa1d635fb6b90d4e87b1bb45cb31c81d40c8e` |

### Independent working-tree revalidation and duplicate directories — 2026-09-17

Re-read root/package AGENTS.md and all five requested implementation areas on
local `main` at `39eb9cef7d9b76a6ceb3d34b1fa2daf8aba18b87`. The permission
repair, metadata cases and preceding evidence were already present as unrelated
working-tree edits at task admission. Preserved them, the separate plan edits
and SafeJS. All five implementation hashes above still match exactly. The initial
Chicago/UTF-8 format run passed 204/204 in 1,746.972958 ms. No additional
metadata/name/platform defect was validated that required another product change.

An additional fast failing probe expected duplicate directory members to restore
the last member's permissions. Actual extraction succeeded but restored `0700`
from the first member instead of the expected `0750` from the second. A native
Apple UnZip probe also restored the first member's permissions and timestamp:
the proposed last-member behavior is **not** a validated compatibility repair.
Corrected the expectation to native-observed first-member behavior and added
four memory-only tests to the existing registered `zip-format.test.ts`; no
production code, public API, dependency or host fallback was added in this
follow-up. Pinned public source adaptations and strict safety exclusions in the
preceding audit remain applicable; this follow-up is not another execution of
those upstream suites.

| Duplicate-directory control | Exact observable result |
| --- | --- |
| Positive/neighbor | Two empty `same/` members followed by `same/child`; exit 0, first member's `0700` and UT mtime retained, child payload and input archive byte-identical |
| Boundary | Empty directory payloads with CRC 0 and adjacent duplicate names remain accepted; both archive members remain visible in `unzip -l`; regular duplicate last-member publication remains covered separately |
| Negative identity | Replace the destination immediately before conditional metadata restoration; exit 2 with `EAGAIN: resource temporarily unavailable`, foreign child bytes retained and archive unchanged |
| Negative capability | Explicitly hide `prepareDirectory` for an existing destination; exit 2 with `extraction metadata requires atomic entry conditions`, no metadata call or fallback |
| Cancellation | Abort on the first deferred metadata call; original abort reason escapes, only one restoration attempt, archive unchanged and no `.unzip-` staging entry |

Initial fixture-control attempts failed because `prepareDirectory` also handles
directory creation, deleting an own property did not hide an inherited method,
and the expected identity diagnostic was imprecise. The corrected fixtures
precreate the destination, hide the method through an explicit proxy, and assert
the actual `EAGAIN` diagnostic. Production validation/safety was unchanged. One
UTC broad run loaded those earlier fixtures and failed the two controls; it is
excluded from passing proof. An attempted workspace `npm test` with positional
paths still appended full maintained discovery; stopped only its owned process
tree after recognizing the unfiltered scope. That interrupted run is not a full
workspace/repository gate or a pass.

| Host-platform oracle cell | Observation / availability |
| --- | --- |
| Darwin 24.6.0 arm64, Apple UnZip 6.00, LLVM 17 build Jul 20 2025 | Explicit `TZ=UTC`, `LC_ALL=C`; duplicate Unix directory modes `0700` then `0750`, DOS mtimes 01:02:04 then 01:02:08 on 2026-09-10, followed by child; exit 0, directory `0700`, mtime `1789002124`, child `child` |
| Linux native platform | Unavailable; no new execution or pass |
| Windows native platform | Unavailable; no permissions/code-page/time qualification |
| Other UnZip builds and deployed VFS backends | Unverified for this follow-up |

The UTC input archive SHA-256 is
`98cd104f1a2f52b6826e762c9cc09d50c542cd0c4093dff44bb24f1c2c67d2c8`;
native UnZip SHA-256 is
`2246c1d0fee8aeda25a3b99c35b8f65f9b8f1d224971c92095072c2092ec70de`.
Python 3.9.6 constructed this isolated native-oracle input, not a unit fixture.
The first exploratory native probe inherited the host timezone and used a
current-time child header (input hash
`cd9d6a7ffa7b26bf9e8324fe194ec0fb4bc8923a6f1325d303f688412378971a`);
it restored `0700` with mtime `1789020124`. The explicit UTC deterministic probe
above supersedes it for timezone-qualified evidence.

Final follow-up verification:

- Focused duplicate-directory controls: 4/4, no failures/skips/cancellations/TODOs.
- UTC/C direct Node ZIP/unzip/plugin scope: 1,940/1,940, no failures, skips,
  cancellations or TODOs, 55,125.388750 ms; same command and file patterns as
  the preceding broad audit, with `--test-reporter=spec`. This is focused runtime
  proof, not a substitute for full maintained repository/workspace discovery.
- Chicago/UTF-8 format, entry-comments, latest-time and unzip scope: 318/318,
  no failures/skips/cancellations/TODOs, 3,655.792875 ms. Final format membership
  is 208 tests, including all four added controls.
- `npm run typecheck --workspace=virtual-bash`: source/tests and all 26 current
  consumer groups passed, three expected exit-2 negative validators; zero builds,
  using existing declarations. Product bytes and public types were unchanged.
- Actual source SDK `Shell` with `archiveCommands` and memory VFS ran `unzip -l`
  and `unzip -o` on the three-member probe; both exit 0, first-member directory
  metadata verified. `npm run screenshot` captured these command results;
  inspected screenshot is legible and lists both directory records and child.
  PNG SHA-256 `5ff5c9874745fbeb53f0a33ffcae1dca0ab4c9d125f84f00b24821246d760a53`.
  This is command/SDK visual QA, not packed-consumer or host backend proof.
- Final test SHA-256:
  `d60ac5ed326b80e6e886e4136d038d7ed4b14794c6dbc119c1f847f07fa637b2`.
  Implementation hashes remain the five implementation values in the preceding table.
- Guarded `npm run lint:eslint`: complete receipt, exit 0, all 15,505 configured
  subjects linted, zero errors and the same four untouched docx/ZIP-review
  warnings. No lint exclusions or policy were changed. `git diff --check` passed.

Absolute `/out` remains read-only. Used task-owned ignored
`out/zip-metadata-followup/` for the isolated oracle and screenshot; purged after
inspection. README, dependencies, SafeJS and unrelated edits remain preserved.
No commit, push, remote-main delivery or release was performed. Earlier completed
member/directory creation can remain after a later metadata failure or abort;
these controls do not imply whole-archive transactional extraction. All prior
absolute-path/traversal/symlink-escape refusals remain unchanged.

## Repeated-hour DOS timestamp repair — 2026-09-17

Revalidated current `main` HEAD
`39eb9cef7d9b76a6ceb3d34b1fa2daf8aba18b87` with the four pre-existing dirty
paths recorded by `git status`: this evidence, the remaining-features plan,
`zip-format.ts` and `zip-format.test.ts`. Preserved those edits, including the
preceding metadata/name/platform audit and duplicate-directory controls. This
is live-worktree qualification, not an immutable committed-archive gate.
Read root/package AGENTS.md. No README, SafeJS, dependencies, public options,
host fallback, or unrelated files changed. Existing registered format tests
contain the three additional memory-only tests; no discovery change was needed.

### Validated failure and repair

The fast positive test failed before the repair, in 8.233208 ms, with
`ZIP retained or unrepresentable timestamp metadata mismatch`. Chicago instant
`2024-11-03T07:30:01Z` is the second occurrence of local 01:30:01. `-X` removes
UT; the DOS decoder selects the earlier occurrence when reconstructing a Date,
so comparing absolute instants incorrectly refused the valid wall-clock fields.
The writer now compares local year/month/day/hour/minute/second for DOS-only
metadata. UT still compares absolute whole seconds. DOS calendar validation,
local/central agreement, timestamp range refusal and all path/identity checks
remain active. No codec, filesystem, signal, budget or cleanup contract changed.

| Control | Observable consequence |
| --- | --- |
| Positive | Both `06:30:01Z` and `07:30:01Z` write DOS 01:30:02 without extras; payload and read/write archive bytes preserved |
| Negative | Contradictory retained DOS time/date and changed timestamp fail before the first archive output |
| Boundary | `06:59:59Z`, `07:00:00Z`, `07:59:59Z`, `08:00:00Z` round across the backward transition and repeated-hour endpoints with correct local fields |
| Cancellation | Abort after the first wire chunk rejects the next pull with the original reason; aborted archive reading rejects with that reason |
| Neighbor | Actual `zip -X` and `zip -X-` update commands preserve the complete untouched member, including opaque extra bytes; `-X-` retains exact odd-second UT time |

The existing pinned public-test adaptations for Unicode path/comment extras,
CP437, malformed encodings, NUL, duplicate names, Unix modes/types, unknown extras
and field limits were rerun in the broad ZIP scope. Their preceding source pins
and safety exclusions remain applicable; no upstream suite was downloaded or
executed again in this follow-up. No new defect requiring changes to
`zip/safety.ts`, `zip/dates.ts`, `zip/comments.ts` or `unzip.ts` was validated
outside the fold-selection exclusion below.

### Host oracle and intentional ambiguity

| Platform cell | Result |
| --- | --- |
| Darwin arm64, Apple Zip 3.0, explicit `TZ=America/Chicago`, `LC_ALL=C` | Native `zip -X -o sample.zip file`, four-byte payload `fold`, both instants above: exit 0 and identical ZIP SHA-256 `d2a54abb93b1b15f6bda399749118e28585dc2fa78f6dbd60af19564ac8b946f`; archive mtime `1730619002` |
| Linux native platform | Unavailable; not a pass |
| Windows native platform | Unavailable; not a pass |
| Other native builds, timezone databases and deployed VFS backends | Not qualified by these probes |

Native Zip binding SHA-256:
`493a7f270b2cb3ea4f5cf153f735939bdce8b1bad48dce56d6ba89b495064271`.
Python 3.9.6 set isolated native fixture mtimes; native subprocesses are test
oracles only. The task-owned temporary oracle directory was removed.

**DOS has no timezone or fold bit.** Both occurrences deliberately collapse to
identical DOS fields. Product Date reconstruction uses JavaScript's earlier
occurrence: this Chicago archive reads as `2024-11-03T06:30:02Z`. With UT retained
by `-X-`, it reads as the original `2024-11-03T07:30:01Z`. The native `-o` probe
chose the later occurrence (`07:30:02Z`); existing product latest-time selection
uses the earlier occurrence. Native fold selection is an explicit platform
compatibility exclusion, not repaired by a guessed platform conversion or host
fallback. Exact absolute timestamp preservation requires UT metadata. These
controls qualify DOS wall-clock acceptance, not universal native timestamp parity.
Atomic staging, publication, identity and directory metadata capability
requirements, permissions/timestamps opt-outs, and all absolute-path, parent
traversal and symlink-escape refusals have the same consequences documented above.

### Revision-specific verification

- Three focused controls: 3/3 passed, no failures/skips/cancellations/TODOs.
- UTC/C broad direct Node ZIP/unzip/plugin scope: exit 0 using
  `node --import tsx --test --test-concurrency=1 --test-reporter=dot` on
  `packages/safe-bash/tests/commands/zip*.test.ts`, `commands/unzip.test.ts` and
  `tests/plugins/zip*.test.ts`. This is scoped runtime proof, not full maintained
  workspace/repository discovery.
- Chicago/UTF-8 format, entry-comments, latest-time and unzip scope: 321/321,
  zero failures/skips/cancellations/TODOs, 3,096.122084 ms. A subsequent test-only
  optional-property type correction was verified by rerunning all three new controls.
- Maintained selected build: `npm run build:workspaces -- --workspace=virtual-bash`
  passed; six builds derived from workspace declarations and dependency closure.
- `npm run typecheck --workspace=virtual-bash`: final source/tests and all 26
  current consumer groups passed, with three expected exit-2 negative validators,
  zero builds using the freshly rebuilt declarations. The initial run failed on
  explicitly assigning optional fixture properties without non-null assertions;
  corrected the fixture types and reran the complete maintained route successfully.
- Guarded `npm run lint:eslint`: complete receipt, exit 0, all 15,505 configured
  subjects linted, zero errors and the four untouched docx/ZIP-review warnings.
  No lint policies or exclusions changed. Final `git diff --check` passed.
- Real source SDK `Shell` executed `zip -X`, `zip -X-` and `unzip -l` on both
  outputs, all status 0, with assertions for the decoded times and extra lengths.
  `npm run screenshot` captured this workflow; inspected PNG is legible and
  displays local 01:30 for both listings. PNG SHA-256:
  `8300446303921109d189fd33f0878e5c47a2cfde0351e8216c4a4eefac860fa2`.
  An earlier capture failed because the ad hoc probe registered the second
  command as registration options; corrected the probe, not product code.

| Final live file | SHA-256 |
| --- | --- |
| `src/commands/archive/zip-format.ts` | `92e4b159395d5d590325d5fb182808525544b3647ccd2fbbb5215fd3200b64c9` |
| `src/commands/archive/zip/safety.ts` | `cca749587878acb89eeb7cf9e0ccb5c597feca535b8acae122401c8c34ee6a71` |
| `src/commands/archive/zip/dates.ts` | `3ff74ac883e576faf089e187d3af8e409961ccf35975966d80cd5533078393d4` |
| `src/commands/archive/zip/comments.ts` | `c82a1f6596377523b06eafbee81c4143c209cebb3b9f79ca5256199949509de2` |
| `src/commands/archive/unzip.ts` | `968a4191b6542f4660ae05a8337aa1d635fb6b90d4e87b1bb45cb31c81d40c8e` |
| `tests/commands/zip-format.test.ts` | `fc0929e2f4d2c868e5f2d5dd6b3a5a5cd6e494379c440c16432c70d40455d4d5` |

`/out` creation failed with `Read-only file system`; the task-owned ignored
`out/zip-fold-*` probe, log and screenshot were purged after inspection.
No commit, push, verified remote-main delivery or release was performed.

## User edge-case follow-up — 2026-09-17

Revalidated the live dirty `main` at
`39eb9cef7d9b76a6ceb3d34b1fa2daf8aba18b87`, preserving all incoming edits.
This follow-up adds one memory-only test in the already registered
`tests/commands/zip-format.test.ts`; no product code, SafeJS, README, dependency,
CLI/SDK option or native fallback was changed. No additional product defect was
validated.

The new test admits DOS February 29, 2000 and February 28, 2100, and refuses
February 29 in 2001 and 2100 even with a valid UT timestamp. Positive rewrites
retain DOS date, exact odd-second UT, local/central extra bytes and decoded
payload. Pre-aborted read and write preserve the original cancellation reason.
Existing malformed timestamp, local/central mismatch, field boundary, duplicate
name, directory/symlink, identity, extraction escape and `-X`/`-X-` tests provide
neighboring controls in the broader runs.

The initial new test failed because it expected the complete synthetic STORE
archive to retain extraction version 20. Serialization recalculates the required
version as 10 in both headers. The test was corrected to assert preservation of
the relevant member metadata and payload; product code was not changed to retain
an unnecessarily high version. Whole-wire byte identity is therefore explicitly
excluded for this fixture, despite preserved timestamps, extras and payload.

Executed checks on Darwin arm64:

- UTC/C broad direct Node scope, `commands/zip*.test.ts`, `commands/unzip.test.ts`
  and `plugins/zip*.test.ts`: exit 0. This run preceded the new leap-century test.
- Final Chicago/C and Pacific/Apia/C direct Node scopes, format, latest-time,
  archive comments, entry comments and unzip: each 351/351 passed, no failures,
  cancellations, skips or TODOs (4438.968416 and 4431.323458 ms respectively).
- Focused new test under Chicago: 1/1 passed, 7.817916 ms.
- Guarded `npm run lint:eslint`: complete receipt, exit 0; all 15,505 configured
  subjects linted, zero errors and four untouched docx/ZIP-review warnings.
  Final `git diff --check` passed.
- `npm run typecheck --workspace=virtual-bash`: exit 0, source/tests and all 26
  current consumer groups; three expected exit-2 negative controls, zero builds.
  Product inputs were unchanged, so this used existing built declarations.

Direct Node runs are scoped runtime checks, not a full maintained repository
gate. Timezone profiles on Darwin do not establish native Linux or Windows
platform parity. No new native oracle was executed: Linux and Windows remain
unavailable, and earlier pinned public adaptations and native observations remain
historical evidence with their stated exclusions. No visual CLI change was made;
the preceding screenshot evidence was not recaptured. Existing VFS capability
requirements and absolute-path, traversal and symlink-escape refusals remain.

Final source `zip-format.ts` SHA-256:
`92e4b159395d5d590325d5fb182808525544b3647ccd2fbbb5215fd3200b64c9`.
Final `tests/commands/zip-format.test.ts` SHA-256:
`9c7c205a784096c2913a947c7f82c09d9147be77bd13a897c83de463ad533f89`.
No temporary logs or fixtures were written. No commit, push, verified remote-main
delivery or release was performed in this follow-up.

## Commit verification — 2026-09-17

For the user's request to run tests and commit all current changes, rechecked
the four changed files on local `main` without reverting incoming edits:

- Chicago/C direct Node ZIP scope (`tests/commands/zip*.test.ts`,
  `tests/commands/unzip.test.ts`, `tests/plugins/zip*.test.ts`), serial execution:
  1,944/1,944 passed, zero failures, cancellations, skips or TODOs;
  68,794.8625 ms. This is scoped runtime validation, not full `npm test`.
- `npm run build:workspaces -- --workspace=virtual-bash`: exit 0, six builds
  derived from maintained workspace declarations and dependency closure.
- `npm run typecheck --workspace=virtual-bash`: exit 0, source/tests and all
  26 current consumer groups; three expected exit-2 negative controls.
- `npm run lint:eslint`: complete receipt, exit 0, all 15,505 configured files
  linted, zero errors and four warnings in unchanged files.

The metadata milestone is included in the local commit with its plan and
historical evidence. No push, remote-main verification or release is claimed.
