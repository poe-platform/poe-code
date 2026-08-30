# Array callback mutation README independent review

## Verdict

August 30, 2026. Reviewer: Aquinas, independently of documentation author Curie
and the Array source author. **HOLD: one narrow README clarification, followed
by independent source acceptance and paired publication.** This is a static
documentation decision, not a new runtime result or a production defect finding.
The author files remain unchanged. The guarded-regex documentation approval is
separate and is neither revoked nor promoted by this review.

The reviewed author manifest is
`/Users/kjopek/Workspace/poe-code-safe-js-array-readme-author/out/safe-js-array-readme/array-only-release-gated-candidate/manifest.json`,
SHA256 `71af168ba5a44ae966d6c5f79a6466b0271922d900e997d2da7618fec2c87e7f`.
The independent capsule is
`out/safe-js-array-readme-independent/array-only-static-hold-20260830/` in this
review workspace. Its three-document selection is held evidence, **not an
approved publication patch**. No target version or release success is assigned.

## Finding ARRAY-DOC-1: distinguish live iteration from buffered sort

Location: `packages/safe-js/README.md:274` in the captured author postimage,
SHA256 `5db2cd8c99b14a578d735273bf037c4a0b2147b4d03a65b7a03e22466326de7c`.
Immediately after the list of thirteen methods, including `sort`, the paragraph
says:

> Iteration follows each method's initial-range and hole-visitation rules while reading subsequent values and membership live.

The last clause is insufficiently scoped for comparator-driven sort. The source
does not reread receiver slots or membership between comparator calls. In the
authenticated `packages/safe-js/src/interp/methods/array.ts:848`, `sortArray`
first collects present defined entries over the initial length and counts
undefined entries. Only after this collection does it invoke the guest comparator
on `definedValues`; it then writes sorted values and undefined entries back and
deletes remaining positions within the original length. Later receiver-slot
replacement or deletion during a comparator does not replace that collected
comparison list. This statement concerns receiver slots, not a claim that object
values in the list are deep-cloned.

The README's subsequent deterministic-order/stable-tie qualification correctly
limits comparator trace parity, but does not distinguish collection from live
callback-time reads. The author's handoff already states the distinction
correctly in its “Verified source scope” section: sort collects initial sortable
values and performs bounded ordering/writeback. Carry that distinction into the
public README rather than relying on the internal handoff to disambiguate it.

Minimal requested author repair: scope the live-read sentence to the twelve
iterative methods other than `sort`, and state that guest-comparator sort first
collects initial sortable values, then orders and writes them back. Keep the
existing bounded deterministic/stable-tie and non-native-trace qualifications.
This requires no source change, new feature, runtime matrix, or new example.
Curie should reissue the affected README hash, exact patch, and diagnostic
composition hashes; this reviewer has not edited the author's wording.

This is a documentation ambiguity requiring clarification, not a newly executed
native mismatch. No runtime failure, security issue, or universal sort defect is
asserted. The remaining checks below pass within their stated static scope.

## Exact base and preservation

Fresh isolated review workspace:
`/Users/kjopek/Workspace/poe-code-safe-js-array-readme-independent-20260830`.
Its main HEAD and pulled origin/main are
`ea469259a7d61ab2839457863c445bd9f95155cb`. Ancestor/root AGENTS were read;
there are no additional `docs/AGENTS.md` or `docs/plans/AGENTS.md` instructions.

An initial `git pull --ff-only` in the previous own review workspace exited 1
to protect three frozen untracked reports now present upstream. Nothing was
deleted, moved, overwritten, thawed, reset, or reverted. Instead, a new main
clone was created using the previous repository only as a Git object reference;
its immediate pull exited 0, already up to date. No modules or writable runtime
cache were shared. The original user checkout and all author workspaces were
left unchanged.

The current Git README blob, current review-workspace README, and captured
preimage are byte-identical: 50,446 bytes, SHA256
`36e546c7e8d4da3386969606d0b6c55003e76274e893e98050e2ee999e992159`.
The two new plan paths below are absent in that commit and were absent in the
review worktree before this report was created.

The author changes exactly the old Array-refusal paragraph at line 274 into two
paragraphs, separated by one blank line. The original paragraph is one line;
the replacement is three lines. Every other README byte and all eight fenced
examples are unchanged. There are no new examples or guarded-regex bullets.
Published Map, Float, String, host-policy, browser/FS and canonical-name content
is therefore preserved without being re-certified by a new runtime run.

The minimal prospective publication selection is exactly:

