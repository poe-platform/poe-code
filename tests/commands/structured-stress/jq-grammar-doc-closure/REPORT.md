# jq grammar documentation closure

Documentation-only closure of the two live stale README statements. Historical
source-author sections, frozen evidence and test files remain unchanged.

- README-only documentation commit: `ceb3f5ff88624d6366a2b0f3810d6a93e489a327`.
- Actual documentation parent: `408ff5991875199f3587e289ee1d9bbaed4d7f94`.
- Previously tested source: `09926fb67452ca7db9bd793d87b78d2f41ff82be`.
- Old tested structured hash (including README): `913886e89fce8626d28f957d978243e3b8dd6bf94dd14348f5331f47607b4fb1`.
- New current docs-only structured hash: `04e7bacb7c0db05df3abc896dc21c9baf5abf0eb38ed018e8fbd3efcfed9d69c`.
- Runtime-only structured TypeScript hash: `53696061a9db15ae34e3f8908075e43123469c15a9e97ef7e7125a442397ee7c`.

`hash-proof.json` records every TypeScript file's SHA-256 at the tested source,
before HEAD, actual documentation parent, documentation commit, after HEAD, and
before/after worktree. All nine runtime files and their path set are unchanged.
The sourceSnapshot structured hash includes README, so its change is exclusively
documentation; the new full structured hash was **not runtime-tested**. The
documentation commit changes only `src/commands/structured/README.md`.

Prior independent evidence, not rerun here: `95966ca`/`1d93186` retain unchanged
main790 + legacy376 + independent178 = 1344/1344 source and compiled pre/post.
Native test-only `50434b3`, host-policy test-only `538a7f8`, and seal migration
`c0055e1` remain separate. Final `ea11ceb85bbecf90f00f472969c11c443df7d2ab`
`tests/commands/structured-stress/jq-grammar-seal-final/REPORT.md` records
3758/3758 structured tests, scoped typecheck success and 14 unowned WebDAV
consumer global diagnostics, not whole-project acceptance.

Historical94 baseline45 exact/49 differences (43 stderr + 6 acceptance),
original42 closure `bb1ceabe`/790, and all historical failures remain intact.
Typed host-exception identity is observable policy, not native parity. Unsupported
regex `split/2` and broader grammar remain gaps; no full-jq or superiority claim.
No research, corpus, tests, typechecks or builds were rerun; only read-only
metadata/digest and Git scope checks were performed. No product runtime was
imported, no delegation occurred, and no owned child remains active. Unowned
worktree/index changes were neither edited nor staged.

This report and `hash-proof.json` are added in a separate evidence-only commit;
resolve its ID with `git log -1 --format=%H -- tests/commands/structured-stress/jq-grammar-doc-closure/REPORT.md`.
