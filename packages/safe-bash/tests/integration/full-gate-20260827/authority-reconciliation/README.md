# Canonical authority fixture reconciliation

August 27, 2026. **Test-author checkpoint; different-verifier review required.**
No filesystem production, contracts, shared helpers, root configuration or
adapter-tools matrix changes. No full-product gate rerun.

## Exact classification of the original 25

| Original failures | Count | Finding and replacement |
| --- | ---: | --- |
| Memory/S3 writer overrides: subclass-before, prototype-before, own-after, prototype-after × buffered/streamed | 16 | The old writer retains one backing resource's authority but damages another. Replace the obsolete method-table sandbox assumption with a genuinely forwarding writer at each same interception point; require successful copying and alias rejection. |
| Memory/S3 changed readStream | 2 | Returning unrelated target bytes under source authority violates the binding. A faithful stream decorator must instead retain authority, acquire no content during comparison and copy the exact source bytes. |
| Three S3 metadata/content remapping cases | 3 | Two remappers now omit unrelated private HEAD provenance and must refuse unknown overwrites without content effects. The third becomes a faithful subclass/late-PUT decorator positive, paired with shared-store alias rejection. |
| Three WebDAV metadata/content remapping cases | 3 | Remappers must remove both private response provenance and unrelated protocol resource-id, or omit inherited identity at the public remapped filesystem view. Unknown overwrite still refuses before effects. |
| authority.test.ts original line463 | 1 | MockDav now supplies a resource-id; the fixture appended a second. Its exact-one resolver correctly refused. Replace the known helper property before supplying fixture-owned IDs; retain missing/alias refusals and deliberately test duplicate-property refusal. |
| Reproduced compliant-provider product failures in these 25 | **0** | No production remediation is justified by these obsolete inputs. This is not arbitrary-provider acceptance. |

Thus **18 obsolete content-method screening assumptions + 6 noncompliant
provider-binding assumptions + 1 obsolete helper augmentation = 25**.
`classification.json` lists every original name, source line, input SHA256,
replacement name, classification and rationale, without collapsing any row.

The binding changes are **explicit fixture-input replacements, not simply
expected-value flips**. Original malicious host inputs do not now pass safety.
The unchanged baseline records damage in all16 changed-writer cases and three
mixed-backing copy cases; `evidence/baseline-observations.json` preserves it.
Those outcomes remain failures/unsafe noncompliant configurations, never passing
characterizations or evidence that arbitrary host JavaScript is contained.

## Normative basis and preserved guards

Contract decision `cd8b5c8`, now `src/contracts/filesystem.md:137`, explicitly
preserves fresh authority through faithful forwarders, rejects exact-method-table
eligibility, and requires remappers to omit or replace changed assertions. This
is a host binding contract, not a hostile-JavaScript sandbox. Actual aliases,
freshness, path/stat binding, errors, cancellation and readonly policy remain.
Constructor callbacks `629ed27` (S3) and `408ff59` (DAV) compose truthful authority;
they do not license identity invention or remove the omission obligation.

The replacement16 writer cases require exact source/target bytes, unchanged
namespace, exactly one real forwarding call and rejection through a readonly
alias view without a second write. Two stream cases require zero comparison
reads and exactly one copy acquisition. The remote negative cases keep their
unknown/ENOTSUP, zero-effect and source-preservation assertions. Two additional
Memory/S3 path-remapper cases strip changed authority and reject both copy
directions before content acquisition. Existing permission, cancellation,
malformed metadata, explicit-error, overlap and core ordering rows are retained.

No test-only `proposal.ts` change is made. The DAV fixture still requires
exactly one valid URI. It checks that the helper supplies exactly one property,
replaces it with the controlled map, and pairs successful distinct copies with
same-entry EINVAL and missing/duplicate ENOTSUP. This is **proposal-helper fixture
coverage**, not a new public cp/mv workflow claim.

## Frozen inputs and results

Product freeze: `26e40698176bbbfc0e5891439ee74885aafb96be`, not moving HEAD.
The original three test files are byte-identical to full-gate source
`e36dab2b6abc216ddc89e5786a0eba76f08a1722`. Their complete bytes are retained as
non-discovered `.txt` files in `original/`; original25 full-gate failure rows
are preserved in `original/full-gate-25.json`. Historical full-gate evidence
remains unchanged: **15958 total,15769 pass,110 fail,79 skip — RED**.

Regular-file git archive:1266 source/test/config inputs, including192 `src/`
files. Dependencies copied once as318 regular files; no private engine, source
fallback, installation, worktree or mutable dist reuse. Source-set SHA256:
`c63c96f4a4ca3d8cc54ab78d95445fee8c0b3289ec9ba59626bbf90361d49e2b`.
Per-file hashes and commands are in `evidence/session.json` and `summary.json`.
Only the three owned test overlays differ during candidate runs; later authors'
changes are excluded. Node22.22.2, Darwin arm64, LC_ALL/LANG=C. No native utility
or live remote-service semantic claim is needed or made for this contract audit.

