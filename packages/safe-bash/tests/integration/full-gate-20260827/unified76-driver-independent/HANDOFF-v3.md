# Static policy decisions v3 — HOLD

Root's new decisions are recorded prospectively in `STATIC-POLICY-v3.json`.
**No tests or controls ran in this resume. A01–A22 remain NOT_EXECUTED.**
No new driver/component body or metadata was inspected. Decisions are authority,
not evidence that Curie's pending integration implements them.

Observed time: August27,2026,20:20:36 CDT (`America/Chicago`), equivalently
August28,2026,01:20:36 UTC. This is a clock observation, not the directory date.

| Decision | Original controls / findings | Qualification and pending evidence |
| --- | --- | --- |
| Exact11 system-library boundary | A03/04/06/07/15; Q2/3/4, R2/7 | Trusted macOS26.4.1/build25E253 metadata-only boundary for those sampled references without readable file identity. Exact list/metadata unavailable here; final packet required. No file-hash or full-OS attestation; no extension to non-system/npm/user/Homebrew libraries or unknown injection. Other required tools/dependencies stay hash-bound. |
| Sole `--run`; inert imports | A20; Q3, R5 | Confirms original policy, not the prior `--execute` implementation. New immutable entrypoint and later execution evidence required. |
| One driver-managed build, typing reuse | A10/11; Q6, R4 | Prospective ownership qualification, **not universally one total build**. Test-owned isolated builds are separate and must be enumerated/classified, not silently relabeled. |
| Strict nonzero/HOLD, zero skip, finite streamed work | A08/09/12–19; Q3/5/7, R3/6/7 | Guard/cleanup/unreaped failures cannot yield accepted CLI-green measurement. No numeric ceilings supplied: final packet must enumerate them. No current enforcement, extraction-safety or lifecycle acceptance inferred. |
| Complete count/inventory sweep in same four files | A01/02/05/11/22; Q1/6, R1 | Exact76/default and77/custom; enumerate before sealing. Final before/after hunks/path hashes unavailable. No fifth file or arbitrary behavior relaxation. |
| Pending integration and packet | A01/22; Q1, R1/7 | `a3ee4183`34+12 are author component counts only, not the independent22. `2ffcb23d` remains superseded/pending:20/1 at line32, line34 unreached. Neither is rescored or admitted. |

## Precise prospective oracle changes

- **A10:** Original positive literally says “Record exactly one build.” Preserve
  it. A future version must count one **driver-managed** build reused by typing
  and separately identify test-owned isolated builds, lineage and consumers.
  The previously observed extra consumer build is not automatically classified
  as test-owned. Hidden driver builds/stale outputs remain failures. This resolves
  R4's policy question prospectively, not original-oracle satisfaction.
- **A02:** Original negative rejects changing an expected command name/non-count
  bytes. The new inventory-literal sweep can conflict with that exact mutation.
  Preserve it; define a later oracle from the **actual enumerated authorized
  hunks**, with exact reverse proof and all other assertions/files preserved.
  Do not invent that enumeration or globally replace historical numbers/names.
- **OS/strict policy:** A future host-boundary oracle must distinguish the exact11
  metadata-only references from all other hash-bound inputs. A future strict
  verdict oracle must reflect zero skip and nonzero/HOLD for guard/cleanup/unreaped.
  These are prospective contracts, not executions of existing controls.

## Preservation and stop boundary

The seven original/v2 files were byte/hash-compared with
`dfd7775b5319a85dffeee9c240806677d39e3572`; their SHA-256 values are recorded in
the new JSON. Original F01 exit1, both distinct provider hashes, prior v2 results
and every historical count remain unchanged. No old validator/predicate ran.
Validation is limited to those comparisons, new JSON syntax and owned Git diffs.

Await exact final candidate/driver bindings, four-file hunk enumeration, exact11
system-reference metadata, other tool/dependency hashes, finite ceilings and
cleanup/profile evidence. No admission/full gate, build/types/pack/product import,
native execution, dependency/private write or new executable occurred. Only two
additive owned files are written; foreign staging/artifacts are preserved.
All owned commands settle before handoff. **Stop awaiting the final packet.**
