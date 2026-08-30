# Independent WebDAV directory X_OK implementation review

## Verdict and exact scope

**Scoped provider acceptance recommended. No blocking source defect or frozen
contract contradiction found. ROOT owns release. cd/runtime and directory-stack
remain HELD.** This accepts the precise composition below, not moving HEAD or the
entire ca1d tree. It establishes neither remote ACL/POSIX search permission nor
listing, child, future-access or actual-service acceptance.

- Accepted full source/package/build baseline:
  `5137a74ec855a32d8a8860eb66b62eb44d11e290`.
- Candidate source/docs: `ca1d33424b94a21ae0f40a36412fd8191611e2df`.
  ONLY `src/fs/webdav/webdav.ts` and `src/fs/webdav/README.md` override the baseline.
  Exact blob hashes are in BINDING.json and SOURCE-REVIEW.md.
- Derived full composition tree: `7c68831a81fc49c94ad9177e58ca9fd7d0aca352`.
  All265 selected source/package/build inputs, raw commit/tree/blob proofs and
  reproducible source bytes are archived; no loose source-object prerequisite.
- Immutable independent precode freeze:
  `c65c121e0756390869cddcf78ceb49d0de9cdd2b`; all seven originals remain exact.
- Author evidence reference only: `899de9ab1344179bde928076217c45ba80c345c8`.
  The committed HANDOFF was read first. Author counts are not ours.

## Frozen results (separate layout denominators)

| Actual layout, final run03 | Pass | Fail | Blocked | Untested |
| --- | ---: | ---: | ---: | ---: |
| Full composed TypeScript source public API | 102 | 0 | 0 | 0 |
| Full npm-packed and npm-installed public package | 102 | 0 | 0 | 0 |
| Same consumer/package physically moved; original absent | 102 | 0 | 0 | 0 |

Each layout independently executes the original unchanged groups: navigation5,
metadata/namespace15, file-type4, ordering/readonly36, mode5 races5, input bounds17,
response limits4, lookup races4, cancellation/cleanup9, compatibility3. Do not sum
layouts as unique coverage. The earlier run01 source102 pass is also retained
separately, not added to the final denominator. No original oracle was changed.

Every admitted request's method/URL/depth/body/credential/redirect policy and
underlying stream resource counts match. Zero-work cases admit zero mock requests.
Q-maximal-lookup observes512 exactly; no aggregate deadline or permission lease
is inferred. Every case has clean owned resources, no unhandled late rejection,
no guard expiry, and no retained response lock. All mocks are injected transport
responses, not real WebDAV services.

## Types, invariants and negatives

In EACH final layout: original **8 positive / 10 negative type assertions** pass;
ten separately inverted negatives produce exactly TS2344 at their intended lines.
There are no missing-import passes. Installed/moved bind actual packed declarations
without source aliases. FsOptions exact-optional signal presence is unchanged.
Source type audit reads379 files and installed/moved256 each (types/package/tool
reads, not counts of independent declarations). Baseline skipLibCheck is retained;
this is scoped strict public-consumer validation, not a global declaration audit.

All **8 invariants** have explicit runtime-versus-design mappings in
SOURCE-REVIEW.md. Request/error/cleanup facts are measured; absence of remote ACL,
ABA/lease or future permission promises and future cd requirements remain design
boundaries. Do not report eight universal runtime theorem passes.

Five candidate-witnessed source mutants are killed by genuine case assertions:
admission, final cancellation, raw path bound, output byte bound and response
identity. Each mutant loads its own authenticated changed provider and finishes
cleanly; no loader/environment error counts as a kill. The path-bound mutant
admits a forbidden request, so the mock guard yields EIO instead of the expected
zero-work ENAMETOOLONG—this is an admission violation, not a loader failure.
Separately, **3/3 load negatives** reject outside-source fallback, tampered packed
provider bytes and a missing public entry. They are admission controls, not kills.

