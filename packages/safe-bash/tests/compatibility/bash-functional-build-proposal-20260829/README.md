# Functional GNU Bash 5.3.15 reference — trusted-host proposal

2026-08-29. **Feasible in principle under a new explicit trusted-host approval;
activation remains HOLD.** This is SOURCE/DATA analysis, not a build grant, a
containment repair, or a usable new reference binary. All ten future families in
`FUTURE-MATRIX.json` are UNRUN.

## Decision requested

Select a separate functional profile that trusts the authenticated upstream GNU
build recipes, generated programs, installed Apple toolchain/SDK and operating
system. Its purpose is to obtain and identify a real Darwin GNU Bash 5.3.15
reference for later surface observations. Mac /bin/bash 3.2 is only the proposed
build interpreter, not evidence of Bash 5.3 semantics. A compiled Darwin reference
would not prove Linux behavior, every configured feature, or full native parity.

Keep P2 `ff2ebe449eacdfa40763fa0041db7fc0d59d678f` PAUSED, with no build GO. Its
exact-read fence, per-generation execution admission and complete process census
are not supplied by this proposal. Old fenced Node/Bash SIGABRT causes remain
unproved. ROOT's separate trusted-host native37 history supplies neither this
cohort's approval nor a repair of those holds; it was not rerun or rescored.

If the requirement instead is enforced denial of every outside read/write/exec,
complete descendant census, hard aggregate process/storage quotas or an
authenticated whole SDK/system image, **retain HOLD**. A sanitized environment,
PGID and signed tarball cannot provide those guarantees.

## Exact inherited inputs, not fresh native qualification

- Acquisition: `822e82a70dfebc071d3b6e27bc78967afa40a993`. Compressed archive:
  11,355,854 bytes; SHA-256
  `0d5cd86965f869a26cf64f4b71be7b96f90a3ba8b3d74e27e8e9d9d5550f31ba`.
- Signatures: `fe5d87a215310cbe847bee99bbe3c7650aa3f6e3`, retained 16/16
  source-attributed outcomes, fingerprint
  `7C0135FB088AAF6C66C650B9BB5869F064EA74AB`. This review checked the committed
  result's internal consistency, not sixteen fresh cryptographic verifications.
- Prepared source: `efcd8b49a63ceb4276ae9d075da59bfb027b3510`; fifteen retained
  zero-fuzz patches, patchlevel 15, 1,602 final entries, canonical tuple SHA-256
  `75c692f66095ad85848915f50e9357e506ed9664415f48ce6104cafa7269368e`.
  The inventory digest was recomputed as DATA. Eight selected existing upstream
  files were independently size/hash-checked before text inspection; the whole
  live staging tree was NOT reauthenticated here. No source archive was decoded.
- P2 metadata is a finite projection: 49 tool-path observations, 45 present /
  44 distinct files, 48 load-metadata files, four CLT libraries; 366 headers and
  47 stubs, not a closed SDK. The preserved 401 absent header candidates are not
  401 proven missing requirements. No fresh host/SDK census or tool probe ran.

`SOURCE-BINDINGS.json` records exact artifact blobs, sizes, hashes, selected
upstream files and the source-only roles. `HOST-TOOLS.json` is a projection of
prior metadata, not fresh tool authentication or executable permission.

## Eight concrete risks and required dispositions

1. **Trusted native execution is real authority.** Configure compiles, links and
   runs repeated conftest programs (configure:1946–1988). The bash target builds
   and invokes bashversion, mksignames, mksyntax, mkbuiltins and psize.aux;
   config.status is generated shell code, mkversion.sh is signed source script.
   Approve source-recipe-generated execution, not a fictitious pre-exec hash
   for each mutable conftest. Conditional gen-helpfiles remains conditional.
2. **PATH is not an exec fence.** Configure:2438–2451 contains absolute diagnostic
   utility calls, including /bin/arch, /usr/bin/arch and /usr/bin/hostinfo. These
   are not in the prior 41 executable-alias rows. Authenticate the selected
   existing paths/negative observations under a later metadata grant and state
   the source-selected system-utility trust explicitly; do not widen PATH or
   silently call the old table complete. Source calls can also intentionally
   treat a missing optional utility as unavailable. That is not confinement.
3. **Generated helper reachability is larger than one make process.**
   builtins/psize.sh:8,37 tries mktemp, then runs psize.aux piped to sleep 3;
   Makefile.in:636–637 invokes ls and SIZE. Missing mktemp has an upstream
   owned-TMPDIR fallback; SIZE failure is ignored by make. Preserve these
   outcomes, do not fake a complete clean tool census or stub the tools.
4. **Copy timestamps can change the build.** Makefile.in:719–723 regenerates
   y.tab.c from parse.y with YACC. Preserve and seal source-copy mtimes as well
   as bytes/modes; the final inventory does not authenticate mtimes. A copy-order
   accident is not permission to admit bison, touch away a dependency or alter
   upstream recipes. The fifteen patched paths do not include parse.y/y.tab.c.
5. **SDK/loader trust is deliberately broader than the projection.** Retain
   the exact clang/ld/resource/sysroot/deployment proposal, but acknowledge
   unmeasured conditional headers, compiler configuration, system images, caches
   and host services. No Homebrew/user dependency is selected. Unexpected
   observed use outside the approved trust domain is HOLD, not proof that every
   unobserved access was excluded. No network operation is requested/approved;
   this profile does not enforce network or private-file denial.
6. **Ordinary upstream probes include expected failures.** Do not treat every
   compiler nonzero as a build failure, or every configure success as a feature
   qualification. Preserve config.log/config.h/Makefiles and the actual feature
   decisions. Missing libintl.tbd and the clang flags remain unresolved at
   runtime. No feature-disable, alternate compiler, installation or retry to
   force success.
7. **PGID ownership is narrower than child census.** A reviewed external owner
   can enroll direct children, create a dedicated process group, capture pipes,
   signal the group and wait for direct closes. It cannot infer fork/exec counts
   or escaped/reparented descendants from make -j1 or parent exit. Unknown live
   work prevents a clean result. Group emptiness is not proof of no escaped work.
8. **Resource bounds must retain their actual meaning.** Parent capture limits
   and observed deadlines are implementable; periodic work census is a stop
   threshold with overshoot, not a disk quota. Neither a 16,384-start reservation
   nor peak-16 from P2 becomes enforced here. This proposal requests no hard
   transitive start/peak/RSS guarantee. The outer owner itself still needs exact
   source/tool binding and harmless lifecycle qualification before build GO.

## Minimum approval and blockers

ROOT must expressly approve ordinary trusted-host execution of the sealed GNU
recipes and generated code; the stated toolchain/SDK/OS trust; the weaker direct
process/PGID and logical-storage observations; and exact fresh output/capture
paths. An actual tool launch must separately use `require_escalated` with the
concrete reviewed command and user approval. No sudo/root execution, global
installation, private checkout, source vendoring or product fallback is needed.

Before that request: finish the capture-first owner/watchdog source and pinned
launcher closure; resolve additional source-called utility metadata; seal copy
mtimes/aliases/physical roots; reauthenticate all signed inputs and final copied
source; and freeze the actual environment/commands/output judge. Those are
**pre-execution blockers**, not evidence that a trusted build is impossible.

See `EXECUTION-PROPOSAL.md` and `PROPOSAL.json` for the exact proposed
environment and phase commands. No automatic follow-on is authorized.
