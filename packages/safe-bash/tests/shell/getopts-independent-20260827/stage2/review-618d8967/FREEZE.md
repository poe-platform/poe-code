# Independent Stage2 review correction freeze v1

August 27, 2026. **Pre-candidate-inspection gate only. STOP after this commit.**
Session: `01a0450f-ec52-77a1-9444-d9e2be8237fc`.

## Authority, ownership and chronology

This different review leaf owns only NEW files in this review subtree. Root's
current assignment authorizes review, not runtime fixes; runtime ownership stays
reserved. No delegation, AGENTS/product/private edits, branches, old fixture or
verifier changes, candidate execution, native runs, builds or typechecks here.
The subtree was absent at initial inspection and immediately before authoring.
Foreign untracked work and staging are not ours. Only explicit owned paths may
be staged and committed with `git commit --only`.

Original controls precede implementation; this supplement does NOT:

| Event | Full commit | Recorded committer time, August 27, 2026 |
| --- | --- | --- |
| Accepted owned-output baseline | eba049535d154f4e028f57ffd8efd7622b2239ca | 14:41:18 -05:00 |
| Original independent freeze | 51f14914a0e7de15c3a23961424f232853bf5c33 | 15:13:22 -05:00 |
| Native capture/corrections evidence | 592c864ef62f5a29b1f126c83b6ac532357fb599 | 15:16:29 -05:00 |
| Root policy v2 | bf3bfd63204ddd8fc5dbfa7308b77444de51d6f7 | 15:29:34 -05:00 |
| D02/D03 documentary mapping | f9d8737b6e391b20062f6f2a12d8fbec94e80ae8 | 15:34:45 -05:00 |
| Candidate | 618d8967009117547ab476256bc6eb0a9463309a | 15:52:45 -05:00 |
| Author handoff/evidence | cb94b17d0eefc62e2a51f5a6f7cf46ebbcad2faf | 16:06:37 -05:00 |

Root now approves the concrete mappings that DECISIONS calls proposed/pending.
That approval supersedes the historical reservation/pending text without changing
its bytes. Our correction freeze is after the existing candidate commit but
before this leaf's candidate implementation inspection or execution. Commit times
are metadata, not proof of actual work duration. No 72-hour completion claim.

## Exactly two native-oracle corrections

`native-corrections-v1.json` binds the original controls and captured records.
It changes ONLY the selected native stdout expectations for N05 and N13:

- N05: `repeated-local|0|b|1|||1` becomes `repeated-local|0|a|1|||1`.
  Bash5.3 caller continuation remains `resumed|0|b|1|||1`. Bash3.2's recorded
  continuation `resumed|0|a|1|||1` is an additional historical difference, not
  silently changed into selected-profile equality. Do not generalize this
  repeated bare-local observation to all declarations.
- N13: `no-argument|0|b|4|||1` becomes
  `no-argument|0|b|4|x|old|1`. Native required-value and no-argument steps both
  retain readonly `old`; native EOF deletes it and ordinary unset then succeeds.
  Both profiles emit two readonly diagnostics: Bash5.3 lines 3/4, Bash3.2 lines
  2/3. Raw bytes remain distinct; original predicate/status expectations are not
  broadened. Captured process status is 0; embedded step statuses are 0,0,1,0.

This is a versioned expectation overlay, NOT a rerun or retrospective rescore.
Original Stage2 Bash5.3 14/16 and historical Bash3.2 9/16 remain unchanged. The
original 16 scripts and 12 host definitions are not newly counted executions.
Phase1 scoped acceptance remains `157d78c957b56f83f6e705fc35da60b1f2ea3a9b` /
`4f84fdfd41134710cdb68fab3f5970cb14e54da3`: original 237/238 runtime and
27/28 types stay; R01-R03 are separate 3/3 per mode; corrected T20 28/28 is
separate, with its restricted TS2740 diagnostic. P03/T20 are not Stage2 results.

## Product policy is not the corrected native oracle

