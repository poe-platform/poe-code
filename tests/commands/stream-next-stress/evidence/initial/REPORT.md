# Initial immutable source replay

Root released actual CLOSED authors and source commit
`1c745c3a633c32a8e9d87dacfdf33fcadc00caf2`. All four specified author ancestor
commits and the six format file hashes / split source digest were verified.
The launcher copied committed source/config bytes with `git show`, not mutable
working-tree source. Actual source-tree metadata hash:
`cb0aac0879d13bd8b64cd9fa57833f28c7e307db93a0160b271b9c9e1484afab`.

The first scoped build hit a verifier TypeScript annotation error before any
product execution. `../preexecution-typecheck.json` preserves the fault; adding
the missing type annotation changed no inputs or expected behavior. The second
scoped build passed and executed emitted JavaScript without TSX/root dist.

| Independent measurement | Initial result |
| --- | --- |
| Frozen primary inputs, MemoryFS | 61/82 strict; 82/82 weak original selected |
| Same inputs, explicit-root RealFS | 61/82 strict; 82/82 weak original selected |
| Combined executions | 122/164 strict; 164/164 weak original selected |
| Frozen actual pipeline workflows | 6/6 across both adapters |
| Prepared contract groups | 15/16; one verifier predispatch assumption fault |
| Node test groups | 17/18 pass; no skips/cancellations |
| Default factory / actual default registry | 60 before and after; five names absent |

All 164 primary executions match exact native stdout, exit status and namespace/
file-byte effects. The 42 strict discrepancies are stderr differences across
21 distinct inputs. The original selected classifier is explicitly weak; these
counts are **not** full diagnostic/semantic parity. Secondary Apple results
remain separate in `results.json` (52/142 strict, 66/142 weak selected); those are
comparisons of repeated source executions, not another 142 product executions.

The failing contract assumed `FileSystem.compareEntry` is mandatory. MemoryFS
supports it, but the real adapter exposes truthful scoped stat identities without
that optional method. The failed RealFS check occurs before that group's command
dispatch, so it is not a product command failure. Root separately authorized a
truthful optional-method/scoped-identity correction; this original log/helper
version is preserved rather than relabeled a product fix.

## Separate post-discovery product failure

The original 82 inputs do not contain dangling final output symlinks. Root
disclosed that author gap and requested a separate regression, not a revised
holdout. `dangling-regression.json` records its native freeze before execution.

Input `abc`, `out.aa -> target` with target absent, command
`split -b2 input out.`: GNU9.7-Darwin and Apple both return 0, preserve the symlink
and input, create target bytes `ab`, and create `out.ab` bytes `c`. The initial
source returns 1 on MemoryFS and RealFS, reports existing output, and creates
neither target nor second segment. Root cause in the pinned split source:
`Outputs.prepare` handles ENOENT from following an existing symlink as a missing
output entry and chooses `wx` against that existing symlink. This is a genuine
stable VFS workflow gap, not an approved safer subset or native unsupported case.
It was reported to root; this verifier edits no production source.

Exact timestamps, runtime/compiler/dependency/config hashes, committed source
file hashes, emitted-file hashes, raw stdout/stderr and source effects are in
the adjacent JSON files. No whole-project, deployed-remote, package-public,
performance, full native parity or superiority claim follows from this review.
