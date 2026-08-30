# Independent historical audit rename review: PASS

Scope is only author commit `219790c55c0214e6d46524bbdced63c18c360f62`
against its **actual parent** `3f6db4dd29950d92410a4d4f9871ba18a5b56e89`.
This is not a module replay, behavioral gate or public-integration approval.

## Exact change

- `preserved-source.test.ts` becomes `preserved-source.audit.ts` with Git **R100**.
  Both modes are **100644**, both blobs are
  `86522c287a3055e2563abcb7d4d1e971414f690c`, both files are 1,141 bytes, and SHA256 is
  `3e84dc28815cd9c3e2a73cef50cd6457ee12fdcc1f5f91efb35033f783d07172`.
- The only other author changes are two **new** `audit-rename/README.md` and
  `audit-rename/receipt.json` files. No existing docs/history, product, behavioral
  test, package script, compiler configuration, glob or exclusion changes.
- Author receipt SHA256:
  `2df3212f78b89c64247c8fe1206bf3a0dd58a36caee1d789f6c0d1fec525d31a`.

## Discovery versus compiler coverage

The unchanged package's exact `globSync('tests/**/*.test.ts', ...)` expression,
including its existing exact native-data exclusion, runs against separate whole
parent and rename-commit archives. It does **not** launch the default test suite.

Frozen default discovery is **580 → 579 files**. Its sole removal is
`tests/commands/column/padding-evolution/preserved-source.test.ts`; there are
**zero additions**, and all **579 retained behavioral paths are byte-identical**.
The removed driver contains precisely the two historical byte-pin checks.
The author's live **586 → 585** counts are retained in the receipt but are not
these canonical frozen counts; concurrent untracked tests never enter this
comparison. The actual parent, not the receipt's observed `0123c83d` base, is used.

Actual TypeScript 5.9.3 configuration parsing returns **1,534 files before and
after**, with only the old/new filename substituted. The renamed `.audit.ts` stays
included by the unchanged `tests/**/*.ts` glob. This proves compiler membership,
not a full-project typecheck. The explicit renamed file also passes a separate
strict NodeNext/noEmit check with library checking enabled.

## Explicit historical execution

The complete rename-commit archive has the exact six historical column source
files from `a809635432f18a235b8fb622a05367bedc54b315`, source tree
`8b32998383d1372a8624ac41d2e747551e5b6d4c`, six-file digest
`e4f9a8d1690600807d496ae8bc42409cc98344ee7bba10ea702a136d52cd370e`.
No product overlay or external filename binding is needed. Sibling JSON bytes
are unchanged, and `preserved-source.json` also matches the historical commit.

Executed from that regular isolated archive:

```sh
node --import tsx --test tests/commands/column/padding-evolution/preserved-source.audit.ts
```

**2 tests / 2 pass / 0 fail**, with raw stdout/stderr/status retained in
`review.json`. The driver imports only `node:assert/strict`, `node:crypto`,
`node:fs`, and `node:test`; it reads snapshot-relative source/JSON bytes rather
than importing product modules. Its actual assertions pin **three full files and
two suffix sections**, not all six complete files. The six-file historical match
is independently authenticated by this review. Other shared source in the whole
rename archive can differ from `a8096354`; no single-source-change experiment is
claimed. No build or built-module prerequisite is needed by this driver.

## Controls and integrity

- A separate regular-file discovery-only mutant renames the identical driver
  back: the exact **580-file** inventory and the file containing both byte pins
  reappear. Empty behavioral placeholders are never executed.
- A one-byte driver mutation is rejected by the identity assertion, without
  editing any candidate or canonical file.
- All **27,698 parent** and **27,700 rename** Git blobs match before/after. Tracked
  fixture symlinks are authenticated as link text, not followed; product/audit
  files are regular. Candidate runtime namespace checks additionally re-enumerate
  files, symlinks **and directories**, detecting additions including empty dirs.
- Seven existing locked development-package file inventories, versions and
  installed integrity declarations match before/after. No dependencies are
  installed; no live product imports, private checkout or worktree is used.
- Both bounded test/typecheck process groups close normally: no deadline, output
  cap or forced cleanup. Synchronous Git/tar children also return normally.

The initial inspection tried nonexistent `tsconfig.tests.json`; that diagnostic
is disclosed in `review.json`. The actual unchanged root `tsconfig.json` is used
for all membership claims. No runtime/harness failure or assertion correction is
hidden. `verify.mjs` is an explicit version-specific capture driver outside test
discovery, never a reusable current behavioral test or evidence-rewriting test.

All old source/results/path history, the closed padding review, and S38 evidence
remain untouched. This review does not revisit the resolved S38 question or run
the parallel module workers' cohorts. **Root public integration remains HOLD**
pending its separate final-module/Arch v2 reviews. This tiny review is closed.