| Path                                                                      | Base identity         | Captured ownership                               |
| ------------------------------------------------------------------------- | --------------------- | ------------------------------------------------ |
| `packages/safe-js/README.md`                                              | Present, SHA256 above | Unchanged author postimage; held for ARRAY-DOC-1 |
| `docs/plans/safe-js-array-callback-mutation-readme-release-handoff.md`    | Absent at ea469259    | Unchanged author plan                            |
| `docs/plans/safe-js-array-callback-mutation-readme-independent-review.md` | Absent at ea469259    | Independent review                               |

The author README is 51,052 bytes with the SHA256 in ARRAY-DOC-1. The author plan
is 9,646 bytes, SHA256
`1473c38296acadcbf4fb5e109439c4ae727b2215a3c6ca4d042580ad000d9310`.
The new report's exact postimage and all three paths' preimages are bound by the
independent manifest. No Array source file, guard plan, guard review, or composed
README is part of this Array-only selection.

## Source scope and checkpoint qualifications

Authenticated Array source manifest:
`/Users/kjopek/Workspace/poe-code-safejs-o01-array-main-integration-20260830/out/safejs-remediation/o01-array-callback-mutation/candidate-20260830-ea469259-array-author-qualified/manifest.json`,
SHA256 `53ab7b5e874b1eab52a723e63e87f17e2044b8bf2a4bddc6b50a785b1e31ab99`.
Only three selected source/report payloads were hashed, not its 495-artifact
runtime archive:

- `files/packages/safe-js/src/interp/methods/array.ts`: 26,144 bytes, SHA256
  `719d57d612efea1cdc11638bfc6f102885f927214256789725c81de19713f9ec`.
- `files/docs/plans/safejs-o01-array-publication.md`: 5,936 bytes, SHA256
  `c71fb2edd4082ce67f0711b1afd383d136f7f49714360cccbcaf942c27213f1a`.
- `verification/docs/plans/safejs-o01-array-final-author-qualification-20260830.md`:
  12,661 bytes, SHA256
  `7aeff762d1e4d17415c1a869bc948305b1df8bd8c187381920d7cf9b2b666a2c`.

The callback classifier lists exactly `map`, `filter`, `forEach`, `flatMap`,
`some`, `every`, `find`, `findIndex`, `findLast`, `findLastIndex`, `reduce`,
`reduceRight`, and `sort`. Selected loop inspection confirms saved initial
lengths and per-method membership handling, rather than a blanket skip-holes
rule. Callback entry retains running-state ownership/depth with `finally`
release; selected loops and comparator calls retain budget visits. Buffered
sort uses stable insertion ordering for a consistent comparator. This is
targeted claim inspection, not an independent audit of every boundary guard.

The author qualification distinguishes completed public checkpoints from
arbitrary callback/comparator suspension. Its saved checkpoints follow the
entire run, including suffix mutation, suffix mark, and final return. Callback
observations are not resumption checkpoints. The separate pending async-map
unit intentionally reissues two pending provider operations under the recorded
policy: two original calls plus two reissued calls. It is not one of the 64
fresh completed public restores and must not be relabelled zero-reissue.

Root reports Averroes's fresh 556 focused passes, 9,271 default SafeJS passes
with 39 skips, seven workers, sixteen native/source/built fixtures, and 64 fresh
restores with zero completed-effect reissues. Those counts are attributed to
root; this docs reviewer did not execute them or inspect all their graphs.
Averroes's final independent whole-graph adjudication remains a release gate.

The retained author report does not claim native physical whole-graph equality:
it records 49 ordinary-object prototype differences, wrapper prototype/name
distinctions, and unequal whole runtime envelopes in all 64 fresh cases. Narrow
return/journal comparisons do not remove those differences. Saved-default-sort
shadow, host-result alias separation, and named-array metadata accounting gaps
remain separately qualified, not waived or closed by this README review.
Unavailable/unrerun original Array audit cases are not retroactively validated
by the new fixtures. No original audit payload was read.

## Guard composition: both exact orders reproduced

Authenticated independent guarded-regex docs manifest:
`/Users/kjopek/Workspace/poe-code-safejs-fs-type-timing-independent/out/safe-js-regexp-guard-readme-independent/release-gated-static-20260830/manifest.json`,
SHA256 `91bcaa30f0f554213d8f87c203ac95e9934bd6e7d39337bb90b5b61fc82d072a`.
Its unchanged author manifest is SHA256
`41f8886eb5abbfa44a3c4a44e55529b4ba2b06eee9cff638ff856ff141bce7c4`.
The independent and author guard packets name the same README pre/postimages.

