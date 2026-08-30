# Independent mixed-binding closure — August 27, 2026

## Bounded verdict

**The mixed-package binding defect from31e24055 is fixed on
a01310c5571dfda2aae4c6c8cc185e2530a01e89.** Legitimate consumers still qualify;
the actual mixed-build full warm command now exits2. No additional current
binding defect was reproduced by the bounded controls. This is not whole-gate,
provider, product runtime or general compatibility acceptance.

The requested **exact21-control cohort is retained unchanged**, except for its
explicit candidate literal. Its raw result remains **20 pass /1 fail /0 skip**,
but the failure is now a stale **diagnostic-wording assertion**, not the original
mixed-binding defect. No old assertion or result was rewritten:

| Same21 controls | Before b9559de5 | After a01310c5 |
| --- | --- | --- |
| Mixed candidate root plus foreign contracts |incorrectly passes qualification; control fails |correctly refuses; control passes |
| Real repository-src fallback |refuses with old text; control passes |still refuses; old `/candidate build/` text assertion fails |
| Other19 controls |pass |pass |

The remaining exact assertion expects `candidate build`. The actual new error
is `foreign candidate declaration/source fallback: virtual-bash -> …/src/index.ts`.
The compiler itself exits0, the binding guard rejects, and the helper process
exits2. A separate current semantic control confirms precisely that behavior.
This review does **not** silently migrate the old assertion or claim21/21.

## Independent execution

| Observation | Actual result |
| --- | --- |
| Exact old cohort on fixed source |20/21; zero skips; one preserved text-only mismatch |
| Extra closure checkpoints |6/6; zero skips |
| Actual compiler/binding near-neighbors within one checkpoint |11/11 |
| Existing mandatory-runtime-coverage controls in exact cohort |24/24; not24 service passes |
| Fresh `npm run typecheck:all`, two independent freezes |exit0, exactly one build per invocation,28 compiler phases |
| Global source/tests and selected-GNU dedicated consumer |exit0 |
| Strict current source / copied-build groups |3/3 and19/19 |
| Legitimate exact negative diagnostics |unchanged1+2+5 |
| Missing new candidate export, without alias |actual TS2305 |
| Original mixed-package mutation, full warm `npm run typecheck` |exit2; source groups pass, exactly the affected moved group refuses |
| Restored old substring guard mutant |forbidden acceptance reappears; same status2 assertion kills it |

The warm negative has26 compiler phases: its affected positive moved group
fails binding after compiler exit0, so the dependent env negative is recorded
as failed/not run rather than falsely credited. The other two negative groups
still run. There are zero product consumer runtime executions.

Near-neighbors use the actual freshly emitted package and actual TypeScript:
root/subpath/contracts-wildcard imports with external Node types, legitimate
paths mapping to the exact candidate export, wrong export within the same build,
undeclared public subpath, byte-identical foreign declarations, changed package
metadata/declaration bytes, a deleted declaration, declaration/dist symlinks,
and a missing public export. No forged resolution trace, host-eval guest,
arbitrary-host sandbox claim or private package is involved.

## Inputs and evidence

`unchanged-cohort.mjs` is byte-identical to the31e24055 audit after replacing only
the candidate literal b9559de5 with a01310c5. The read-only verifier proves this
against Git. The new `nearby.mjs` reuses the same snapshot/probe machinery and
adds separately reported controls; `nearby-body.txt` records that new body.

Both runs use a full Git archive of the explicit committed candidate, without
live-source overlays, stale dist or source-loader fallback. Each authenticates
22,745 tracked inputs,318 regular copied development-tool files and708 emitted
files before/after controls. All mutations and temporary package/tool trees
are removed; all synchronous children settle without signal or timeout.

- Archive SHA256: `4045e51d97657dcda475f4034f9ba50896e151040138c5eec22e52daae959f60`.
- Before/after source census: `fd829634e2076360b305ab170dd78a5e4fb1229540ece02072629f14bdf6d543`.
- Emitted census: `12801a0b1723648ebab6826d4bb5ee1f06e388ca948f86b5e0b303223251f1f1`.
- Candidate metadata SHA256: `2127bbfed020aeb7873462ae65224e6ee73069425c878aa2ceee9816b2191245`.
-177 authenticated candidate declarations. Node22.22.2, TypeScript5.9.3,
  @types/node22.20.1, Darwin arm64.

Exact replay interval: August27,2026,12:58:24–12:59:18 UTC.
Additional controls:13:02:14–13:03:32 UTC.
Raw stdout/stderr, resolution traces, before/after manifests, statuses and the
unmodified failing assertion remain in `evidence/unchanged` and `evidence/nearby`.
The12 author captures at0ebba132 are authenticated separately by the verifier;
author22/22 is not counted as independent acceptance.

The old b9559de5 evidence and its first19/21 and final20/21 remain sealed in
31e24055. Product/config/author expectations were read-only here. Different
annotation review0a6c120c is already accepted, not new credit for this author.
Arch is reviewing the separate cleanup migration; it is not rerun here.

## Reproduce

```sh
node tests/integration/typecheck-workflow-independent-20260827-closure/verify.mjs
node tests/integration/typecheck-workflow-independent-20260827-closure/unchanged-cohort.mjs /tmp/NEW-EXACT-OUTPUT
node tests/integration/typecheck-workflow-independent-20260827-closure/nearby.mjs /tmp/NEW-NEARBY-OUTPUT
```

The exact cohort still exits1 for its preserved diagnostic-text mismatch.
The separate nearby run exits0. Neither runs the whole product suite or changes
root configuration. Future root-authorized migration of that one text assertion
must remain separate from these unchanged historical observations.
