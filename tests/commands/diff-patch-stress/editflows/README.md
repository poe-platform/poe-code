# Independent coding-agent edit-flow evidence

Recorded 2026-08-26. This worker owns only this directory. Product source,
author tests, and compatibility/safety/fuzz workers' files were read-only.
No runtime or development dependency was added. The original intentionally failing
acceptance regressions are preserved as historical evidence below, not a claim
that refusing common patches is correct.

## Post-fix checkpoint: August 26, 2026

On committed source `9d6d292febce66d2e7ffa564a059e8f44e4ebff9`, the original
suite reported **31 tests, 30 pass, 1 fail**. The remaining assertion was obsolete
under user authorization commit `e685231032b34f06c34038ce4c443376af7e066d`:
a valid absolute header does not override or invalidate a safe explicit target.
Its replacement requires status 0, exact stdout, empty stderr, exactly one write
to a distinctly named explicit target, and a complete VFS snapshot preserving
all header-name decoys, other bytes, and entry identities. No-explicit-target
absolute rejection and all traversal-before-strip and symlink cases remain.

Final result: **31 passed, 0 failed, skipped, TODO, or cancelled**; strict scoped
TypeScript passed. This includes the same ten isolated native oracle checks;
no new GNU probe or GNU behavior claim was added. No defect remains in this suite.
`../path-regressions/postfix-checkpoint.json` records the exact committed-source
archive, before/after source hashes, test hashes, both run counts, typechecks,
and executable provenance. Source remained unchanged in that isolated checkpoint;
concurrent live-tree edits were not incorporated. The historical 20/11 result
below is not rewritten, and these results are not whole-repository validation.

