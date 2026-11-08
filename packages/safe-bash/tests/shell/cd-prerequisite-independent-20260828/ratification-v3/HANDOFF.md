# Additive ROOT ratification binding

## Authority and preserved control

This appendix explicitly binds authoritative policy commit
`ef833fd2cbf006993b1f94d7f3a0d3254e0ad3de`, document
`tests/shell/cd-prerequisite-20260828/ROOT-RATIFICATION-v3.md`, to independent
control seal `beeda1a96bb25c846cd6df0cf0f7a0fff06bcf6e`.

Policy Git blob: `37ecdd0c187896ab7583c3631c4d6fea262f4c29`.
Policy SHA256: `1a88dd6c82a82803bd0c5b1aa2939f394ecb1486626bd074c7a1f6455a8fe60e`.
The committed document is 4812 bytes. `BINDING.json` pins full commits, blobs,
SHA256 values, original18-file membership, and the preserved denominators.

The original freeze used ROOT's routed approval of7728401/88208567. It did NOT
explicitly bind ef833 in its18 artifacts. This new appendix supplies that formal
binding without rewriting or retroactively relabeling the original freeze.

## Comparison: consistent, no assertion changes

The complete committed ratification and original profiles were read and compared
with the sealed `../DECLARED-CONTRACT-v1.md`. No inconsistency was found:

| Ratification lines | Already frozen rule |
| --- | --- |
| 10-22 | Both original profiles ratified; their historical pending wording does not remain an open question. |
| 24-33 | Inclusive65,536-byte inputs/paths;4096 components;4097 probes;8194 public calls;8,388,608 helper units;128-unit yields; no extra shared charges/reset. |
| 34-44 | Only typed ENOENT/ENOTDIR/EACCES continue; EPERM/ELOOP fatal; cancellation/fallback precedence; missing variables before limits; empty-to-dot retained; checked publication and no rollback. |
| 48-60 | Payload65,792 including cd-owned prefix, excluding shell origin/newline; longest scalar prefix <=65,780 plus exact12-byte suffix; incremental construction; no envelope/global cap/new keys. |
| 64-83 | Same5137+two-ca1d-WebDAV-blob composition, provider review/native history, virtual navigation rather than ACL/service proof, and separate ROOT GO requirement. |

Original profile hashes match at their original commits, the control seal,
the ratification commit, and current files:

- `AUTHOR-POLICY-v2.md`, commit `882085678862a23cfeef6505fa41a03891743439`,
  SHA256 `bbc2024017c6476b2f8c43af4a1088367303c86a4d894cd3ce6e57fda6bbc9ff`.
- `AUTHOR-POLICY-v3-DETAILS.md`, commit `7728401ccb7bfa8f1961ffe100ca5617f3a6b553`,
  SHA256 `5268aeafff4878926931c8ccf80cf2234134ae0d1fc594b00e44b6d157211489`.

All original18 files remain byte-for-byte unchanged, including82 command cases,
four diagnostic cases,10 positive/10 negative type controls,12 invariants and
seven future integration controls. No new cases, cohort, source inspection,
native/probe/provider/product execution or type compilation accompanies this
appendix. Existing evidence counts are references, not newly claimed passes.

## Read-only verification and handoff

```
node tests/shell/cd-prerequisite-independent-20260828/ratification-v3/verify.mjs --commit FULL_BINDING_COMMIT
```

The verifier authenticates the original18 Git members and live bytes/modes,
excluding ONLY the authorized `ratification-v3` child subtree from the original
membership walk. It then checks that subtree's exact four-file membership,
including added-file/empty-directory rejection, and authenticates its manifest
against the supplied binding commit. The manifest's sole self-exclusion is bound
by Git. No product imports, prior verifier execution, writes or capture updates.
These are enumerated filesystem checks, not a concurrent filesystem transaction.

Old audits/manifests remain untouched. Their unmodified full-directory checks
may reject this newly authorized append; use this separate verifier for the
composed original-plus-append scope, not an edited or weakened old verifier.

**No remaining policy question. No runtime authorization is granted here.**
Runtime still requires explicit ROOT GO; directory-stack remains separate/held.
