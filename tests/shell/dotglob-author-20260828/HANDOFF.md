# DOTGLOB author candidate — August 28, 2026

## Exact handoff

- Source/test/driver commit: `d2502aae3c8458e0ac92662f2af07e7f9fc3923a`.
- Committed-replay driver refinement: `a8a64dccbb026faf9a89d9eaccd6571de25ae41a` (no product delta).
- Accepted selected STACK composition: `099455f232870fa1ea59e1a0ae482e003fd170db`.
- Candidate selected composition: `37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e`.
- Candidate package SHA256: `b0544dcb3d0d9b22420932fc86e4d4693377fcc813fde6bde95c8625edc951aa`; 846 regular members.
- Runtime source blob: `69125acc1d3afefcaeba642e71539ab0cc40e055`; SHA256 `100361256ee71d7a263c92fa607de31ec1d3be9b1fb5c601b337c19e700ac4b3`.
- Shell source blob: `220d6c28a6e50f459a48aaee2030f24a841f4ab7`; SHA256 `126438b132a9f1863bf25b20f02ca6473cb24aa86e0a91869ab98bcbf3309cba`.

These are **author-only** results, ready for root/Plato's different executors.
The source commit's raw repository tree is NOT the selected product composition.
The named composed trees are computed Git tree identities; they need not exist
as stored tree objects. Do not assemble from moving HEAD.

## Admission and scope

The committed `0fe2274a` BINDING-v1 supplies 265 selected regular inputs,
including 211 production TypeScript files. Every selected input's Git source,
blob, SHA256, byte length and mode was authenticated. The driver reconstructs
the selected tree from baseline `5137a74e` with the accepted DAV and STACK
overrides, reproducing `099455…` before adding only the two owned source blobs.
The accepted CD+LET predecessor identity is
`3e3a2fe381e11540213285e14e2a9a55a72bdbdd`.

Initial live source bytes exactly equaled accepted runtime
`9ff4aa32354f15901ed18e7e57aa30f812d34b14` and shell
`0ebf7efa77df77707d594fa55c89af4db891ee87`; neither had staged/unstaged deltas.
The accepted STACK package was decoded from author receipt `92b60355` and its
bytes authenticated against SHA256
`15aa8d8dd6e78a9b7d12156ea2adaf93bd5f0037f13443e8928268c9d5215a18` (846 files).
This is accepted receipt identity, not an all-HEAD package assumption.

Profile authority is author `3771cdb6`, independent freeze
`429766aaa9fee0be469ed79b186bc8e3b3ed43c2`, offending-z overlay `deced72d`,
and root's explicit always-exclude-dot-entries correction. Independent case
fixtures were not copied, edited, rebaselined or counted as author tests.
No parser, public options, limits, exports, providers, contracts, shared Budget,
root wiring, AGENTS, array/alias implementation or private checkout was changed.

## Implemented mechanism

- Internal optional primitive `State.dotglob`, initialized false by fresh
  public exec and `processState`. Missing internal values also mean off.
- Unchanged `cloneState` object spread copies this primitive and preserves the
  accepted directory-stack Symbol publication stamp. No clone code was replaced.
- Functions, source, eval and braces share the current value. Subshells,
  pipeline stages, substitutions and literal invoke inherit isolated copies.
  Env-shebang forwarding clones; actual interpreter processes reset false.
- Genuine ordinary builtin `shopt` joins existing discovery/dispatch, not special
  builtins, public options or plugin registration. Default agent names remain 77;
  the registry does not acquire `shopt`. Runtime dependencies remain empty.
- Only exact `dotglob` is supported. Leading clustered/repeated `pqsu`, `--`,
  filters, quiet/print/list modes, statuses, duplicate operands, partial changes,
  invalid-before-conflict precedence and exact spacing/diagnostics are exercised.
  Unknown names, including `expand_aliases` under unset/query, are rejected.
- Wildcard segments admit leading-dot entries when enabled and always reject
  `.`/`..`, in both states and with custom providers. Literal components remain
  literal. Existing matching, provider iteration, final sorting, budgets,
  signals, byte I/O, cleanup and `scriptFile` whole-input preflight remain intact.

`verify-evidence.mjs` strips only enumerated dotglob additions and requires both
source files to reproduce the accepted blobs exactly. Thus all other methods,
including CD/LET, stack publication and clone ownership, remain byte-identical.

## Final scoped measurements

Final committed-source capture `capture-hm46By`, preserved as `capture-07.json.gz.base64`:

| Cohort | Result |
| --- | --- |
| Own source runtime tests | 272/272 |
| Same author body, installed package | 272/272 |
| Same body after physical consumer move | 272/272 |
| Unchanged selected glob/invoke regressions | 14/14 |
| Unchanged accepted STACK author regressions | 87/87 |
| Production build and strict selected source/tests | Pass |
| Installed/moved strict public consumers | Both pass |
| Private dotglob ShellOptions/ShellLimits types | Two exact TS2353 rejections plus two positive inversions per layout |
| Root and contracts subpath public runtime consumer | Both layouts pass |

