# Registered env-shebang expectation correction

## Exact test-only scope

Test-only commit: `f6a3fa75280bd4d925027e62498aa67b5d9785dc`.
Accepted product source: `ea409a6b49d5c1523e3238f0384048218b559c4c`.
This TEST-ONLY leaf is separate from both the exited source author and the
independent source reviewer. ROOT authorized only the obsolete registered-alien
characterization correction under the existing explicit guarded-target policy.

Only `tests/shell/env-shebang.test.ts` changes in the test commit. The same test
keeps every input vector and registered definition, including the `["env", "alien"]`
registration loop. The reserved interpreter still produces `body\n`, a registered
bash override still returns 126 with its existing diagnostic, and the zero-handler
side-effect check now occurs immediately before selecting alien. That selection
requires exactly 37, empty stdout and stderr, and exactly one handler effect.
Empty stdout also rejects executing the unchanged `say BAD` script body. No
unknown-target 127, negative control, host test, original core/script refusal,
production code, native fixture or independent corpus was modified.

Original test bytes remain at `ea409a6b:tests/shell/env-shebang.test.ts`, SHA256
`fa3920c0e09cf2c614540a0a804cc36d60d73da1e8bdf14d590c1e262de78129`.
Corrected test SHA256:
`ac45453fa01328c5eb783952c384446d68a8cceaaa39e54b2b23c6a74d1a4341`.

## Immutable validation

`attempt-03` archives the accepted source commit's complete `src` tree and the
explicit build/test prerequisites listed in its report. It overlays only the
corrected test from the test-only commit, plus the unchanged scoped TypeScript
configuration from author-evidence commit `ee7d909c0379ca1237f729f55a0a22fbe35aa8f7`.
There is no live product-input fallback. The source Git tree is
`1b0de0790cda18887870195e88e519b045132d38`; archive SHA256:
`57c54f68f88fb17e74cc72d079ba10325c22c1741231d326593c75fe46c7c89d`.
The unrelated committed `src/commands/text.ts` changes between accepted source
and test commit/current HEAD are explicitly excluded from this archived candidate.

Results, August 27, 2026, 15:30:44.445–15:30:52.179 UTC:

| Check | Result | Raw evidence |
| --- | --- | --- |
| Archived build | exit 0 | `attempt-03/build.stdout`, `.stderr` |
| Both complete author files | **48/48**, 0 fail/skip/cancel/TODO | `attempt-03/author-48.stdout`, `.stderr` |
| Same existing case titles, only authorized title renamed | exact ordered match | `attempt-03/report.json` |
| Scoped strict TypeScript | exit 0 | `attempt-03/strict.stdout`, `.stderr` |
| Input, dist, tool and native before/after checks | unchanged | `attempt-03/report.json` |

Inside the archived root, the exact validation commands are:

```sh
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node --import tsx --test tests/shell/env-shebang.test.ts tests/shell/env-shebang-host.test.ts
node node_modules/typescript/bin/tsc -p tests/shell-stress/env-shebang-author/guarded-completion/tsconfig.scoped.json
```

The first command is the compiler invoked by the unchanged `npm run build`
script. Strict checking covers the two author entrypoints and transitive source,
not all repository tests, strict consumers or a release gate. Explicit rerun:
`node tests/shell-stress/env-shebang-author/guarded-expectation-correction/verify.mjs attempt-04`.
Use another unused attempt number if necessary; existing output directories are
rejected. The runner uses installed development tools, checks their named package
trees before/after, and records Node executable and native binary hashes.
Versions: Node 22.22.2, tsx 4.23.12, TypeScript 5.9.3, @types/node 22.20.1,
esbuild and darwin-arm64 esbuild 0.28.2. Both unchanged native test profiles
(GNU env 9.7/Bash 5.3 on Darwin and Apple env/Bash 3.2 on Darwin) ran without skips.
Their binary pins and separate Darwin-kernel caveat remain intact.

