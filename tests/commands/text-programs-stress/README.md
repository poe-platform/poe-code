# Independent text-program verification

This suite was written by an independent verifier before text-program source
ownership transferred for stress-driven fixes. The original 88 shell fixtures
and native expected outputs remain unchanged.

Run from the repository root:

```sh
node --unhandled-rejections=strict --import tsx tests/commands/text-programs-stress/run.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/text-programs-stress/*.test.ts
```

The first command writes `latest-report.json`, including all fixtures, native and
virtual results, per-feature counts, executable hashes, and source fingerprints.
Every non-pass and source drift produces a nonzero exit. The tests deliberately
fail for measured gaps; unsupported, pending, and unavailable-oracle cases never
become successful skips. Node test failure counts combine these categories; the
JSON report keeps them separate. No feature filter is exposed.

## Native execution boundary

Only trusted, repository-authored fixtures run natively. This is not a sandbox
for user programs. Direct tools use fixed `/usr/bin/sed` and `/usr/bin/awk` argv,
through a fixed Bash wrapper setting umask 000; three curated pipelines use
fixed PATH `/usr/bin:/bin`. No fixture invokes system commands from sed/awk.
Every invocation has its own temporary directory, fixed C locale, three-second
deadline, one-MiB captured-output ceiling, and bounded filesystem snapshot.
Timeouts kill the detached process group. All owned temporary directories are
removed in `finally`. Inputs cannot seed absolute/traversing paths or symlinks.

The matching umask is important: virtual filesystem creation defaults do not
apply the host process umask. Seeded files use explicit mode 0644. Outputs compare
raw stdout/stderr bytes, exit status, complete descendant file/directory maps,
file bytes, and permission modes. Neither newline normalization nor mode omission
is used to manufacture agreement. This explicitly chosen umask does not test
virtual support for configurable shell umask.

Virtual execution runs in a separate worker thread with a three-second deadline
and a 256-MiB V8 old-generation limit (not a hard RSS/external-buffer ceiling).
Each fixture receives a fresh memory filesystem and command context. Pipelines
use the actual Shell, standard commands, and delivered text-program plugin.

## Initial checkpoint: August 26, 2026

- 141 cases: 99 sed, 39 awk, three pipelines; all remain in the denominator.
- Matched-umask report: 129 pass, six fail, four unsupported, two oracle-rejected;
  zero pending, error, timeout, unavailable-oracle, or skipped results. Source
  fingerprints are identical before/after and no worker background errors occur.
- The earlier `initial-report.json` is preserved: it used the host umask and saw
  source drift while awk landed. Its four additional mode mismatches were a
  comparison-configuration mismatch, not evidence of four interpreter defects.
- Concrete divergences: sed range state after `n`; ambiguous nested capture
  selection; `^|$` global empty matches; cross-file unterminated output joining;
  in-place quit behavior across files; awk `getline` parsing.
- Unsupported native-valid features measured: sed `r`, `w`, `l`, and pattern
  backreferences. Awk `getline` is also documented outside its initial scope but
  currently returns a generic parser error, retained as a raw failure.
- Native BSD sed rejects combined numeric/global substitution flags and the
  label-comment fixture. These are `oracle-rejected`, not virtual regressions.
  In-place editing and some zero-length/capture behavior need another oracle
  before labeling the local divergence a universal POSIX or GNU defect.
- Native awk reports version 20200816; Bash reports 3.2.57(1)-release. The report
  identifies exact executable bytes rather than assuming a system sed version.

The matrix extends flag/address/action combinations, regexes, arrays, control
flow, byte/Unicode inputs, file effects, and pipelines beyond the original shell
corpus. It is not a just-bash head-to-head report or a performance benchmark, and
does not establish the user's superiority requirement.

## Safety checkpoint

Twenty additional virtual-only safety probes measure cancellation, unused input,
syntax preflight, per-file in-place preservation, instruction/buffer limits,
recursion/array limits, and stdout quotas. The initial result is 15 pass/five fail:
sed and awk both fail prompt cancellation of blocked stdin and stdout, and sed
`1q` waits for an unused next record. Late read/write rejections are released and
observed after the test; a passing cleanup after release does not conceal the
failed cancellation deadline. These failures are reported to the source owner;
the verifier does not edit interpreter source during this ownership phase.

The machine report records native differential and safety totals separately and
combined. No source fix is bundled with these regression tests.

After source-owner cancellation changes, a stable rerun records 19/20 safety
passes: only sed's unused lookahead remains failing. Combined with the unchanged
141-case differential result, that is 148 pass, seven fail, four unsupported,
and two oracle-rejected out of 161. The earlier five-failure safety observation
is retained here as regression history, not presented as the current result.

## First independent source fixes (historical)

Source fixes are separate atomic commits: `e842095` expires numeric ranges after
skipped input; `8699b5c` defers unused lookahead; `a8a6c70` preserves separators
between named input files. Three harness tests also ensure unexpected native
errors cannot become passes and byte/mode differences remain visible.

