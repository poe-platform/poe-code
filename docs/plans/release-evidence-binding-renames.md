# Release evidence binding rename compatibility

## Scope

Repair the current jq-42 retained-evidence check on main at
`4491f7bb25638654c72170a7ab37f8f28af0ee20`. Preserve upstream
`f8d3103946274ec8629cfb1a01aa4e26a9d6346f`, all historical manifests,
receipts, captures and snapshots, and all 140 current comparisons.
Only the assigned evidence test and this plan change. Root owns integration,
commit/push hooks and release monitoring; this leaf does not install, rebuild,
run full suites or lint, commit, push, or change product code.

## Reproduction and inspection

From `packages/safe-bash`, Node v22.22.2:

```sh
node --import tsx --test --test-name-pattern='frozen historical evidence and retained non-native canonical seals remain intact' tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts
```

Before repair: one test fails, zero pass. The structured helper's current
digest is `867a73c52c69532d424141133b2d4201293f43deae19df7303b7be98e9871536`;
the historical expected digest remains
`58f64bcaaedc766a7b13a77195a93dd0886770ea20f6b9c57fbe032d642950b2`.
Running the entire evidence test before repair gives 35 passes and this one
failure. Inspecting all 140 bindings finds only this new mismatch and the
four already-approved exact spelling migrations.

The 2,041-byte retained after-native helper snapshot is byte-identical to
the parent of upstream f8d310394; the 2,053-byte current helper is identical
to that commit's helper. The complete difference is two unused local
destructuring bindings: `_stdoutBytes` to `ignoredStdoutBytes` and
`_stderrBytes` to `ignoredStderrBytes`. Current-byte offsets are 1350 and
1383 respectively. Property names, values, rest binding and result are
unchanged. Reversing only those two replacements reconstructs the complete
historical snapshot byte-for-byte.

## Repair

- Add one inline maintenance binding for that exact path, both whole-file
  sizes/digests, and the two exact offset/spelling replacements. No new
  receipt file is necessary; no existing receipt changes.
- Authenticate the current image, reverse only the two reviewed replacements
  in memory, and require the original expected digest and exact retained
  snapshot. Do not normalize arbitrary identifiers or accept new hashes alone.
- Retain all 140 current comparisons, all 23 historical snapshots, and the
  four existing spelling migrations. Report 135 byte-unchanged current
  comparisons plus four spelling migrations plus one binding migration.
- Add in-memory controls for exact admission and rejection of changed paths,
  offsets, ordering, replacement membership/spellings, image bindings,
  expected digest, same-size edits, extra bytes, partial renames, property
  changes, use of ignored bindings, historical snapshot mutation and rollback.

## Selected validation

From `packages/safe-bash`:

```sh
node --import tsx --test tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts
node --import tsx --test tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts tests/commands/structured/cli.test.ts tests/commands/structured/byte-ownership.test.ts
```

These are bounded evidence and helper-consumer checks, not a full gate or
release qualification. On September 1, 2026, Node v22.22.2:

- The original exact test changes from 0 pass / 1 fail to 1 pass / 0 fail.
- The evidence file passes all 54 cases: all 36 existing cases, one new
  exact-image admission and 17 new negative controls.
- Evidence plus the two helper-consumer files passes all 100 cases, with
  zero failures, skips, cancellations or TODOs. The combined invocation used
  `--test-reporter=spec`; the evidence-only first green run used
  `--test-reporter=dot`.
- Diagnostics retain 140 current comparisons and 23 historical snapshots:
  135 unchanged images, four existing spelling migrations and one exact
  binding rename migration. All original manifest/receipt assertions pass.

No product sources or historical evidence files were edited. Full gates and
published-artifact verification remain with root.

## Concurrent upstream integration

After the focused repair commits as `cd0d1896b`, upstream independently lands
`0eb0c61fd` for the same mismatch. Preserve its implementation, assertions,
negative controls and plan unchanged when resolving the merge. Retain only four
additional controls from this repair: partial stdout/stderr renames, changed
destructuring property names, and using a discarded binding. Do not retain a
second implementation or duplicate upstream's existing negative controls.

The preceding 54/100 counts describe the independently tested local repair,
not the integrated candidate. Revalidate the resulting upstream implementation
with these additional controls, then run normal commit/push hooks and monitor
the actual containing release. Historical manifests and snapshots stay intact.

The integrated candidate passes all 93 selected cases: 47 evidence checks and
46 helper-consumer checks, with zero failures or skips. All 140 comparisons and
23 original snapshots remain checked. The four added cases change no runtime
or upstream migration behavior.
