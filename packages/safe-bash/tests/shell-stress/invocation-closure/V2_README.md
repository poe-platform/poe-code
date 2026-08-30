# V2 native-role fixture correction

**Postfix checkpoint completed:** corrected34 + registry1 pass; original34 is
32/34 with truthful role conflicts retained. See `V2_POSTFIX.md` and
`v2-postfix-summary.json` for scope, raw losses and the invalidated global guard.
The preparation/wait history below remains unchanged historical context.

This is a new, separately named cohort, not a correction to old results.
Original cases/probe/holdout/native files and the original **31/34 d02c3b5**
evidence remain immutable. Native printf is a builtin; virtual printf really is
a registered command. Reporting that difference was truthful, not a production
classification defect. No builtin-label substitution is allowed.

`v2-cases.ts` derives all 26 rows from the original module and changes only the
queried introspection operand in `query-V-verbose` and `type-multiple-status`:
`printf` becomes actual builtin `true` in command-V/type queries. The later
status-printing `printf` output utility is untouched. Function/VFS/missing-name,
status and output assertion structure remain; all other 24 rows are identical.
Exact before/after source strings are in `v2-preparation-audit.json` and
`v2-native.json`. There is no per-case oracle or label normalization.

The **whole 26 × both pinned real profiles = 52** native rows were freshly
captured, plus four actual version/argv0-mode probes. Both actual bash/sh roles,
locale, child-interpreter symlinks and shebang rendering match the original
protocol. Exact executable hashes, argv, env, input/output bytes and fixtures
are retained. Headers differ by interpreter profile and are never called
byte-identical. All 24 unmodified rows per profile have identical source, argv,
env, input, rendered fixtures and result bytes/status to the original capture.
The existing isolated-cwd → `/work` semantic mapping is explicit; raw comparisons
still retain path differences. No diagnostic normalization is added.

`v2-holdout.test.ts` is **34** rows: new native-role26 plus the same eight host
cases executed through the unchanged original probe. A separately counted
**one-test** `v2-registry.test.ts` asserts truthful registered printf/plugin
classification versus builtin true and then actually dispatches both commands.
It does not alter or replace the original host tests.

## Preparation commands and disposition

```sh
node --import tsx tests/shell-stress/invocation-closure/v2-native.ts
node --import tsx tests/shell-stress/invocation-closure/v2-verify.ts v2-preparation-types.json prepare-v2
node --import tsx tests/shell-stress/invocation-closure/v2-preparation-audit.mjs
```

Scoped typecheck: exit0, **208** starting-listed inputs with stable hashes.
Preparation ran no virtual cohort while the author writes. A separate atomic
fixture/native-proof commit precedes any postfix acceptance. Evidence writes
refuse overwrite. The readiness wait uses only the new discovery-fixes READY
marker and is capped at 180 seconds; its exact outcome is recorded separately.

After READY, the guarded `v2-verify.ts` stages are: `new` (original34 unchanged),
`v2` (corrected34 plus registry1), `legacy` (72+132), `previous` (file58 and selected
173), `author` (211), the exact newly handed-off author-fix cohort, and `types`
(global/build/benchmark noEmit). Every run has a fresh pre-enumerated input list
and actual product TS import proof. Original57 virtual comparisons reuse the
already refreshed d02c3b5 native57 captures; no redundant native57 probes.

Original expected postfix outcome is 32/34, with the two legitimate registry-role
differences still red. That is a forecast, not a measured pass. V2 must separately
pass its assertions without changing role labels or diagnostics to green.
All historical raw losses, unsupported policies and previous red/seal evidence
remain. The whole26 retains its original read-N byte/NUL rows; no paused-NUL,
lifecycle, known first-read, remote/full-suite/source-eval/JSON/BOM extras.

## Actual preparation handoff

Fixture/native-proof commit: **225f992f0dde918c1a3e169fccb81d547d783cb2**.
The single READY wait ran **2026-08-27 01:44:07.963–01:47:02.967 UTC**,
175.004 seconds, under the 180-second cap. READY was absent and the watcher
exited. **No original34/v2-34/registry1 or other runtime replay ran.** Root can
resume after the source owner's discovery-fixes READY handoff.

The follow-up verifier wiring explicitly guards v2 probes/oracles and includes
the observed author-fix test path `tests/shell/invocation-discovery-fixes.test.ts`.
No author expectations were copied. Scoped type-only follow-ups and final
original-file/process guards are retained in `v2-final-preparation-types.json`,
`v2-handoff-types.json`, `v2-ready-wait.json` and `v2-handoff-audit.json`.
These compiler snapshots do not establish source acceptance while the author
is still writing. Original 31/34 and all prior native/raw losses remain unchanged.
