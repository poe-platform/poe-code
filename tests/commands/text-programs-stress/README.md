# Independent text-program verification

This suite is owned by the independent verifier, not the sed/awk implementation
worker. It does not modify interpreter source or the original 88 shell fixtures.

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
