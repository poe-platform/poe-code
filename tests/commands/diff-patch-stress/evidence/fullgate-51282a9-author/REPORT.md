# Bounded canonical diff/patch author evidence

## Ownership and frozen baseline

This is author evidence, not independent acceptance. The assignment covers only
the three routed canonical test scopes and a genuinely confirmed diff/patch
source defect. Reviewer inputs, original cohorts, FS/contracts, root configs,
package exports, other commands and unattributed `.native-*` artifacts are not
edited or cleaned. No root `dist` output is generated.

`original.json` archives exact original bytes as base64 with individual SHA-256
values, including all three affected tests, the emptyfile-delta directory,
diff/patch source, relevant helpers and the routing full-gate report. It also
records all tracked source hashes, initial git status/index, native identities,
and initial HEAD `4686a1789bc95d17893cb4370955e722fb4a46ff` (after `72f780d`).
The initial diff/patch aggregate is
`b3096cbd306f633f6117c9e0ea89b19be7ad2f762c3cffabf0a0ae685091fa17`.
Aggregates hash JSON path-to-SHA-256 maps in `git ls-files` order, not source
concatenations. These are live dirty-worktree captures, not a frozen full gate.

The unchanged serial three-file run in `original-run.json` is **121 tests,
113 pass, 8 fail**, with zero skips, cancellations or TODOs. Failures are the
exact one repeated-hunk status, six pruned-parent nlink assertions, and one
stripped quoted ancestor assertion routed by the user. Later preservation
assertions in failing tests were not reached; their success is not assumed.
Historical broad results **3750/3758 original, 3758/3758 revised**, and the
original eight conflicts remain historical, not overwritten or re-executed here.

## Native diagnosis

`native-controls-original.json` contains raw argv, stdin, complete stdout/stderr,
exit status, before/after namespace (including file bytes, symlink targets,
mode, inode/device, nlink, directory children and empty directories), and virtual
counterparts. Native fixtures are newly allocated inside this author directory;
only those allocated roots are removed. Absolute explicit target arguments map
to a file inside that isolated root. No external user data or network writes.

Native executables are checked against existing project pins before execution:

| Runtime on this Darwin host | SHA-256 |
| --- | --- |
| GNU patch 2.8 | `c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00` |
| GNU diffutils 3.12 diff | `f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9` |
| Apple patch 2.0-12u11-Apple | `ca8aaa5fa4bd9dfaf4b3be251b18372f25f07483946e7d06b505e5a5fb0a6a84` |

The exact paths, canonical paths, version output and GNU local source hashes
are in the JSON captures. GNU uses `--batch`, matching virtual default policy;
Apple uses `-f` for noninteractive calibration and is never treated as GNU.
This is not GNU/Linux evidence or a universal native-filesystem nlink claim.

1. Repeated `@@ -1 +1 @@` hunks have valid GNU parsed ranges and body counts.
   GNU reports **status 1**, not malformed status 2: the second match would
   publish behind the output cursor. GNU commits `first`, the first target
   hunk, original bytes in `target.orig` and the failed second hunk in
   `target.rej`. Apple reports **status 2**, commits `first` but leaves target
   unchanged. Virtual atomic mode deliberately publishes nothing and emits
   `patch: hunk 2 does not match target`; GNU has no `--atomic` equivalent.
   A truncated body control produces status 2 in both native runtimes and
   virtual; default commits the previous file, atomic preserves everything.
   Native and virtual malformed diagnostics differ and are recorded, not
   equated or weakened.
2. All six exact normal/context/unified `-E`/long-option deletion fixtures
   succeed in GNU and Apple. The authorized target and empty authorized parent
   disappear; root nlink is **4 before, 3 after** on this local fixture. Decoys
   and work remain. The original fixture deletes the parent's namespace entry
   from its expectation but incorrectly leaves root nlink 4. Its later mutation
   assertion also expects `rm` for that parent, while the current implementation
   correctly calls optional `rmdir`. The original observer never recorded it.
   `rmdir`, no recursive fallback, remains normative.
3. GNU default strips `"alias/target"` to `target`, updates `first` and `target`,
   and leaves the symlink and `dir/target` untouched. Apple does not parse these
   quoted headers equivalently and creates rejects (raw bytes preserved).
   With `-p0`, GNU follows the selected ancestor symlink; virtual still rejects
   it before publication. Selected-final-symlink behavior also differs: GNU
   commits the earlier file and writes a reject, virtual rejects pre-publication.
   These intentional security-policy differences are not called native parity.
   Existing malicious decoded absolute/traversal/NUL/header controls stay intact.

## Independently confirmed source correction

The SAME repeated hunks with initial target `old\nmiddle\nold\n` expose a real
defect, separately from the stale original status assertion. GNU selects the
first exact match at line 1, then rejects its misordering; it does not search
for a later duplicate. Before correction, virtual `matches` marked that match
misordered but returned false, searched again, and changed the last `old` line.
Both default and atomic incorrectly returned 0; atomic published both files.

`unified.ts` now keeps the first content-match selection and then classifies a
selected position behind the output cursor as failed. It preserves conflict
status, partial/default publication, exact diagnostics, rejects and backups, and
atomic no-publication. No grammar tightening, dependencies or host fallback.
Two pinned-native regressions are added to the owned fuzz test. They assert
status, exact diagnostics, complete file listing and bytes (including reject
and backup), and atomic full namespace/metadata preservation.

`source-regression-before.json`: **0/2 pass**. `source-regression-after.json`:
**2/2 pass**. `native-controls-source-fixed.json` repeats the bounded native
fixtures with the source correction, before correcting any old assertion.
`validation-source-fixed.json`: targeted **115 pass / 8 fail / 123 total**;
six existing matcher/publication/property suites **164/164 pass**. Scoped strict
TypeScript, root build configuration with output redirected to author `.build`,
and owned whitespace check pass. All original eight failures still reproduce.

Primary references: local GNU patch 2.8 `pch.c:1602` unified parsing,
`patch.c:1155` match selection, `patch.c:1626` copy/output-cursor failure,
`patch.man:1009` status classification, `util.c:1466` basename stripping,
`util.c:1356` safe ancestor removal. Source hashes are recorded in each native
capture. Online primary GNU Diffutils manual pages consulted on August 27, 2026:
`https://www.gnu.org/software/diffutils/manual/html_node/Detailed-Unified.html`,
`https://www.gnu.org/software/diffutils/manual/html_node/patch-Options.html`,
`https://www.gnu.org/software/diffutils/manual/html_node/Creating-and-Removing.html`.
The pinned implementation/runtime, not an assumed interpretation of hunk
coordinates or a different host profile, establishes the repeated-hunk result.

## Reproduction

Run from the repository root with existing pinned local native fixtures:

```sh
node --import tsx tests/commands/diff-patch-stress/evidence/fullgate-51282a9-author/native-controls.mjs fresh-native.json
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 tests/commands/diff-patch-stress/fuzz/edits.test.ts tests/commands/diff-patch-stress/emptyfile-delta/emptyfile.test.ts tests/commands/diff-patch-stress/editflows/quoted-safety.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/commands/diff-patch-stress/evidence/fullgate-51282a9-author/tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.build.json --outDir tests/commands/diff-patch-stress/evidence/fullgate-51282a9-author/.build
```

Capture helpers refuse to overwrite existing evidence. `original.json` retains
bytes for an unchanged-original replay without modifying canonical tests. Native
captures and test checks do not claim broad superiority, deployed-provider
support, 72 hours of work, full-gate completion or independent review acceptance.
