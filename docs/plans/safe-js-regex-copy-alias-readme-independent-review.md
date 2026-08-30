# Regex copy identity README: independent review

## Verdict

August 30, 2026. Aquinas independently reviews Curie's documentation candidate.
**DOCUMENTATION CONDITIONAL READY.** The two added sentences accurately describe
the narrow proposed public-copy identity contract. There are no documentation
findings. Final author source sealing, independent source acceptance and paired
publisher gates remain required; this is not a source or runtime approval.
The alias fix is not claimed as already released in guard 13.0.4.

Author manifest:
`/Users/kjopek/Workspace/poe-code-safe-js-regex-copy-readme-author/out/safe-js-regex-copy-readme/release-gated-candidate/manifest.json`,
SHA256 `7ce0d33d2fd2de832f762e6b2c31d10bc12e48194e9497cad070cdc34a5ce554`.
Pinned source index:
`/tmp/poe-safejs-copy-alias-20260830.Axog1k/postimages.sha256`, SHA256
`50987a10850c28f4dc7fbf8c7ed870f20f5d253de22eac9a0cd5efeea795484f`.
This five-postimage index is not represented as a final source manifest.

## Current base and exact publication selection

Fresh isolated review workspace:
`/Users/kjopek/Workspace/poe-code-safe-js-regex-copy-readme-independent-20260830`.
Clone and immediate `git pull --ff-only` succeeded at
`8411130b542921ad92fcf88c51e6ec66370281b4`. Root/ancestor AGENTS were read;
there are no additional instructions in `docs/AGENTS.md` or
`docs/plans/AGENTS.md`. Git object referencing does not share writable runtime
modules or caches. No dependencies were installed or source overlays applied.

Exactly three publication paths:

| Path                                                               | Base identity                 | Owner            |
| ------------------------------------------------------------------ | ----------------------------- | ---------------- |
| `packages/safe-js/README.md`                                       | Present, exact preimage below | Curie, unchanged |
| `docs/plans/safe-js-regex-copy-alias-readme-release-handoff.md`    | Absent                        | Curie, unchanged |
| `docs/plans/safe-js-regex-copy-alias-readme-independent-review.md` | Absent                        | Aquinas          |

The README preimage is 52,386 bytes, SHA256
`914eb56eff8eda9857ae51b687b630bb5e420ba415be0ff5eb1b409fc7f68b38`.
The current Git blob, review-workspace README and captured preimage are identical.
Its postimage is 52,672 bytes, SHA256
`820fd3d19777a46b103250d13683a1bf84cae4975f6561a1c5c1fa708732dc4e`.
The author's new handoff is 4,892 bytes, SHA256
`1f60d2cdeea5a70c2c67f5e7c39f39aa771b232492cb8a69ab6e2635c277f2a2`.
The final independent manifest binds this review's postimage and the complete
three-path patch. The five source prerequisite paths are excluded from this
documentation publication selection.

## Precise contract and preservation

At `packages/safe-js/README.md:427`, one paragraph adds exactly two sentences
after the existing explicit boundary-copy guidance. It says that one admitted
sandbox regex encountered repeatedly by `deepCopyFromSandbox` maps to one native
`RegExp` within that copy. Equal-but-distinct regex objects and separate copy
calls remain distinct. The second sentence expressly excludes a whole native
graph or prototype-equality guarantee.

This is a functional alias guarantee, not merely a prototype-domain disclaimer
or an assertion that native wrappers already had equivalent behavior. It is
limited to the named copier and per-copy identity. It promises neither global
pattern interning, cross-call identity, retroactive repair of old captures,
universal graph fidelity, native matching safety nor new compiler limits.
The README does not promise copying arbitrary custom regex properties or
re-reading changed fields into an already-created native copy.

Removing the new paragraph line and its added blank separator reproduces every
byte of the current README. All eight fenced examples and existing inline examples
are unchanged. Published guard budget/ownership qualifications, corrected Array
iteration/sort wording, String, Float, locale, Map/Set, host policy, browser/FS,
canonical names and recovery guidance remain untouched. There is no new example,
option, environment variable, flag or CLI change.

## Bounded source inspection

All five indexed source postimages are authenticated. The sole production file
is `packages/safe-js/src/interp/values.ts`, 32,735 bytes, SHA256
`637a4fcb523157cffd0363db439cb73faade991011ca38eb3d9720c018a924d4`.
Its current-base diff adds exactly three lines to the admitted regex branch:
look up the existing per-copy memo, return a hit, and memoize the successfully
constructed native regex. No other production bytes change.

`deepCopyFromSandbox` creates a fresh WeakMap for each public invocation at
`src/interp/values.ts:565`. The new key is the admitted sandbox object identity,
not its pattern or flags. That explains both repeated-reference sharing and
distinct-object/separate-call isolation without an interning cache.

In `copyFromSandbox` at line 780, depth/proxy checks, own brand validation and
`captureRegexData` still precede the new memo lookup. `captureRegexData` reads
own data descriptors for string source/flags and the cursor without invoking
their getters. Construction of the owned guard and source/flag preflight also
precede memo reuse. Only after a miss does the code allocate, construct the native
`RegExp`, assign `lastIndex`, retain its owned allocation and store the memo entry.
Cleanup remains in the existing `finally` block. No partially constructed value
is memoized by these three lines.

