# Independent WHICH normative freeze v1

August 27, 2026. Root has approved author base `5c34372b` and permission delta
`c82a7fc9`. The latter supersedes mode eligibility: **followed regular-file stat,
then the same VFS's X_OK**. No permissions/read-only capability gate, mode-bit
fallback, host UID/ACL inference, native lookup or invented registry path exists.
These are independent fixtures frozen before WHICH implementation, after policy
inspection. They are not candidate passes, native observations, public wiring or
an execution/atomicity guarantee. Root controls the author's implementation release.

## Exact binding and counting

`FREEZE-v1.json` binds both approved documents, their retained primary-source
evidence, the existing shared interfaces, all new fixture inputs and the original
draft/observations. `cases-v1.json` resolves all **28 draft families** in their
original identity order: B01–B18, L01–L04, C01–C02, T01–T04. `cohort-v1.mjs`
provides 24 behavior/limit/cancellation groups plus runtime controls for the two
type families T02/T03; `types-v1.json` provides four strict declaration families.
Do not add those overlapping family counts into a claim of 30 unique families.
Looped reason/error/boundary vectors are controls within a family, not separate
native corpus cases. No runtime or type family has been executed at this seal.

`README.md`, `draft-cases.json`, all twelve old type-path observations and their
verifier stay byte-for-byte historical. That draft's proposed 1 MiB/100k/1 MiB
limits are NOT the approved limits. The new defaults are 4096 argument entries,
65536 argv bytes, 65536 PATH bytes, 4096 PATH components, 16384 bytes per cwd/
display/absolute lookup, 65536 logical candidates and 8388608 stdout bytes.
Stderr is a separate single diagnostic allowance of maxPathBytes+256. Each probe
permits stat and then at most one access; it is not two probes and does not bound
backend-internal work. Limits are positive safe integers; maxPathBytes has the
additional MAX_SAFE_INTEGER-256 bound. Quiet mode consumes probes but no stdout.

## Deliberately different controls

- Rely on the provider's effective access decision: real ReadOnly(Memory)
  success, absent/false permission capabilities, successful access with mode0000,
  Memory owner-execute denial and nonregular-stat/no-access controls.
- S3-like EACCES and WebDAV-like ENOTSUP are fault profiles, **not remote-service
  tests**. Ordinary actual FsError misses continue; other typed failures stop
  with the exact bounded description, preserving prior output. Code-shaped and
  raw/falsy exceptions do not masquerade as typed misses. Access is no lease and
  two successful observations do not prove unchanged identity or future launch.
- Input stays literal. Absent PATH quietly misses even slash operands; empty
  components mean '.', duplicate/trailing slashes are retained, no deduplication
  or output canonicalization. Parsing stops at first operand, including '-'.
- The trace-only facade allows stat/access, rejecting content/mutation/link and
  borrowed-stream/ownership operations. The B13 isolated surrogate subcontrol
  uses an explicitly UTF-8-replacement-naming backing facade: traced lookup bytes
  must still originate from literal argv; it does not impose that normalization
  on the product or all providers. The rest uses actual Memory and ReadOnly.
- Direct-handler cancellation/sink rejections retain exact identity. Custom
  raw-undefined signal coverage is preaborted only; native abort(undefined)
  retains its native AbortError. Shell mapping is tested separately in B18, not
  mislabeled direct-handler rejection. Cooperative provider teardown and late
  sink rejection are controlled; opaque metadata work is not preempted.
- No command-owned cleanup is invented: which never acquires stdin or closes
  caller sinks. Metadata-only means no explicit content/mutation/copy-up, not
  a promise of native/provider directory-atime immutability.

## Replay boundary and planned weakening checks

Syntax/hash checks do not import product code. A future authenticated isolated
Git extraction must build its own declarations/JS and run the frozen cohort
with `WHICH_CANDIDATE_ROOT` pointing at that extraction. The driver only imports
explicit `dist` module paths; it refuses the live repository and has no source
fallback. It does not by itself authenticate all transitive modules: the
candidate reviewer must add an external loaded-module hash guard and retain the
resolved closure, source/tool versions and initial failures. Product/API absence
is not a candidate failure now. Type strings compile against the same built
extraction, outside canonical TypeScript discovery; root/subpath exports are
intentionally not required until separately authorized.

Bounded future weakening controls: permission-capability gate; any-mode-bit
fallback; access-before-stat/nonregular access; swallowing ENOTSUP; treating
code-shaped errors as misses; absent-PATH cwd fallback; spelling normalization/
deduplication; option parsing after operands; per-provider-call probe counting;
quiet-mode probe bypass; UTF-16 output counting; sink-failure-to-status conversion;
stdin acquisition/fake cleanup. These are **planned**, not executed mutations.
Before-encoding allocation checks, every4096codeunit cancellation cadence and
no host/global-environment acquisition also require source inspection; a passing
small runtime vector alone cannot prove RSS bounds or all scan cadences.

No blocking policy ambiguity remains for this freeze. This does not add runtime
argument-object validation outside the existing typed CommandContext contract,
promise provider symlink normalization, or silently choose native TOCTOU behavior.
FreeBSD revision `8268a31bcceb9ebe32d380cab792c89c5d897d15` is a retained manual/
source reference only. **No FreeBSD binary is provisioned; Darwin which is also
unqualified and unexecuted.** No new native or existing-shell cohort was run.
Stage2 cancellation freeze and accepted R08v3 remain separate and unchanged.

Hash-only verification:

```sh
node tests/commands/which-independent-20260827/verify-v1.mjs
```
