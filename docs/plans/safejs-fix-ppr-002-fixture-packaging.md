# PPR-002 Historical Fixture Packaging Repair

## Scope and authority

This author repair on August 29, 2026 addresses only the publication-packaging
blocker in the closed Curie HOLD. It does not repair runtime semantics or close
PPR-001. Fresh independent packaging review and root approval remain required.

The isolated main clone is `poe-code-safejs-ppr2-fixture-packaging`. Its successful
`git -c pull.rebase=false pull --ff-only` preceded staging. The base is
`6e3733a0df3b764a5d87d5f19fe6142bfed905f1`. No branches, commits, pushes, nested
agents, README edits, original audit reads, or live neighboring author-tree reads
are part of this repair.

## Immutable inputs and upstream preservation

- PPR2 final author manifest:
  `8aa982da2dab9b01da8f80c2035397143e1693c17ed64ab6a8f9247f37061826`.
- Curie closed HOLD manifest:
  `5284fa0766e3435d35d44cdaa7caf5c218fa7464eb51ecdf6cc6dcca4f5f2cdf`.
- Historical Curie report, preserved without edits at
  `docs/plans/safejs-validate-ppr-002-final-integration.md`:
  `075a2ca94be97711898b7b88d9f90b171520a35f2cd07dbeec6aa6b9ca4597ff`.

The author input contains 22 PPR2 publication paths, 10 ordered preimages, and
50 separate prior paths. Frozen prerequisite deltas were applied relative to
their captured main preimages, not copied over newer main indiscriminately.
Current main's G01 `packages/safejs/src/interp/values.ts` remains unchanged at
`a453757823a826a5c533a5b13e44cdb2021783889e90601608bac932f5f3db86`.
The historical NUM-only hash
`1e027e9c9c100b0849b7b8e4ab02b747181f63ce1383e9e467fecc37e76ad4a6`
is retained as provenance, not applied to the current publication tree.

## Approved functional fixture provenance

Only the two data files explicitly named by the HOLD and the author's
`requiredValidationSupport` are materialized. Their immutable source is the
author capsule's
`history/author-repair-hold/history/provisional-ppr2/evidence/` directory.
Both file hashes and lengths match the pinned manifest; no original-audit
payload, excluded payload, or security-family input is accessed.

The package destination is
`packages/safejs/test/fixtures/ppr2-integration-history/`:

| File                          | Bytes   | SHA-256                                                            |
| ----------------------------- | ------- | ------------------------------------------------------------------ |
| `ordered-original-red.json`   | 129,251 | `a9feba99d6e0f02d631f8b38c4e027beaa30d7d240b0f8666edbb3ada26bed62` |
| `ordered-v6-generations.json` | 629,290 | `d72a81042ddabc34835079e7d9e8aa53c058390ae9860fdbbe1d0051a01533ae` |

Fixture bytes, version markers, original failure records, hashes, and all test
assertions remain unchanged. The historical test reads package-relative URLs
anchored to `import.meta.url`, not a working-directory-relative `out` path.
The fixtures contain no other-clone absolute paths or `out/` references.
Tests only read these files; no test setup writes files or invokes real providers.

## Publication projection and TDD

A temporary Git index records current main plus the explicit publication paths;
`git write-tree` and `git checkout-index` produce a physical tracked-file
projection under `.tmp/ppr2-publication`. It has its own pinned
`SKIP_SYNC_SKILLS=1 npm ci` installation and workspace dependencies. No source or
dependency links to another clone and no historical `out` support are staged.
The real index remains unchanged. Generated build outputs are derived locally
from this publication tree.

The prerepair projection tree is
`227459ed6e022d308320fca779c5d8e0c80485b5`. Running
`env -u TERM ./node_modules/.bin/vitest run packages/safejs/test/ppr2-integration-history.test.ts`
fails collection with genuine ENOENT for `ordered-original-red.json`: one failed
suite and zero collected tests. The complete unedited output and command record
are captured, not replaced with a simulated failure.

The historical ordered-mode alternate Vitest configuration remains unchanged;
it references its original frozen adjudication artifacts. Current publication
validation uses the normal root configuration, not this historical alternate
configuration, and does not stage those artifacts.

## Validation and handoff record

