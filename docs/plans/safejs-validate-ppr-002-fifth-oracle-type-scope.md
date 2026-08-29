# PPR-002 fifth-oracle and strict-type-scope sidecar review

Date: August 29, 2026. Independent delegated validator, not author.

## Decision

The fifth assertion is a **fresh-writer oracle**, not a historical-v6 assertion.
The root-authorized repair is justified: change only `jobs-v6` to `jobs-v7` at
`packages/agent-harness/src/loader/agent-results.test.ts:42`. Preserve every other
assertion and all historical v6 fixtures. No runtime repair is indicated.

The frozen expanded strict-type comparison has **56 baseline and 56 candidate
diagnostics, zero new signatures and zero removed signatures**. Its result remains
**qualified RED, exit 2**, not GREEN. Do not undertake unrelated type cleanup or
drop roots/diagnostics to make this gate pass. This sidecar does not approve the
final PPR2 candidate or publication.

## Intake and isolation

- Only the immutable author input was used for candidate evidence:
  `/Users/kjopek/Workspace/poe-code-safejs-public-promise-recovery-integrated/out/safejs-remediation/ppr-002-integrated/author-repair-hold/manifest.json`.
- Its verified SHA-256 is
  `e6a56c68d2b1341b324f8c7523ee146925541980eed11890667e2a46fa117d06`.
- The capture declares 20 delta files, nine ordered preimages and 11 added files.
  All 20 postimages and all nine preimages were independently hash/size verified.
  Additional evidence reads were restricted to explicit manifest-listed paths;
  their SHA-256 values are recorded in the sidecar proof artifacts.
- No racing author source, external referenced preimage path, original audit
  payload, README, provider, or home configuration was read or edited. The
  diagnostic record's original absolute/relative origins were not followed;
  matching preimages came only from this frozen capture.
- This separate report checkout was cloned from the publisher origin on main,
  then immediately pulled with `--ff-only` before work. Its base is
  `ec8ad163aa5096e0f7a49d5732b8de85501c0937`. That is the **report checkout**, not
  the reviewed candidate base, which remains
  `32caeaddbac72bccea1cb3fd0a07fb293a1bee71` plus the captured ordered prerequisites.
  Workspace and clone AGENTS instructions were read. No candidate was staged here.
- No author-clone writes, runtime fixes, test edits, executable QA scripts,
  commits, pushes, custom branches, or duplicate runtime-suite executions occurred.

## Fifth-site evidence

The captured unchanged test has SHA-256
`ad639dafd41b8ab4543a225418607af1a85d67f32e1e6f4bc4540fec81f98d7c`
and 4,928 bytes. Its first case, “persists a first checked failure before any
successful host call”, does the following:

1. Resets memfs before the test. Creates only a Markdown input and guest source;
   no historical checkpoint file is supplied.
2. Calls `runHarnessPair` with a mocked spawn result, exit code 7 and stderr
   `child failed`, plus a destination snapshot path. This is a new execution.
3. Asserts that execution rejects for the checked host failure, the snapshot file
   now exists, and the stub was called once.
4. Reads that newly written file and asserts the obsolete `jobs-v6` literal.
5. Subsequently checks public `restore` acceptance and absence of a warning.

Thus the line-42 value is produced during this very test. It is not a loaded old
fixture, an explicitly selected v6 continuation, or a migration-history marker.
The captured runtime defines fresh `EXECUTION_SEMANTICS = "jobs-v7"` in
`files/packages/safejs/src/snapshot/dump-format.ts:2`. Its `run.ts:199` selects v6
only from an accepted v6 snapshot; the failure snapshot factory at `run.ts:362`
passes the selected `executionSemantics` through unchanged. The catch path at
`run.ts:499` writes that failure snapshot. `restore.ts:51` still accepts genuine
v6 in addition to the current version. Fresh failure checkpoints are not an
exception to the current writer contract.

Recorded, hash-verified observations support this reading:

- `evidence/additional-loader-ordered.log`: all seven old tests pass on ordered
  pre-PPR2 execution.
- `evidence/additional-loader-candidate.log`: six pass, one fails solely with
  expected `jobs-v6`, received `jobs-v7`, at line 42.
- `evidence/full-root.log` and `evidence/full-root-command.json`: unfiltered
  `env -u TERM ./node_modules/.bin/vitest run`, 24,036 pass / one fail / 41 skipped;
  the same assertion is the sole reported failure. These are captured author
  executions, not new sidecar runs.

### Exact authorized repair

```diff
-    expect(snapshot.executionSemantics).toBe("jobs-v6");
+    expect(snapshot.executionSemantics).toBe("jobs-v7");
```

Applying only that one literal substitution to the captured old bytes would
produce SHA-256
`c86872c5b6801dc2b818a9c7407cc9e11defbfa68a752fea2f78dd2147de6bd4`.
That postimage was computed in memory, not written to any test file. Final review
must compare the actual author's postimage and run the complete test: the public
`restore` and warning assertions after line 42 were not reached in the failing
candidate run. No assertion may be removed or widened to accept both versions.

The frozen four earlier fresh-site repairs and receiver-filtered exact-one ALS
assertion are present. The capture's 37 repaired controls, 59 cases in both modes,
24 PPR2 cases and 969 combined passes remain recorded author evidence; no duplicate
execution or final approval is substituted for the requested final rereview.

## Independent diagnostic comparison

