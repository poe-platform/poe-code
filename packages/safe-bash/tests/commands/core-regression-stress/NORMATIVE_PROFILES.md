# Normative semantics versus native profiles — August 27, 2026

This read-only check does not change source, permission APIs, old expectations,
or strict comparison scores. It re-examines the recorded env and SGID evidence,
not new permission fixtures. Twelve primary publications/source files were
fetched; URLs, versions and content hashes are in
`evidence/normative-profile-sources.json`. No privileged setup was performed.

## Environment ordering

The captured executable is **GNU coreutils9.7 built for Darwin arm64**, a Mach-O
binary linked to Apple's `/usr/lib/libSystem.B.dylib`, on macOS26.4.1 build25E253,
Darwin25.4.0. This is not a GNU/Linux/glibc capture. Its SHA256 remains
`1026eb36ffd2fdca6d064c0ffd6dd99ceb7bb3f49ec5e804df2c53bef372dbf0`.

The configured GNU build maps putenv to gnulib's rpl_putenv; its bundled
`lib/putenv.c` prepends newly introduced names and replaces existing names in
place. Thus the observed insertion rule belongs to this build/profile, not a
portable GNU promise or a claim that Apple's native putenv prepends. GNU env's
source delegates insertion to putenv and prints the resulting environ vector.
The inspected glibc2.42 implementation instead adds new names at the end; that
is source analysis, not a Linux execution result.

POSIX.1-2024 XBD8.1 assigns no meaning to environment-string order. XCU env
requires one name=value record per line when there is no utility, but specifies
no sorting or insertion-order guarantee. For this fixture there are no duplicate
names, malformed names, or newlines in values to complicate map equivalence.

| `env -i A=1 B=2` | Exact stdout | Status/stderr |
| --- | --- | --- |
| Pinned GNU9.7/Darwin | `B=2\nA=1\n` | 0 / empty |
| Apple `/usr/bin/env` | `A=1\nB=2\n` | 0 / empty |
| Virtual implementation | `B=2\nA=1\n` | 0 / empty |

The environments are semantically equivalent for this input, while the Apple
byte-order comparison is a strict profile mismatch. Retain that failed row and
its original capture. Do not advertise a portable correctness win, generalize
the Darwin GNU order to all GNU builds, or reverse the selected implementation
merely to make the Apple/historical oracle pass.

## SGID classification

I read and hash-checked the committed277a635 archive and d7a8179 classification.
Their measured six cases use `chmod -- u-s,g=s,o-t NAME`, umask027, caller
uid/euid501 and gid/egid20 with supplementary groups excluding0, and owned
objects uid501/gid0. All layers calculate/request02707. The three initial modes
04777/00777/01777 are tested on both a regular file and directory:

- GNU9.7/Darwin: status1/EPERM, unchanged original mode and metadata.
- Node22.22.2/libuv1.51.0, RealFS and its actual command: status0, mode00707.
- MemoryFS: status0, mode02707; it does not reproduce host credential policy.

These are archived observations, not a fresh native replay or six new tests.

**Primary POSIX findings:** XSH chmod requires SGID to be cleared on successful
return for an unprivileged regular-file caller outside the target group, and
allows implementation-defined restrictions to ignore set-ID bits. Therefore
success with0707 is permitted and fits the regular-file clearing rule; failure
with no changes is not required merely because the requested mode includes
SGID. Directory set-ID behavior has additional implementation latitude under
XCU chmod. None of this is a certificate of complete backend/POSIX conformance.

XSH also requires fchmodat(AT_FDCWD,path,mode,0) to behave identically to chmod
for the same path. The archive's native trace shows GNU calling that fchmodat
form. The matched Apple UNIX03 wrapper first tries raw __chmod, and on EPERM
retries without SGID; it explicitly identifies this treatment as a conformance
wrapper. Node calls uv_fs_chmod, whose Unix implementation calls public libc
chmod. GNU9.7 calls fchmodat and reports its failure. The differing public API
paths explain the observation without a mode parser error, swallowed Node
error, or two differently authorizing kernel implementations.

**Classification:** the GNU status1/unchanged-mode requirement is exact
**GNU9.7-on-this-Darwin profile emulation**, not a demonstrated universal GNU
or POSIX requirement. Node's success/clearing is not proven wrong by that oracle.
The measured chmod/fchmodat difference is an apparent Darwin API conformance
inconsistency; do not present it as an intentional portable GNU semantic rule.
This is a source-supported interpretation, not an upstream adjudication or
signed verification of Apple's installed shared cache/kernel.

Unlike the env-order row, **the SGID outcomes are not semantically equivalent**:
statuses and final modes really differ. All six strict native mismatches remain
recorded; no denominator or golden value changes. If root explicitly retains
that precise Darwin profile as an emulation requirement, it remains unmet.
That is a separate product-policy choice from providing a Node-backed chmod
operation or portable permission semantics. A new authority API is not justified
solely as a mandatory POSIX correction by these observations. Post-stat failure
or rollback would not recreate GNU's original no-effects result safely.

## Linux and safety boundaries

No already-available local Linux runtime was found in the checked executable
paths/common Docker or Colima locations. **No Linux native control was run**;
no VM/container was started, downloaded, or provisioned. Linux6.12 source's
setattr_prepare clears unauthorized SGID during mode processing, corroborating
why a Darwin-only result must not be generalized, but this is not measured
GNU/Linux compatibility or proof about every filesystem/security module.

This classification neither relaxes output budgets nor excuses the eight real
double-accounting rows. Their subsequent unchanged f7000b0 acceptance is
recorded separately in `OUTPUT_ACCOUNTING_REVIEW.md`.

## Primary references

All are independently read; the manifest holds fetched content hashes. POSIX
2024 pages were fetched directly from the publisher, not inferred from a manual
summary. The corresponding licensed POSIX2017 manual reproductions corroborate
the same relevant rules but are not mislabeled as the2024 edition.

- POSIX XBD8.1: `https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap08.html`
- POSIX env: `https://pubs.opengroup.org/onlinepubs/9799919799/utilities/env.html`
- POSIX chmod function: `https://pubs.opengroup.org/onlinepubs/9799919799/functions/chmod.html`
- POSIX chmod utility: `https://pubs.opengroup.org/onlinepubs/9799919799/utilities/chmod.html`
- Apple XNU5c306bec, `libsyscall/wrappers/unix03/chmod.c` (exact URL in manifest).
- Node v22.22.2, `src/node_file.cc`; libuv v1.51.0, `src/unix/fs.c`.
- GNU coreutils v9.7, `src/chmod.c`, `src/env.c`, `doc/coreutils.texi`, plus
  the locally configured replacement source/header hashes.
- glibc2.42, `stdlib/setenv.c`; Linux6.12, `fs/attr.c` (source-only controls).
