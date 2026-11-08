# Unapplied historical seal migration — 2026-08-27 UTC

This TEST-ONLY proposal changes one future target:
`tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts`.
Nothing outside this new proposal directory was edited. The original test,
immutable-before.json, canonical files, source, native bytes, fixtures and old
reports remain unchanged. The historical full-suite result remains **3757/3758**;
this leaf neither applies the patch nor reruns that suite.

## Exact artifacts

- `seal-migration.patch`: unified patch, SHA-256
  `53e2b083aa7c61444052eebd14428ba5e032500e963eb1b6e5f427806ddaa47f`.
- `afterSnapshot/evidence.test.ts.txt`: exact proposed target bytes, SHA-256
  `81a55856d1ec4dea51676ef09a5aeeb95d3383a7284eb1ec87deef848e430281`.
- `before-2026-08-27/evidence.test.ts.txt`: exact original test bytes, including
  its original name, SHA-256
  `bc2b19133b926eccf2519885bb5ca7a16f9ce09e1fb1a9cda78b6c365a7710f8`.
- `verification.json`: complete 13-path before/after snapshot/hash/commit map,
  intersection flags, verification counts and every mutation outcome.
- `verify.mjs`: reproducible read-only Git provenance and virtual-file checks.

## Exact intersection and provenance

The unchanged old manifest seals **139 paths**. Its actual intersection with
the approved 13-path manifest is **10 paths**, not just the first helper:

| Path (under tests/commands/) | Application |
| --- | --- |
| structured-stress/harness.ts | native 50434b3 |
| structured-stress/independent-increment/safety.test.ts | native 50434b3 |
| structured-stress/join.test.ts | native 50434b3 |
| structured-stress/jq-42-author-20260827/safety.test.ts | host 538a7f8 |
| structured-stress/raw-input.test.ts | native 50434b3 |
| structured-stress/safety.test.ts | native 50434b3 |
| structured-stress/split-increment/command.test.ts | native 50434b3 |
| structured/cli.test.ts | native 50434b3 |
| structured/helpers.ts | native 50434b3 |
| structured/resources.test.ts | native 50434b3 |

The other **129 sealed paths** retain their original live-byte hashes. The
remaining three approved paths are newly added jq-grammar-native-v3.json,
jq-grammar-native-v3.ts and jq-grammar-byte-assertions-v3.test.ts under
structured-stress; none was in the old seal. The proposed test additionally
verifies these three live files and all 13 approved after snapshots exactly.

The test pins the entire original immutable manifest to
`3766803b4bd8cc39f014e13de881cda034515b1094436530cdfa6505750ce9e3`
and the entire canonical-plan patch-manifest-v3.json to
`aae89dfeefab84c50ef91a84c1c1608d659c0037ac96eb93c5f828ab32c938ce`.
That second pin is the exact eab1d48 proposal present at independent approval
95966ca. No mutable allowlist, manifest rewrite, existence-only check or skip
is used. Every intersecting before snapshot must match both its reviewed hash
and its original old-manifest hash; each live migrated path and after snapshot
must match the approved after hash. The dated original test is also hash-pinned.

Proposal verification compares the exact intersection with final-audit.json's
oldSeal.exactApprovedDeltas and checks that audit against report commit 1d93186.
For all 13 paths it verifies exact application-commit membership, live bytes
against committed bytes, before snapshots against commit-parent bytes, after
snapshots against committed bytes, and snapshots against approval 95966ca.
The three new files must be absent from their application commit's parent tree.
Both application commits must descend from approval; the native commit has
exactly 12 reviewed paths and the host commit exactly one. Full commit IDs and
all individual hashes are in verification.json. Runtime validation needs no Git:
its immutable content pins bind the reviewed manifest and original seal.

## Validation and limits

Run from the repository root:

```sh
node tests/commands/structured-stress/jq-grammar-seal-proposal/verify.mjs
```

Node v22.22.2 builtins only; no dependencies, product imports, native oracle,
new corpus, build, global typecheck or filesystem mutation. Node's built-in
TypeScript stripping emits its experimental warning. The verifier executes the
exact afterSnapshot in a VM with only imports/import.meta wired to Node builtins,
a synchronous test registrar and a virtual read-only byte map. It does not
substitute a separately implemented validator. Git apply --check succeeds, and
the unified patch equals the exact before/after snapshot diff.
Git's staged whitespace check flags only the patch artifact's required single-space
blank context line; the snapshots and executable code have no whitespace errors.

**352/352 explicitly counted checks:** two candidate tests pass, two original
tests pass with historical bytes restored only in memory, the original live
failure is reproduced, and **347/347 negative mutations are rejected**. These
347 comprise 10 before-snapshot tampers, 13 current-after tampers, 13 after-snapshot
tampers, all 129 unlisted sealed-path changes, 13 manifest/snapshot/native control
mutations, and removal of each of the 169 virtual input files. Controls include
missing/extra/duplicate migration entries, changed before/after hashes and paths,
wrong manifest hash despite equivalent JSON, removed/extra/rewritten old entries,
dated-test tampering and frozen-native tampering. Provenance and patch checks
are additional assertions, not inflated into that 352-check denominator.

This is a bounded hash-seal proposal, not new native or source acceptance.
Prior independently reported source+compiled pre/post 1344/1344, changed-tests
427/427 and full 3757/3758 remain separate historical evidence. Source 09926fb
and its approved aggregate hash
913886e89fce8626d28f957d978243e3b8dd6bf94dd14348f5331f47607b4fb1
are not changed or revalidated here. A different leaf must independently review
this proposal, apply only the single test target if accepted, retain these
snapshots, and rerun the complete 3758 tests. Future unapproved hash changes
must still fail rather than inherit migration permission.
