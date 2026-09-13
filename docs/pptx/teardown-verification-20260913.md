# PPTX teardown audit

Completion is not verified. Inspected local HEAD:
`766f98c7fe3c30cc1d0fc33d1718e81c1703657d`. This audit uses the existing working
tree, including uncommitted implementation and untracked research dependencies.
Passing checks below cannot be attributed to a clean checkout of that hash.
The [observations](teardown-verification-20260913.json) retain exact accounting,
input hashes, task-state observations and inspected local commit paths. The
[procedure](../plans/pptx-teardown-verification-20260913.md) defines scope.

## Checks executed

| Check                                                                       | Result                                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run test:unit --workspace=pptx`                                        | 269 files, 6,874 tests passed; 64.30 seconds                                             |
| `npm run lint --workspace=pptx`                                             | ESLint, production TypeScript and test TypeScript passed                                 |
| `npm run build:workspaces -- --workspace=pptx`                              | Maintained selected dependency closure passed: office-package, toolcraft-schema, pptx    |
| `node --import tsx --test packages/safe-bash/tests/commands/pptx/*.test.ts` | 239 passed; zero failures, skips or cancellations; 7.458 seconds                         |
| Built `import * as sdk from 'pptx'`                                         | 274 runtime exports; original one-slide deck saved/reopened, title retained, 4,816 bytes |

The public factory test includes type assertions for the async factory/save and
synchronous property/package views. Package lint compiles these tests. Public
value, chart, drawing and text export tests also ran. These establish their
tested boundaries, not every documented public member. The built consumer uses
the declared package import, but is not packed-package, browser or workerd QA.
No repository-wide build/test/lint or clean-commit execution ran in this audit;
the pipeline's broad maintained-check gate remains unverified.

## Complete case accounting

All 2,700 unit variants and 973 expanded BDD examples join exactly once to the
3,673 central ledger rows by pointer, identity, location and pinned revision.
There are 3,673 unique original target IDs, no missing/duplicate joins and zero
architecture-only dispositions. The complete disposition partition is:

| Disposition                      |  Rows |
| -------------------------------- | ----: |
| Original TS passes recorded      |    43 |
| Semantic review required         | 2,585 |
| Specified, not implemented       |   167 |
| Proposed design, not implemented |   877 |
| Deferred public behavior         |     1 |
| Total                            | 3,673 |

These are verified ledger labels, not a fresh semantic review of all assertions.
Later family passes do not automatically promote central rows. The 3,630
remaining obligations block complete adaptation. Source-suite passes and the
6,874 product test executions have different denominators.

## Public API and command gaps

All 2,409 inventory identities have targets among 2,426 API rows. All 2,426
command SDK pointers match their corresponding API identity. The current API
assessment remains 749 bounded SDK receipts, eight unsupported rows and 1,669
rows awaiting current reconciliation. Inherited, underscore-prefixed and
untested public records remain included.

All F01–F60 IDs occur once. However, F23 references `shapes.paths.list` and
`shapes.paths.get`, which have no operation declaration in the register.
The public `shape_offset_x` and `shape_offset_y` entries have empty command
bindings. The register's scope prose still says 2,407 source records although
its accounting says 2,409. These are unresolved register defects; this audit
does not invent command routes or relabel proposed operations as supported.
Generic enum discovery remains an explicitly documented command gap.

The built consumer freshly confirmed absent presentation members `equals`,
`notes_master`, `slide_master`, `slide_masters`, and absent slide members
`has_notes_slide`, `notes_slide`, `slide_layout`. Grouped chart insertion remains
the eighth unsupported register row; it was not separately probed here.

The [60-family committed support table](implementation-checkpoint-20260913.md)
remains the bounded source-review baseline at `a7fbba9c4`. It distinguishes
read/edit/preserve/reject boundaries. Current passing tests include uncommitted
image replacement, media tracks and sanitization; these do not become delivered
features through a documentation commit. Whole semantic validation, visual
layout, font shaping, SmartArt editing and playback are not established.

## Paired ergonomics, rendering and regressions

The [built command receipt](office-cli-execution-20260913.md) accounts for all
Q01–Q41, with partial/failed/blocked/unrun cases and every DOCX counterpart unrun.
It records the B2 grammar, shared property batch, template creation and recovery
hint gaps. This audit freshly reproduced unsupported `validate /deck --json`:
exit 2, `Unsupported operation.` Package passes do not close these recipes.
No fresh terminal screenshot, independent slide render, application playback,
codec, font fallback or before/after visual acceptance ran here. Existing
terminal screenshots cannot establish slide rendering or playback.

The original negative live-index regression from `2e1e17121` and 11 original
guide workflow tests from `a2597a3e8` passed in the package run. They use bounded
original cases, not the full upstream corpus. The eight corpus-gap designs still
say specified/not implemented. The retained large campaign still records two
reproduced-not-fixed findings (slide admission and cancellation envelope) and
one timer-delivery instrumentation finding. Their proposed reductions and the
crossed value/series-label design are not passing regression evidence. No new
regression was authored and no product defect was fixed by this audit.

## Identities, notices and corpus

Known reference identity strings were absent from 841 package/adapter files,
including source, test names, fixture source and built outputs; filenames were
also scanned. Standalone LICENSE and THIRD_PARTY_NOTICES were excluded from
branding scanning only. Built help, capabilities JSON and the validate error
also contained no scanned identity. This is an exact-string scope statement,
not a proof that all substantial copied material was identified. Copied or
derived test material receives no implicit legal exemption. The existing case,
API, baseline and package MIT notices remain intact; the baseline notice is
preexisting untracked work and is not silently staged by this audit.

All 14 retained download paths were present and matched their expected SHA-256.
No corpus input was edited, downloaded or deleted. No QA output or reference
checkout was deleted, and no tests-with-downloads-absent claim is made. Campaign
and regression closure remain unverified, so disposable cleanup is pending.
README and other preexisting changes remain untouched.

## Task states and local delivery

The worktree pipeline labels all 125 tasks done and finalization pending; most
of those done labels are preexisting uncommitted edits. This audit does not
certify them, stage them or revert them. In particular, whole API acceptance,
paired conformance, complete adaptation, rendering/playback, broad maintained
checks and cleanup cannot be treated as verified completion. No task promotion
or Implemented Through update was made. The latter remains the explicitly
limited committed-source checkpoint `a7fbba9c421decb4ba710db2c6c16543eba10c34`.

The eight inspected local commits run from `9f7200934` through `766f98c7f`;
their full hashes, subjects and paths are in the JSON receipt. All eight have
Conventional Commit subjects, include relevant plans and have no co-author
trailers or fixture/cache paths. `3209b7805` aggregates enum and several owner
reconciliation families, so one-improvement atomicity is not certified. Git
objects do not prove historical staging ownership or whether hooks were bypassed.
The audit's own commit stages only its three explicitly named new documentation
files with normal hooks. No product changes or ignored fixtures are staged.
No push, remote-main verification, publication or release occurred.