## Prior failure and independent justification

The original author's **47/48** transcript remains unchanged at
`ee7d909c:tests/shell-stress/env-shebang-author/guarded-completion/fourth-author.tap`,
SHA256 `142e51689305f298b15a00bc39b0239b5a827dd571482e3a7ec00f3967bb2833`.
Its previous failed attempts and the eight original core/script refusal failures
remain in that immutable evidence commit. They were not rerun or reclassified here.

The different source reviewer's immutable evidence commit is
`01cc25f94247f6a2f9279f33c058fc4c7862f6ac`. Exact report references under
`tests/shell-stress/env-shebang-integration-review/`:

- `guarded-ea409a6b-20260827-review1-controls/report.json`: archived **47/48**,
  actual registered 37 versus obsolete expected 127; report SHA256
  `f0b5469f2637df517555e616e09963029a0cf2b789754bc35d711bfba2de15b8`, source archive
  `7e49f2f30750623c5e5e63c8b23bd3583f62835cfd2a9568b09ceae597873447`.
- `guarded-ea409a6b-20260827-review1/report.json`: unchanged frozen **30/30**,
  report SHA256 `bc8cf21b3abf3dae5e660bf56d7d82297c0653d45961b5aee45652eb75d8895f`,
  source archive `1bc774bb32e2b7268c007d99075fdc9265b7c6ad01413e2614517a350eb9bbac`.
- `guarded-ea409a6b-20260827-review1-audit/report.json`: independently qualified
  30/30 and scoped controls; SHA256
  `650a542b773c558a77793feaa91257fdedf8d5ffb02576e6369f3c9921295bc2`.

`immutable-review-binding.json` verifies these hashes using `git show` from that
commit. `attempt-03/independent-prior-47-of-48.tap` preserves the decoded reviewer
transcript byte-for-byte. Frozen 30 are cited, not rerun or added to this leaf's
48-case denominator. Strict native tuples remain 17/23, not 30/30 native parity;
no Linux-kernel qualification is claimed.

## Retained pre-attempts and integrity limits

- `pre-attempt.log`: post-commit hash inspection used nonexistent
  `src/commands/core.ts` and exited 1. Read-only lookup identified actual env core
  `src/commands/execution.ts`; no source modification followed.
- `attempt-01`: runner root traversal was one level too high. Git preflight
  failed before extraction/build/tests. Original runner bytes: `runner.inert.data`.
- `attempt-02`: preflight treated the review report's base64 stdout as literal
  TAP. It failed before extraction/build/tests. Its misleadingly named `.tap`
  artifact is the original encoded field, not a passing transcript; it and the
  original runner bytes remain unchanged. Attempt 03 decodes the documented
  format and checks retained 47/48 counts before running tests.
- The first README/handoff patch lacked its `*** Begin Patch` line and was
  rejected with `Invalid patch: The first line of the patch must be '*** Begin Patch'`.
  No file changed in that rejected patch; the corrected patch was then applied.

All attempt reports and initial manifests remain intact. The outer manifest
also authenticates inert runner snapshots appended after failed attempts;
those snapshots are data, not discovered TypeScript tests.

Runtime, env core, env splitter, shell parser, unchanged host test and native-pin
hashes match accepted source, test commit and inspected live bytes. Input
before/after census detects new files/directories and rejects symlinks, excluding
only top-level generated `dist`, development-tool link `node_modules`, and `tmp`.
Dist and named tool package trees are checked separately; temporary-cache
contents and unlisted external tooling are not covered by that census.

All four attempt-03 owned process groups were absent at settlement without
cleanup kills. All three owned scratch roots were removed. No worker, watcher or
owned child remains. No product fix, full-suite/whole8670 qualification, packed
release acceptance, superiority or elapsed-72-hour completion is claimed. ROOT's
immutable, unqualified whole8670 pipeline is untouched.