The source-stable machine report at that checkpoint recorded **131/141 native passes**, four
divergences, four unsupported, and two oracle-rejected; safety is **20/20**.
Combined: **151/161 pass**, no skips, pending outcomes, timeouts, or background
errors. The author, regression, harness, and differential test command reports
**262/272 pass, ten fail, zero skips**. Its ten failures are exactly the ten
non-pass native cases, not new safety regressions.

Remaining raw divergences are ambiguous nested captures, global `^|$` empty
matches, BSD in-place quit across files, and awk file `getline`. Sed `r`, `w`,
`l`, and pattern backreferences remain explicitly unsupported. Numeric/global
substitution flags and the label-comment fixture remain native-rejected. Do not
copy BSD in-place data truncation merely to improve agreement with that oracle.
Dialect differences need explicit policy and additional native reference runs.

## Oracle validity corrections

The numeric/global flag case previously used `2g`, rejected by the local BSD
oracle; it now tests portable numbered substitution `2`. The extension still has
an explicit virtual expected-output regression. The label/comment case now puts
the comment on its own line instead of incorporating it into the label. These
are fixture-validity corrections, not product fixes. Historical reports and Git
history retain both original rejected inputs and their diagnostics.

## Implemented gap fixes and unresolved dialect choices

The follow-up adds bounded capture-state matching and pattern backreferences
(`a769bce`), virtual `r`/`w`/`s///w` file operations (`4cc5457`), `l` listings
(`1745ddc`, `86d3655`), file `getline` with cancellation/cleanup (`abd7e08`), and
successful quit propagation across separate/in-place files (`3fa0846`). Resource
regressions include regex position-scan accounting and the 256-reader limit
(`a0215f6`). No native expected stdout/file bytes were rewritten to match a fix.

The machine result is now **139/141 native pass, two raw differences**, with no
unsupported, oracle-rejected, skipped, pending, or timeout cases. Safety remains
**20/20**. This is **159/161**, not a fully passing comparison. The two original
invalid fixtures were corrected separately, not counted as product bug fixes.
The complete text test scope is **326/328 pass, two fail, zero skips/todos**;
those failures are exactly the two BSD differences below. Whole-repository
build and typecheck pass at this source checkpoint. No unrelated command,
filesystem, or shell source was changed by the text verifier.

`dialect-evidence.json` retains raw output and complete file-state observations
from BSD sed, separately compiled GNU sed 4.9, and this implementation. The GNU
source URL/archive hash, executable hashes/version, and interpreter-source hashes
are recorded. Build products live only in a temporary oracle directory, not the
shipped library or its dependency manifest. Reproduce the targeted diagnostic:

```sh
GNU_SED_ORACLE=/absolute/path/to/gnu-sed-4.9 node --import tsx tests/commands/text-programs-stress/dialects.ts
```

Missing GNU configuration is explicitly pending and exits nonzero, never a
successful skip. Any native mismatch also exits nonzero. This three-case
diagnostic investigates dialects; it is not another compatibility score.

- For `s/^|$/X/g`, GNU and virtual output is `XabcX`; BSD is `Xabc`. No product
  change was made merely to suppress the end-anchor substitution.
- For in-place `1q` across two files, GNU and virtual preserve the second file
  without creating its backup. BSD truncates it and creates a backup. The source
  fix stops the entire invocation, rather than restarting it for each file; it
  does not deliberately reproduce BSD's truncation of later files.
- Ambiguous `((a|aa)*)` captures are `[aaaa][aa]` in BSD/virtual and `[aaaa][a]`
  in GNU. Thus claiming universal BSD/GNU equivalence would also be false.

At that checkpoint both BSD differences remained active failures. The following
explicit user decision changes their acceptance oracle, not their observed bytes.

## Approved dialect acceptance

The user chose the independently verified GNU sed 4.9 results for exactly
`sed-regex-70` and `sed-inplace-quit-per-file`. `oracle-policy.ts` pins the entire
prior native record by SHA-256, verifies the exact fixture inputs, and selects
only those two GNU expectations. Tests still assert stdout/stderr bytes, status,
the complete file/directory map, file bytes, and modes. Separate tests retain and
assert the recorded BSD disagreements; unsupported/pending results remain errors
against either selected expectation. The old BSD expectations were not erased.

The primary acceptance matrix has **141 cases: 139 live host-native expectations
and two independently recorded GNU sed 4.9 expectations**. It is not a claim of
141 live GNU comparisons or 141 BSD matches. The machine report exposes
`oraclePolicy`, `summary`, and the separate `liveNativeComparison` with all raw
host observations. Safety retains its own 20-case denominator. Exact host OS and
executable hashes remain recorded; no standalone BSD version is invented.

`dialects.ts` now writes `native-dialect-current.json`, never the immutable
`dialect-evidence.json` used by the policy. `benchmarks/text-dialects.ts` compares
the two pinned GNU cases against actual virtual-bash and isolated just-bash 3.4.2,
writing `benchmarks/reports/text-dialect-policy.json`. Both match global anchors.
Just-bash differs on in-place quit: it omits the first backup and changes the
later file to its first line. Virtual-bash matches both pinned GNU cases. The
benchmark adapter checks all regular-file paths/bytes but not file modes; the
native policy suite still checks modes. None of these two-case results establishes
general compatibility or the user's superiority requirement.
