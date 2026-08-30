# Bounded independent long-link correction: root review only

This evidence addresses R4 after the user-authorized `be29e38` archive handoff.
Nothing is staged or committed by this worker. The source change is one fallback
string in `encodeEntry`; the archive README also receives the two requested
capability-honesty qualifications. No other production behavior is changed.

## Result and causal control

The fixture is a single `symbol` symlink whose relative target is exactly
`cross-` + 116 ASCII `x` characters + `.bin` (126 bytes). Native extraction runs
only in newly created, owned temporary directories, with that ordinary target
file preseeded with `independent long-link target\n`. The target is not another
archive member. These are benign writer-interoperability fixtures, not hostile
extraction tests. Both formats use the same 2,560-byte uncompressed archive;
gzip wrapping is Node zlib, not the virtual tar command's streaming compressor.

| Consumer | Baseline plain / gzip | Fixed plain / gzip |
| --- | --- | --- |
| GNU tar 1.35 | exact symlink / exact symlink | exact symlink / exact symlink |
| bsdtar 3.5.3, libarchive 3.7.4 | **empty regular file / empty regular file** | exact symlink / exact symlink |

All eight baseline/fixed native list and extract pairs return status zero.
Success requires actual `lstat` symlink type, exact `readlink` target, correct
bytes read through the symlink, an unchanged seeded target, and no extra names.
Status or listing alone is not acceptance. Baseline semantic cases are 2/4;
fixed semantic cases are 4/4, not a full tar-parity denominator.

The local PAX header is at byte 0; its 140-byte payload is at byte 512. The
following header is at byte 1024, with name `symbol`, typeflag byte `0x32`, and
size zero. Baseline linkname bytes 1181..1280 are all zero; the full target is
already correct in PAX. `control.mjs` independently changes only that raw
linkname to `PaxLink` and recomputes the checksum. The PAX payload, typeflag,
size, and all other bytes remain identical. Both consumers then preserve the
exact full target in both formats. The controlled bytes equal the fixed writer
output byte-for-byte (verified during validation).

This isolates the empty raw fallback as the causally relevant writer defect
for these consumers; it does not claim an inspected libarchive internal call
path. `PaxLink` is a nonempty ASCII single relative component, with no traversal
or absolute path. It is not a truncated or guessed target. PAX still carries
the unchanged complete target; unsupported/non-PAX consumer behavior is not
certified by this correction.

`baseline.json` retains the complete original archive as base64, its exact raw
header and PAX bytes, binary hashes, commands, statuses, bad file types and
sizes. `control.json` retains the independent intervention and all eight
control rows: two intentionally preserved bad BSD observations are **not**
counted as successful product behavior. `fixed.json` records the corrected
output. Original artifacts are not rewritten to green.

## Frozen closure and provenance

The baseline snapshot is at dirty HEAD
`2e3ae8f60bd43955e5ded2b8dc488a2932fea66f`; the fixed snapshot is at dirty HEAD
`565638a655d808d27961df57cc222dfd9ac22dfd`. Both reports retain full before/after
Git status. Other workers advanced HEAD; this is not clean committed-HEAD
validation. The baseline format source is the `be29e38` implementation.

| SHA-256 input | Baseline | Fixed |
| --- | --- | --- |
| `format.ts` | `d2a1106ab7e484aaa2b5ad57c7b17fa7d93ae51cd1f4e54b7ddc34b1d05a14d0` | `30ba491fca428e91e11bc26802f6e69d05f94fdd30ab1c40f5812a4e92827719` |
| Plain archive | `dbdf036554759d9140f01da78e97e974d8445085ce333e3c3acdfa0ecaef5ad0` | `6f9dfdd3025c52a19b62713f4276c4a392d1578a5b9ea3d6fcc851b99f6a011e` |

`baseline-regression.mjs` and `fixed-regression.mjs` are **static, self-contained
direct-format runtimes**, stored as regular files, not source symlinks or
hardlinks. They include the regression input and the entire used JavaScript
runtime closure. Their only external imports are Node builtins, checked against
esbuild's output metafile. There are no live Shell, filesystem adapter, root
plugin, common helper, or installed JavaScript dependency aliases. Normal Node
executes each frozen runtime without tsx/esbuild/TypeScript. The version and hash
of the executing Node binary are recorded; native executables remain external,
explicitly pinned prerequisites, not vendored evidence files.