## Artifact and execution evidence

Independent build/pack produced complete package SHA256:
`2f6d9f142165802f4e8a033c317f5c4f034f535508d3a434688e547b654c85b0`.
Its846 regular entries are authenticated against emitted output and actual
installed/moved files, including declaration closure and every public export.
This happens to match the author package hash; it was built and measured here,
not adopted. Each actual layout loads207 distinct authenticated product modules;
this is loaded-module inventory, not default-command count or all-feature coverage.
Public root/WebDAV export class identity is checked. Installed resolution is the
actual bare package path, not a dist-only facade. Source fallback is guarded even
while the separate source tree exists; moved execution occurs with the original
consumer absent. The complete consumer inventory is byte/mode-identical on move.

All tools are pinned regular local copies. Build uses the unchanged baseline
config. Npm pack/install are offline, ignore scripts and use owned configuration,
HOME/cache/TMPDIR; no dependencies are downloaded. Full tools/source membership
is checked before and after; all scratch is enumerated and authenticated before
cleanup. CLEANUP.json records removal and the durable scratch inventory.

Captured execution spans August28,2026 **04:13:19–04:17:27 UTC**, including the
retained failed type frontend and successful continuation. Nineteen captured
validation children exit naturally: six exit1 (one type frontend, five intentional
mutants), thirteen exit0. No timeout/termination signal. Synchronous Git plumbing
and preparation/orchestration parents are not silently included in that count.
No service, listener, native oracle, private engine or guest is launched. Public
root export loading does not invoke a SafeJS engine/runtime or injected hooks.

## Retained failures and honest adaptations

1. PREPARATION-01/02 preserve tool-origin and copied npm symlink admission failures
   before product execution. Explicit byte materialization yields regular copies.
   The initial driver parenthesis syntax error is recorded with preparation02.
2. raw/run-01 preserves source102 pass plus the type frontend's TS2353 `duplex`
   diagnostic: omitted lib accidentally admitted DOM, unlike baseline ES2023-only
   config. types-v2 adds only the correct lib; all expectations remain unchanged.
3. raw/run-02/ADMISSION.json preserves the resume driver's exclusive-create EEXIST
   on existing empty npm config. run-v3 authenticates/reuses those exact bytes.
4. raw/audit-01 preserves the auditor's mistaken literal treatment of the existing
   wildcard export. Final audit expands actual members and requires paired types.

Parent errors before automated child capture are explicitly labeled transcriptions;
all executed child stdout/stderr/status and all actual case failures are retained
raw. Original driver versions remain committed. These are post-inspection harness
adaptations, not precode claims, source fixes or silent rescoring.

Author61/680/shared61/shell108/installed9/moved9 results and historical13/61,
initial archive admission error and six missing-fixture load failures remain
author evidence at899, not independently rerun or added to these denominators.
No broad replay, full gate, default inventory, superiority or deployed-service
claim follows. Actual WebDAV service: **unavailable/not run**.

## Handoff

Data-only verification: `node verify-final.mjs` and `node audit.mjs` here. REPRO.md
documents a fresh authorized replay from archived bytes and pinned local tools;
the fresh replay wrapper is syntax-checked, not an additional executed cohort.
The exact scope's source/default/limit decisions are in SOURCE-REVIEW.md. Original
seven-file hashes and live provider/readonly/runtime/contracts/root package scope
are preserved separately; live preservation is not mislabeled historical equality.
The append-aware final seal excludes ONLY this owned review subtree when checking
the parent, then authenticates this subtree's exact independent membership.
The final wrapper also rejects empty-directory additions, without editing either
the original precode verifier or the committed regular-file verifier. Both file
and empty-directory addition negatives are recorded in SEAL-CONTROL.json.

This is an independent provider prerequisite handoff, not cd-runtime acceptance.
G fixtures test provider compatibility only. ROOT decides release and any later
cd/runtime authorization; directory-stack work remains outside this review.
