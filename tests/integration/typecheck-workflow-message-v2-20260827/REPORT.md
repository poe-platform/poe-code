# Fixture v2 execution evidence — August 27, 2026

Fixture commit: **c7f2abab5e11539c69f890e617a461cbd5ec4a08**.
Actual product/configuration input: **a01310c5571dfda2aae4c6c8cc185e2530a01e89**,
freshly archived and built, never mutable HEAD or existing live dist.
This is author execution evidence for a root-authorized fixture migration.
Independent product repair proof remains39116ae1; root/Curie reviews this delta.

## Exact delta and preserved history

Only line248 of `cohort-v2.mjs` differs from the entire original cohort at
39116ae1: substring `/candidate build/` becomes equality with
`foreign candidate declaration/source fallback: virtual-bash -> ` followed by
the actual candidate's `src/index.ts` path. Compiler exit0 and helper exit2 are
still required. All cases, inputs, other assertions, full-command branches and
the remaining20 controls are byte-identical. The verifier checks the complete
files against the original committed Git blob, not an informal line count.

The original20/21 result and its stale assertion remain unchanged in39116ae1.
V2 is a new explicit version, not a rewritten historical capture. No product,
configuration, source guard, package metadata or original author fixture changed.

## Actual results

| Observation | Result |
| --- | --- |
| Frozen v2 cohort |**21/21**, zero skips |
| Cold command |exit78; no compiler work |
| Fresh combined full typing command |exit0, exactly one build,28 compiler phases |
| Global source/tests and selected-GNU consumer |exit0 |
| Strict source / moved consumer groups |3/3 and19/19 |
| Exact negative diagnostic groups |unchanged1+2+5 |
| Repository-src fallback |compiler0, helper2, exact candidate-binding diagnostic |
| Mixed-package helper control |refuses, status2 |
| Existing runtime-coverage unit cohort |24/24 nested; not product/service passes |
| Exact assertion controls |**9/9**: one real diagnostic accepted, eight negative neighbors rejected |
| Nonempty-error mutant |rejected on the unrelated TS2305 diagnostic |

The diagnostic controls execute the actual fixture statement. Rejections cover
an unrelated compiler error, a generic error mentioning `candidate build`, wrong
package, wrong candidate path, leading/trailing unrelated text, missing error,
and null. A weak `assert.ok(error)` line passes the positive but fails the first
negative; its child exits1 with `Missing expected exception` identifying the
unrelated compiler diagnostic. This confirms that v2 cannot turn an unrelated
failure into successful binding rejection.

The exact cohort retains its full-command code unchanged. Its legitimate
combined `npm run typecheck:all` executes here. Its existing mixed-command branch
is conditional on the helper incorrectly accepting the foreign build; the fixed
helper refuses, so that branch does not execute in v2. The independently accepted
full mixed-package warm-command exit2 remains the separate39116ae1 evidence,
not a falsely claimed new full-warm execution or a removed branch.

## Binding and cleanup

- V2 fixture SHA256: `850579bc359b4fd2f8fa7f1decdffe7e021b52cd7f8dc787cd347a3be5df767d`.
- Source archive SHA256: `4045e51d97657dcda475f4034f9ba50896e151040138c5eec22e52daae959f60`.
- Before/after source census: `fd829634e2076360b305ab170dd78a5e4fb1229540ece02072629f14bdf6d543`.
- Emitted census: `12801a0b1723648ebab6826d4bb5ee1f06e388ca948f86b5e0b303223251f1f1`.
-22,745 tracked inputs,318 regular copied development-tool files and708 emitted
  files are unchanged after controls;177 candidate declarations authenticate.
- Node22.22.2 / TypeScript5.9.3 / @types/node22.20.1, Darwin arm64.
- Cohort interval: August27,2026,13:17:43–13:18:49 UTC.

All74 raw cohort captures and the separate diagnostic-control report retain
stdout/stderr/status and hashes. All synchronous children settle without signal
or timeout. Owned source/tools/build/consumer and diagnostic-child temporary
directories are removed. No whole gate, native workload or cleanup-migration
review is rerun. Foreign working changes and staging are left alone.

Authenticate this evidence without running compilers:

```sh
node tests/integration/typecheck-workflow-message-v2-20260827/verify.mjs
```

Passing that verifier authenticates this author evidence; it does not replace
root/Curie's separate fixture-delta review or claim whole-product acceptance.
