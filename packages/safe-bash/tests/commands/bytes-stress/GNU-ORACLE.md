# Pinned GNU byte references

Captured on August 26, 2026: Darwin 25.4.0 arm64, Node v22.22.2,
Apple clang 21.0.0 (`clang-2100.1.1.101`). These are deliberately pinned
reference versions, not a claim to use the newest releases.

## Provenance

| Archive | SHA256 | Release announcement |
| --- | --- | --- |
| `gzip-1.14.tar.xz` | `01a7b881bd220bfdf615f97b8718f80bdfd3f6add385b993dcf6efd14e8c0ac6` | `https://lists.gnu.org/archive/html/info-gnu/2025-04/msg00007.html` |
| `coreutils-9.7.tar.xz` | `e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf` | `https://lists.gnu.org/archive/html/coreutils/2025-04/msg00025.html` |

Both official `ftp.gnu.org` archive SHA256 values were checked before extraction.
Detached signatures from that server also verified with its `gnu-keyring.gpg`
inside a private temporary GnuPG home. `VALIDSIG` matched the announcement pins:

- gzip: `155D3FC500C834486D1EEA677FD9FCCB000BEEEE` (Jim Meyering).
- coreutils: `6C37DC12121A5006BC1DB804DF6FD971306037D9` (Pádraig Brady).

GnuPG reported good signatures and undefined local owner trust; this is not a
claim of an independently established web-of-trust identity. Captured binary
SHA256 identities are in `gnu-evidence.json`. Rebuild hashes may differ because
of compiler, host configuration and build paths. Live tests require the pinned
version and exact captured results, not identical rebuilt binary hashes.

`gnu-evidence.json` contains **59 GNU observations** (four gzip dialect cases,
ten encoder cases, 45 digest manifest/flag cases) and **four Apple observations**.
`gnu-gzip-boundaries.json` contains **47 more GNU observations**, including
resulting files for warning-status publication. Every observation binds its
command, argv, input and initial files through `caseSha256`. Tests pin the entire
evidence files as well. Capture scripts invoke native programs only; they never
derive expectations from the virtual implementation. Diagnostic bytes are
preserved exactly; virtual comparisons use exit status, exact stdout bytes,
diagnostic presence/category and resulting file bytes, not host-specific wording.

## Four resolved dialect cases

| Exact input/mode | GNU gzip 1.14 (selected) | Apple gzip 479 (preserved) |
| --- | --- | --- |
| Empty stdin, `-dfc` | Status 0, empty stdout/stderr | Status 1, unexpected EOF |
| One byte `1f`, `-dfc` | Status 0, stdout `1f`, empty stderr | Status 1, unexpected EOF, empty stdout |
| Stored-DEFLATE `payload` member plus eight NULs, `-t` | Status 0, empty stdout/stderr | Status 2, trailing-garbage warning |
| Same member with header flag `20` hex, `-t` | Status 1, empty stdout; encrypted/unsupported diagnostic | Status 0, empty stdout/stderr |

These are not GNU bugs inferred from Apple behavior. GNU `gzip.c:get_method`
explicitly permits short forced passthrough, ignores trailing zero bytes by
default, and rejects flag `0x20` (its historical encrypted flag, a reserved bit
in RFC 1952). No valid expected result was edited to fit virtual output. The
old four equality-to-Apple TODOs are replaced by GNU-selected frozen tests plus
a live test preserving all four Apple results, not a renamed Apple parity pass.

## Genuine divergences fixed

The byte-split rerun exposed `Premature close` after valid zero padding despite
the original whole-buffer case succeeding. Node Gunzip could finish before its
upstream pipeline did. It also silently accepted zero-prefix garbage, reported
ordinary trailing garbage as error 1 rather than GNU warning 2, and failed to
preserve plaintext suffixes under forced stdout decompression. Forced `-t`
accepts non-gzip data under GNU; it still suppresses stdout. File-output `-f`
does **not** enable passthrough: warnings publish validated members, retain with
`-k`, otherwise remove the original only after safe publication.

The command now parses gzip framing itself around bounded Node raw-DEFLATE
streams, checking optional fields/header CRC, per-member CRC32/ISIZE and
truncation. It separates valid members, zero padding, incomplete next headers,
warning-only garbage and forced passthrough without buffering the archive.
The 47-case matrix runs across input chunk boundaries; original lifecycle,
256-MiB staging-limit, corruption, publication-safety and pipeline tests remain.

## Rebuild and rerun without installation

The following downloads optional **test tooling**, never runtime dependencies.
Run from the repository with `curl`, `tar`, a C compiler and `make` available.
No `make install`, package-manager installation, root access or persistent PATH
change is needed. Configure/build logs stay under the temporary directory.

