# GNU grep 3.12 native DEV prerequisite

## Status and scope

One isolated configure/build attempt succeeded on 2026-08-27T14:29:28Z.
This closes only a native DEV-ORACLE prerequisite. It does not reopen or qualify
the closed alias author source `c9bd0dbb05553dc1f1cf9136a4e11ed6a3767bc8` or
evidence `d248861c2ed0ac4148df899cb402918ad5d82355`, and is not candidate acceptance,
a full gate, conflict verification, product parity, or superiority evidence.
No virtual product calls, independent verifier inputs, product edits, package
changes, installs, dependency downloads, source patches, or unrelated comparisons
were performed. The independent verifier owns its separate stress corpus.

`evidence.json` is native prerequisite metadata/captured data, not a canonical
TypeScript input. Only this document and that JSON are committed; source,
executables, scripts, full logs, and build outputs remain in isolated temporary
storage. No test-discovery or configuration changes are needed.

## Retained executable and generated aliases

- Executable: `/private/tmp/safe-bash-gnu-grep-3.12.MJXqupXn/build/src/grep`
- GNU-generated ERE wrapper: `/private/tmp/safe-bash-gnu-grep-3.12.MJXqupXn/build/src/egrep`
- GNU-generated fixed-string wrapper: `/private/tmp/safe-bash-gnu-grep-3.12.MJXqupXn/build/src/fgrep`
- Version: `grep (GNU grep) 3.12`; Darwin arm64 build, not GNU/Linux evidence.
- Executable SHA-256: `e6f4094b2abbe43e2740d6bc32481a1e6bc3de86a754db23c920ddec56a48743`
- Egrep wrapper SHA-256: `6848c4b9df827591f8af3d846c98b4766d262f06c440efb8b6535eb6accac084`
- Fgrep wrapper SHA-256: `e512071d46a7816b96564588c5ebbd1b9189212aa4130e453eb7cdcaabd30f9a`

The wrappers invoke the bare command `grep` with `-E` or `-F`; invoking a wrapper
by absolute path alone does **not** bind its target. Set child `PATH` explicitly
to `/private/tmp/safe-bash-gnu-grep-3.12.MJXqupXn/build/src` (as in this sanity run), or put that exact directory first
in a deliberately constructed PATH. Do not rely on an ambient PATH or install
the wrappers globally. The generated scripts use `/bin/sh`. Recheck artifact
hashes before independent use; temporary storage is not an immutable release.

The clean child environment, wrapper resolution, exact argv, exit status, and
separate stdout/stderr captures are in `evidence.json`. Version checks covered
the binary and both wrappers. The only semantic sanity inputs were two tiny
native-only cases: ERE `a|b` over `a`, `b`, `c`; fixed `a.b` over `a.b`, `axb`.
Each alias matched its direct binary equivalent. Both aliases retained their
exact GNU obsolescence warning on stderr. No warning/conflict holdout was run.

## Primary source and verification boundary

Pinned archive: `https://ftp.gnu.org/gnu/grep/grep-3.12.tar.xz`.
Archive SHA-256: `2649b27c0e90e632eadcd757be06c6e9a4f48d941de51e7c0f83ff76408a07b9`.
The detached `.sig`, primary directory index, and
`https://ftp.gnu.org/gnu/gnu-keyring.gpg` were fetched once via HTTPS; URLs,
HTTP headers, actual sizes, hashes, and curl results are recorded. No redirect
following or alternate mirror fallback was used. This is a pinned version,
not a claim about the latest GNU release.

Existing GPG verified the detached signature with fingerprint
`155D3FC500C834486D1EEA677FD9FCCB000BEEEE` and reported a good signature for
Jim Meyering, but also `TRUST_UNDEFINED` and an uncertified-key warning.
This proves signature validity against the GNU HTTPS-retrieved keyring, not
independent/out-of-band authentication of its owner's identity. The fetched
primary index listed signatures but no checksum manifest; the reported SHA-256
values are measured digests, not a separately published checksum verification.

## Build and isolation

Before execution, inspected upstream `configure.ac`, generated `configure`
option/PCRE logic, `INSTALL`, `src/Makefile.am`, and `src/egrep.sh`; hashes are
recorded. Both `--disable-nls` and `--disable-perl-regexp` are supported upstream.
One out-of-tree configure used those flags plus an unused prefix inside this
temporary root, followed by one `/usr/bin/make -j2`. No `make install`, bootstrap,
network script, source patch, global installation, or dependency install ran.
The source manifest before and after the build is byte-identical. The build
emitted an upstream operator-precedence compiler warning and duplicate-library
linker warnings; exact diagnostics remain in the recorded `make.stderr` capture.

Existing Apple clang 21.0.0 and GNU Make 3.81 were used. Command paths, resolved
Xcode compiler/make paths, hashes, and version outputs are recorded. HOME,
TMPDIR, XDG cache/config/data, GNUPGHOME, source, build, downloads, and output
were explicitly isolated; build PATH was `/usr/bin:/bin:/usr/sbin:/sbin` with
no ambient environment inheritance. No symlinks to repository/private checkout
files were created. macOS's existing `/tmp` alias resolves to `/private/tmp`.

`otool -L` reports only `/usr/lib/libSystem.B.dylib` as a direct dynamic library;
the exact output is in the JSON. PCRE and NLS are disabled, so this is not a
PCRE/localized-message oracle.
OS runtime libraries and `/bin/sh` remain native prerequisites; no product
runtime dependency was added. This is host-local evidence, not a portable binary.

## Bounds, retained evidence, and cleanup

The shared download/configure/build/sanity deadline was 600 seconds, including
the inspection gap; elapsed capture time was 178.727 seconds.
Curl had 10-second connection and 25-second transfer limits, no retries,
and a 16 MiB per-download cap. Configure had a 180-second stage cap; make had
a 300-second cap, both additionally limited by the shared deadline.
Each command's stdout and stderr were independently capped at 1 MiB; exceeding
a cap or deadline stops the attempt. Captures were not truncated in this run.
Processes ran in new sessions/process groups; the supervisor attempted TERM
then KILL cleanup in `finally` and reaped each direct child. All recorded groups
were absent afterward, and the final process scan found no remaining artifact
processes. No build process remains active.

Temporary root: `/private/tmp/safe-bash-gnu-grep-3.12.MJXqupXn`. `state.json`, `control.py`, `build-once.py`,
`record-evidence.py`, full bounded captures under `output/`, downloaded primary
materials under `download/`, and build diagnostics under `build/` remain there.
The JSON commits hashes/paths for larger logs and the exact small captures.
No temporary artifact was deleted, so the independent verifier can use the
binary. After that verifier releases it, the owner may remove only this unique
temporary directory; no global cleanup is needed. No further work is implied.
