# ZIP remaining-features evidence and qualification plan

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
