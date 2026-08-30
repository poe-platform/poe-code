# Additive N18 harness correction

Root adjudicated N18's original diagnostic word-list as a harness defect, not a
source bug. This correction changes only the N18 assertion in a derived runner
and adds its helper. The original sealed/private corpus, public preseal, initial
38 raw results, original regex failure and native captures remain byte-identical.
The exact two-hunk change is `runner.diff`; `derived/corpus.mjs` is unchanged.

## Corrected predicate

`n18-predicate.mjs` requires a valid nonzero command status, empty normal stdout,
and bounded nonempty error stderr. A diagnostic line must identify case-sensitive
`-L` or case-insensitive `level`/`depth` and state a valid positive constraint:

- `must/shall be [a] [strictly] positive [integer]`;
- `must/shall be greater than/above/>` a nonnegative integer;
- `must/shall be at least/>=` a positive integer;
- `must/shall be between` ordered positive integer bounds;
- an explicit `valid/allowed/expected/required range` with positive ordered bounds.

Recognized zero-inclusive, reversed, fractional, unsafe or contradictory bounds
are rejected. This is a bounded English diagnostic predicate, not an arbitrary
text parser. It does not hardcode the candidate's complete diagnostic or accept
an unrelated nonempty error. Original shared nonzero/nonempty checks remain;
the helper explicitly retains empty usage stdout and meaningful error stderr.

Justification comes from root adjudication, the predeclared candidate README's
positive `-L`/usage-error policy, and the original native positive-bound example.
It does not derive a new product requirement from a desired green result.

## Separate result, not a 38-case rerun

- Candidate remains `e2d1b9230f4304650651572395523ca9d1644e74`, using the existing
  frozen source and copied locked development dependencies.
- Exactly **one fresh N18 invocation** passes in 229 ms: product status 2,
  zero stdout bytes, 35 stderr bytes, zero filesystem calls.
- Product bytes/status equal the original N18 product observation. Native status
  1 and original diagnostic remain unchanged: **raw native mismatch**, not parity.
- The other **37 selections are reused**, not rerun. The adjudicated view is
  31 semantic passes (30 reused + one fresh), one accepted N16 profile difference,
  three unsupported and three characterizations. The latter seven are not new
  native-parity passes. `semantic-adjudication.json` maps every selection.
- Initial raw counts remain 30 pass, two fail, three unsupported and three
  characterizations. No historical result or original evidence manifest changed.

N16's root-link nofollow profile is accepted by root without a source fix and
remains native-not-parity. Ancestor-only behavior is our chosen profile, not a
literal user instruction. No source, root/default API, FS, core or contract edit
was made. Different-peer review is pending before any commit/integration handoff.

## Checks and reproduction boundary

The 31 nonproduct checks comprise eight positive examples, 22 rejection
counterchecks and one exact derived-diff/corpus hash check. They reject success,
empty/unrelated diagnostics, normal stdout and invalid zero-bound messages.

```sh
node --test tests/commands/filesystem-inspection-stress/tree/corrections/n18-positive-depth/predicate.test.mjs
```

That command executes no product or native oracle. Do not execute another product
case without new root authorization. `run-once.mjs` and the retained lock document
the single invocation already consumed; they are not a request to rerun it.

Before/after audits verify 97 original private artifacts, 316 original published
artifacts, 186 original raw files, 76 original coverage files and all 14,205 frozen
inputs unchanged. `CORRECTION-MANIFEST.json` adds hashes without replacing the
original manifests. Raw single-case observations, source-load audit, original
N18 failure copies and exact native comparison remain alongside this document.

No other 37-case rerun, native capture, broader regression suite, source fix or
public/full-gate claim accompanies this correction. All earlier coverage limits
remain. The single owned child closed normally; no service or watcher was started.
