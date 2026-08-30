# Public regex copy identity: README release handoff

## Status and ownership

August 30, 2026: **AUTHOR DOC CANDIDATE; PAIRED FIX RELEASE REQUIRED.**
This documentation is not independently approved and must not publish alone.
The alias repair has no assigned release version here; it is not claimed as
part of guard 13.0.4. Final author source seal and fresh Laplace review remain
pending at this checkpoint.

Fresh isolated workspace:
`/Users/kjopek/Workspace/poe-code-safe-js-regex-copy-readme-author`.
Clone followed by `git pull --ff-only` reached
`8411130b542921ad92fcf88c51e6ec66370281b4`; applicable AGENTS were read.
Root reports guard 13.0.4 published on August 30, 2026 at 15:28:17 UTC, including
Array 13.0.3. This lane does not poll or independently certify release status.

Exactly two publication paths:

- `packages/safe-js/README.md`: present at base, 52,386 bytes, SHA256
  `914eb56eff8eda9857ae51b687b630bb5e420ba415be0ff5eb1b409fc7f68b38`.
- `docs/plans/safe-js-regex-copy-alias-readme-release-handoff.md`: absent at base.

## Why this small clarification is useful

The existing custom-module instructions name `deepCopyToSandbox` and
`deepCopyFromSandbox` but do not specify repeated-regex identity or cross-call
isolation. Two sentences after that instruction describe the intended public
contract: one admitted sandbox regex maps to one native RegExp within a copy;
equal-but-distinct regexes and independent copy calls stay distinct. The scope
is expressly not whole native graph or prototype equality.

No new example, fence, flag, option or environment variable is introduced.
All existing text, including guard compilation and stale-wrapper restrictions,
Array mutation/sort qualifications, String, FS/browser and recovery contracts,
remains byte-identical after removing the new paragraph. All eight fences and
existing inline examples remain unchanged. Physical compilation charges and
native CPU guarantees are not broadened by this identity clarification.

## Candidate source basis, not final source approval

Supplied source packet:
`/tmp/poe-safejs-copy-alias-20260830.Axog1k`.
Its `postimages.sha256` is verified as
`50987a10850c28f4dc7fbf8c7ed870f20f5d253de22eac9a0cd5efeea795484f`.
All five indexed postimages match their listed hashes. The final author seal
is still pending, so this index is the current pinned input, not a fabricated
final manifest. The capsule records the index and selected source facts.

Static inspection of `packages/safe-js/src/interp/values.ts` confirms that
`deepCopyFromSandbox` creates a fresh WeakMap per call. The three-line repair
uses that map only in the admitted regex branch: proxy/brand/own-data capture,
owner admission and preflight still precede memo lookup; successful native
construction, cursor assignment and retained allocation precede memo insertion.
There is no pattern interning or cross-copy cache. Repeated encounters still
perform preflight; only duplicate native construction/allocation is avoided.
The README intentionally makes no exact work-count or universal graph promise.

The candidate test root `interp/values.regex-copy.test.ts` covers repeated and
distinct objects, separate public-copy isolation, cursor data and nested
aliases, among other bounded controls. Root reports 13 new passes; this author
does not run or independently accept them. The two existing policy tests change
only their previous alias-loss identity expectations; the old expectations and
failures remain source-review evidence, not erased by this documentation.

Root reports all 37 planned guard groups passed and four extra assertions
exposed this separate baseline public-copy defect. The historical 13.0.3
attribution is static, not a historical execution by this lane. Do not call
this a guard-introduced regression, retroactive old-capture repair, or alias
support already released in 13.0.4. The source packet's author plan and any
later validation receipts retain their own as-of qualifications.

## Intake and scoped checks

Require the final source seal, Laplace's independent result, Aquinas's review
of this two-doc packet and publisher current-preimage/composition gates. Pair
the README with the approved copy-alias repair only. If source semantics or
the README baseline changes, review that delta before intake; do not silently
transfer approval or overwrite upstream text.

The immutable docs capsule includes exact pre/postimages, the two-path full
patch, source-index provenance and scoped format/strict-patch receipts. A
removal check must recover the entire current README, including all fences.
This is a Markdown handoff, not an executable QA runner. No runtime, install,
build, compiler, example, test or screenshot runs in this lane. No source,
ledger, home/SKILL, original archive, other workspace, branch, commit or push
is modified. Prior guard, Array and failure capsules remain untouched.
