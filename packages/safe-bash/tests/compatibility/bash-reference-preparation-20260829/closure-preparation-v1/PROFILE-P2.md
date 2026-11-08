# Build-specific fence and observation profile P2

Status: Proposed, inactive; no Seatbelt rendering or native conformance result.

Implemented Through: Not applicable. Metadata preseal:
`2ba8bff61c542c6b6d74dd5ee06374d48131b73e`.

Purpose: Describe the finite authority required to build the authenticated GNU
Bash source without granting user/private/repository/network access.

## Boundary and authority

ROOT's present grant permits metadata/source preparation only. This document
does not activate a sandbox, observer, compiler, make, Bash, generated helper,
or native test. The proposed profile is distinct from Faraday's provider-v1;
none of that provider's startup or containment assumptions are inherited.

The build subject consists of configure, make, admitted host tools, and their
owned generated programs. A trusted external supervisor owns admission,
captures, process observations and retirement. Its own evidence writes are
separate from the build subject's write permissions. The source identity is
`75c692f66095ad85848915f50e9357e506ed9664415f48ce6104cafa7269368e`.

## P1 → P2 source-backed correction

P1 remains preserved as an inactive proposal. Two static findings refine it:

1. The actual `/private/var/select/sh` symlink points to `/bin/bash`. Installed
   sh(1) documents re-exec dispatch. Thus P2 returns to the original proposed
   `/bin/sh` configure entry and permits ONLY the pinned /bin/sh and /bin/bash
   interpreter pair, with exact selector metadata reauthentication. Other
   fallback shells are NOT allowed. No shell was executed to make this finding.
   P1's direct-Bash alternative was a proposal, not an observed build result.
2. GNU 5.3 Makefile.in:696 invokes source `support/mkversion.sh`, not a presumed
   `mkversion` executable. Makefile.in:113,118,633,639,643 instead binds the
   generated `bashversion` helper to the bash target's `.build` prerequisite.
   builtins/Makefile.in:250–256 binds `psize.aux`; :215 shows conditional
   gen-helpfiles. P2 removes the unsupported mkversion binary allowance and
   records these actual helper edges. No old result is rescored.

## Required filesystem and execution restrictions

The renderer MUST default-deny and consume the exact P2 JSON file bindings.
It MUST NOT substitute broad /usr, /System, SDK, toolchain, home or repository
read permissions. Existing SDK directory metadata is not a byte-integrity claim.

- Read data: exact authenticated tools, four CLT libraries, selected SDK/resource
  headers and stubs, SDK metadata, dyld/cache files, and the owned source copy.
  Runtime system-image paths remain logical names backed by cache identities,
  not independently demonstrated image membership or actual loader events.
- Read metadata: necessary exact ancestors, admitted paths, exact selector, and
  recorded negative SDK candidates. Unknown SDK reads must be observable refusals;
  configure must not silently mistake a policy-denied header for a missing feature.
- Writes: only fresh canonical `<B>/build`, `<B>/home`, `<B>/tmp`, `<B>/out`.
  Owned source, tool aliases and profile are read-only to build subjects.
- Execute: exact installed-tool path bindings/aliases and separately admitted
  generated paths. No executable-directory wildcard. Preserve argv0 semantics
  for the ranlib alias whose resolved executable is libtool.
- Network, user home, repository/private roots and unlisted IPC: deny.
  Mach-service exceptions are empty, not a hidden permissive default. Any
  demonstrated required service needs a new exact reviewed rule before replay.
- Device proposals are only null/random/urandom; no tty, user preference or
  credential access. Denials must not be auto-whitelisted from failed probes.

The renderer/backend is not implemented or syntax-validated here. JSON policy
bindings are NOT proof that a Seatbelt program enforces these operations.

## Exact proposed commands and toolchain

Fresh build cwd `<B>/build`:

```text
/bin/sh <B>/source/configure --prefix=<B>/out --cache-file=/dev/null
/Library/Developer/CommandLineTools/usr/bin/make -j1 bash
```

Only the bash target, one make job, no installation/docs/tests. Default upstream
shell features and bundled Readline; no --disable-* feature flags. Output is
hashed/inspected before copying to `<B>/out/bash-5.3.15`; a later three-second
`--noprofile --norc --version` observation is separately charged, not a native
compatibility suite or a source-version-equals-executed-version assumption.

Exact proposed compiler command for CC and CC_FOR_BUILD:

```text
/Library/Developer/CommandLineTools/usr/bin/clang -isysroot /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk -resource-dir /Library/Developer/CommandLineTools/usr/lib/clang/21 --ld-path=/Library/Developer/CommandLineTools/usr/bin/ld -mmacosx-version-min=26.4
```

The resource directory name is not an executed compiler-version claim. The
installed driver's support for these flags remains UNRUN; failure must not
trigger silent flag removal or ambient linker fallback. The explicit 26.4
deployment proposal acknowledges SDK 26.5 versus host 26.4.1/25E253.