The 272 tests are one author cohort repeated in three layouts, not 816 independent
compatibility cases. STACK's 87 author regressions are not a rescore of its
independent acceptance denominator. No final test is skipped/cancelled/TODO.

Final execution has 21 recorded Node tool/test invocations, all settled with
null signals/errors, including four intentional type-error exits. Tests normally
use a 20s runner bound; the unchanged STACK capacity regression uses a separately
declared 90s runner/95s process bound. Final STACK elapsed time was about 35s.
This is not a performance comparison. The final measured capture interval is
`2026-08-28T10:36:56.837Z` through `2026-08-28T10:38:03.060Z`.

Both actual package layouts authenticate 207 distinct loaded product modules,
including root, runtime and contracts, with a load hook rejecting paths outside
the consumer. The old consumer path is absent after moving. Full package
membership, bytes and modes match fresh build output; no runtime source fallback
or runtime dependency install is used. Only source building uses the explicit
development-tool link; consumer typechecking uses explicit host Node types.
Production/source snapshots and installed package snapshots detect added entries
as well as changed original entries. Source `node_modules` is the documented
development-link exception, not an append-proof tool-tree claim.

## Preserved attempts and corrections

All seven captures retain exact original RESULTS text when it existed, complete
command stdout/stderr, source/test bytes and later successful package bytes.

1. `capture-01`: build passed; strict regression compile found a missing helper
   for two initially proposed extra regressions. No product test ran.
2. `capture-02`: after reading that helper and finding native Bash execution,
   the author stopped the next driver during Git authentication (exit143).
   Its 156-file partial projection had no tests directory or RESULTS file.
   No native oracle or product runtime had started. These two optional native
   regressions were excluded from this authorized cohort, not passed or changed.
3. `capture-03`: author 259/259; the combined original regression run timed out
   during the unchanged 4096-entry STACK test at 20s: 96 passed, one cancelled.
   This failure remains. Accepted historical evidence had recorded about 59s
   for that fixture. Subsequent unchanged STACK runs use the explicit 90s bound;
   no assertion, source or capacity fixture was weakened or skipped.
4. `capture-04`: 259/259 in all three layouts, 14/14 and 87/87 regressions.
5. `capture-05`: expanded source cohort 271/272. An author test wrongly expected
   a generic stderr sink error to reject public exec. Existing runtime catches
   ordinary command errors, attempts a diagnostic and maps status1. The corrected
   test asserts exact status1, both captured diagnostics, two sink calls and no
   later dotglob mutation. No product source changed to accommodate the test.
6. `capture-06`: precommit 272/272 in all three layouts, all listed checks pass.
7. `capture-07`: final committed-source replay after the archive preflight was
   refined to avoid consulting live source staging. The production/test inputs
   are read from `d2502aae`; only strict-live mode checks its source index.

The successful package builds have identical package hashes. Earlier driver
versions were not captured as source files; their executed arguments/results are
retained. Final driver bytes are captured and authenticated to `a8a64dcc`.
The first six attempts preceded the source commit and use post-run byte binding;
capture07 executes that already committed source and tests. Neither mode imports
other live product inputs. Unrelated live edits neither enter nor veto committed
replay; strict-live mode retains its dirty-input checks.

## Root qualifications and limits

Root's accepted STACK position remains **136 qualified / C06 partial /
S13 unsupported**, NOT 138/138. C06 escaping-control versus local cancellation
is source-only; unsupported `/bin/sh` shebang is not rescored as `/bin/bash`.
Acceptance receipts are `3e4cd743` / `92b60355`, independent `0fe2274a` plus
`1446a706` and root's final artifact confirmation. This task does not upgrade them.

Native oracle calls: zero. Comparator calls: zero. Existing 24-call/72-probe
dotglob observations remain immutable; their 43/27/2 status distribution is
observations, not passes. Preparatory 42 synthetic groups are not product proof.
No arrays were observed, implemented or rescored in this task; the prior root
cohort `4e8f8a13` remains separate. No blocked-module probes were rerouted.

This is not whole-product green, superiority, deployed-service acceptance,
independent dotglob acceptance, a full canonical typecheck/test run, a 72-hour
work claim, or a proof of opaque host-work preemption. Root still owns independent
frozen-case replay, mutation controls and final acceptance. Cleanup records owned
temporary removal and observed process settlement, not a universal process census.

## Reproduction

- Static archive/source/package verification: `node tests/shell/dotglob-author-20260828/verify-evidence.mjs`.
- Explicit fresh author replay: `node tests/shell/dotglob-author-20260828/validate.mjs d2502aae3c8458e0ac92662f2af07e7f9fc3923a`.

Replay reads selected committed product inputs and committed owned tests, never
live product fallback; it creates a unique isolated capture and leaves its owned
work directory for review/cleanup. It requires the recorded Node/TS/npm tools and
available development dependencies, and never installs product runtime dependencies.
The static verifier is not a new runtime replay or independent executor.
The package bytes are retained as `result.package.base64` inside the decoded
`capture-07.json.gz.base64` JSON record.
