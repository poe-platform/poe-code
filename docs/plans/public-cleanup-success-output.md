# Public cleanup success receipt output

## Scope and result

Qualified on September 2, 2026 in an isolated detached checkout of
`77cc3de15e3cbcdb3867418e06eb9109bcd6211b`. The primary worktree was not changed.

The only test change is the normal-scenario emission in
`packages/safe-bash/tests/shell/invocation-cleanup-public.test.ts`. Serialize the
same complete proof once. Send it to file-attributed stdout only when the child
has no execution error, no signal, status zero, and empty stderr. Otherwise keep
the complete diagnostic. The six attack/refusal emitters remain unchanged.

All assertions, scenario names, fresh source checks, private snapshot build,
native workers, deadlines, resource controls, and cleanup remain unchanged.
Emission stays before the post-child source check and result assertions. The
existing reporter therefore retains buffered proof if a later assertion or
source check fails. There is no reporter/helper change, retry, alternate runtime
route, compiler/source cache, or concurrency change.

The actual baseline printed ten normal receipts totaling **274,507 UTF-8 bytes**,
including the informational prefixes and newlines. The candidate prints none of
those records on success. Both runs produce ten complete JSON payloads totaling
274,457 bytes, and both retain all six refusal diagnostics. This is an output-byte
reduction, not a runtime speed claim.

## Qualification

Node `v22.23.2`, original tsx route, one isolated test-file process, and
`--test-concurrency=1` were used. Root's normal pre-push gate could co-load these
checks; elapsed durations are execution records only, not comparative performance.

| Check | Result | Elapsed milliseconds |
| --- | --- | ---: |
| Baseline, fully staged prerequisites | 16 pass; ten successful diagnostics visible: quiet contract red | 24928.695125 |
| Candidate | 16 pass; ten normal stdout records suppressed; six refusal diagnostics visible | 25849.593917 |
| Baseline explicit TAP, normal scenarios | 10 pass; ten receipts extracted | 15366.092291 |
| Candidate explicit TAP, normal scenarios | 10 pass; ten receipts extracted | 15640.998750 |
| Post-emission assertion negative | One deliberate failure; entire proof visible | 6321.800208 |
| Post-emission source-drift negative | One genuine source-check refusal; entire proof visible | 6830.530708 |
| Focused TypeScript, Bash's Node22 declaration profile | Pass | 414.183958 |
| Scoped ESLint, zero-warning limit | Pass | 21448.640834 |

The two full owner runs each execute the same 16 named cases, with no skips or
cancellations: grep and rg across five retirement modes, plus six tamper/refusal
cases. All ten child reports retain `passed: true`, `sourcePinned: true`,
`liveWorkers: 0`, and empty unhandled-rejection lists. Imported runtime hashes are
checked against the current emitted/required-peer manifests. Each snapshot is
removed. Native event receipt attribution resolves to the actual entry file.

The real assertion negative adds a deliberate assertion immediately after
emission. The real source negative instead appends one newline to the private
snapshot's `src/index.ts` after the real successful worker exits, invokes the
unchanged `binding.verify()`, and restores those snapshot bytes in `finally`.
It fails with `Captured source was changed after build`; cleanup succeeds. Neither
negative alters primary/product source or mocks the source guard. Each temporary
caller version is freshly captured, stays stable throughout its run, and is
removed before restoring the exact qualified candidate bytes.

Separate small real-Node reporter controls execute the extracted caller emission
with a historical real receipt. The baseline exposes its success diagnostic
(86.478083 ms). Candidate controls confirm success suppression and visible
nonzero status, execution error, signal, and nonempty stderr diagnostics, even
when the surrounding control test passes. A later assertion flushes the entire
stdout proof. These are emitter-classification controls, not fresh native-worker
or source-authentication qualification.

## Source binding and historical consumers

Normal qualification uses the unchanged
`captured-working-tree-not-committed-qualification` profile: runtime and callback
commit fields are null. The captured caller hash changes honestly from
`9ab7f2f3f437bdd57e12f44645b8776f3fa2c1c38c0db5e20f043ebec2694ebf` to
`aecd4d698266eba17c05904f306e7a50831ae213924f1e9fafa8d08abab58c98`.
No old expectations are substituted or rewritten. This is neither committed
revision qualification nor packed-release qualification.

Historical original callers remain available at `85e6d560`,
`4bb4ad85d4554889cd6f59097af776f4172e34d1`, and
`026e20cf38ddbb695d82de3f30cf7a1a7c88f088`. The latter two caller blobs agree;
their SHA-256 is
`04d89950adb9eae86407154f913be7b9c257df16ff55fc377a1006c456642568`, matching
the historical expected-inputs manifest. That manifest already does not
authenticate the maintained baseline caller, and does not authenticate this
candidate. Current fresh-input checks remain enabled. Historical manifests,
drivers, helpers, source objects, and stored evidence are unchanged.

Explicit TAP output from both real ten-case runs is parsed by the exact
`parseDiagnostic` implementation extracted from the historical migration-review
driver. All ten unique scenario receipts, nested JSON, and source/cleanup records
parse successfully. No TAP parser or driver is changed.

There is an existing semantic-consumer limitation distinct from TAP extraction:
the historical driver's later `parseCanonical` validation assumes every runtime
import hash belongs to `manifest.emittedHashes`. Current reports also contain
required-peer imports. Running that unmodified function against both baseline
and candidate TAP produces the same hash-versus-undefined assertion failure.
Do not claim full historical-driver qualification; extraction compatibility is
preserved, while this already-drifted historical semantic check is not repaired.

## Prerequisite correction and evidence

The first baseline attempt stopped during prerequisite admission, before a
scenario executed: staging only the authenticated peer file list omitted the
generated `packages/safe-fs/dist/package.json` resolution boundary. The unchanged
guard correctly rejected source selection for `#safe-fs-platform`. That failed
attempt (869.901833 ms; 16 hook-failed cases) remains in `baseline-owner.*`.
Copying the existing generated package metadata from the stable primary build
completed prerequisite staging. The separately labeled `baseline-staged-owner`
run then passed. No test failure was automatically retried or routed around an
admission check. Generated peer files are regular isolated copies; primary builds
were not modified.

Evidence directory:
`/tmp/poe-public-cleanup-output-evidence-20260902`.

- `original-invocation-cleanup-public.test.ts`, `historical-*-fixture.ts`, and
  `static-preparation.json`: preserved original bytes and historical checks.
- `baseline-owner.*`: failed incomplete-prerequisite attempt, not a quiet red.
- `baseline-staged-owner.*`, `candidate-owner.*`, and `*-analysis.json`: real
  output, raw Node events, counts, names, byte totals, and source identities.
- `baseline-tap.*`, `candidate-tap.*`, and `*-extraction.json`: explicit TAP and
  exact historical parser results, including the existing semantic limitation.
- `negative-assertion.*`, `negative-source-drift.*`, and `*-emitter-*`: actual
  failure/source-refusal evidence and separately labeled emitter controls.
- `types.*`, `lint.*`, `summary.json`, and
  `public-cleanup-success-output.patch`: focused checks and integration handoff.

CPU was released after runtime/types/lint checks and before writing this plan.
Root owns integration, the full gate, commit, push, and release monitoring.
