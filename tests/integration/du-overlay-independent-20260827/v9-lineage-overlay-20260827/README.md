# V9 lineage boundary overlay

This is a one-file overlay for the immutable V9 freeze at
`1b2ddea9e38b25cc91134a2f35a318e27f4d7c29`, candidate
`9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`. It responds only to the frozen
harness bookkeeping failure recorded by the independent Raman commit
`b3f45fa796282ef644729af36f9d41fc37693bd8` in `VERDICT.md` and
`fresh-source.stderr.data:45`. That replay's 40 `ok` markers remain raw markers,
not an accepted 40/40 result; no replay or downstream stage was rerun here.

## Exact change

`verify-v5.patch.data` changes only `harness/verify-v5.mjs`:

- It replaces display-title prefix classification with an explicit, validated
  map of stable IDs `V5-001` through `V5-040`. The frozen partition is 31
  historical, 2 lifecycle and 7 observer-policy records; `V5-024` is explicitly
  observer-policy. Unknown, duplicate, missing or malformed IDs and invalid
  lineage categories fail closed.
- It constructs and writes the complete JSON receipt before the unchanged
  31/2/7 report assertions. A report-boundary failure therefore remains nonzero
  but retains the full observations.

No record call, case input, executable case assertion, budget, order, marker,
product source or original V9 file is changed. `manifest-delta.json` binds the
23-file base inventory, the single changed file and all 22 untouched files.

## Authenticate and apply

From the repository root, first authenticate the immutable Git inputs and the
derived patched bytes:

```sh
node tests/integration/du-overlay-independent-20260827/v9-lineage-overlay-20260827/overlay.mjs verify
```

Materialize the base from the exact commit into a new reviewer-owned directory,
never from mutable `HEAD`:

```sh
git archive --format=tar --output=/reviewer-owned/v9-base.tar \
  1b2ddea9e38b25cc91134a2f35a318e27f4d7c29 -- \
  tests/integration/du-overlay-independent-20260827/approved-v9-9a5a6f92
tar -xf /reviewer-owned/v9-base.tar -C /reviewer-owned/materialized
node tests/integration/du-overlay-independent-20260827/v9-lineage-overlay-20260827/overlay.mjs apply \
  /reviewer-owned/materialized/tests/integration/du-overlay-independent-20260827/approved-v9-9a5a6f92
```

`apply` first requires the exact complete base inventory, changes only
`harness/verify-v5.mjs`, then requires the complete overlay inventory. It rejects
a wrong commit, wrong base harness, missing/new entry, or changed untouched file.
It is intentionally not idempotent: a second application is rejected because
the input is no longer the authenticated base.

## Raman replay hook requirement

The immutable base `replay.mjs` cannot directly execute the patched tree. Its
bootstrap and materialized paths repeatedly require every file to match the
original `MANIFEST.json`, including `harness/verify-v5.mjs` (base lines 299,
316, 382, 626, 682 and 703), and the bootstrap authenticates its own runner
bytes. Updating either `replay.mjs` or the base manifest would be a second base
file change and is outside this overlay.

For the one root-authorized full replay, Raman must use reviewer-owned
orchestration that:

1. authenticates and materializes the unchanged base freeze before applying the
   overlay;
2. authenticates `manifest-delta.json` and `verify-v5.patch.data`, applies the
   overlay only to the V5 harness, and verifies all 22 untouched files against
   the delta;
3. routes every base-runner V5 invocation to those exact patched harness bytes,
   preserving its original argv, environment, ordering, timeouts and case code;
4. uses overlay-aware pre/post inventory checks for the changed harness while
   retaining the base checks for every untouched file; and
5. records the orchestration adjustment separately. It must not silently weaken
   the immutable runner's original-manifest checks or edit the frozen manifest.

This handoff does not authorize this author to create that runner adjustment or
to perform the replay.

## Focused controls

Run only the bounded controls with:

```sh
node tests/integration/du-overlay-independent-20260827/v9-lineage-overlay-20260827/focused-controls.mjs
```

They evaluate the exact extracted patched regions with synthetic receipts and
authenticate the overlay. They do not import product modules, run the 40 cases,
build/package, invoke native DU, or run the 128 regressions. The retained output
and exit metadata are `focused-controls.stdout.data` and
`focused-controls-result.json`.
