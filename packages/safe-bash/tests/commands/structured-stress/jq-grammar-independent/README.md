# Independent jq grammar verifier preparation

**PREP ONLY. No new virtual implementation has been imported or executed by this
leaf. No author handoff, source approval or canonical-test proposal approval.**
The native capture ran on 2026-08-27 at 01:39:09 UTC, before the reusable virtual
runner was written. This is independent preparation, not a wait for the author.

## Frozen evidence

- `native-frozen.json`: 35 independently designed native vectors, two identical
  captures each; 76 jq invocations including version/build queries and individual
  pipeline stages. Exact status, stdout/stderr hex, fixture bytes/effects,
  argv, environment, executable hash and pre/post source snapshots are recorded.
- Native executable: `/usr/bin/jq`, `jq-1.7.1-apple`,
  `--with-oniguruma=builtin`, SHA-256
  `1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f`.
- `manifest.json` and `MANIFEST.sha256`: seal the owned preparation files and
  all 235 historical structured test/evidence files present at accepted evidence
  commit `bb1ceabef3a3a4c3791af64d9efb7384f6ca773f`. No historical file is edited.
- Accepted source context is `0278a3032d7851de4c2f5141bbc863cdf310c39d`, structured
  SHA-256 `30c573976d4dddb5e8e545f8e3914aeb166e0232f92ed0dfe20514205056db8f`,
  using the previous review's unchanged `sourceSnapshot()` algorithm.
- `canonical-red-inventory.json` maps all 22 historical failing names to five
  canonical files, hashes and individual native94 probes. Nineteen are stale
  expectation candidates with native-exact mapped observations; three are mixed
  groups that also contain actual diagnostic/acceptance differences. This is
  preliminary evidence routing, not approval to change any assertion.
- `RESEARCH.md` records official documentation/tagged source research and the
  measured profile-specific observations. No author grammar examples were used.

## Denominators and baseline

| Cohort | Vectors | Planned executions | Historical result |
| --- | ---: | ---: | --- |
| New grammar | 35 | 178 | Native freeze only; virtual not run |
| Whole old main | 256 | 790 | 790/790 accepted bounded observations |
| Whole old legacy | 94 | 376 | 45 exact / 49 nonexact; 180/376 executions exact |

The 256 main vectors comprise historical155 + additive81 + reviewer20.
Original42 (84 executions) is a subset, not an additional denominator.
Legacy94 retains all **43 diagnostic-only and six acceptance differences**;
neither group is skipped, waived, normalized or rebaselined.

New vectors run direct and public Shell routes, whole and bytewise input.
Three short critical vectors additionally run **every cut including empty
endpoints**: malformed NaN suffix, initial BOM + leading-zero scalar, partial
BOM. Two vectors are actual public Shell pipelines, with all direct stages also
checked. File routes check exact contents and namespace preservation. Token
lengths 255/256/257 and 4095/4096/4097 share one bounded vector, not a Cartesian
expansion. New planned executions total 178; the three cohorts total 1,344.

## Preparation checks — safe now, no product import

From the repository root:

```sh
node tests/commands/structured-stress/jq-grammar-independent/run.mjs --check
node --test tests/commands/structured-stress/jq-grammar-independent/validation.test.mjs
(cd tests/commands/structured-stress/jq-grammar-independent && shasum -a 256 -c MANIFEST.sha256)
```

`capture.mjs` and `seal.mjs` are retained for capture provenance. They refuse to
overwrite the frozen native file or manifest. **Do not delete the freeze to rerun
them.** No expected bytes are derived from virtual output. Generated text files,
including native fixtures and reports, use `apply_patch`; only owned temporary
fixture directories are removed in capture cleanup. There are no dependencies
added; the later virtual runner uses the repository's existing `tsx` tooling.

## Post-handoff review — different independent reviewer

Coordinate a source/build freeze with root first. Independently verify the
compiled public entry corresponds to the handed-off source; this runner records
compiled-tree hashes but cannot establish build provenance. Root/author, not this
leaf, owns building outside this subtree. Then use the **handoff's** expected
hashes, not hashes of whatever uncoordinated worktree happens to be present:

```sh
STRUCTURED_SHA256='<handoff structured hash>'
PRODUCT_SHA256='<handoff whole src hash>'
node tests/commands/structured-stress/jq-grammar-independent/run.mjs \
  --post-handoff --entry dist/index.js \
  --structured-sha256 "$STRUCTURED_SHA256" --product-sha256 "$PRODUCT_SHA256" \
  --report post-handoff-01
```

This runs **all 35 + all 256 + all 94**, with no selection option. Exact
status/stdout/stderr comparison includes every direct pipeline stage and count.
The source advisory route reuses `loadPublicHarness()` unchanged for main790;
compiled execution uses the same immutable vectors/schedules and old
`chunks`/`collector`/`quote` helpers through an API-injected blackbox adapter.
It does not execute old report-generating scripts in their immutable directories.

Each worker has a 180-second process watchdog, strict unhandled rejection mode,
1.5-second per-invocation cancellation signal and existing bounded jq/output
limits. Source/tooling and compiled-tree hashes are recorded around import and
each cohort. Changed hashes or frozen files invalidate the run (exit 2);
comparison failures exit 1; complete exact stable observations exit 0.
Pre/post equality does not exclude transient ABA edits. A watchdog failure is
not a partial pass. Reports are new owned `post-handoff-01.json` files and cannot
overwrite existing artifacts. A different name is required for a later attempt.

Optional moving-source advisory, **not run during this preparation**:

```sh
node tests/commands/structured-stress/jq-grammar-independent/run.mjs \
  --advisory --report advisory-01
```

## Separate safety and canonical review gates

The unchanged seven independent host-stderr/sink boundary tests previously passed
three times; this prep does not claim to rerun or replace them. After handoff:

```sh
for repetition in 1 2 3; do
  node --unhandled-rejections=strict --import tsx --test \
    tests/commands/structured-stress/jq-42-independent-review/failure-boundaries.test.ts || break
done
```

The reviewer should retain their dated outputs and use an external process
watchdog for these standalone tests. They use source imports, so report them
separately from the compiled blackbox cohort. Binary/sink/cancellation and budget
controls in existing canonical suites remain required; grammar results do not
establish those guarantees.

The author must submit a **TEST-ONLY proposal before canonical changes**. Audit
each of its 22 named-test deltas against the inventory, unchanged native94 bytes
and historical fixtures/results. In mixed tests preserve valid malformed-input
rejections, division-by-zero behavior, completed-prefix and quota assertions;
do not replace whole tests or blanket-refresh snapshots. Real implementation
diagnostic differences still require source fixes even when an old regex is
stale. This runner deliberately rejects changes to any frozen canonical file:
run the pre-application gate before root routes a separately approved canonical
application. Any later approved baseline belongs to new dated evidence, never
to a rewrite of this preparation or prior reports.

No source/canonical/archive/root/FS/shell edits, no installation, no foreign
uploads, no native subprocess in product code, no recursive delegation. Passing
these bounded cases would not establish full jq parity, full shell support,
project closure, 72 hours of work or superiority over just-bash.
