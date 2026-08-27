# Independent closure replay — red checkpoint

Completed August 27, 2026. **No complete closure/current-tree acceptance.**
All required cohorts ran; no skips, xfails, TODOs, hard timeouts or overflow.
Source/dot/eval and other breadth remain blocked pending root disposition.

| Independently executed cohort | Result |
| --- | --- |
| Frozen new holdouts | **31/34**, three discovery failures |
| Unchanged old independent holdouts | **72/72**, previously 69/72 |
| Unchanged old author invocation | **132/132**, previously 130/132 |
| New author discovery/read/sh | **211/211** |
| Original prior file cohort | **57/58**, obsolete precedence assertion retained red |
| Authorized strengthened prior file cohort | **58/58** |
| Selected regressions | **173/173** |
| Fresh virtual vs fresh complete 57 native | GNU5.3 **51/57**, historical3.2 **49/57** |
| Fresh virtual vs frozen complete 26 native | GNU5.3 **23/26**, historical3.2 **12/26** |
| Global/build/benchmark noEmit | Exit0 each; **916/296/411** guarded compiler inputs |
| Final owned scoped noEmit | Exit0; **205** guarded inputs |

The original three independent targets (`sh-posix-special-assignment`,
`path-command-v`, `path-type`) and the two author `stdin-read-one-byte` Bash/sh
read-N cases now pass unchanged. The new ten read-N, eight POSIX and eight
host-boundary rows also pass. These counts do not inherit author-reported results.

## Three frozen new failures

1. `query-V-verbose`: native command -V prints an absolute executable pathname;
   virtual prints `tools/closuretool`, not the declared `/work/tools/closuretool`
   coordinate mapping. This narrow output discrepancy is routed to root. A
   separate `printf is a registered command` versus native `shell builtin`
   difference truthfully reflects the virtual registry role, not unavailability.
2. `type-multiple-status`: virtual printf kind `command` differs from native
   `builtin`; modern mixed-name status1 is correct. Historical status0 differs.
3. `query-empty-and-unsupported-option`: empty status0 and bad-option status2
   match; `unsupported option` fails the frozen `invalid option` diagnostic
   assertion. No rejection or dispatch failure is concealed by that wording.

All three stay red without weakening tests or fabricating builtin membership.
Exact source, argv, statuses, stdout/stderr hex and classifications are in
`post-ready-summary.json`; the complete child runs are in `post-ready-new.json`.
The coordinator findings file was updated promptly. No production fix was made.

## Source and snapshot limits

Shell commits: discovery `7e69fe1`, read-N `6370e71`, sh profile `3aa3a41`,
and the separately authorized shell-local BOM capture fix `abdc741`.
Both READY markers are preserved in `post-ready-start.json` and phase evidence.
Runtime SHA256: `8af9bb685fee68e6f199e1ebf9613ac8da50572f357fd98599e570d30810e820`.
Shell SHA256: `4ac91162195c150848793c92b8b1e90f15a36e67b5ae8a2652fe7ed9dcf4fb5e`.
All shell files retained their READY hashes. Starting observed HEAD was
`319299e7d24be17bed990242d605a4fc37d0d305`; audit-end HEAD was
`7bce86ade313ed53ffc740087db236256d5c0a00`, not a tested clean committed tree.

Every phase enumerated starting compiler inputs before execution; compilation
recorded its actual file list and rejected missing/new unguarded inputs. Runtime
load hooks prove **42 distinct product .ts dependencies** across the phases.
All per-run imported endpoint hashes were stable. However, Memory FS and S3
authority changed **between** phases; Memory and WebDAV dependencies also differ
at final observation. Thus the aggregate dependency-equality check **failed**.
Its original error remains in `post-ready-cross-phase-seal-error.json`; all
versions/phases/end hashes are in `post-ready-summary.json`. No rerun loop or
blanket freeze is claimed. Compiler passes apply only to their recorded snapshots;
later WebDAV edits and two owned runner edits are separately recorded. The final
scoped check covers the owned edits, not subsequent foreign changes.

## Native evidence and authorized expectation change

Both complete original **57** native profiles were freshly captured with actual
argv0/bash/sh adapters and profile-rendered executable children. **Zero** rows
changed bytes/status/effects from the old frozen snapshots in either profile.
The prior complete **26 × two profiles** capture remains byte-identical and is
compared against new virtual observations. Profile binary hashes, argv, input,
fixtures and mappings are recorded; profile-specific headers are not called
byte-identical. No native result is selected per case or silently normalized.

All six modern raw57 losses remain: two error-diagnostic rows plus four explicit
headerless/shebang/binary/strict-UTF8 policy rows. Historical adds two diagnostic
differences. New historical raw26 retains lack of read-N, POSIX function-prefix
and discovery differences. Native raw parity is not universal shell acceptance.

Separate atomic commit **da549ff** changes only the authorized
`builtin-function-registry-shadow` definition outside this owned directory.
Both original and strengthened sources were independently confirmed against
both actual native profiles (**4/4**). Exact original red expectation and raw
57/58 run remain immutable; other sixteen definitions are hash-identical.
The stronger case asserts function status7, command-builtin status0, function
versus registry dispatch and nested script isolation. See `PRECEDENCE_REVIEW.md`.

Selected regressions are the prepared core/invoke/stdin-origin/input-units/
descriptor-inheritance/glob-budget/inline-input-limits/read-options/read-fields/
variable-scope files. Their **61 existing native references** use actual
`/bin/bash`3.2: 17 descriptor, 19 read-options, 15 read-fields and 10 scope.
They retain their existing 2-second synchronous helper, not the new detached
profile capture harness. New/read-regression NUL delimiter and cancellation
controls are not the paused NUL or known five pending first-read cohorts.

## Reproduction, errors and cleanup

Exact commands/env and before/after dependency hashes are embedded in each JSON.
The prepared `verify.ts` stages used were `new`, `legacy`, `author`, `previous`,
`precedence`, `types`, and final scoped `prepare`. `native.ts` used
`post-ready-legacy-native.json --legacy`; `compare.ts` used `new` and `legacy`
with the fresh `post-ready-*` captures. Use new output names for future replay;
all evidence writes refuse overwrite. No escaped-TAP diagnostic reparsing: the
fixed stdoutHex transport decoder handles old captures; new probes write JSONL.

One initial runner path typo failed before any test started and is retained in
`post-ready-runner-error.json`. Correcting the path changed no expectation.
The narrow native-proof runner subsequently reads its original definition from
commit480be8c for reproducibility. Neither correction hides a product red run.
The audit verifies **254 recorded child PIDs and process groups absent**, no
owned temporary directories and no watcher. Existing untracked foreign native
directories were untouched. No known nine historical/five custom first-read,
paused NUL, remote audit, tar/full suite or source/eval expansion ran.
Unsupported command-p, invalid/split UTF8 text, aliases/keywords, limited function
display and other previously recorded policies remain limits. No full Bash or
superiority claim is made.
