# Independent release-coverage repair acceptance

2026-08-27. **Accept the two scoped repairs at
c3fbda6279028fd2bde9f6d967970870ff7546aa.** Production, root configuration,
author consumers and historical expectations were read-only. This is a release
harness review, not new product, external-service or whole-suite acceptance.

## Exact original holes

- R1: `tests/fs/webdav/atomic-extension-independent/consumer.mts` now has its
  own executable group with an identity package.json beside the emitted program.
  Its unchanged source, public resolution and namespace assertions pass. The
  observed binding hook runs once; all three final HTTP-method observations are
  injected PROPFIND, not actual network. Real TLS programs stay compile-only.
- R2: the actual runner calls mandatory coverage validation before build and
  validates execution records after work. The original timestamp .test.mts
  cannot become a zero-execution success, including when nodeTests metadata is
  removed. A missing result record is rejected after its23 real assertions run.
  No arbitrary nonzero result, skipped test or unrecorded program is acceptance.

The original847dfd7 exit0/17-group/15-program qualification remains a real but
incomplete-coverage historical result. It is not changed to a failing product
gate or retroactively upgraded to the repaired result.

## Independent replay and controls

| Cohort | Observed result |
| --- | --- |
| Unchanged frozen current-consumer runner | exit0;18 strict groups,29 maintained inputs,16 emitted programs |
| Canonical timestamp runtime |20 controls plus3 mutant-kill assertions, not23 server successes |
| Original WebDAV loopback / S3 constructor |13/13 and6/6; no external-service claim |
| Existing paired negative types |exact2+5 diagnostic messages/positions/continuations |
| Unchanged new canonical repair tests |24/24; strict scoped types; exact npm-glob discovery |
| Additional independent helper controls |14/14 |
| Actual frozen runner controls |4/4 expected rejections |
| Independent guard-removal mutants |2/2 detected |

The four actual-runner controls are: the **original independent sentinel** in
a declared runtime; omitted runtime with nodeTests also absent; successfully
executed tests whose result record is deliberately suppressed; and removal of
the atomic consumer's required identity setup. The latter compiles but fails
ENOENT when the real emitted consumer executes. All mutations affect only
regular-file temporary copies, never the authoritative fixture/configuration.

The two known-bad runner mutants separately remove the precheck or postcheck.
Removing the precheck admits forbidden build/compile work before the remaining
postcheck rejects. Removing the postcheck with suppressed recording produces
a false-success return which the independent control detects. These outcomes
are mutant kills, **not passing consumer executions**.

Additional controls cover canonical inputs without explicit count metadata,
renamed canonical companions, legitimate service-only compilation, missing
counts, skipped/TODO/cancelled/failed counts despite status0, duplicate records,
extra result groups, loss of the atomic executable route, and an unknown path
under the formerly excluded `tests/integration/stream-five-public/` prefix.
The repaired snapshot no longer removes that prefix before census validation.
Metadata authorship remains trusted; this is not arbitrary malicious-config or
fabricated-provenance defense.

The final independent controls ran11:00:32.842Z–11:00:55.986Z, Node22.22.2,
Darwin arm64. Original18-group source/typed package inputs and all raw statuses
are in `evidence/current-consumers.json`. Canonical24 and final14/6 records are
separate. No executed node:test skips/TODOs in these observed cohorts.

## Classification and history checks

All177 .mts entries remain classified, with the same29 current,2 negative,
4 declaration,141 frozen-evidence and1 frozen-oracle denominator. Every actual
consumer input is byte-identical across the repair commit and its parent.
The only inventory-entry metadata change is the atomic consumer's route and
service qualification. All noncurrent identity pins still match.

Do not call every current census SHA a frozen identity: provider.mts already
differs from its census-time SHA at both847dfd7 and the repaired candidate.
Current inputs are authenticated from the selected commit at execution. Also,
two current stream consumers changed between847dfd7 and this candidate through
the separately authorized tree/file68→70 count migration2ae131a9. Those changes
are listed explicitly in `evidence/classification.json`, not attributed to this
repair. The original20 omission-classification cohort remains unchanged.

Own audit corrections remain visible: first the scratch audit overconstrained
current entries to census-time hashes, then to pre-tree/file bytes; the final
repair-parent comparison correctly distinguishes these scopes. The first
14-control capture used a different unknown prefix while labeling it the old
excluded prefix. `history/first-verify.mjs.data` and its result are retained;
the final unchanged-size cohort corrects the path and reruns all controls.
No product fixture or expected native output was changed to obtain acceptance.

## Reproduction and cleanup

Use runner/config bytes at c3fbda62, then:

```sh
node scripts/verify-current-consumers.mjs --source-commit c3fbda6279028fd2bde9f6d967970870ff7546aa
node tests/integration/qualified-current-release-repair/verify-regressions.mjs \
  c3fbda6279028fd2bde9f6d967970870ff7546aa /tmp/new-canonical-output
node tests/integration/qualified-current-release-inventory-independent/repair-review/verify.mjs \
  EXACT_NEW_QUALIFIED_RUN /tmp/new-independent-output
```

The original runner's own candidate-byte checks must pass. The independent
script reauthenticates its frozen helper inputs, checks execution records and
removes its exact scratch trees. The task-owned original qualified run is
removed after capture. No private engine, installed dependency, root dist,
production source or foreign staging was changed. MANIFEST authenticates the
retained source harness and evidence.

## Whole-gate boundary, separate from this acceptance

At the root's subsequent instruction, currentHEADa84dd195 includes env-S84ab66ca
whose independent review was still active. No whole gate was run under that
SHA. A genuine ancestor **b494675c34dc289f4ad4b10a9201e1211eb0a7d8** contains
c3fbda62,1ad428ed,7d7dce7c,3bf672f,b2821599 and the sealed SafeJS fixture commits
656ee2b0/1602a5d2, and excludes84ab66ca. Root authorized using such an ancestor;
its exact SHA was announced before prerequisite qualification or launch.
No source patch/cherry-pick, silent evidence filtering or current-HEAD relabeling.
Whole-gate results, native/SafeJS availability and per-failure routing belong
to that separate frozen capture, not this scoped green review.
