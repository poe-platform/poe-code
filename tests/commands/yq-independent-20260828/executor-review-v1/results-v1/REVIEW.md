# Independent YQ executor-framework review v1

Date: August 28, 2026. **NOT READY: two prepared controls need runtime-owner
disposition.** This is synthetic framework review, not YQ product acceptance.
No foreign framework file was fixed. No author success was inherited.

## Seals and execution boundary

The original protocol/fixtures seal `d7290477ea464928f02d790314eef6775fdf3c8d`
and separate ER-08 clarification `5a24badf0016cfa535fbb372ac80907f7bf83f0c`
remain byte-identical. Runtime protocol `0f138190073cb5419aa86c63e0a10075fe67f88f`,
initial source `d77e8714e9e6a97d689045f6dd66afafd5842a2d`, final source
`c49d494dd5a36b19198680239a72e0c95cb90d8d`, and documentation/evidence
`ee9d0c1fd24b33aa918154eb379a92c02cfe5925` are distinguished. Consumer preseal
is `21ad8c589d7f138064616e8f37e748e6a2e7c200`; reviewed final is
`409449136ae1adc252ff6e205a6bb5785d113d0f`.

`capture-y9zvw316/AUTHENTICATION.json` binds exact Git blobs, modes, bytes,
SHA-256 and physical scratch paths before author helper imports. Both independently
supplied seal hashes and runtime recipe hash matched. The consumer exact recipe
verifier ran before/after controls; only its verifier/helper functions were used,
not the author's 36-control suite. The runtime author's 15-control suite was not
run. Committed handlers and selected original data were copied to fresh regular
scratch; no live author source, workspace product or node_modules fallback was
used. SHA/mode checks bracketed every independent observation. Only isolated
scratch mutations were made, and consumer scratch recipe changes were restored
before another observation. An intentionally invalid candidate tree was never
reused for continued admission within its failed cohort.

Actual candidate `35da18547ca82a67be9ca22b4adc21e3b8060780` was neither read
nor imported, built, typechecked or executed. A tiny canned fake factory exercised
the real deferred `execute.mjs` path; its output derives from existing CMD-01 data
solely to establish a valid framework control, not to test YAML semantics. The
synthetic trusted composition receipt is explicitly not a genuine source/build
attestation. All other workers, private checkouts and historical files are untouched.

## Findings frozen with raw evidence

**F01 — unknown assertion becomes green (ER-16).** The actual `assertCapture`
ignores an added unbound `expected.assertions` obligation on an otherwise valid
CMD-01 job. With that callback, actual `runJobs` returns aggregate PASS, no failures,
integrity true and reapProof true. The raw cohort PASS remains in
`capture-y9zvw316/ER-16-unknown-assertion-raw.json`; the independent expected-FAIL
control fails. This is an assertion/host seam finding, not a claimed bypass of the
immutable job hash in full authorization. Existing declared partial projections
are not retroactively scored or silently required to prove all original assertions.
An unsupported obligation must remain unfulfilled or be refused, not disappear.

**F02 — object identity lost in reason capture (ER-03).** `encodeRejection`
serializes the same object twice and a distinct equal-looking object identically.
It provides no stable identity token for identity-sensitive rejection/cleanup
comparisons. Raw output is in `capture-y9zvw316/ER-03-reason-identities-raw.json`.
The undefined/null/false distinction passes. This is a capture limitation, not
an observed product cancellation failure or runtime lifecycle acceptance.

`FINDINGS.json` records the exact minimal benign mutations, handler hashes,
input/raw/verdict references and qualifications. No fixture-invalid failures were
identified in this capture. Root should route both findings to the runtime owner;
this reviewer does not patch that owner or weaken the frozen expectations.

## Controls and captured outcomes

The bounded run completed in **4,368 ms**: **62 observations across all 18 prepared
families**, 60 matching controls and two control failures. This is not 60 YQ passes,
nor complete acceptance of every subpredicate. Classifications are 55 synthetic
framework helper/worker observations, six data-admission checks, and one explicit
data/source inventory audit. The collector exits zero after saving findings;
that is collection completion, not a green framework verdict. No failed actual
cohort was rewritten or waived. `RESULTS.json` retains both unexpected failures.

| Family | Observations | Observed scope |
| --- | ---: | --- |
| ER-01 | 1 | PASS receipt plus exit 7 remains aggregate FAIL |
| ER-02 | 1 | FAIL then PASS continues only after both boundaries; FAIL sticks |
| ER-03 | 2 | Raw capture precedes assertion; object-identity control fails |
| ER-04 | 1 | Missing receipt fails |
| ER-05 | 6 | Duplicate/malformed/wrong-job/duplicate-key receipts and actual forged-binding refusal; real-entry fake positive |
| ER-06 | 1 | Mutating child stops the next admission |
| ER-07 | 7 | Bytes/modes/new file/directory/symlink and actual consumer recipe guards |
| ER-08 | 3 | Reaped timeout, withheld proof and both bad boundaries |
| ER-09 | 1 | Exact original IDs, roles, projections and preserved gaps; data/source proof only |
| ER-10 | 2 | Real entry rejects absent authorization/hash mismatch before fake import side effects |
| ER-11 | 2 | README absence/mismatch refuses |
| ER-12 | 4 | Extra entry, omitted README, authenticated baseline omission, authorized-addition count |
| ER-13 | 8 | Physical copy/rename, moved resolution, fallback/escape refusal and unenrolled import refusal |
| ER-14 | 5 | Missing/unknown projections and public-export gap remain refusals |
| ER-15 | 7 | Declared negative diagnostic only; bad module/declaration/signal controls; zero/7 worker outcomes |
| ER-16 | 3 | Source/unknown data refusal; unknown assertion control fails |
| ER-17 | 2 | Signal and bounded output overflow remain FAIL |
| ER-18 | 6 | Evidence overlap, absent authority, forbidden source paths and exact-map mismatch |

