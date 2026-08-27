# Two bounded jq review fixes

Read `REPORT.md` for results and limits. This is source-author evidence, **not
independent acceptance**. Old canonical tests, reviewer evidence and native
expected bytes are unchanged. Only four neighboring vectors were added.

Final source is `09926fb67452ca7db9bd793d87b78d2f41ff82be`; its structured SHA-256
is `913886e89fce8626d28f957d978243e3b8dd6bf94dd14348f5331f47607b4fb1`.
The hash uses the old unchanged `sourceSnapshot()` path/hash recipe, including
the owned production README. Original runners keep their old source pin.

## Read-only verification

From the repository root:

```sh
export STRUCTURED_HANDOFF=09926fb67452ca7db9bd793d87b78d2f41ff82be
export STRUCTURED_SHA256=913886e89fce8626d28f957d978243e3b8dd6bf94dd14348f5331f47607b4fb1
node --unhandled-rejections=strict --test tests/commands/structured-stress/jq-grammar-review-fixes/integrity.test.mjs
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/jq-grammar-review-fixes/limits.test.ts
```

Three integrity tests validate evidence, not three additional native semantics.
The six limits tests check work charging, cancellation, arity and output bounds.

## Optional fresh replay

Use new labels; artifact writers refuse overwrites and write only this subtree
through `apply_patch`. Do not rerun one-shot `audit.mjs` or `validate.mjs` over
existing evidence, recapture `native-frozen.json`, or reseal the manifest.

```sh
node tests/commands/structured-stress/jq-grammar-review-fixes/cohorts.mjs source fresh-source
node tests/commands/structured-stress/jq-grammar-review-fixes/cohorts.mjs compiled fresh-compiled
node --unhandled-rejections=strict --import tsx tests/commands/structured-stress/jq-grammar-review-fixes/focused.mjs source fresh-focused
node --unhandled-rejections=strict --import tsx tests/commands/structured-stress/jq-grammar-review-fixes/host.mjs compiled fresh-host
```

`common.mjs`, `build.mjs`, `cohorts.mjs` and `record.mjs` are thin adaptations of
the read-only source-review runners: explicit new handoff/hash inputs, owned
output paths and less duplicated command-log encoding. The original evidence
loader, direct/shell executor, schedules, comparator and source main harness are
unchanged. Full-root TypeScript emit stays in memory; the imported emitted ESM
rejects product source imports and never writes `dist`.

`focused.mjs` recaptures the prerequisite and all four reviewer vectors without
changing expected bytes, then freezes four bounded neighbors twice. Native use
is test-only, pinned to `/usr/bin/jq` SHA-256
`1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f`,
with an isolated empty cwd, explicit environment, 2-second timeout and 64-KiB
capture bound. No huge native allocations, subprocesses in product code, new
runtime dependencies, delegation or broader feature corpus.