Both actual readonly commands used the frozen captured files:

```sh
git merge-file -p ARRAY_POST COMMON_PRE GUARD_POST
git merge-file -p GUARD_POST COMMON_PRE ARRAY_POST
```

Each exited 0 with empty stderr. Their full stdout bytes are identical, not just
their patch labels. Removing the exact two guard bullets from either result
reproduces the Array-only postimage byte for byte. Exact ordered identities:

| Image              | Bytes | SHA256                                                             |
| ------------------ | ----: | ------------------------------------------------------------------ |
| Common base        | 50446 | `36e546c7e8d4da3386969606d0b6c55003e76274e893e98050e2ee999e992159` |
| Array only         | 51052 | `5db2cd8c99b14a578d735273bf037c4a0b2147b4d03a65b7a03e22466326de7c` |
| Guard only         | 51640 | `114450081e182d6786f0eef87d5cbe57d1d027eca76d9718ea3292b86f054580` |
| Both, either order | 52246 | `8b3f247bbf345de28a64e1c2f07ee2c68e085e7a17269676cf4acabc8ce22008` |

Array-first means common→Array, then Array→both. Guard-first means common→guard,
then guard→both. The second publication must reissue its exact ordered
preimage/postimage manifest. A clean patch application does not authorize stale
preimages. These hashes describe the reviewed, held text; ARRAY-DOC-1 correction
will require new Array/composed hashes. Any later upstream change requires a
fresh preservation check, not overwriting newer content to recover an old hash.

This merge result is diagnostic only, not a combined publication artifact or
source/runtime composition approval. Array-only publication does not require
guard acceptance. Publication containing both features requires both independent
source approvals, both documentation approvals, and current publisher source
composition gates. Root reports a newer final guard source seal and ongoing
Laplace validation; this review neither rechecks that source capsule nor treats
the in-progress review as approval.

## Checks, handoff, and remaining gates

The capsule records independent authentication of the seven-file Array author
packet, selected source pins, and guard authorities. It records the exact
three-way merge argv, stdout identities, exits, preimages, preserved fences,
and formatter/strict patch checks. Small Prettier checks use the existing own
Prettier 3.8.3 library read-only; no dependency install is performed. The source
and author artifacts are not edited. Frozen captures are retained unchanged.

Before approval, Curie must address ARRAY-DOC-1 and issue an exact replacement
capsule. Then obtain the final independent Array whole-graph/source verdict and
root acceptance, verify actual publication preimages/dependencies, pass current
publisher composition gates, and pair the documentation with the accepted
Array runtime release. There is no standalone future-feature documentation
approval or already-published-version support claim.

No target runtime, tests, builds, installs, compilers, new screenshots, original
archive reads, security probes, source changes, ledger/home/SKILL changes, or
Git publication commands ran in this review. There are no new examples or CLI
changes needing a duplicate screenshot run. This report is a Markdown review;
the inline metadata checks are not a new standalone QA runner. All owned checks
are synchronous and complete before sealing; no worker is left running.

## Source READY supplement: Array-only priority

This later supplement supersedes only the earlier pending-source status, not
ARRAY-DOC-1 or the preserved initial decision. The new authenticated Averroes
manifest is
`/Users/kjopek/Workspace/poe-code-safejs-array-independent-current-20260830/out/safejs-remediation/array-independent-current/candidate-20260830-ea469259-release-ready/manifest.json`,
SHA256 `f3d406e6a7b40b7af4aa12bf06422cf97f57f9c1dd849f49f2006ddbc651f032`.
It declares scoped READY, no within-scope source blockers, and the same ea469259
base. All twelve author preimage/postimage records match the previously reviewed
source manifest exactly; no new source files were hashed or executed here.

Its adjudication records 337 comparisons, 1,687 validated graphs, and zero
unclassified differences. All 64 completed raw returns, journals and checkpoint
bytes match their declared saved baselines, with zero completed host/callback/mark
reissues. Native prototype distinctions and unequal whole runtime envelopes remain
explicit and unnormalized. These are authenticated independent source-review
results, not duplicate executions by the README reviewer.

Root now prioritizes Array-only release. Guard has three reported budget
regressions and is held; there is no combined gate or guarded-regex documentation
intake in this packet. The earlier merge-order proof is historical diagnostic
evidence only. No guard source or documentation approval is an Array-only
prerequisite. Publisher Kuhn's fresh integration/release gates remain pending.

