# fmt released numeric behavior review

This increment reviews the existing implementation without replacing unrelated
edits. Released coreutils 9.10 archive SHA256:
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
The source comparison against development revision
`b25722854370b8206d7f53f8934c36710cdd9974` changes only initialization placement.
Read released fmt.c, the fmt manual section and all five upstream fmt tests.
These are source-derived controls, not native executions.

## Manual QA

1. Read fmt.c's numeric conversion calls and gnulib xdectoint.c. Width uses
   XTOINT_MAX_RANGE; goal uses the result-type overflow policy. Verify large
   width values retain the range diagnostic, including uintmax overflow.
2. First run original failing package tests. Require goal76 and goal20/width10
   (both option orders) to fail with the result-type diagnostic. Invalid suffixes
   receive no range suffix; repeated valid replacements still use the last value.
   Keep the historical 8.30 profile's independent expectations unchanged.
3. Run package tests/lint/typechecks, focused Safe Bash fmt/registration tests
   and the maintained selected Safe Bash workspace build closure.
4. Execute actual Shell commands with explicit C locale and memory VFS. Inspect
   a terminal screenshot for the width8 control and goal76 diagnostic/status.
5. Generate public artifacts and run the maintained fmt runtime/declaration
   fixtures in a consumer containing only public artifact packages. Confirm
   private fmt implementation and declarations are bundled without private imports.

## Acceptance cells

Full native 200 MAXCHARS / 144 MAXWORDS stdout capture, combined margin/tab/
punctuation/tie/window cases, non-C diagnostic parity, browser/workerd execution,
and checkpoint/replay runtime integration remain OPEN. Existing tests and source
analysis cannot substitute for unavailable native byte artifacts or runtime cells.
No recursion or formatting algorithm changed in this increment. Numeric scanning
remains linear in the bounded argument bytes, with saturated arithmetic; decoded
argument storage is separately bounded, and input formatting remains opaque bytes.

No commit, push, release or private package publication is authorized by this QA.

## Fresh results

- Original failing-before-fix test: 57 passed, 1 failed. The released numeric
  diagnostic assertion reproduced the gap before the parser change.
- Final package tests: 59 passed, no failures/skips. Package ESLint, source/test
  TypeScript checks and focused integration-test ESLint passed.
- Maintained selected `@poe-platform/safe-bash` build closure: passed, 18 builds.
- Final fmt/adversarial/registration run: **712 passed, 7 failed**, no skips.
  The first run additionally used stale compiled numeric parsing; after the
  completed build, the goal diagnostic passes. Neither integration run is a pass.
- The seven remaining failures are the six falsey-reason Shell cancellation
  controls and the direct metadata cleanup control. `InputScope.close()` waits
  on acquisition while those tests require opaque metadata to remain outstanding
  after cleanup settles. The existing private-package acquisition test instead
  requires cleanup to wait until that metadata resolves. There is no explicit
  capability enrollment in these fixtures distinguishing cooperative resource
  work from opaque metadata. This contradictory acceptance cell stays OPEN;
  this numeric increment does not alter either cleanup behavior or its assertions.
- Fresh public artifacts at `0.0.0-behavior-fmt-numeric` passed the maintained fmt
  runtime and strict NodeNext declaration fixtures, using a consumer populated
  with only public artifact directories. This was directory staging, not tarball
  installation or publication. AST inspection of 1274 shipped JS/declaration
  files found no bare fmt/contracts private imports. Cross-realm bytes, canonical
  identity, VFS scripts/pipes and CLI/SDK execution passed the runtime fixture.
- Actual memory-VFS Shell width8 and goal76 commands passed exact output/status
  checks; the rendered terminal screenshot was visually inspected.
- Release/development fmt manual sections are identical. Archive hash matched;
  no host fmt utility or locale was executed. `git diff --check` passed.

Candidate source SHA256 for the changed parser:
`0e2d642c73d4cb100f8e313d93f0d7a2e3541fab27de7843b23a344e17b4687b`.
Engine: `7f50a2094b86643a00b57c25951720355c5700defa11dfaaf6e309b655ea13de`.
Invocation: `c8402ff3fbce7de1786cba2dee0908715b95a18d9513c482d5ccbf3c328c82c1`.
These identify the reviewed working-tree candidate, not a committed revision.

Repository-wide test/lint/build routes were not repeated for this focused parser
change. No benchmark/performance, original/checkpoint/replay integration,
browser/workerd or new full native cohort pass is claimed. Task-owned temporary
source archives, logs, artifacts, consumer directories and screenshots in
repository `out/behavior-fmt-current` are purged after recording results.
Local commits: none. Verified remote-main delivery: none. Successful release:
none. No private command package was published.