```sh
ORACLE_ROOT=$(mktemp -d "${TMPDIR:-/tmp/}safe-byte-gnu.XXXXXX")
curl --fail --location https://ftp.gnu.org/gnu/gzip/gzip-1.14.tar.xz -o "$ORACLE_ROOT/gzip-1.14.tar.xz"
curl --fail --location https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.xz -o "$ORACLE_ROOT/coreutils-9.7.tar.xz"
node --input-type=module - "$ORACLE_ROOT" <<'NODE'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
for (const [file, hash] of [
  ['gzip-1.14.tar.xz', '01a7b881bd220bfdf615f97b8718f80bdfd3f6add385b993dcf6efd14e8c0ac6'],
  ['coreutils-9.7.tar.xz', 'e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf'],
]) assert.equal(createHash('sha256').update(readFileSync(`${process.argv[2]}/${file}`)).digest('hex'), hash);
NODE
(cd "$ORACLE_ROOT" && tar -xf gzip-1.14.tar.xz && tar -xf coreutils-9.7.tar.xz)
(cd "$ORACLE_ROOT/gzip-1.14" && ./configure --disable-dependency-tracking > ../gzip-configure.log 2>&1 && make -j4 > ../gzip-build.log 2>&1)
(cd "$ORACLE_ROOT/coreutils-9.7" && ./configure --disable-nls --disable-dependency-tracking > ../coreutils-configure.log 2>&1 && make -j4 > ../coreutils-build.log 2>&1)
export BYTE_GNU_GZIP="$ORACLE_ROOT/gzip-1.14/gzip"
export BYTE_GNU_COREUTILS_DIR="$ORACLE_ROOT/coreutils-9.7/src"
node --unhandled-rejections=strict --import tsx --test tests/commands/bytes/plugin.test.ts tests/commands/bytes/*/*.test.ts tests/commands/bytes-stress/*.test.ts
```

The initial coreutils configure also received `--without-gmp`, which it warned
was unrecognized; it had no effect. An initial direct build of selected `src/*`
targets failed because generated gnulib headers were missing. Ordinary `make`
built the generated prerequisites and all tools successfully without modifying
the release sources. The recipe above omits the ineffective flag and failed
shortcut. The five requested coreutils binaries and GNU gzip then ran directly
from their build trees.

To independently recapture for review, run `capture-gnu-reference.ts` or
`capture-gzip-boundaries.ts` with `node --import tsx` and those environment
variables. They print JSON; they do not overwrite frozen evidence. The first
capture also requires Apple gzip 479 to preserve its historical dialect matrix.
Live replay does not overwrite files either.

## Denominators and remaining limits

The gzip checkpoint `1c3d7cb` passed **376 tests, zero failures/skips/TODOs**.
After the decoder correction, the GNU-enabled final run passed **381 tests,
zero failures/skips/TODOs**. All
five originally absent GNU coreutils tests executed, rather than being renamed
or skipped. The frozen five command groups always run with no downloaded tool;
optional live checks explicitly skip when their binaries are unavailable.
With optional GNU variables unset the measured run is **373 passes and eight
explicit external-oracle skips**, zero failures/TODOs. The five original GNU
checks and three new live-replay groups skip; all 240 frozen GNU observations
still run. An Apple-only run is not claimed to execute GNU checks. External VFS-provider
durability, permissions, races and cooperative cleanup remain unverified here.
This is bounded utility evidence, not complete GNU compatibility or superiority.

## Decoder follow-up

The same pinned coreutils 9.7 binaries confirmed genuine divergences beyond the
five original valid-data checks: canonical unpadded `Zg`/`MY` succeed; partial
padding can fail after output; `Zh==`/`MZ======` emit `f` and fail for nonzero
unused bits. The old stricter policy was not a GNU/BSD exception and was fixed,
not relabeled unsupported. The implementation keeps a bounded quantum and
validates its remaining bits, exposing already-decoded prefixes and performing
GNU EOF padding. The GNU source `src/basenc.c:do_decode` documents EOF auto-pad;
the native observations, not copied implementation code, define these tests.

`gnu-decoder-evidence.json` pins **134 independent native observations** with
input hashes, command identities and exact output/status/stderr. Its SHA256 is
`6676fffacfe2718098b322c4f3bb1861f4950bbfabd80a330738162c8bed56c9`.
The tests replay every case at four virtual chunk widths, while a separate live
test checks the original native observations. Capture for review with
`node --import tsx tests/commands/bytes-stress/capture-decoder-reference.ts` and
`BYTE_GNU_COREUTILS_DIR`; the script prints JSON and does not overwrite evidence.
Two pipeline tests cover unpadded decoding through gzip/checksums and observable
partial bytes plus a failing pipefail status. A separate deterministic 256-case
native mutation probe also passed; it is additional evidence, not included in
the 381-test denominator. No source/manifest/runtime dependency outside the
owned byte subtree was changed.
