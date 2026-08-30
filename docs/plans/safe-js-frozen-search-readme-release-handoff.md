# Frozen RegExp search: README accuracy handoff

## Status and exact ownership

August 30, 2026: **AUTHOR DOC CANDIDATE; INDEPENDENT REVIEW AND PAIRED SEARCH
FIX PUBLICATION REQUIRED.** No source approval, final target version or release
success is assigned here. The frozen-search repair is not claimed as already
released with the copy-alias fix in 13.0.5.

Fresh isolated workspace:
`/Users/kjopek/Workspace/poe-code-safe-js-frozen-search-readme-author`.
Clone followed by `git pull --ff-only` reached
`5dafe7a59bf21da7365befe60e6b4d8d901e8669`; applicable AGENTS were read.
Root reports actual 13.0.5 alias publication. Older source/reviewer reports
retain their as-of pending-artifact qualifications; this lane does not poll or
independently certify the release.

Only two publication paths are owned:

- `packages/safe-js/README.md`: present at base, 52,672 bytes, SHA256
  `820fd3d19777a46b103250d13683a1bf84cae4975f6561a1c5c1fa708732dc4e`.
- `docs/plans/safe-js-frozen-search-readme-release-handoff.md`: absent at base.

## Accuracy decision

The current README lists regex-aware `search`, supported flags and compilation
limits, and documents per-copy native regex identity. It contains no raw
`lastIndex` caveat. The narrow frozen-search fix needs no new feature example,
but its remaining raw-cursor gaps warrant one Gotchas bullet rather than a
blanket native-parity implication. This is not a permanent accepted limitation
or a waiver of the user's broader JavaScript scope.

The new bullet states the current guest assignment behavior and explicitly
keeps the raw gaps open. It does not describe arbitrary cursor values as
normalized compatibly, expand native graph/prototype equality, or advertise
new flags, public options, environment variables or native CPU guarantees.
Removing that exact bullet must recover the entire base README. The released
two-sentence copy-alias contract, guard, Array, String, FS/browser and every
other upstream line remain unchanged, including all eight fenced examples.

## Source and qualification basis

Author plan, read-time snapshot:
`/Users/kjopek/Workspace/poe-code-safejs-frozen-search-20260830/docs/plans/safejs-frozen-regexp-search-20260830.md`,
SHA256 `b4410029c76452102836d53aee8aa4a5e1c48bb9e4610492868d3ea9f21e0d6f`.
The final three-path source seal is pending. This plan hash is not invented
final-candidate authorization or a promise that the live plan will not change.

Independent LIGHT report, read-time snapshot:
`/Users/kjopek/Workspace/poe-code-o09-implementation-review-vaxcfr/docs/plans/safejs-frozen-search-independent-light-review-20260830.md`,
SHA256 `a6ddbbaf19427b94e6f0a8dfff31c2335fa663d33a7671ea7b6a092bce656530`.
Its verdict is no static blocker in the two-write correction, qualified for
finite independent validation, not runtime READY or release approval.

Current base `packages/safe-js/src/interp/methods/regex.ts:42` assigns
`target.lastIndex = Number(value)`. Current `methods/string.ts` has the two
unconditional writes in its search branch. The author/reviewer describe a
candidate changing only those writes to `Object.is`-conditional assignments,
preserving required-write errors, negative zero and immediate abrupt exit
without finally restoration. No owner/accounting changes, native matching
fallback or `y` activation are part of that fix. This docs lane inspects the
current source and supplied reports, not a final source seal or fresh runtime.

The author plan identifies exactly three remaining raw-cursor observations:

- Frozen string cursor `"0"`: raw string preservation, one observation.
- Object cursor with `valueOf`, mutable receiver: raw identity and coercion
  ordering, one observation.
- Object cursor with `valueOf`, frozen receiver: raw identity and coercion
  ordering, one observation.

They remain unexecuted in the supplied scoped review and unresolved by this
two-write repair. Their original expected event and identity oracles remain
for later work; no substitute normalized numeric oracle is invented here.
Fourteen separate `y`/`gy` observations also remain unexecuted and open: four
required-write source, four caught source, two negative-zero source and four
original public observations. The README's existing rejection of `u`/`y`
remains unchanged. None of these 17 excluded observations is counted as passed.

## Preserve evidence boundaries

The two initial host-error-instance expectations were corrected to the existing
public rejection-record contract, not repaired by production changes. The
global `/a/g` controls still require rejection named `TypeError`; the native
oracle still requires native TypeError. This does not establish equal host
error prototypes, messages or stacks. A fulfilled `{ ok: false }` is not an
acceptable replacement for those rejection controls.

Keep initial source 6-fail/7-pass, qualified source 4-fail/9-pass and built
4-fail/9-pass receipts. Author GREEN is the same 13 recipes at source and built
boundaries, not 26 distinct recipes: 13 source and 13 built comparisons. The
3,016 regression total includes the 13 new tests; do not add them again. These
are attributed author observations, not executions or independent acceptance
by this README author. No raw failure, observation or original oracle is erased.

## Intake and scoped document checks

Require the final three-path author seal, independent runtime review, Aquinas
doc review and publisher current-preimage/composition gates. Only pair this
README with the approved frozen-search repair; no standalone publication or
claim of support already released in 13.0.5. Changed source/report bytes need
delta review before transferring these qualifications.

The immutable docs capsule contains exact README preimage, both postimages,
full two-path patch, read-time report snapshots and scoped format/strict-patch
receipts. The single-bullet removal and eight-fence checks establish complete
upstream preservation. This Markdown handoff is agent-executed QA, not a
standalone executable runner. No runtime, example, screenshot, install, build,
test or compiler runs here; no source, ledger, home/SKILL, original archive,
other workspace, branch, commit or push is modified. Older capsules stay intact.
