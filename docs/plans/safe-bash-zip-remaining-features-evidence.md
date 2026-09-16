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