ER-08 uses the clarification, not the original unconditional timeout-stop wording.
The timed-out child was terminated/reaped, integrity and reapProof were true,
the next job ran, and aggregate remained FAIL. Withheld reap or failed integrity
stopped the next job. The withheld-proof seam is a real author option; it withholds
the admission proof while still physically reaping the benign child, rather than
manufacturing an unsafe orphan. Conservative STOP would also have been accepted.

Raw stdout/stderr bytes are preserved as base64, with child status, signal,
capture/receipt/effects/events and boundary/verdict records. `assertCapture`'s
command-byte files survive its deliberately failing assertion. Raw compiler-result
objects were captured before classifier assertions; TS2554 at the declared fixture
line is accepted, whereas TS2307, missing declarations, declaration-origin errors
and signal are refused. A synthetic TYPE worker exits zero only after actual
classification; the same PASS fact followed by exit 7 makes the actual cohort FAIL.
No compiler process or declaration build ran.

`REAP-AUDIT.json` covers **25 distinct known-owned processes**, including the real
entry's nested workers: every captured process closed/reaped and every recorded
group was absent in the post-run signal-0 audit. No signal was sent by that audit,
and no foreign PID/group was targeted. These are known-group observations, not
hard preemption, arbitrary descendant discovery, a PID lease or an escaped-opaque
work guarantee.

## Coverage truth and remaining gaps

The 194 unique original IDs and eight overlays stay one universe. Independently
recomputed primary roles are 111 semantic, 34 admission, 23 source, 11 lifecycle,
four package, five type and six negative. There are 132 materialized ID projections
and 149 fragmentation jobs; 94 semantic IDs have complete explicit projections
and 17 have partial projections. Eighty records still lack bindings: 62 unprepared
and 18 partial (17 semantic plus WRK-14). All remain pending product execution.
Source-primary records and WRK-22's secondary source role prove no runtime
memory, progress, private counter or cancellation behavior. No 194+80+62+32+64 sum
or semantic credit from data/admission/type/package/infrastructure appears.

There is no implemented semantic-score aggregator to exercise by appending all
nonsemantic job kinds. Only the actual inventory/materializer and source exclusion
rules were checked; this portion of ER-09 remains an explicit runtime gap.
Likewise, successful capability-bound `withMaterializedImports` and full
`authorizeSources`/`authorizeCandidate` cannot be completed without the separately
authorized source/package binding. No capability was forged to force those paths.
Actual lower-level copy/rename/resolution helpers were exercised; those are not
enrolled public import proof. `PUBLIC_EXPORT_GAP` remains an explicit refusal;
direct module evidence does not establish public exports or MOV-02 acceptance.

The sealed consumer baseline map contains all **846** baseline entries, including
the exact 36,273-byte README/hash. Guards refuse omitted/mismatched README and
authenticated baseline edits. Fake additions exercise the real computed expected
map; no fixed 845/846/870 candidate count is asserted. Source guards were tested
on forbidden paths and exact-map disagreement; inspection shows admission binds
5137 plus accepted length plus explicit new YQ/query-core files. This is not a
test of actual candidate 35da's source write-set or a replacement for the separate
root-routed composition/build receipt.

Other unexercised subvariants include a genuine unreapable/escaped process,
an additional unclaimed recipe subtree outside the declared scope, and every
possible reason/receipt schema permutation. We deliberately introduced no unsafe
descendant or new YAML semantics breadth. Full recipe guards and captured process
statuses are not a hostile-host sandbox or change-and-restore transaction defense.

## Reproduction and handoff

Explicit opt-in only; neither script is canonical product-test discovery:

```text
python3 tests/commands/yq-independent-20260828/executor-review-v1/results-v1/authenticate.py
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/commands/yq-independent-20260828/executor-review-v1/results-v1/review.mjs NEW_AUTHENTICATION_JSON
```

The authenticator creates unique scratch/capture directories and authenticates
the same immutable inputs. A repeat is additional evidence, not an overwrite of
this run. The driver's exact SHA-256 is in `CONTROL-BINDINGS.json`. Raw captures
and helper imports precede comparisons; no native product oracle, XAN invocation,
private access, package installation or product source execution occurs.

Framework readiness is **NOT READY**, pending runtime-owner findings and a new
sealed review route. Product imports/executions/builds/type-compiles and author
control-suite executions are all zero. Different actual YAML review remains a
separate future root route after framework/admission/source/compound-recipe seals;
this packet grants no actual-candidate execution or global acceptance.