Evidence and the refreshed capsule belong under
`out/safejs-remediation/ppr2-fixture-packaging/`. Final results and hashes are
appended after executing the publication-tree checks. The refreshed PPR2 set
contains 26 paths: the original 22, two package fixtures, the unchanged historical
Curie review plan, and this repair plan. The 50 prerequisite paths remain separate;
with five overlaps, the combined publication scope is 71 distinct paths.

The packaging delta is limited to the lookup, two byte-exact fixture additions,
and this repair note. All other production and test bytes must match the staged
frozen inputs, apart from explicitly preserved newer-main G01 bytes. Expanded
legacy test types remain a separately reported qualified RED if their existing
24-root, 56-diagnostic signature set is unchanged; they are not a clean type pass.

## Executed results

All commands run in the physical publication projection with `TERM` unset.
Runtime checks use the existing root configuration and playback/error snapshot
settings, with no added exclusions or real provider calls.

| Check                                | Actual result                               |
| ------------------------------------ | ------------------------------------------- |
| Prerepair historical suite           | Exit 1; collection ENOENT; zero tests       |
| Repaired historical suite            | Exit 0; all 40 cases pass                   |
| Full root `vitest list --json`       | Exit 0; 24,544 cases in 979 files collected |
| Exact prior combined command         | Exit 0; 999 tests in 38 files pass          |
| Shadowed-array control               | Exit 0; 23 tests pass                       |
| Full `npm run build`                 | Exit 0; 67 workspace tasks and root build   |
| Configured root and SafeJS types     | Both exit 0                                 |
| Introduced/scoped 20-root test types | Exit 0; zero diagnostics                    |
| Expanded 24-root test types          | Exit 2; unchanged 56 diagnostics            |
| Root ESLint and package lint         | Both exit 0; all 17 package rules pass      |

The 24-root compiler rerun compares the current publication candidate against an
in-memory overlay of the exact prerepair history-test preimage. It also matches
the immutable Curie diagnostic signatures. There are zero added or removed
signatures, and all 56 current diagnostic source anchors verify. The common
signature SHA-256 is
`530fba17d9b4808edeb86e1a33f88431758174c6b2e449959eeb51fc3eaa0333`.
This explicitly qualified legacy RED is not an introduced type failure.

The history-test preimage SHA-256 is
`0c68f35ec1728b961cffb139eb96cff1793743fcd5cce64deb759a9838536ec2`;
its repaired postimage is
`b28bf8f66a70c5f27d1679c88d79e7a39b5a0bfcc737456f94129861014937ba`.
An exact string-replacement proof confirms that only the fixture lookup changes.
The other 21 original PPR2 publication paths and the historical review report are
byte-identical to their frozen inputs. All 50 prerequisite paths match their
intended composite bytes, including unchanged current-main G01 values.

Full-root collection is fresh evidence, not a claim that all root tests were
executed again. The prior 24,060-test runtime result and original recovery
verdicts remain historical Curie evidence. The fresh execution scope is the
40-case regression, the exact 999-test combination, and the 23-case shadow
control.

## Packaging format hold

The first configured 71-path Prettier check exits 1 for this new repair plan and
the two exact historical JSON fixtures. Only this owned plan is formatted using
`apply_patch`. No immutable input, fixture byte, prior report, production file,
test assertion, or formatter configuration is rewritten to hide the warning.

The two fixture paths are nonignored and included in the temporary publication
Git index. They contain no trailing whitespace. Nevertheless, default Prettier
would change their bytes, conflicting with the explicit hash-preservation
requirement. Its proposed hashes, not applied, are:

- `ordered-original-red.json`:
  `3c60b578793fafe974814c1ffae876c25232e5a0e2b22491c2a8d6709c2a252f`.
- `ordered-v6-generations.json`:
  `1d747b98f1281d354a1800ee960a5def56c2fcc06d90a93e37221a6dbbfd9db8`.

The exact configured command and warnings are retained in
`evidence/publication-formats-final-command.json` and
`evidence/publication-formats-final.log` inside the capsule. Root authorization
for an exact-path formatter exception, or a changed byte-preservation
requirement, is needed to clear this conflict. Neither is within the current
bounded repair authorization. The candidate remains on author HOLD for this
formatting conflict, pending root direction and fresh Curie packaging review;
publication is not authorized.