| Frozen scoped invocation | Pass / total | Fail | Skip / cancel / TODO |
| --- | ---: | ---: | ---: |
| Original three fixtures, unchanged | 58 /83 | **25** | 0 /0 /0 |
| First replacement attempt, preserved | 80 /85 | 5 | 0 /0 /0 |
| Corrected replacement attempt | 85 /85 | 0 | 0 /0 /0 |
| Final replacement fixtures | **85 /85** | 0 | 0 /0 /0 |
| Unchanged original4 + required49 guards | **53 /53** | 0 | 0 /0 /0 |
| Unchanged adjacent six-file cohort | **112 /112** | 0 | 0 /0 /0 |
| Restored source/tests after mutants | **85 /85** | 0 | 0 /0 /0 |

Final scoped TypeScript: **exit0**. No broad global typecheck, build or full suite
is implied by this test-only task. The original58 passing names are all retained;
the final85 contains83 reconciled cases plus two new honest-remapper controls.
It does not mean original83 inputs now pass unchanged.

The112 adjacent cases are the unchanged `core-ordering.test.ts`,
`public-comparison.test.ts`, original `compatibility.test.ts`, independent
`authority-trust-review/authority.test.ts`, and S3/WebDAV
`constructor-comparison.test.ts`. The53 guards are `copy-identity.test.ts`,
`copy-identity-guards.test.ts`, and `overlay/copy-identity.test.ts`.
The two deliberately noncompliant `boundary.test.ts` characterizations are not
included or counted as behavior acceptance.

The first candidate's five failures were reviewer-fixture mechanics, not changed
goldens: S3 writeStream is an instance-bound function, two path remappers had not
mapped realpath, one PUT counter watched the buffered path while streaming was
enabled, and one DAV remapper incorrectly described its root as a file. Their
inputs, hashes, TAP and diagnostics remain in `evidence/candidate-inputs/` and
`evidence/candidate.*`. Corrections preserve the intended assertions.

## Helper provenance is not unchanged-input acceptance

Independent `7a7562fe` and helper control `00aa323b` remain separate history.
Current MockDav SHA256 is
`177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36`;
the shared helper is untouched by this work. `a0e598b6` introduced its resource
identity model; `8c863cdd` removed method-reference forwarding eligibility.
This audit does **not** call that historical helper unchanged.

The current original compatibility fixture passes43/43 (38 positives +5 guards)
with the current helper. The old `d799cbb` helper control was38/43 overall,
**33/38 positives**, with five failed DAV positive workflows. The intermediate
`b02` helper could not load against removed imports. Those are distinct input
cohorts, not old-helper38/38 or blanket backend closure.

## Guard mutants and cleanup

Ten mutants are killed by named assertion failures, not import errors; each
executes all85 cases with zero skips/cancellations/TODOs. Six mutate production
**only in the isolated temporary snapshot**, four mutate fixture controls:

| Mutant | Failing cases /85 |
| --- | ---: |
| Reinstate Memory method-reference eligibility | 8 |
| Reinstate S3 method-reference eligibility | 4 |
| Remove unknown-existing-destination refusal | 6 |
| Remove mounted alias refusal | 19 |
| Swallow explicit comparison errors | 11 |
| Fabricate authority for unrecognized SDK HEAD | 2 |
| Retain unrelated private S3 HEAD | 1 |
| Retain unrelated private/protocol DAV response | 2 |
| Restore duplicate helper property augmentation | 1 |
| Accept duplicate protocol properties | 1 |

Each patch is applied with `apply_patch`, recorded with before/after SHA256,
then reversed and hash-checked. Restored85/85 passes; source/dependency hashes
remain intact. Known-bad host-binding mutants failing does **not** establish
product enforcement against malicious plugins; it validates the fixtures'
declared omission premise and retention of their strict safety assertions.

24 child invocations,120-second/8-MiB limits;121 observed PID/birth identities,
zero timeout/output-limit hits, zero surviving observed children. The owned
regular-file snapshot, dependencies and fixture tmp tree are removed;
`evidence/cleanup.json` records cleanup. No unrelated process or private tree
was touched.

## Commits and next verifier

- `6ce7750`: only the two implementation fixture files, binding reconciliation.
- `92e4118`: only authority.test.ts, protocol fixture correction/controls.
- Evidence is committed separately in this owned directory.

To reproduce without overwriting retained evidence, set
`AUTHORITY_RECONCILIATION_OUTPUT` to a fresh owned directory and run
`node tests/integration/full-gate-20260827/authority-reconciliation/run.mjs`
with `baseline`, then `candidate final`, `mutants`, and `cleanup`. The runner
always reconstructs26e4069 product bytes; the candidate phase overlays only the
three current test files. Inspect each recorded status: collector exit alone is
not acceptance. For the exact author checkpoint, use test bytes at the two
commits above. `summarize.mjs` seals the retained default evidence and refuses
to overwrite it; it is not a test runner.

The different verifier should review all25 mapped deltas, rerun the final scoped
cases/guards and challenge the mutants. **The two adapter-tools S3/WebDAV rmdir
positive failures remain real missing operations**. They were not edited, run,
relabelled or counted green. No arbitrary-host sandbox, generic-provider closure,
full-gate closure or compatibility/superiority claim follows from this checkpoint.
