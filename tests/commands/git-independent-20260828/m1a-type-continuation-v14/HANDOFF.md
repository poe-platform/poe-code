# V14: positive PASS, exact negative diagnostic observed; exit-mapping HOLD

August 28, 2026. Direct tools only. One positive+negative compiler cohort; no
retry, product changes, rebuild, npm/install, semantic replay or native oracle.

Preseal: `3020bd3c2ac83e2641b02a44c22f9c97a2db9355`.
Preseal SHA256: `a8c7d6c7357a29e5745d7e73c1155f0b2885fa0cefb30bb7ec16b503ff9764cf`.
The evidence commit contains this handoff, AUDIT and the original raw captures.

## Actual outcomes

- Positive: exit0, zero diagnostics, empty stderr; PASS.
- Negative: actually ran and rejected with exactly the sealed TS2724 primary
  diagnostic, line1/column9/start8/length16, missing `createGitCommand`, exact
  `createTarCommand` suggestion and the single sealed supplemental TS2728 record.
  No other diagnostics. Formatted bytes equal the v13 expectation exactly.
- Negative process exit1, while the unchanged seal expects exit2: FAIL.
- Overall outer exit1 / SCOPED_FAILURES. Both roles ran once. No UNRUN roles here.

The remaining defect is the inherited wrapper's exit synthesis at compiler.mjs:90:
every diagnostic maps to `DiagnosticsPresent_OutputsSkipped` (1). Its report field
`nativeExitCode` is therefore a wrapper-assigned value, not an observed native CLI
exit. This mapping was unchanged under the narrow authorization.

Source-only inspection of the authenticated TypeScript5.9.3 `_tsc.js:128844`
shows the CLI distinguishes diagnostic-present `emitSkipped` true (1) from false
(2). Both v14 reports actually observed `emitSkipped:false`. The source excerpt
and hash are in AUDIT; that CLI was NOT executed. No mapping repair or rerun was
performed. No product/type failure is inferred from this harness exit mismatch.

The outer's exit assertion stopped its negative-verdict assertion sequence before
the diagnostic comparison. A separate post-run DATA audit compared the captured
diagnostic object, formatted bytes, options, compiler, source identities and
consumer against the unchanged seal: all match. This does not relabel the sealed
negative FAIL as PASS or supply an exit2 proof.

## Narrow correction and immutable inputs

Only the unsupported `emitSkipped === true` assertion was removed. Its actual
value is now reported without a value-dependent acceptance rule. Existing
`noEmit:true`, strict/exact options, zero positive diagnostics, compiler binding,
write-refusing CompilerHost and exact source/work census checks remain.
Complete work membership/content/mode guards pass after both roles; no emitted
output is observed. No replacement TypeScript internal-flag assumption was added.

The collector only adds preservation of raw primary wrapper failure alongside a
secondary JSON-parse record. This branch was not taken in v14; v13's original
primary and secondary remain immutable. Both v14 reports are complete JSON.

Both consumer files, bytes and logical paths are unchanged. The v13 exact
EXPECTATION.json and guard.mjs are byte-identical. The same CompilerHost routing
maps logical v12 paths to authenticated new v14 scratch; no old scratch is recreated.
The package remains all898 original members with SHA256
`68541722217fb3f88f7317750c8f1a66042ea090f2c769564b9afc14372dfe68`.
Git source9885390fb11454fa194a3e60fdbef198dbfdf633, derived base8437 and original
Shell composition remain unchanged. TypeScript5.9.3/Node22.22.2 hashes and all
loaded declaration/source identities remain sealed. Actual source-file counts:
positive183, negative259; reads188 and264 respectively.

## Resources and preservation

Three controlled processes including outer, peak2; positive PID67746 and negative
PID67763 naturally closed with null signals and both stdio closes. No rescue,
unknown retirement, nested process or network attempt. Outer measured7929.211ms
through publication/closure; timing-file final-write tail is separately qualified.
Captures776258 bytes; observed owned disk peak9125756 bytes, below16MiB/128MiB.
Owned scratch was guarded then removed; raw stdout/stderr/events remain separate.
No RSS, universal descendant or hostile-host guarantee is inferred.

Source preparation began22:09:49Z separately from this bounded compiler cohort.
One DATA-only preparation attempt used an incorrect `scaffold/` lookup for
`source/package.json`. Before the seal, it was corrected to authenticated archive
paths; existing partial regular files were byte/mode-verified, not overwritten.
No compiler ran during preparation. A post-run display helper initially assumed
an optional `failure` JSON key existed; the DATA display was corrected without
subject execution or artifact edits. These are not hidden compiler retries.

All protected histories and tools pass complete post-run census checks, including
new entries. Original v12 HOLD/284/4-of-5 and v13 positive failure/negative UNRUN
remain unchanged. This version adds one positive PASS and actual exact negative
diagnostic evidence, but **composed types remain4/5 under the sealed exit rule**.
Historical284 semantic passes, three loaded-mutant detections, three restores and
three binding refusals are not rerun. Historical per-layout295 closed streams and
167 fulfilled registrations remain distinct from source-qualified private-writer
joins. Frozen defaults78/root exports unchanged; no packed readiness or native Git
parity claim. Further execution needs new root authorization, not this consumed seal.
