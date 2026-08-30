# Source-only extraction and build preparation

Authority: ROOT's 2026-08-29 fresh 30-minute grant, at most 64 owned process
starts / peak 3, 128 MiB capture, 512 MiB working storage including publication.
No configure, make, compiler, generated helper, downloaded source, or Bash runs.
No network acquisition, native oracle, private checkout, or provider-fence claim.

The signed-input authority is verification commit
`fe5d87a215310cbe847bee99bbe3c7650aa3f6e3`, specifically its exact plan,
16 pair outcomes, and machine stdout. Git metadata recovers this identity; the
previous terminal display truncated, not the owned raw stdout/stderr files.
Initial zero-child case-insensitive directory collision and its path-only
correction remain unchanged in verification-v2.

## Finite procedure

1. Capture startup before helpers. Reauthenticate the 33 acquired objects,
   66 authority artifacts, 26 verifier closure identities, all 16 outcome/raw
   status bindings, and the Node controller. No new signature or Bash runs.
2. Stream-hash finite installed patch/build metadata tools. Only pinned patch
   and trusted Apple metadata reader may execute. No compiler/make invocation.
3. Validate the complete decompressed tar before creating a source tree:
   compressed <=16 MiB, tar <=128 MiB, <=10000 entries, each payload <=16 MiB,
   all regular payloads <=96 MiB, pathname <=1024 bytes. Verify tar checksums,
   framing, zero padding, UTF-8 path validity and exact single bash-5.3 root.
   Refuse absolute/dot/dotdot/backslash/control paths, case/normalization aliases,
   duplicate members, special files, privilege bits, and unsupported metadata.
   Links, if present, require a separately resolved contained target; no writes
   through a link ancestor. Do not silently normalize unsafe input.
4. Only after complete inventory succeeds, create a fresh exclusive work/source
   directory. AGENTS-named files are metadata-only excluded entries, never text
   inspection, extraction, patch targets, or runtime evidence. All other archive
   prose remains untrusted DATA; no source instruction text enters captures.
5. Inspect patch header *paths only*, authenticate referenced regular members,
   then apply verified patches 001 through 015 serially with pinned /usr/bin/patch
   using exact sealed argv, zero fuzz, no prompts, fresh HOME/TMP/empty PATH.
   Each patch has a 10-second body deadline and 1-second retirement grace; stop
   on unknown retirement, cap/integrity/safety failure, or unsuccessful patch.
   Capture literal statuses/output, target hashes and complete final inventory.
6. Source-inspect only admitted bounded configure/Makefile/header files; publish
   hash/line-linked findings, not arbitrary prose. Metadata-inspect compiler,
   make, shell, linker/SDK/bootstrap utility dependencies. Propose later build
   commands and explicit remaining admission/fence needs, without running them.

The source-only controller has an absolute 15-minute cap within this grant;
per-child captures <=1 MiB each stream and cumulative <=32 MiB, no renewal.
Up to 15 patch + 8 metadata children are reserved. Development Git/editing and
controller starts remain charged to the outer 64, not hidden in these reserves.
Regular source files are non-executable in the isolated staging tree. Metadata
records retain original modes separately. No installed or product paths change.

Primary format/build references consulted read-only: GNU tar manual, Basic Tar
Format; GNU Bash 5.3 manual, Basic Installation / Installing Bash. No third-party
parser, runtime library, binary, or dependency is added.

## Exact patch-path admission

Authenticated header-only inspection finds old header prefixes `../bash-5.3/`,
`../bash-5.3-patched/`, and `../bash-20250807/`; new headers are relative files.
The source root is `<fresh-owned-work>/bash-5.3`, so each old path resolves to
either the same admitted file or a nonexistent reserved sibling under that
fresh owned work root. All new paths name existing admitted regular files.
Reject any other prefix, mismatch between suffixes, or existing alternate sibling.
Archive member paths themselves still forbid dot/dotdot components. Patch input
bytes are unchanged. Exact argv: `-s -f -F 0 -p0 --posix -d SOURCE -i SIGNEDPATCH`.
The installed bounded patch(1) manual documents these options. No reverse, fuzz,
backup, input rewriting, external command, or interactive response is requested.
