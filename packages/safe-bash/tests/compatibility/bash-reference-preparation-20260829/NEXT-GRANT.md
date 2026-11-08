# Proposed separate oracle grants — not execution authority

## A. Acquisition and provenance completion (minimal next request)

Assign to the existing Faraday provider owner, avoiding a second builder.
Proposed finite ceiling:15min including cleanup,32all process starts, peak2,
32MiB capture,128MiB owned scratch. No compiler/configure/build/new Bash execution.
If source/member expansion needs more than128MiB, stop and present a new bounded
proposal; do not silently expand. No retry after safety/integrity/retirement stop.

Reserve a fresh0700 regular owned tree under
`/tmp/safe-bash-bash53-oracle-<grant-id>/` with `downloads/`, `verification/`,
`source/`, `build/`, `artifact/`, `home/`, `tmp/`, `logs/`. Names are proposed;
ROOT must bind actual unique paths before launch. No symlink into private/source
checkouts; no global install and no modification of shell startup files.

Allow only official HTTPS artifact paths: `bash-5.3.tar.gz` and its `.sig`,
`bash-5.3-patches/bash53-001` through015 and each `.sig`, plus GNU's explicit
keyring/project-key endpoint after its metadata admission. At most34artifact
requests (32source/signature objects plus at most2keyring objects), no arbitrary
redirect/mirror fallback. Body ceilings: base16MiB, each patch64KiB, each signature
4KiB, each keyring4MiB; cumulative32MiB. Streamhash before publication, record
size/mode/finalURL, reject status/length/change violations; don't treat checksums
as signer authenticity. Retain public data, not credentials/ambient environment.

Authenticate the full Bash maintainer primary/subkey fingerprints from official
project authorization plus corroborating primary evidence; any unresolvable
signer decision returns to ROOT. Use only a separately admitted existing gpgv
and dependency closure, with isolated empty home and exact admitted keyring,
offline/no keyserver, explicit signature+payload operands. This future verifier
invocation needs ROOT permission; it has not occurred. Record verification
status/fingerprints for **all16** payloads, including patches signed with a
different subkey if observed. Do not infer key identity from signature sizes.

Before materialization, authenticate archive members and bounded expansion;
reject absolute/traversal/duplicate/escaping links/devices and unsafe ownership
or permission effects. Preserve permitted upstream modes/licenses. Review
README/INSTALL/configure inputs as DATA. Establish base `patchlevel.h`; preseal
exact official patch sequence and zero-fuzz/no-reverse/no-unexpected-path policy.
No patch command is part of acquisition permission unless explicitly added.
No loose source blob is committed to this repository.

## B. Later isolated build and binary admission (new GO required)

After A, freeze all executable hashes/modes and dependencies: bootstrap `/bin/sh`
(not surveyed here), required text/file tools, make, compiler subprocesses,
assembler/linker, headers/SDK, runtime libraries/dyld and signature verifier.
Do not assume `/usr/bin` launcher metadata admits whatever it chooses, or that
SDK directory metadata closes its contents. No automatic xcrun/brew fallback.

GNU documents out-of-tree configure followed by make. Keep release configure
and generated parser files; no autoreconf or broad tool regeneration. Use
default upstream features, bundled Readline, owned installation prefix, serial
make and one consistent admitted SDK/toolchain. No feature-disabling configure
flags, source edits, fixture-conditioned patches or global `make install`.
Inspect actual recipe before fixing argv/target; restrict target to required
oracle artifact where supported without changing its semantics.

Construct env from scratch: `LC_ALL=C LANG=C TZ=UTC`, owned HOME/TMPDIR,
explicit admitted tool-only PATH and CC/SDK bindings. Set CONFIG_SITE to an
admitted empty owned file to prevent host site defaults. No inherited BASH_ENV,
ENV, exported functions, SHELLOPTS/BASHOPTS, CDPATH, compiler flags, credentials,
DYLD injection, user configs or network during configure/build.

Planning ceiling (not granted, not a forecast):30min,4096all starts, peak8,
128MiB capture,1GiB owned working including cleanup. Serial make still involves
shell/compiler/linker descendants;64metadata starts cannot be reused as a build
budget. Source inspection must yield a concrete process/capture schedule before
GO; reduce planned concurrency or stop if it cannot fit. Count forks including
configure conftests and helpers, not only direct Node spawns. External observer
must establish exact owned-process retirement and block writes/network/exec
outside the admitted closure; direct-child exit alone is insufficient. Unknown
ownership or missing capture stops, with no hard-preemption/RSS promise.

After build, streamhash executable, preserve source/patch/config/log/feature and
license bindings; inspect dependency closure without executing arbitrary content.
Only separately authorized identity probes may establish `--version`,
`BASH_VERSINFO`, patch15 and host profile. A Darwin build is not Linux semantics.
Validate absence of ambient startup effects, correct cleanup, and provider fence
with bounded harmless controls before any differential case. No loadable builtin
or network is granted merely because upstream supports it.

## C. Existing40-case reference proposal (separate runtime GO)

Use Curie's frozen40 cases and Faraday's admitted provider, not this sidecar as
an oracle. Direct absolute binary with `--noprofile --norc -c`, exact argv/input,
owned cwd/HOME and empty command PATH. No implicit POSIX/compat-mode forcing.
Retain GNU5.3.15 host-specific outputs/status/effects and errors as observed.
Curie's proposed10min/128all-descendants/peak8/3s-percase/64MiBcapture/128MiBwork
is a separate unexecuted plan, not a build allowance or observed qualification.
Preserve GPL notices/source/build records for any later redistributed artifact;
no Bash binary/source enters runtime dependencies, npm package or root exports.