D01 retains checked-write fail-fast: publish the completed hidden scan, await a
nonempty diagnostic and check signal, then checked OPTIND, checked OPTARG set/
unset, late scalar-name validation and checked destination. The first failure
stops later writes without undoing earlier committed scanner/OPTIND effects.
Readonly OPTARG stays `old` AND readonly through every set/unset intent and EOF;
later ordinary unset must still fail. Thus N13 native output/status is NOT the
product expectation. N12-N15 native failure effects are observations, not policy.
Failed external assignment/export/read/prefix installation never resets; the
hook follows successful storage, not merely command status. Same-scope temporary
prefix restoration restores the exact visible AND hidden snapshot on success,
failure and abort. N04 is intentionally different even on success. Keep ASCII
options only, Unicode values allowed; no arrays/namerefs/builtin/declare/typeset
expansion or unchecked readonly deletion.

D02 and D03 are frozen concretely in `REVIEW-PROCEDURE.md`, using the approved
DECISIONS mapping and existing public contracts, not candidate code. Diagnostic
failure retains only earlier published scanner state; later variable writes do
not occur. ShellLimitError/sink/caller failures retain identity/existing mapping,
not invented getopts usage errors or universal public rejection promises.

## Authentication findings, not implementation acceptance

`INPUTS.json` records raw commit identity/body, tree/parent IDs, document hashes,
consulted/exposed material and metadata-only scope observations. Baseline metadata
and handoff match cb94b17d; DECISIONS matches f9d8737b. All 243 protected inputs
match baseline metadata at candidate and author commits by hash-only checks.
No protected source/test body was displayed by those checks.

Candidate's own parent diff is exactly two production files, runtime.ts/shell.ts,
plus five runtime author files. The WHOLE candidate tree versus eba also includes
prior expr/html-to-markdown changes: it is not a source-only two-file whole-tree
delta. Authenticate the two owned baseline bindings separately on resume, and
preserve/authenticate the actual complete committed package without overlaying
live files or silently transplanting candidate source onto a different tree.
The baseline's protected inventory was captured later than eba: an exploratory
comparison against eba found 199 missing later evidence paths and older AGENTS
bytes; that wrong temporal comparator is not candidate damage. All 243 match
the actual candidate and author commits. Runtime baseline byte-binding proof
and semantic owned-output preservation remain pending after root resumes review.

The candidate is currently reachable through `refs/heads/main`, not an observed
detached synthetic commit. Raw commit body is sealed nevertheless. Resume must
preserve exact commit/tree/blob inputs or a self-contained Git bundle with
reconstruction/hash checks if reachability becomes insufficient; never rely on
loose objects or create a user branch. A candidate archive is not yet created.

## Exposure disclosure

Only instructions, approved documents, manifests, existing capture evidence,
declared public contracts/types and Git metadata were intentionally consulted.
Baseline JSON includes the old accepted owned-output patch; DECISIONS and the
author report include code-location descriptions. Those are documentary exposure,
not candidate-body review, and author assertions remain assertions. Reading public
contract files also displayed existing registry/middleware/byte-pipe code and
Shell error constructors; none is the candidate runtime.ts/shell.ts implementation.
Printing full N05/N13 archived capture records incidentally displayed their
`execution.args` frozen native script strings. This is explicitly disclosed;
there is no claim of script-blind review. No author test bodies, candidate
runtime.ts/shell.ts/getopts.ts bodies or candidate implementation diff were
displayed, imported or executed. Opaque hashing of protected blobs is content
authentication only. Some combined terminal document displays were truncated;
the operative corrections, invariants and mapping sections were inspected in
smaller selections. No claim of historically blind controls or new measurement.

## Integrity boundary and stop

`verify-freeze.mjs` is data/metadata-only, importing no product or old verifier.
Phase1 membership excludes ONLY stage2; original Stage2 membership excludes ONLY
the three authorized policy files and this review subtree. The policy files are
separately commit/hash-bound, and new review membership is independently exact.
Unexpected files/directories/symlinks fail; checks are append-aware. Every prior
seal remains byte-identical. Old exact-tree verifiers are not run or patched and
would reject the authorized append. The freeze manifest is bound by this commit;
it does not circularly hash itself. Later review additions need a separate exact
membership seal; they do not silently pass this strict freeze verifier.

After commit and post-commit metadata validation, STOP. Pending proof inventory
is in REVIEW-PROCEDURE; no candidate/native pass, full parity, default-plugin
increase, global gate, SafeJS guest-capability acceptance or release is asserted.