Fresh environment: HOME/TMPDIR/PATH inside `<B>`; LANG=LC_ALL=C, TZ=UTC, TERM=dumb;
CONFIG_SITE=/dev/null; CONFIG_SHELL=SHELL=/bin/sh; pinned CC/CC_FOR_BUILD,
AR/RANLIB/MAKE; CFLAGS=CFLAGS_FOR_BUILD=-O2; exact SDKROOT/DEVELOPER_DIR and
MACOSX_DEPLOYMENT_TARGET=26.4. No inherited BASH_ENV/ENV/functions, user flags,
credentials, agents or DYLD injection. No global installation or new software.

## Generated code and process census: required, not implemented

The prospective helper set is configure's repeated `conftest`, `bashversion`,
`mksignames`, `mksyntax`, `builtins/mkbuiltins`, `builtins/psize.aux`, and
conditionally `builtins/gen-helpfiles`. The source mkversion.sh and generated
config.status are shell scripts, not new host executables. Exact configured
Makefile reachability/argv and output hashes must be captured before treating a
conditional edge as exercised. Unlisted generated programs must stop admission.

A path-based process-exec rule does NOT authenticate the hash of a mutable
conftest at each generation. Nor does allowing an interpreter authenticate its
inline code, stdin or script argv. Required recipe/input/output bindings and
per-generation admission therefore need a separately demonstrated implementation;
they are not magically supplied by Seatbelt or this metadata inventory.

The census MUST distinguish process birth, same-PID exec, exit, PID reuse,
fork-only children and spawned grandchildren, with pre-launch subscription and
loss detection. Polling, command tracing, make -j1 and waiting for the top-level
process are insufficient proofs. Installed eslogger is metadata-bound only:
its root/TCC requirements, usable event schema, descendant filtering and loss
behavior were not exercised. Unfiltered host event capture is not authorized.

Notifications may arrive after a burst. Neither an observed count nor kill on
notification proves a hard pre-fork peak/start cap. No such hard-enforcement
claim follows here. ROOT must receive an actual qualified observation/enforcement
protocol before accepting the corresponding process-cap guarantee; no relaxed
counter policy is selected in this document. Unknown retirement or event loss
is a STOP, with no automatic retry.

## Frozen future probe matrix — all UNRUN

Each probe uses only benign owned canaries, no real secrets/private data. The
same proposed build profile must apply; changing the profile per probe is not
positive evidence. A source-bound probe executable itself needs a separate
trusted creation/admission plan before native execution can be requested.

| ID | Required observation |
| --- | --- |
| F01 | Pinned bootstrap + selector re-exec allowed; unlisted shell denied. |
| F02 | Exact tool/header/stub reads succeed and bytes match bindings. |
| F03 | Read harmless owned canary outside allowed roots is denied. |
| F04 | Harmless repository/home-root canary denied, without reading real secrets. |
| F05 | Owned build write succeeds; outside write is denied with no file effect. |
| F06 | Symlink/path traversal cannot redirect allowed reads/writes outside root. |
| F07 | Loopback TCP/UDP denial; no connection/datagram reaches owned observer. |
| F08 | Exact host tool allowed; unrelated executable path denied. |
| F09 | Approved generated output generation allowed; replacement/unadmitted generation rejected by actual admission layer. |
| F10 | Forged inline/interpreter input not falsely attributed to sealed source; boundary accurately reported. |
| F11 | Fork, exec, fork-only child, grandchild and same-PID re-exec counted once per declared event role. |
| F12 | Rapid bounded child cohort + event-loss control; no polling-based completeness claim. |
| F13 | Caller cancellation/deadline drains known descendants before settlement; escaped-group case explicitly accounted. |
| F14 | Output cap, startup refusal and cleanup failure retain raw evidence and terminal STOP disposition. |

No F row has executed. A valid failed probe blocks activation; expectations are
not relaxed or replaced with a broader profile to manufacture acceptance.

## Finite future request (not this grant)

Retain the 45-minute / 16,384-all-start / peak-16 / 128-MiB capture / 2-GiB working
proposal. Phase maxima now explicitly include probes: admission 120 s, probes
420 s, configure 900 s, make 900 s, version/metadata 60 s, cleanup/publication
300 s = 2,700 s. All phases clamp to the same remaining deadline, no resets.
Single ordinary tool/compiler body <=120 s, version <=3 s / 64 KiB per stream;
one general stream <=8 MiB, cumulative <=128 MiB. No forecast that a build fits.

These are requested ceilings, not demonstrated hard enforcement. Probe-only GO
is the practical next step after exact renderer/census/generated-admission
preparation; successful metadata alone is not enough for actual build GO.

## Evidence and open conditions

Observed: 49 tool paths, 45 present/44 distinct files, 48 files with load-command
metadata, four exact CLT libraries, zero unresolved non-system rpath edges in
that finite static graph, 123 system-image edges. 366 header files (2,911,692
bytes) and 47 stubs (863,546 bytes), not the whole SDK. All 401 absent literal
header candidates are retained; many are alternative search-root candidates,
not 401 missing required headers. No candidates were left unprocessed under
this lexical expansion, but macro/conditional/include_next compiler selection
and complete actual read closure remain unproved. libintl.tbd is absent;
configure's actual default localization decision is UNRUN, not forced disabled.

Open: backend rule rendering/activation, required runtime image/service reads,
driver flag support, actual configured helper graph, per-generation admission,
safe complete descendant census, loss/overshoot/retirement guarantees, and all
F01–F14 observations. No provider-v1, full-SDK or full-Bash parity claim.