`*-format.ts.txt` and `*-input.test.ts.txt` are exact regular source/input copies;
the regression input hash is identical in both phases. The JSON reports contain
all compiler input hashes and the complete bundle metafile. Generation used
installed esbuild 0.28.2 with its platform binary, with versions checked against
`package-lock.json` and actual compiler/binary bytes hashed. Lock integrity
strings are retained, **not represented as newly verified registry tarball
contents**. This uses the dependency-free static-runtime alternative, not a
claim to have frozen an installed tsx dependency tree. `capture.mjs` is the
capture recipe and now refuses to overwrite either frozen phase.

## Reproduction from the repository root

No prepare, download, install, network, or native malicious fixture is needed.

```sh
shasum -a 256 -c tests/commands/archive-stress/long-link-evidence/SHA256SUMS

# Always-runnable direct source regression: one top-level test, six targets.
node --unhandled-rejections=strict --import tsx --test tests/commands/archive-stress/long-link-regression.test.ts

# Three top-level tests total; four native consumer/format cases, no skips.
ARCHIVE_LONG_LINK_NATIVE=1 node --unhandled-rejections=strict --import tsx --test tests/commands/archive-stress/long-link-regression.test.ts

# Dependency-free frozen fixed runtime, with and without native cases.
node --test tests/commands/archive-stress/long-link-evidence/fixed-regression.mjs
ARCHIVE_LONG_LINK_NATIVE=1 node --unhandled-rejections=strict --test tests/commands/archive-stress/long-link-evidence/fixed-regression.mjs

# Expected exit 1: original deterministic failure and original BSD failure.
ARCHIVE_LONG_LINK_NATIVE=1 node --unhandled-rejections=strict --test tests/commands/archive-stress/long-link-evidence/baseline-regression.mjs

# Repeats the raw-header intervention; prints new observations, preserves originals.
node tests/commands/archive-stress/long-link-evidence/control.mjs

node node_modules/typescript/bin/tsc --noEmit --target ES2023 --lib ES2023 \
  --module NodeNext --moduleResolution NodeNext --strict \
  --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax \
  --forceConsistentCasingInFileNames --skipLibCheck --types node \
  src/commands/archive/index.ts tests/commands/archive-stress/long-link-regression.test.ts
```

The native flag is explicit; without it only the deterministic test is defined,
not silently skipped. With it, unavailable or changed binaries fail, never skip.
Required GNU binary: `tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar`, SHA-256
`49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66`.
Required BSD binary: `/usr/bin/bsdtar`, SHA-256
`bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9`.
Both version output and binary hash are asserted before native cases run.

## Validation and limits

`validation.json` and its named logs record strict-rejection live deterministic
**1/1**, live native-enabled **3/3**, frozen fixed replay **3/3**, and frozen
baseline replay **1/3 with two preserved failures**, all with zero skips. The
six deterministic target variants cover 100/101-byte ASCII, the exact 126-byte
case, multibyte long and short targets, and a UTF-8 boundary. All archive
production plus the new test passes scoped strict TypeScript checking. The
raw-header intervention replay also matches its recorded eight observations.
Repeated replay observations are not additional independent coverage counts.
The two raw baseline TAP logs retain Node's four whitespace-only diagnostic
lines apiece; a whole-artifact whitespace check flags those eight original
lines. Authored source/test/documentation checks are clean; raw failure logs
are intentionally not cosmetically rewritten.

The existing BSD global-PAX mtime difference and BSD vendor-PAX rejection are
separate and untouched. No unknown-PAX policy, native corpus filter, existing
fixture, filesystem code, root integration, command registration, limit, or
rollback policy changes. The default 64 MiB member limit and configurable limits
remain; there is still no whole-archive rollback. Mode arguments are requested,
not universally enforced; changed-target detection needs observed complete
backing identity and still has no copy fallback. Broader command pipelines,
remote adapters, full GNU/BSD parity, superiority, and 72-hour work completion
are not established by this bounded correction.
