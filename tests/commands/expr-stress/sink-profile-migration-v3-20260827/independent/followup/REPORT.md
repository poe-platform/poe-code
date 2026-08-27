# Final independent acceptance: quota direct-identity follow-up

This report supersedes the **quota exact-identity acceptance** in the initial
independent `REPORT.md` at commit `0219616f7e2dc2f13aebc155933fd52fe1dfac9e`.
That report, its seal, all raw bodies, and its original execution results are preserved
unchanged. The initial reported five quota negative controls really failed, but did
not cover a string-classification collision. No initial result is rewritten or rescored.

## Demonstrated oracle issue and correction

The author appended a correction while the independent initial review was finishing.
The follow-up was inspected after the initial evidence commit; an issue notice was
published at `/tmp/expr-sink-migration-independent-v3-20260827-issue.txt` before this
reproduction. This is a **test-oracle flaw, not a demonstrated product defect**.

The old quota probe classifies `outcome.error === sinkReason` as `sink`, but its fallback
`String(outcome.error)` can also yield `sink`. Real c3 execution followed by a test-only
wrong-reason mutation demonstrates both false positives:

- Throwing the different value `'sink'` passes the initial revised target oracle.
- Throwing another object with `toString() { return 'sink'; }` also passes that oracle.

Both false-positive rows are retained under `../quota-followup-01/`. The corrected
author probe rejects each **only at the new named direct-identity assertion**; existing
checks still pass, which isolates the actual sensitivity rather than any generic reject.

The exact additional hunk, after settlement and cleanup, is:

```js
if (input.id === 'stdout-rejection-normal-quota') check('identical stdout rejection without diagnostic attempt', outcome.error === sinkReason && attempts.length === 1 && attempts[0].channel === 'stdout');
```

The rest of the probe is byte-identical to the initially revised probe. Cases/common
are also byte-identical. The target remains argv `["1"]`, cap 2, reject-stdout mode;
callbacks, command invocation, options, budgets, jobs, worker descriptors and cleanup
are unchanged. This is minimal assertion plumbing, not product or execution changes.
Five structural mutants (weakened identity, relaxed write count, callback change,
removed job check, removed cleanup check) fail the exact-delta audit.

## Final accepted results

| Profile | Original | Accepted revised |
| --- | ---: | ---: |
| Canonical, exact beba six-file legacy scope | 236/237 | 237/237 |
| Old core | 145/146 | 146/146 |
| Quota with direct-identity follow-up | 46/47 | 47/47 |
| Nearby | 15/16 | 16/16 |

Canonical/core/nearby replay is retained from `../run-02/`: every relevant author input
was authenticated byte-identical at the final author commit, so those cohorts were not
needlessly rerun. This follow-up executes only three distinct quota47 profiles: original
46/47, initially revised 47/47 (still comparator-qualified), corrected revised 47/47.

Four fresh positive controls pass. Both demonstrated initial false positives are kept.
Seven corrected quota behavior mutants are detected: the two marker collisions plus
swallowing, diagnostic/status recast, copied Error with equal message, another sentinel,
and duplicate diagnostics. Together with the unchanged canonical/core/nearby five each,
**22 accepted-profile behavior mutants are detected**, not merely arbitrary rejections.
No product bytes were mutated; the wrapper changes settlement/output only after actual
c3 execute has rejected and cooperative cleanup has completed.

## Exact commits and physical package binding

- Product remains `c3e40f8bd721da5e496f3b3abfd51aee45db5a84`.
- Canonical test-only commit remains `860967af44b20918e3096230f6c7445d4c9cf133`.
- Final inspected author evidence: `098ce3f4fefed0eebf98881bd835eac1ed9b6e4c`.
- Initial independent evidence: `0219616f7e2dc2f13aebc155933fd52fe1dfac9e`.
- Corrective control freeze: `6db3b699` (explicit post-review, not blinded).
- Corrected quota probe SHA-256: `d654ad3b0623430481a6e306a8d64fdbb888092e4394ccd0e473cb2fb6f37dfd`.
- Source archive SHA-256: `66d53b29c609957e3f5b7ee27c7734c72a959771b68e3b9b6417df0dd379b97f`.
- Packed artifact SHA-256: `8331e853455f295dfda24ff53d612514212067ca2075df09e8b60339bda58a5e`.

The first task root had already been removed. A new unique OS temporary root rebuilt
the same exact c3 selected archive, matching every beba compiled file and the original
independent package hash. It was packed/installed offline and its consumer directory
physically moved again. No live HEAD overlay, shared dist, runtime dependency, private
package, global install, or native recapture was used. The same compiled worker closure
is retained through the exact all-dist hash equality, not a claim based on entry alone.

Append-aware source/dist/installed/harness inventories are unchanged. All quota runs
have zero worker safety terminations. The second task root is removed and cleanup is
recorded. Initial setup attempts, path-alias correction and first task cleanup remain
documented in the initial evidence; no old files were edited to make the review green.

## Verification and limits

Use the current read-only command:

```sh
node tests/commands/expr-stress/sink-profile-migration-v3-20260827/independent/followup/verify.mjs
```

The new seal authenticates the entire independent tree including the unchanged initial
seal. Initial append detection intentionally notices this follow-up; the original
standalone verifier is historical now, not silently weakened. The new verifier checks
every initial sealed entry against its old value and allows only explicitly named
follow-up directories, then checks every current entry, including new entries.

Syntax checks and code/prose whitespace checks pass. The initial all-evidence whitespace
check reported four trailing-space lines in an exact historical TAP copy; those bytes
remain immutable. No comparator, test exclusion or data bytes were relaxed for it.

**No unresolved demonstrated core defect in this scoped review.** The demonstrated
quota-oracle flaw is now closed by the separately verified author assertion. The
unsupported nullable-repeat/backreference feature and unmeasured cases are not changed
or certified. This is not universal bug absence, parity, superiority, public expr export
acceptance, elapsed-72-hour proof, or full product completion.