## Reproduction and historical measured baseline

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch-stress/editflows/*.test.ts
node_modules/.bin/tsc --noEmit -p tests/commands/diff-patch-stress/editflows/tsconfig.json
```

Final repeat: **31 tests, 20 pass, 11 fail, zero skipped/todo**. The test command
exits 1. Scoped strict typechecking passes, including transitive source imports
and the actual Shell plugin integration. This is not whole-repository validation.
Ten native checks pass; nine quoted-path security checks pass; the exact-match
whitespace control passes. All eleven other product assertions fail. The mail
test also fails through `new Shell(...).use(diffPatchCommands())` with the literal
virtual command `patch -p1 < change.eml`; no host shell executes that command.

Inspection began at HEAD `834f76ca6f86b531597a157f92b0b367b839363a`, with source
author commit `cd49267c9792c02c6dd9b6ac8a7cffd81c7eaa69`. Concurrent root fixes
later changed diff option handling/brief labels and empty unified context lines.
The final repeat remained 20/11 at observed HEAD
`e6036bb314f4e7234b05388400e3f05ac33248a1`; source SHA-256 values were unchanged
across that repeat:

```text
dce63aa8e9a43f5908e778be0eeefde18a3d45f40cf21e62b389b796fc8402a2 diff.ts
82465ab079aac196a8cf99231fc9d9e7f4f60135f862802e02d2e523d0bebf17 index.ts
1650dcacf34c3d8361eb8bc34a446b4d1280fc0b46a0ea63b461007e231c3d4f patch.ts
81ab0a3d1fbb29feb91761a7a60a535ca5768079ee0415e0788cbebfb1f3617e shared.ts
256aae65f1f2edc7965963295378700aa61bc0181b12eeee298295d592cd0c66 unified.ts
```

The initial author hashes of the two subsequently changed files were
`42375b418511a0fa12688d91278d18a0487ab999cd4e0d186ea4915929da64e2` (diff.ts) and
`9e2821b36236b40f70654ba3ff7202da3a99b13c81c5642036666d13e4473e10` (unified.ts).

## Five historical confirmed gaps

All patch success fixtures require status 0, empty stderr, and the exact target
bytes encoded in `fixtures.ts`; currently they return 2, emit no stdout, and
leave the old bytes. Regressions compare Buffers, not trimmed/normalized text.

| Flow | Native result | Product baseline |
| --- | --- | --- |
| Git C-quoted spaces, tab, UTF-8 octets | Git apply: 0; `old\n` becomes `new\n` in the intended literal name | Three failures: `patch: unsupported or empty patch filename\n` |
| Mail headers, diffstat, Git preamble, signature | Patch: 0; target `new\n` | `patch: expected --- file header\n`; also fails Shell integration |
| Concatenated same-file sections | Patch: 0; old -> middle -> new | `patch: duplicate target in patch: /work/target\n` |
| `patch -l` | Patch: 0; preserves tabbed context, installs literal spaces in additions | `patch: unsupported option: -l\n` |
| Normal/default diff and normal patch | Diff: 1 with `1c1\n< old\n---\n> new\n`; normal patch: 0 after append/change/delete | Diff returns 1 but unified bytes; patch returns 2, expected-header diagnostic |

Two additional failing assertions constrain the fixes: `-l` must return 1,
not 2, when a required blank run is absent; a conflicting second same-file
section must return 1 without writing the first section. The latter no-early-write
requirement preserves this project's preflight policy, not native patch's
partial-application behavior. Successful sequential edits have native evidence.

## Native isolation and evidence

The executable paths and observed identities are `/usr/bin/git` =
`git version 2.50.1 (Apple Git-155)`, `/usr/bin/diff` =
`Apple diff (based on FreeBSD diff)`, `/usr/bin/patch` =
`patch 2.0-12u11-Apple`. This is not a GNU-binary comparison.

`oracles.test.ts` uses literal argv through Node `spawnSync`, `shell: false`,
three-second timeouts, 1 MiB output limits, and fixed C locale. Each invocation
uses a freshly created `.oracle-*` directory here, removed in `finally`; HOME,
TMPDIR and XDG_CONFIG_HOME point inside it. Git global/system config is disabled,
parent repository discovery is blocked, and `apply --no-index` does not touch the
shared repository index. There is no Git initialization, network, or dependency
installation. Missing executables fail visibly rather than skip.

Git applies the three safe quoted fixtures with
`apply --no-index --whitespace=nowarn -p1 -`; all produce empty stdout/stderr.
Native patch uses `-f -p0 -F0` plus fixture arguments and reports
`patching file target\n` (twice for repeated sections), with empty stderr for
success. Dangerous quoted names and symlinks run **only** on MemoryFileSystem.
An independent native rejection verifies the nonempty-blank requirement.

## Primary authorities checked with web.run

- Git diff-format and git-config, core.quotePath:
  `https://git-scm.com/docs/diff-format` and
  `https://git-scm.com/docs/git-config#Documentation/git-config.txt-corequotePath`.
  Git uses C-style escapes and octal UTF-8 bytes. A plain space alone does not
  force quoting; the explicitly quoted-space fixture tests accepted input,
  not a claim that Git always emits quoted spaces. Tab and octet escaping are
  ordinary Git output. Do not Unicode-normalize decoded names.
- GNU Diffutils manual, Changed White Space:
  `https://www.gnu.org/software/diffutils/manual/html_node/Changed-White-Space.html`.
  Nonempty space/tab runs can match other nonempty runs; other content and line
  boundaries must still match. This is not unconditional whitespace deletion.
- GNU Diffutils manual, Imperfect and Multiple Patches:
  `https://www.gnu.org/software/diffutils/manual/html_node/Imperfect.html` and
  `https://www.gnu.org/s/diffutils/manual/html_node/Multiple-Patches.html`.
  Mail framing can surround a patch; concatenated patches are processed as
  separate patches. This evidence does not authorize skipping malformed hunks.
- GNU normal-format discussion and POSIX patch/diff:
  `https://www.gnu.org/software/diffutils/manual/diffutils.html`,
  `https://pubs.opengroup.org/onlinepubs/009695399/utilities/patch.html`,
  `https://pubs.opengroup.org/onlinepubs/9799919799/utilities/diff.html`.
  Normal diff is a compatibility default; normal patch input is not an exotic
  extension. The cited patch page is the older POSIX edition, identified here
  explicitly rather than presented as the latest specification.

## Smallest safe implementation handoff

1. Decode a complete quoted filename token into bytes, then strict UTF-8, before
   path policy and stripping. Never JSON-parse, evaluate, URL-decode, or split a
   decoded tab as a timestamp. Validate both headers even with an explicit target.
   Keep absolute, traversal-before/after-strip, NUL, backslash, and symlink
   rejection. Supporting literal tabs needs a narrow policy change and escaped
   diagnostics, not permission for arbitrary controls. Reject malformed escapes.
   Existing passing security guards currently benefit from blanket quote
   rejection; they prove no decoding capability until the success tests pass.
2. Add a bounded envelope-scanning state around the strict unified parser for
   common mail headers/body, diffstat and signature. Once a hunk starts, do not
   downgrade broken counts or patch-like garbage into ignorable prose. Keep
   binary/mode/symlink/rename metadata rejection separate from harmless framing.
3. Replace duplicate-path rejection with a per-canonical-path staged state map:
   apply later sections to the prior staged result, retaining the original bytes
   for revalidation and committing each final target once. Preserve budget,
   dry-run and all-files-preflight guarantees. Do not infer rename semantics:
   Git's rename-swap example explicitly cannot be applied sequentially.
4. Add a budgeted optional space/tab-run comparator for matching old/context
   lines only. Retain actual target context and literal patch additions. Keep
   exact matching as default; do not conflate `-l` with context fuzz.
5. Reuse the line-edit representation to render normal `a/c/d` output; parse
   normal ranges into validated edits with explicit target selection. Keep `-u`
   selecting unified output. Changing the documented unified default requires
   root coordination with author tests and documentation, not weakening this
   parity regression or silently changing another worker's expectations.

Read existing author and compatibility/safety/fuzz suites before adding these
cases. Existing unquoted Unicode/space tests, ordinary Git prefixes, and exact
whitespace edits were not duplicated. The safety worker's duplicate-target
status-2 expectations conflict with sequential-support acceptance; root must
coordinate their revision rather than ask this leaf to edit that subtree.
The full shell goal and superiority over just-bash remain unproved.