The final 71-path combined check and 26-path PPR2 check both exit 1 solely for
those two fixture files. All other 69 combined paths pass configured formatting,
including this repair plan. Strict whitespace checks across all 71 paths and
`git diff --cached --check` against the temporary publication index both pass.
The final publication-tree rerun again passes all 40 historical cases. Every
tracked projection blob used by the build, collection, runtime, type, and lint
checks matches its publication-tree object; only this report's appended evidence
changes afterward. The projection has no historical `out` directory, and all
workspace dependency links resolve inside its own package tree.

## Authorized exact-path formatter exception

On August 29, 2026, root authorized a formatter-only exception for the two
byte-preserved historical fixtures. This supersedes the author formatting HOLD
for the refreshed candidate, not the requirement for fresh Curie review and root
publication approval. The prior frozen manifest
`8aff9fe524dd9e85b27198c99d7076124468a1bef7ebe452f4c5c8a5ee96af61`
and its actual Prettier failure logs remain immutable historical evidence.

This isolated clone has no existing `.prettierignore`, either in its base commit
or working tree. Its preimage is explicitly recorded as absent, with no invented
preimage hash or preexisting entries. The new root `.prettierignore` contains a
short provenance comment and exactly these two fully anchored entries:

```text
/packages/safejs/test/fixtures/ppr2-integration-history/ordered-original-red.json
/packages/safejs/test/fixtures/ppr2-integration-history/ordered-v6-generations.json
```

The exception is necessary because these fixtures are historical byte-exact
oracles whose existing SHA-256 assertions must remain valid. It does not ignore a
directory or wildcard, change runtime or type behavior, skip test gates, rewrite
fixture data, or bypass hooks. Both JSON files remain intentionally byte-exact;
they are not represented as Prettier-formatted files.

The refreshed publication set adds `.prettierignore` as its 27th PPR2 path. The
50 prerequisite paths remain separate, making 72 distinct combined paths after
the same five overlaps. The only changes since the held candidate are this
configuration file and this appended repair note. All fixtures, markers,
assertions, other tests, production files, G01 values, and prior reports remain
byte-identical. The exception's exact postimage hash, the absent-preimage record,
and the refreshed validation outputs are captured in the new capsule.

### Refreshed validation results

The new `.prettierignore` postimage SHA-256 is
`ef9b8964fc0ceeb91f53a1e0ddf10dd3e0a41c948ed4b866a0ac3abe17bb904b`.
Its absent-preimage guard must not be used to overwrite an ignore file added by
newer upstream work; preserve any such entries when integrating the two exact
additions.

Both configured scoped Prettier commands pass using normal root ignore-file
discovery, without an `--ignore-path` override. Of the 72 combined paths, 69 are
formatted, the two historical JSON fixtures are intentionally byte-exact, and
`.prettierignore` is validated as exact configuration text rather than assigned
an unsupported formatter parser. The 27-path PPR2 set similarly comprises 24
formatted files, the same two byte-exact fixtures, and the configuration file.
Prettier's file classification ignores exactly those two fixtures; nearby names,
a nested same-name fixture, another package fixture, and the history test remain
unignored. All 72 paths pass strict whitespace checks, and both working-tree and
temporary-publication-index `git diff --check` commands pass.

Both JSON files parse successfully and retain their original SHA-256 values,
record counts, version markers, and exact bytes. They remain nonignored by Git
and byte-identical in the tracked publication tree. The test's hash assertions
are unchanged. The fresh root-configured historical suite passes all 40 cases;
the exact combined command passes 999 tests in 38 files; the shadow control
passes 23 tests. Fresh full-root collection finds 24,544 cases in the same 979
files, including all 40 historical cases, with no added exclusions. Raw case-name
multisets are not identical: two existing parameterized titles interpolate
`Date.now()` and `process.pid`. Their actual differences and unchanged source
anchors are retained without rewriting or normalizing the collection outputs.

The full build, configured root and SafeJS types, scoped 20-root test types,
root ESLint, and all 17 package rules pass again. Expanded 24-root test types
remain an explicit qualified RED: exit 2, 56 diagnostics, with byte-identical
diagnostic output and no new or removed signatures. No hook, test, or type gate
is bypassed. The physical publication projection has no historical `out`
support, and its package dependencies remain local to that projection.

All 70 prior combined paths other than this append-only repair plan remain
unchanged. The only refreshed changes are `.prettierignore` and this note.
The narrow formatting blocker is resolved; fresh independent Curie packaging
review and root publication approval are still required.
