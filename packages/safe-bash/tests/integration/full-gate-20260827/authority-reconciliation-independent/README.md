# Independent canonical authority-fixture review

August27,2026. Scoped acceptance of test reconciliation `6ce7750` and `92e4118`,
not acceptance of the old inputs, hostile host bindings or a full product gate.
Production, author fixtures, shared helper and root configuration remain read-only.

## Frozen inputs and decisions

Product: `26e40698176bbbfc0e5891439ee74885aafb96be`, matching the author freeze.
Canonical three-fixture overlay: `92e4118`, including `6ce7750`.
Author evidence: `9122522`; binding rule: `cd8b5c8`.
The original three files match historical `e36dab2` byte-for-byte, including the
preserved original `.txt` copies and all25 named failure rows. No current dirty
worktree source or fixture enters the replay. Node22.22.2, Darwin arm64, C locale.

`ASSERTION_AUDIT.json` audits **every25 delta** with original name/source/hash,
canonical hash, changed inputs, retained assertions and acceptance limits:

-16 writer cases keep the interception timing/backend/mode but replace an
  unrelated backing mutation with same-receiver/same-argument forwarding. Exact
  copying, one write, source/namespace preservation and alias rejection remain.
-2 reader cases replace unrelated bytes with the actual backing stream and
  require zero comparison reads, one acquisition for copy and exact bytes.
-6 remote cases no longer assume method identity can sandbox a lying host.
  Five enforce omission of unrelated identity and retain unknown/ENOTSUP/no
  content effects; one becomes a faithful subclass/late-writer positive paired
  with a shared-store alias guard. S3 HEAD cloning drops private provenance;
  DAV remappers remove private provenance **and** unrelated protocol resource-id.
-1 helper case replaces the generated DAV property rather than appending a
  duplicate. Exactly-one, duplicate/missing refusal, alias refusal and bytes
  remain asserted. This is test-only proposal-helper coverage, not public cp/mv.

These are explicit input replacements, not25 product bug fixes or unchanged
malicious inputs becoming safe. Original damage remains in the baseline TAP/
observations. Trusted host code that describes one backing resource while
modifying another still violates the contract; this work does not enforce a
JavaScript sandbox. No compliant-provider bug is reproduced within this slice.

## Reproduced cohorts

| Frozen cohort | Pass/total | Fail | Skip/cancel/TODO |
| --- | ---: | ---: | ---: |
| Original three fixtures |58/83|25|0/0/0|
| Canonical three fixtures |85/85|0|0/0/0|
| Unchanged original4+required49 guards |53/53|0|0/0/0|
| Unchanged six-file adjacent cohort |112/112|0|0/0/0|
| Restored canonical fixtures after author mutants |85/85|0|0/0/0|
| Independent semantic controls |17/17|0|0/0/0|
| Restored independent controls |17/17|0|0/0/0|
| Old-helper compatibility |38/43|5|0/0/0|
| Current-helper compatibility |43/43|0|0/0/0|
| Unchanged built adapter matrix |77/79|2|0/0/0|

All58 originally passing names remain. The85 are83 reconciled cases plus exactly
two new honest path-remapper cases, one Memory and one S3. Both copy directions
must reject unknown existing targets before content acquisition, preserving
source and namespace. Neither addition is a skip or a replacement of an old pass.

The old `d799cbb` helper is **33/38 positives plus5/5 controls**, whereas the
current helper is **38/38 plus5/5**. The five old failures are retained, all DAV
positive workflows. This is not old-helper38/38 or unchanged-helper acceptance.

Both original remote empty-directory-removal positives remain failed in the
79-row matrix: S3 and WebDAV `create, copy, append, inspect and remove files`.
Their stderr still identifies unsupported rmdir; neither fixture nor production
is weakened to count a refusal as successful removal.

## Independent semantic and mutation checks

The new17 tests cover faithful late Memory/S3/DAV writers and readonly-view
aliases; honest opaque remappers in both directions before reads/writes; explicit
error meaning/cause/path and exact cancellation reason; a useful remapper that
truthfully preserves actual native identity; faithful versus serialized, stale
and wrong-path S3 HEAD provenance. No content-method-reference eligibility or
fake per-client identity is introduced. Unknown stays unknown.

All ten author mutants reproduce their expected named failures with full85-case
execution, no load-error or skip kills. Six mutate source and four mutate fixture
premises **only inside the disposable snapshot**. Restored85/85 passes.

Four separately selected source mutants are also killed by the new17 tests:

| Independent mutant | Failing cases/17 |
| --- | ---: |
| Accept a previous query's S3 proof |1|
| Accept proof for a different S3 key |1|
| Invent distinct identity when native identity is incomplete |14|
| Shape away explicit comparison error meaning/cause |3|

Every mutant restores exact bytes/hashes before the next run. A killed
fixture-premise mutant does not prove containment of a malicious provider.
No mutant is applied to the repository checkout. Source and copied dependencies
match the frozen input hashes at cleanup.

## Checks, harness defects and cleanup

Canonical and independent scoped TypeScript pass. A disposable source/declaration
build passes to supply the existing regex worker required by the adapter matrix.
No root/cold type configuration is edited or reviewed, and no full gate runs.

Reviewer attempts are preserved separately: attempt1 incorrectly required raw
FsError identity across Mount's documented contextual error wrapper and replayed
HEAD data into directory-marker probes; corrected tests require exact code/path/
cause, exact abort identity, and scope stale/wrong-key data to the intended file.
Attempt2 had one exact-optional-property typing error in the new Proxy fixture,
fixed by explicitly hiding compareEntry rather than an incompatible cast.
The first supplemental matrix run omitted the built regex worker:58/79 with19
missing-worker failures plus the two rmdir failures. After the normal isolated
build, the **unchanged** matrix is77/79. None is a production fix or oracle waiver.

Final source/fixture versions, command counts/statuses, per-case failures, hashes,
process identities and cleanup are in `evidence/CHECKPOINT.json` and final logs.
All supervised children exit, with zero surviving observed processes, timeouts
or output-limit kills. Temporary source/tool trees are removed. No private repo,
new dependencies, global config or unrelated files are changed. Large JSON files
are losslessly compacted with parsed equality checks; captured/archive hashes
are preserved in `evidence/ARTIFACTS.json`.
Original TAP assertion blocks retain their indentation-only lines, so the broad
whitespace check reports evidence-only trailing spaces. Source/docs checks pass;
raw failure logs are not cosmetically rewritten to hide that distinction.

Reproduce with a new outside evidence directory:

```sh
node tests/integration/full-gate-20260827/authority-reconciliation-independent/run.mjs \
  /tmp/NEW_AUTHORITY_INDEPENDENT_REVIEW
```

The runner pins both source and fixture commits. Historical15958-test RED gate
and all old25 failures remain historical evidence, not inferred current status.
Acceptance is only of this canonical fixture reconciliation and preserved safety
assertions under the stated host-binding contract.