The comparison input is
`evidence/type-diagnostic-preimage-comparison.json`. Its method holds all current
test roots constant, including new PPR2/validator roots, while substituting the
nine frozen ordered production/test preimages in memory for the baseline.
This is an **ordered-preimage comparison under the same current test-root scope**,
not a claim that the historical repository originally had or compiled those new
test files. All nine preimage identities were matched against this capture.

The sidecar independently verified:

- All 56 candidate raw compiler diagnostics in
  `evidence/all-changed-test-types-final.log` match the comparison's file, line,
  error code and complete multiline message.
- All 112 baseline/candidate source anchors match their exact captured source
  text at the recorded line and the actual raw compiler column. No diagnostic
  source or span was rewritten.
- Sorted **multisets**, retaining duplicate counts, of
  `[file, code, completeMessage, exactSourceSpan]` are identical. Canonical SHA-256:
  `17c3075e656125f56e31452288e4ab4b2126da3e7391cb08ba5cfeb00788940c`.
- The entire records are **not byte-identical**: `run.references.test.ts` has
  diagnostics at baseline lines 50/54 and candidate lines 51/55. The candidate's
  extra `EXECUTION_SEMANTICS` import explains this one-line displacement. Exact
  source spans, columns, codes and complete messages are unchanged; both line
  locations remain in the proof. No other location shifts occur.

Diagnostic distribution is identical in both programs:

| File under `packages/safejs/src/` | Count | Codes                                                                    |
| --------------------------------- | ----: | ------------------------------------------------------------------------ |
| `interp/methods/function.test.ts` |     9 | TS2339 × 6; TS2345 × 3                                                   |
| `run.references.test.ts`          |     2 | TS2339 × 2                                                               |
| `runner/signal-dump.test.ts`      |    16 | TS2322 × 14; TS2559 × 2                                                  |
| `snapshot/restore.test.ts`        |    29 | TS2304 × 1; TS2322 × 5; TS2339 × 13; TS2345 × 1; TS2769 × 1; TS18049 × 8 |

The independently recomputed result is **56 → 56; added 0; removed 0**. Neither
the compiler nor the runtime was re-executed in this sidecar. This is verification
of frozen compiler outputs, baseline identities, source anchors and scope, not an
independent reproduction of the entire compiler program or its dependency graph.

### Exact gate scopes

The configured command records distinguish four gates:

- Root `npm run lint:types`: captured exit 0.
- SafeJS `tsc -p packages/safejs/tsconfig.json --noEmit`: captured exit 0.
- Explicit new/validator scope: 18 roots, captured exit 0.
- Expanded all-changed-test scope: 22 roots, captured exit 2 with 56 diagnostics.

Both explicit commands use `--noEmit --target ES2022 --module NodeNext
--moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck
--resolveJsonModule --types node,vitest/globals`. The diagnostic comparison command
exactly equals the recorded final 22-root command; no compiler options or roots
were silently changed for the signature comparison.

Relative to the 18-root command, the expanded gate adds these five existing roots:

- `packages/safejs/src/interp/methods/function.test.ts`
- `packages/safejs/src/snapshot/restore.test.ts`
- `packages/safejs/src/runner/signal-dump.test.ts`
- `packages/safejs/src/run.promise-order.test.ts`
- `packages/safejs/src/run.references.test.ts`

It stops listing `test/fixtures/ppr2-integration-workflows.ts` as an explicit root,
but that same fixture remains transitively imported by
`test/ppr2-integration-adjudication.test.ts`. Thus 18 + 5 − 1 = 22 is not evidence
of suppressing that fixture's diagnostics. All 56 expanded diagnostics reside in
four of the five added legacy roots; `run.promise-order.test.ts` adds no diagnostic.

**Neither captured explicit type command includes the fifth agent-harness test.**
Consequently, this 56-signature proof does not certify the newly authorized fifth
test edit. Final review should include that modified test in matching baseline
and candidate scope (23 roots if it is simply appended to the frozen 22), using
its captured old bytes for baseline. If the scope exposes additional diagnostics,
compare the same expanded scope on both sides; do not hide them or call the old
56 count a universal invariant. The required condition remains zero new candidate
signatures, with the expanded legacy gate explicitly qualified rather than green.

## Retained helper failure and limits

An initial source-anchor helper selected the first `call` in `call?.call(...)`
instead of the property at the compiler's diagnostic column, then stopped with
`Diagnostic column mismatch 0`. The corrected check uses the raw diagnostic
column and validates the full exact span there in both source versions. It omits
no diagnostic and changes no source. This unsuccessful helper attempt is recorded
separately; the completed proof covers all 112 anchors.

The report's structured evidence is under `out/safejs-ppr2-oracle-scope/`:
`fifth-site-proof.json`, `diagnostic-signature-proof.json`, and
`initial-anchor-check-failure.json`. No original audit reads, real providers,
runtime tests, snapshot marker rewrites or type cleanup were needed.

## Final handoff

Proceed with the root-authorized fifth **fresh literal only**. Preserve the full
old failure capture and the qualified 56-diagnostic comparison. Await the final
closed author capture before fresh independent full PPR2 review: all five fresh
sites, actual ALS receiver lifetime, six genuine working v6 controls, fresh v7,
eight qualified historical raw-v6 failures, and all root runtime tests without
exclusions. This sidecar completes only oracle/type-scope adjudication; it grants
no final candidate or publication approval.