**Current docs verdict: HOLD for ARRAY-DOC-1; source adjudication gate satisfied
within its declared scope.** Curie needs only the narrow sort/live-read wording
clarification and updated exact documentation identities before a final docs
READY can be issued. Source publication need not await this documentation
clarification if root chooses to publish the fix first. Neither this supplement
nor the source seal claims an actual completed npm release.

The first metadata-only attempt to bind this supplement exited 1 because the
reviewer mistyped the prior manifest hash by duplicating `57`; the actual prior
hash remained `c88aee2c6ae07934cb51f965a268850119bf8baa57c5d45ea214e25812dd1a65`.
That attempt wrote no files and ran no target runtime. Correcting the expected
metadata literal authenticated the unchanged prior capsule. The failure is
retained, not represented as a source or runtime failure.

## Final corrective approval: Array-only READY

August 30, 2026. **ARRAY-DOC-1 CLOSED; DOCUMENTATION READY, conditional on
publisher gates and paired Array runtime publication.** This final section
supersedes the historical documentation HOLD verdicts above. Their exact old
capsules, failures, and text remain immutable; no historical outcome is rewritten.

Corrected Curie manifest:
`/Users/kjopek/Workspace/poe-code-safe-js-array-readme-author/out/safe-js-array-readme/sort-corrected-array-only-candidate/manifest.json`,
SHA256 `8b65d50345bb834303209c50957090fdb30be72c7c89c75ed758988fa6f60fe4`.
The README now explicitly assigns live later-value/membership reads to the twelve
methods other than sort. It separately states that guest-comparator sort collects
initial sortable values before comparator calls, then writes back and deletes
within the initial range. Stable consistent-comparator ties and non-native
comparison-trace qualifications remain. This resolves the requested ambiguity
without changing production behavior or expanding the documented feature.

The correction consists of exactly the two phrase substitutions declared by
Curie. Every other byte of the prior candidate README is unchanged; comparison
with the base still replaces only the old refusal paragraph. All eight existing
fences remain byte-identical, with zero new examples. The handoff consistently
distinguishes iterative methods from buffered sort, records source scoped READY,
and labels all earlier guard compositions historical and invalid for the new
Array image. No guard source, guard README bullets, guard publication plans, or
combined gate are included. The old composed SHA is not a current acceptance
condition and was not recomputed.

The exact README preimage remains 50,446 bytes, SHA256
`36e546c7e8d4da3386969606d0b6c55003e76274e893e98050e2ee999e992159`;
the corrected postimage is 51,192 bytes, SHA256
`b961c0130dad973641522ca25183b742389d0c8889caa6105a975107c083f2f3`.
The corrected author handoff is 11,588 bytes, SHA256
`72d41ca105c7379d9d5d236a5eeb35197ddff6741ddd24d8c930905a57eee483`.
Both plan publication paths remain absent at the exact ea469259 base. The
publication selection remains precisely the same three paths listed earlier;
only the two corrected author images and this appended reviewer image are new.

Averroes's authenticated independent source manifest remains
`f3d406e6a7b40b7af4aa12bf06422cf97f57f9c1dd849f49f2006ddbc651f032`.
Its exact bytes match the previously sealed review input, preserving the prior
verification of all twelve unchanged author source pre/postimage records. This
rereview neither reruns nor broadens that source acceptance. The 337 comparisons,
1,687 graphs, 64 exact completed returns/journals/checkpoints, zero completed
reissues, native prototype/whole-envelope distinctions, and separate two pending
map reissues retain their existing scoped dispositions.

One packaging qualification is explicit: the corrected author's manifest names
`evidence/source-independent-manifest.json` as a relative receipt capture, but
that alias is not among its eight sealed files. Its absolute source-manifest
locator exists and matches the declared 29,888 bytes/SHA256 and our prior frozen
receipt exactly. This independent packet materializes those exact external
receipt bytes at that relative path. No publication image or source proof is
missing from this independent intake; the immutable author manifest is retained
unchanged, and its absent internal alias is not silently claimed present.

All eight actual author capsule files are authenticated. Three document-format
checks and strict forward/reverse checks of the exact three-path publication
patch pass. The final manifest binds these checks, the absent new-file identities,
the new report postimage, the external receipt resolution, and the old HOLD
manifest. No author source, test, README, plan, or frozen capture is modified.
There is no new runtime, install, build, test, compiler, original payload read,
source investigation, or screenshot run in this corrective review.

Root/publisher must still verify actual intake preimages/dependencies and pass
the current publisher gates, then publish these docs paired with the accepted
Array runtime. There is no standalone future-feature approval, completed npm
release claim, guard acceptance, or arbitrary mid-callback recovery guarantee.
