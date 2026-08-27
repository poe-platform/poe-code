# Inactive-prefix evaluator correction

## Result and scope

The single added guard in `src/commands/expr/evaluate.ts` returns the existing
zero sentinel for an inactive call node after the existing evaluator checkpoint,
before visiting its operands. This suppresses `length`, `index`, `substr` and
`match` reductions, operand encoding, numeric conversion, locale evaluation and
regex submission. Active calls, parser/argument admission, structural node/depth
accounting and the existing shared Budget are unchanged. Prefix `+` remains
parser literal quoting; it is tested, not turned into a new evaluator operation.

This is not the paused async-parser rewrite. Existing non-call evaluator traversal
is untouched. There is no claim of full parse-only inactive traversal, parser
architecture closure, all-21-failures repair, full native parity or superiority.

- Author baseline freeze commit: `875b0fb0e5fcc60e6ddd3947710779fc1fc74cea`.
- Atomic evaluator/new-test commit: `4f01c1593486c1abff3b007f9a3b16923b88559f`.
- Only those two paths occur in the source commit. Evidence is committed separately.
- The author acted as a delegated leaf and did not redelegate.

## Executed results

| Cohort | Baseline-03 | Candidate-01 |
| --- | ---: | ---: |
| New canonical inactive-prefix author tests | 43/68 | 68/68 |
| Existing contracts, abort-reason, regex-lifecycle tests | 149/149 | 149/149 |
| Combined scoped runtime tests | 192/217 | 217/217 |
| Frozen independent semantic controls | 25/44 | 25/44 |
| Frozen independent product-specific controls | 15/17 | 17/17 |
| Frozen independent combined | 40/61 | 42/61 |
| Frozen actual-Shell overlap, not additional unique inputs | 3/5 | 3/5 |
| Separate historical one-byte output-cap assumption | 0/1 | 0/1 |

Exactly `skip-no-prefix-locale-evaluation` and
`skip-no-substr-number-evaluation` change from red to green in the frozen
independent cohort. Their argv, environment/limits, no-encode assertions,
expected status/bytes, driver and worker observations are unchanged. No old
fixture is edited and no failures are waived. The remaining 19 controls are
11 arithmetic/noninteger error-order failures and eight regex order/submission
failures, including three with matching final diagnostics but missing jobs.
The separate historical output-cap assumption also remains red.

The new tests cover each prefix under OR, AND and mixed nested short circuits;
nested prefix arguments containing arithmetic errors and invalid BRE; quoting;
exact malformed skipped-syntax diagnostics; active C and C.UTF-8 results;
active locale/numeric/allocation errors; argument count/bytes, node/depth, work,
numeric/output limits; retained inactive-call work/cancel checkpoints; sequential
single-evaluation active jobs; monotone shared budget identity; no stdin/FS
access; six abort reasons (`undefined`, `null`, `false`, `0`, empty string and an
errno-shaped Error) with exact identity/no writes; and actual Shell middleware
literal `invoke` dispatch. No untrusted main-thread RegExp or dependencies added.

Scoped strict TypeScript and the expr/Shell/memory/runtime-selected regex-worker
build pass. All 217 tests have zero failures, cancellations, skips or TODOs in
the candidate. This is scoped validation, not a whole-repository gate or real
service acceptance. Original `baseline-01` infrastructure defects and the
`baseline-02` author instrumentation error remain disclosed in `BASELINE.md`;
they are not counted as valid green evidence. The later refinements preserve
every earlier input and result.

## Exact source identity

The executed source is the immutable accepted archive at
`21220b465537bf45ffcfb36740956a69f43bf75e`, plus exactly the owned evaluator
delta and the new test. It is **not** the full live HEAD or the whole source
commit's tree: concurrent named-profile, repeat-worker and unrelated changes
were never overlaid. `candidate-01/binding.json` records those exact overlays,
the observed live HEAD, runtime, and local tooling package/version hashes.

| Artifact | SHA-256 |
| --- | --- |
| Accepted compressed source archive | `b2de2b86a834f1b5c3ba7a98c347d3aa9668632ff3af2a073cf2c45c6b6bfef5` |
| Accepted evaluator | `80f8b4b7fbcd0552dd91772b941e6654c0b8dd08ce980814b811f08959015d61` |
| Candidate evaluator | `04ca8f588ccaea97b3801fe30accfa6020636c5f72f156b0d158fa6474f525c9` |
| Final new canonical test | `50a1748f93ce4781b7a765227e07e4e7ad7e35c6f8ae46cf36ea93631d575c70` |

The independent frozen commit is `e9ff18dcdd403c68550c9ad9ea69d2edce5403a3`.
Its cases, driver and source archive are copied from Git objects with hashes
checked against its own receipt; the independent inputs and captures remain
unchanged. The two user-requirement controls are not claims about GNU's skipped
prefix implementation. This author did not rerun a native oracle. The preserved
independent oracle profile is GNU coreutils 9.7 on Darwin, not GNU/Linux or BSD.

Candidate runtime capture occurs before the source commit, using the exact
single-line owned working overlay; `COMMIT_BINDING.json` subsequently verifies
that the committed evaluator and test blobs equal the executed bytes. No other
live product input is read for the candidate. The final test does not pin product
source hashes and never reads or writes historical evidence during canonical runs.

## Integrity, cleanup and replay

All source/test inventories are compared before/after execution, detecting
modifications, deletions **and new entries**, excluding generated `dist` and the
explicit local `node_modules` symlink. No append-proof compiled-output guarantee
or complete tool-package authentication is claimed. Node is v22.22.2 on
Darwin/arm64, with TypeScript 5.9.3, tsx 4.23.12 and @types/node 22.20.1 from
existing development tooling. No installation or shared-dist rebuild occurred.

All capture children are bounded/waited. Each extracted source tree is removed
in `finally`. The frozen driver reports zero active workers, with cooperative
cleanup complete before observed execute settlement. The initial failed capture's
test timeout is preserved as an infrastructure failure; its observed process IDs
were subsequently absent. No worker/process from this author is left running.
These are observations of these runs, not universal host-work cancellation claims.

Read-only verification:
`node tests/commands/expr-stress/inactive-prefix-author-20260827/seal.mjs --verify`.
Independent read-only verification:
`node tests/commands/expr-stress/sequencing-design-20260827/seal.mjs --verify`.
The seal checks added files as well as original paths, excluding only itself and
the owned temporary extraction area. Explicit `capture-v3.mjs --candidate
UNIQUE-NAME` can create a fresh capture, but doing so within this sealed directory
deliberately invalidates the seal: new follow-up evidence requires its own
authorized location/binding. Existing captures are never overwritten.