The source/flags/cursor capture and assignment bytes are unchanged. The source
does not mutate the original regex during this conversion. The first successful
native copy keeps the captured source, flags and raw cursor assignment; memo
hits share that object. Repeated encounters still perform preflight. Avoiding a
duplicate native construction/allocation is not a discount for executed work,
and the README makes no exact work-count promise. No admission, owner, getter,
function-import, hard-limit or native-matching rule is relaxed by this diff.
This is static inspection of the normal copy path, not a boundary-probing run
or a comprehensive security audit.

The new `values.regex-copy.test.ts` contains public-API assertions for repeated
references, equal-but-distinct objects, independent copies, source/flags/cursor,
unchanged original descriptors, nested collection aliases/cycles and ordinary
host arguments. These tests were read selectively, not executed here. Each of
the two existing compile-policy roots changes exactly one identity expectation
from `not.toBe` to `toBe`; source, flags, raw cursor and surrounding assertions
are unchanged. This records the intended functional repair rather than silently
treating the old alias loss as an acceptable native-prototype distinction.
Their baseline assertions and failed receipts remain source-review history.

## Source and release gates

Root reports 37 planned guard groups passed and four additional public-copy
identity assertions exposed the separate defect. Historical attribution to
13.0.3 is static, not a historical runtime execution in this lane; neither that
attribution nor the 13.0.4 observation is relabelled a guard-introduced regression.
The 13 new author passes are root-attributed, not independent documentation
review results. No full-suite, public-build or released-artifact PASS is inferred.

The existing README was underspecified about this identity relation, not falsely
claiming a released alias guarantee. The added text nevertheless documents a
real functional change and therefore cannot publish as a standalone clarification
ahead of its fix. The handoff consistently preserves that pairing requirement.

Before publication, obtain the final author source manifest matching these five
postimage pins, Laplace's final independent source result, and current publisher
preimage/dependency/composition gates. Publish the docs only with the accepted
copy-alias repair. A changed source image or newer README requires a bounded
delta review rather than transferring approval or overwriting newer content.
There is no source-READY receipt or successful release receipt certified by this
documentation packet, and no target version is assigned.

## Checks and ownership

The immutable independent capsule records authentication of the author's eight
indexed payloads plus manifest, the exact five-source index, selected source
excerpts and diffs, current preimages and absent plan identities. Three Markdown
format checks and strict forward/reverse checks validate the full three-path
patch. A new-file diff exit 1 with empty whitespace diagnostics is recorded as
the expected diff result, not hidden as a test failure.

Two reviewer metadata checks initially exited 1. The first used an unbounded
common-suffix calculation that overlapped the common prefix at an identical
blank line, incorrectly reporting one added line instead of two. A subsequent
one-line removal check correctly failed whole-byte equality with one extra
newline. Bounding suffix comparison so it cannot overlap the prefix establishes
the exact paragraph-plus-separator insertion, and removing both restores all
base bytes. Both failed checks are retained; no author source, runtime oracle
or test was changed to obtain approval.

Only lightweight metadata/hash/format/patch commands run. Prettier is loaded
read-only from an existing owned installation; no install is needed. This report
is the agent-executed Markdown review, not a standalone QA runner. No target
runtime, test, build, compiler, new screenshot, original archive read, security
probe, source/author edit, shared README edit, ledger/home/SKILL change, branch,
commit or push occurs. Earlier guard, Array and failure capsules remain unchanged.
The original user checkout is untouched, and no heavy worker is started.

## Source-progress supplement: four code pins unchanged

Root's later update reports a final five-path author source packet identified
by the partial prefix `9f6c81a...`, with independent default SafeJS 9,370 passes
and 39 skips, 13 alias tests, 110 guard tests, 315 adjacent tests, and passing
build/types/lint. It also reports the original four built SDK alias failures now
GREEN and four fresh reconciliation cases with exact zero additional host calls.
These are root-attributed progress updates, not new executions or a complete
authenticated final manifest in this README lane. No full SHA is invented from
the supplied prefix.

All four pinned code/test postimages remain the reviewed source basis. The fifth
path is the source author's plan, which still needs formatting. Root also reports
two extra reviewer accessor fixtures need setup correction: attempted mutation
of a nonconfigurable field fails before the converter is called. Those setup
failures do not establish a product defect. Their correction and the final source
review disposition remain source-owner/reviewer gates; this docs reviewer does
not run, modify or pre-approve the corrected fixtures.

**Documentation remains CONDITIONAL READY now; no wait for administrative plan
formatting is needed.** This supplement narrows the earlier exact-five-image
condition: the four code/test identities must match the recorded pins; a
format-only source-plan correction may legitimately change only that plan's hash.
Final source sealing must record the corrected plan identity and final reviewer
acceptance before paired publication. A plan-format-only change does not require
a new runtime review of these unchanged two README sentences. Any code or
contract change still requires bounded re-review.

The documentation claim stays solely per-copy repeated-regex identity and
distinct-object/separate-copy isolation, with no whole-native-graph guarantee.
Final source approval and publisher intake/release gates remain required, and
there is still no standalone documentation or already-released 13.0.4 fix claim.
The initial conditional capsule and its two reviewer metadata failures remain
immutable; this supplement adds coordination status without changing the source,
author docs or any runtime assertion.
