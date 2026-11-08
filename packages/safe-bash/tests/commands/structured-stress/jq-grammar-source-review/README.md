# Independent source-verifier evidence

Read `REPORT.md` first; machine-readable adjudication and exact failing
reproductions are in `review.json`. **No final acceptance:** missing `isfinite`
and aliased-container NaN ordering both fail source and emitted-root execution.

This subtree alone was edited. All captures and command artifacts are append-only
and created with `apply_patch`. Existing source, previous reports, frozen vectors
and canonical assertions are read-only. No runtime dependency was added.

## Integrity checks

From the repository root:

```sh
node --unhandled-rejections=strict --test tests/commands/structured-stress/jq-grammar-source-review/validation.test.mjs
(cd tests/commands/structured-stress/jq-grammar-source-review && shasum -a 256 -c MANIFEST.sha256)
```

The five validation tests check **artifact integrity and retained failures**,
not five new native-semantic successes. They continue to enforce the handoff
source hash; a later source handoff requires a separately coordinated review.

## Replay without overwriting evidence

Use unique labels and the original pinned handoff, never delete a report to
rerun it. These commands intentionally exit1 while native differences remain:

```sh
node tests/commands/structured-stress/jq-grammar-source-review/cohorts.mjs source fresh-source
node tests/commands/structured-stress/jq-grammar-source-review/cohorts.mjs compiled fresh-compiled
```

Adding future artifacts changes the file inventory; preserve this manifest as
the seal of this handoff. Do not reseal it over new observations.

- `cohorts.mjs`: read-only preparation harness/evidence reuse, unchanged original
  schedules and comparisons; main uses the original source harness.
- `build.mjs`: full compiler-API emit retained in memory, emitted public root
  import with source-runtime-import rejection; no `dist/` writes.
- `validate.mjs`: one-shot broad/old-safety/new-author/scoped/global command
  capture. Every nonzero status and exact TAP output is retained.
- `record.mjs`: watchdog/strict-rejection wrapper for one labeled command.
- `focused.mjs`: one-shot pinned native capture and replay of four bounded
  inspection-driven neighbors in two separately frozen groups. Do not recapture.
- `host.mjs`: one-shot host failure identity/closure/effects evidence, not native
  parity and not approval to replace canonical assertions.
- `audit.mjs`: immutable provenance, baseline classification, source diff and
  exact failing byte tuples. Its first baseline-selection error is disclosed.

Raw evidence includes the original2157 pass under product movement and exactly
one bounded2157 rerun, also under movement. No whole-product clean-head result
is claimed. `MANIFEST.sha256` covers all final owned files except itself.
