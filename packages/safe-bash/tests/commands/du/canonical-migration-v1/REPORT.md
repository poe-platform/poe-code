# Combined DU canonical migration author checkpoint

Candidate: 9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d (test-only migration, two owned files).
DU production remains byte-identical to 32c5b60c; Overlay remains byte-identical
to 1c793b93; Overlay test migration 0d6b9fcf is included. No production, root
export/package/config/contract, excluded author, or independent test changes.

## Exact expectation delta

DELTA.md and migration.patch describe the only four migrated expectations.
ORIGINALS.json authenticates full original test bodies and unchanged raw
5/9 pass, 4-fail handoff. Their byte-identical snapshots live in originals/.
Invalid explicit options still fail before filesystem access. Invalid/empty
selected environment inputs now assert exact successful 1024-byte formatting
on a 1025-byte apparent file, empty stderr, and one lstat only. The frozen
O086/O087 results now match exactly; only O062's obsolete empty diagnostic
map changes. No broad diagnostic assertion relaxation or deleted native cases.

## Same committed snapshot results

Capture: combined-v1-3IRluB/. All commands use one git-archive extraction,
never a live product overlay. Source closure: 237 source files;
278 committed input paths. Every extracted input hash was separately
checked against its candidate Git blob and the current live input at sealing.

| Check | Result |
| --- | --- |
| All current DU canonical tests, seven files | 191 pass, 0 fail/skip/cancel |
| Overlay existing strict selection | 30 pass, 0 fail/skip/cancel |
| Overlay existing focused selection | 416 pass, 0 fail/skip/cancel |
| DU root scoped TypeScript | exit 0 |
| DU functional-v1 scoped TypeScript | exit 0 |
| Overlay strict/focused scoped TypeScript | exit 0 |
| Isolated ESM/declarations build | exit 0; 99 output files hashed |
| Actual Shell built-module/plugin boundary | six checks, exit 0 |

Selections overlap (DU backend/purity tests also occur in Overlay selections);
do not sum these denominators as distinct tests. The full seven-file DU
inventory is recorded, including current backend/purity tests, with historical
opt-in data and independent scripts excluded, not current canonical tests.
The unchanged Overlay driver's exact strict/focused arrays are reused by the
DU-owned archive driver; no other owner's driver was edited or executed in
the live worktree. Existing native tests reuse the authenticated GNU9.7 binary
read-only: their original 18 and functional 36 live cases remain unchanged.
No added native breadth, dependency fetch, BSD substitution, or Linux claim.
Canonical pass means the qualified profile passes, not universal GNU parity.

Archive SHA256: 060064b1fbada5d605934cbdcdda1863ae44f8ef05e05b8ab3a7af690982c3fa
Source-manifest SHA256: 5e656dba28073ae1b4e4127a130253ffa14004cbb7821a04bbaf03b3898a60c7
Combined input-manifest SHA256: 8b70378033cef9bf7490c931cb0089cdb0002dcaebd3ed01cd0fc9002193a211
Per-file source/test hashes and exact argv/status/raw stdout/stderr are recorded
in AUTHENTICATION.json and the capture manifests/logs. The source digest hashes
the serialized sorted path-to-SHA256 source map, not a Git tree object.

## Preservation and concurrency

All original 55 artifact hashes, prior functional 45 artifact hashes,
and 3 classification-seal payload hashes reverify. Both frozen native fixtures
remain unchanged. Original 15 differences plus three ordering raw observations
are preserved; this follow-up does not recapture or replace those denominators.

Archive before/after bytes match; every original runtime file is unchanged and
no unexpected files remain. The separately hashed build output and installed
tooling link are explicitly excluded from that input comparison. Empty
directories and external tooling contents are not append-proof claims. Owned
runtime/native fixture/build trees are cleaned. Shared dist hashes are unchanged.

The validation capture honestly records indexPreserved:false: a concurrent
87833f33 docs commit advanced the shared index while tests ran. Both recorded
index hashes exactly equal the complete stage-0 trees of 9a5a6f92 and 87833f33;
that commit changes none of the 278 measured inputs. This leaf issued no
index writes during validation and never restores another writer's index.
The migration commit preserved all unrelated entries; the evidence commit
uses explicit new owned paths with a separate before/after unrelated-index check.

No scoped failures remain. O060 stays proposal-only; deterministic ordering
and the three ordering differences remain unchanged. Public wiring/packed
consumer integration is not claimed. This is author validation, awaiting
Heisenberg 01a0443f-942f-7e32-9f01-6d19143fc87b, not independent acceptance.
