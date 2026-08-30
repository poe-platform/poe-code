# Independent shell stress tests

This is a focused Bash differential and public-runtime contract suite, not a
just-bash comparator or a claim of full-shell completion or superiority. It adds
no runtime or development dependencies. The existing `tsx`, TypeScript, and
`node:test` tooling is sufficient.

## Current inline-input checkpoint — 2026-08-26

Working directory: `/Users/kjopek/Workspace/safe-bash`. This checkpoint supersedes
the historical validation summaries below, without deleting their evidence.
The package remains `virtual-bash`; no dependencies or public shell API changes
were introduced by this verifier. Work stopped at the user's urgent checkpoint;
no full-shell, general superiority, or 72-hour completion claim is made.

Feature commits are `91ac2e1` (queued heredocs) and `834f76c` (scalar here-strings).
Independent commits: `a08d1c6` (30 regression cases, initially 14 failures),
`3f6605a` (fatal inline parameter-expansion scope), `e6036bb` (real text-program
oracle registration), `0c85433` (26 independent grammar/lifecycle checks), and
`df541c7` (exact, versioned reference-status assertions). The preserved case and
unsupported-option commits `441124d` and `d7a0d77` remain ancestors.

`<<`/`<<-` queue FIFO documents, remove delimiter quotes, suppress expansion for
quoted/mixed delimiters, and distinguish leading tabs from spaces. Whole-source
syntax validation precedes effects; skipped bodies never expand. `<<<` expands
one scalar without splitting/globbing and appends one LF. Descriptor copies share
input cursors; function calls and separately executed loop redirects get fresh
inputs. Source/expansion/output/command/depth budgets and active-read cancellation
are tested. Fatal parameter expansion now stops the current builtin/function/
compound/redirect-only environment, while external commands and subshells retain
their isolated failure scope. This does not erase legacy Bash arithmetic recovery
differences. EOF documents warn; text expansion is UTF-8, removes substitution NUL,
and does not promise arbitrary binary preservation.

| Check | Recorded checkpoint result |
| --- | --- |
| Latest complete strict shell run | **409/409 pass**, zero failures/skips/TODOs/cancellations |
| Unmodified independent stress suite | **95/105 pass**, ten failures, zero skips/TODOs/cancellations; exit 1 |
| Complete oracle with real standard + text-program definitions | **88/88 pass**: core 64/64, advanced 24/24 |
| Repetitions stopped by root | Four stable **111/111** runs, 444 passes; interrupted fifth is not a failure |
| Fresh `npm run typecheck` | Exit 0 at 20:32:16 UTC |
| Earlier scoped typing, build-config noEmit, build, built ESM smoke | All exit 0; not rerun at urgent checkpoint |

The four completed repetitions are root-observed progress from the interrupted
driver; its final JSON was not flushed. An earlier repeat attempt and a 405/409
shell run were invalidated by explicit unrelated-source-change guards, not by
semantic assertions. The subsequent complete shell run passed 409/409. No guards,
expectations, or test denominators were weakened. The old `<<EOF` unsupported
syntax test was replaced by a genuinely missing delimiter, preserving pre-effect
rejection; positive heredoc coverage was added. Oracle registration previously
omitted existing awk/sed definitions: adding their real factory, not mocks or
semantic changes, changes that test-only result from 81/88 to 88/88.

### Exact remaining stress failures

| Case name | Classification |
| --- | --- |
| `descriptor-move-closes-original-after-copy` | Unsupported descriptor-move semantics |
| `read-n-consumes-exactly-two-characters` | Unsupported `read -n` |
| `read-d-consumes-through-delimiter-only` | Unsupported `read -d` |
| `command-substitution-file-shortcut-reads-and-trims` | Unsupported `$(<file)` shortcut |
| `ansi-c-quoted-word-decodes-escape-before-argument-passing` | Unsupported ANSI-C words |
| `glob-posix-bracket-digit-class` | Unsupported pathname POSIX bracket classes |
| `nested-substitution-syntax-error-does-not-prevent-earlier-effects` | Deliberately stricter whole-source prevalidation policy |
| `fatal-parameter-expansion-prevents-following-file-effect` | Diagnostic/status difference; forbidden later effect is prevented |
| `fatal-arithmetic-expansion-prevents-following-file-effect` | Diagnostic difference; forbidden later effect is prevented |
| `fatal-expansion-in-substitution-stops-substitution-only` | Diagnostic difference; substitution isolation is retained |

Reference: `/bin/bash` 3.2.57(1)-release, arm64-apple-darwin25. Its old here-string
splitting and nested case/substitution parser quirks are not target semantics.
No newer Bash execution is claimed. An additional **unverified audit lead** remains:
`src/shell/pattern.ts` tokenizes synchronously and may repeatedly scan unmatched
brackets before reaching the bounded/yielding matching loop. No watchdog regression
or source fix was attempted before the urgent stop. Do not claim that this parsing
path has demonstrated timer-cancellation safety.

### Current comparison, with every outcome retained

The existing owner-expanded harness was run unchanged, once at this checkpoint:

```sh
npm run benchmark -- --output /tmp/safe-bash-checkpoint-comparison.json --seed 1526603814 --timeout-ms 6500
```

It now runs **118 cases per engine**: original 88 fixtures + 18 deterministic
cases + 3 probes, plus 7 plugin integrations and 2 pinned GNU-dialect cases.
No filtering or expectation edits were made by this verifier.

| Engine | All 118: pass / fail / unsupported | Original 109 cohort: pass / fail / unsupported |
| --- | --- | --- |
| virtual-bash 0.0.0 | **116 / 2 / 0** | **109 / 0 / 0** |
| just-bash 3.4.2 | **108 / 9 / 1** | **103 / 5 / 1** |

Both have zero errors, timeouts, and pending outcomes. Exit 1 reflects retained
non-pass results, not an incomplete run. Source/harness fingerprints were stable
during the run and background errors were empty. Measured engine-run window:
20:32:17.190–20:32:17.727 UTC (**537 ms**); npm process wall time **796 ms**.
This is descriptive timing, not a performance claim. Node v22.22.2, tsx 4.23.12,
TypeScript 5.9.3; installed/pinned comparator 3.4.2, no installation performed.

The original corpus SHA-256 remains
`cc1df2a29865b60a830afddca63869a84ea9782b1f5871e664f842654d7f4d3c`;
original deterministic/probe expectation files also match the supplied baseline.
The baseline operational bundle `6c9346cc8ab9758bd368ab2d91dbb0164e03fdfc362f1032d976c0aec809b92d`
changed to `ad9e3d44a3e585bb14e07fbc65e7480006f57cf91b45ab468b6b86959a895804`
because the benchmark owner changed model metadata, worker reporting, plugin
registration, and run composition. This is **not** an unchanged-baseline-harness
claim. Those four files were unchanged across the checkpoint execution.

The two current virtual failures require owner integration: implicit empty-pipe
`rg` searches files instead of consuming empty input; the diff/patch integration
requests an absolute target rejected by patch's current safety policy. Neither
was edited or relabeled as passing. GNU sed policy remains separate and unchanged.
All 236 engine outcomes, original-cohort membership, raw-result hashes, current
source/test/contract hashes, and validation provenance are preserved in
`final-inline-input-evidence.json`. Original raw comparison remains at the `/tmp`
output above. Owned source/tests were clean at the validation checkpoint. At the
20:35 UTC final status check, external edits appeared in `src/shell/runtime.ts`,
`src/shell/shell.ts`, `src/shell/types.ts`, and new
`tests/shell/stdin-origin.test.ts`. They were not edited, staged, committed, or
validated by this verifier. The recorded test/benchmark results describe their
captured source snapshots, not these later in-flight changes. Foreign staged
entries were untouched. All verifier test/repeat children are stopped.

## Historical independent bugfix review

Recorded August 26, 2026. **Bugfix review delivered; full-shell compatibility
is not complete. No superiority claim is supported.**

| Validation | Observed result |
| --- | --- |
| Shell tests, strict unhandled rejections | 177/177 pass; no skips, TODOs, cancellations |
| Twenty additional complete shell repetitions | 3,540/3,540 pass, 177 per run |
| Twenty strict process-harness repetitions | 100/100 pass, five per run |
| Complete independent stress suite | 92/105 pass, 13 fail; no skips, TODOs, cancellations |
| All-tier oracle, explicit `--strict` | 77/88 pass: 57/64 core, 20/24 advanced-pending; exits 1 |
| Isolated strict source/test/report compiler | Exit 0 |
| `npm run typecheck` | Earlier exit 0; final exit 2 in newly added, unowned byte-tool tests |
| Build configuration with `--noEmit` | Exit 0 |
| `npm run build` and built-package import/execution | Both exit 0 |

The final compiler recheck in `final-validation.json` still passes the isolated
owned source/test/report compiler, build `--noEmit`, and `npm run build`.
However, global `npm run typecheck` now fails outside this assignment: three
TS2307 missing-module diagnostics in `tests/commands/bytes/{checksums,compression,
encoding}/helpers.ts`, plus TS7006 for the compression helper's `entry` parameter.
Those concurrently introduced scaffold tests refer to not-yet-present command
modules. They were not edited, ignored, or represented as a global pass. Earlier
successful global checks below remain historical evidence, not the final status.

`review-evidence.json` contains exact commands, raw shell TAP, all twenty
repetition summaries, all oracle failures, and compiler/build output. Its run
was **19:20:52.650–19:22:30.254 UTC**, with repository HEAD advancing from
`b9755cd4815e54c276b16e306fe950514176db2e` to
`c8e60b4d55ffec25f8c962a3f2234b792c7c6852`. Other workers changed structured-command
and overlay files during that broad run; the artifact explicitly records them.
Every shell source hash and every reviewed harness hash stayed unchanged. This
is not a claim that the entire repository was immutable throughout validation.

The final stress/evidence run was **19:26:44.183–19:27:05.084 UTC**, at unchanged
HEAD `a8a6c706060908064ef4c3524556a21115571d36`, with **no source changes anywhere**.
Its global and scoped compilers both exit 0. See `evidence.json`. The earlier
102-case result remains in `harness-followup-evidence.json`; the original
95-case, 68-pass/27-fail baseline remains in `pre-isolation-evidence.json`.
New independent coverage adds two newline differentials and a Bash pipeline
waiting assertion, rather than changing original expected observations.

After the broad review run, the new Bash-wait assertion was strengthened to
require the consumer's `consumed` marker before accepting the hard deadline.
The final complete stress run and twenty strict process-harness repetitions
include this strengthened assertion; `process-repeat-evidence.json` records its
test hash, all 100 passes, and raw TAP. The harness preserves raw bytes/nonzero
statuses, enforces a combined output ceiling, kills synchronous infinite loops
within a bounded deadline, and removes descendants retaining inherited pipes.
`cleanup-evidence.json` records no retained Bash temp directories or shell test
children after the final runs.

The recovered independent read-only investigator runner was also inspected and
rerun with `--oracle`: installed Bash 3.2 matches **all 88/88 committed goldens**;
virtual matches **77/88** against those live Bash observations. All 88 children
have one stable measured source map. `oracle-evidence.json` preserves every
observation, the command and runner/child hashes. This supplementary recovered
runner uses separate 3-second process-group kill deadlines and 256 KiB output
ceilings; it does not replace the repo-native `--strict` oracle run.

### Reviewed and new commits

Reviewed author commits: `28a2cc6`, `7009cc8`, `3c62df7`.

Reviewed atomic bugfix commits: `29b6f68` (broken-pipe cancellation), `96c3ae8`
(fatal expansion context), `97db237` (descriptor inheritance/order), `57bf9a2`
(glob budgets), `90bc1d3` (`read`), `805a70b` (declarations), `df4fad6` (quoted
patterns), `958bd7d` (NUL substitution), `317f5fb` (cooperative yielding), and
`2448f5d` (empty-IFS quoted positional joining). None was amended or rebased.

New review commits:

- `30b9aae`: newline wildcard and exact-end matching fix, with nine independently
  authored Bash-backed regressions. Seven failed before the source change;
  all nine and twenty adjacent pattern/budget tests passed afterward. The shared
  regexp previously excluded newline from `*`/`?` and allowed `$` to match before
  a final newline. `regression-evidence.json` retains failing and passing TAP.
- `6b967d3`: no-write signal cancellation and exact command/loop budget tests
  around the cooperative scheduling boundary (0, 127, 128, 129, 256 commands).
- `b9755cd`: restore direct active-read cancellation, retained byte, retained
  rejection, and abandoned late-rejection safety coverage.

The tested shell source revision is `30b9aae1cd546c35d544f6aa89279aa9c9621dd8`,
not the later evidence commit. Tested runtime SHA-256:
`257953d461dec575da04998eef43962ffb64b33b07dd217d7c7c7b703b644982`.
Parser SHA-256:
`4fe457c890b2f4a8a245b82a5c03b89716b47271479fdfca7b595bae12e25af6`.
Input SHA-256:
`792824bc75b41ec1afcadb810fcf033df4d2d50db6dada116a89d14ceea815b4`.
Full source and test maps are in the evidence artifacts. Public shell exports,
types, and the live optional `CommandContext.invoke` contract were not changed;
the existing literal-argv invocation suite and compilation pass. No dependencies,
manifests, fixture edits, command plugins, or remote files were added or changed
by this reviewer. No broad `npm test` result is claimed.

### Existing-test weakening audit

The original unconditional cancellation expectations were incorrect: finishing
a consumer does not itself cause SIGPIPE in a producer that has not written.
The GNU pipeline contract waits for every stage. The independently spawned
`sleep 30 | { printf consumed >&2; :; }` reference confirms the consumer ran and
stays pending until the harness kills its group, while
`{ :; : >after; } | :` and `printf abc >out | true` preserve their file effects.
Actual broken-pipe writes still abort producers and return 141 under pipefail;
the old blocked-input scenarios still require exact caller-reason rejection and
one iterator return. Signal-only upstream behavior is explicitly covered again.

The changed delayed-input results (`AB` to `B`, and to empty after two broken
pipes) follow consumption of one byte before the failed write. The source error
is now encountered by the first pipeline stage: it is diagnosed there, the
rightmost successful stage determines status 0 without pipefail, and the closed
input is not retried by the next command. Existing read-count, single-return,
serialized-read, hard-timeout, cleanup-abort, and rejection-observation checks
remain. However, these corrected scenarios no longer exercised cancellation
*during* an outstanding read. The reviewer restored that original safety intent
with direct cancelled `ShellInput` views: pending `A` is retained for the next
reader, `B` follows without overlapping reads, a late failure reaches the next
reader unchanged, and an abandoned late rejection stays observed under strict
Node rejection handling. See `tests/shell/review-lifecycle.test.ts`.

Conclusion: changed outcomes are justified, and the displaced safety coverage is
restored rather than silently removed. No test was skipped, marked TODO, turned
into an expected failure, or normalized to hide a remaining discrepancy.

### Remaining discrepancies, not passes

The complete stress suite retains **13 ordinary failures**:

- Nine unmet semantics: descriptor moves, `read -n`, `read -d`, `$(<file)`, ANSI-C
  quoting, tab-stripped heredocs, multiple heredocs, here-strings, POSIX bracket
  classes. These are deferred features, not repaired runtime behavior.
- One deliberate parse-before-effects policy difference from Bash 3.2.
- Three exact fatal-error differences: one versioned exit-status/diagnostic
  mismatch (top-level parameter error, 1 versus Bash 3.2's 127), and two
  diagnostic-only mismatches. Fatal parent/substitution side effects are stopped;
  exact stderr comparisons remain red rather than normalized.

Oracle's seven core failures are absent `sed`/`awk` registrations in the default
standard-command collection, even though other workers are implementing those
plugins. They are not seven demonstrated shell-runtime failures. Its four
advanced failures are `case`, two heredocs, and a here-string. All 24 advanced
fixtures were executed; none was silently counted as passing.

`compatibility-probes.json` records five additional exact nonmatches, excluded
from neither a claimed pass nor any stated denominator: they are separate
diagnostic probes, not members of the 105 tests. `set -e` remains a serious unmet
shell option: `set -e; false; printf bad >after` diagnoses an unsupported option
but still writes `after` and exits 0. Brace expansion and `<>` also remain unmet.
Arrays and full `case`/heredoc/here-string implementation were not attempted.
The `.*` inclusion of `.`/`..` and division-by-zero in an unselected arithmetic
branch differ from installed Bash 3.2; they require an explicit version/option
policy, not claims about an unexecuted Bash 5.x reference.

No reproduced data-loss, fatal-expansion continuation, inherited-descriptor,
glob-budget, busy-loop cancellation, or newline-pattern bug remains failing in
this scoped review. This does not establish absence of other bugs or fulfill the
full-shell target. The 20 ms timer-driven busy-loop abort now settles before the
hard watchdog; its exact reason, absence of later effects, and finite budget
boundaries are tested. The existing amortized yield every 128 commands remains;
this review makes no comparative throughput or superiority claim.

To reproduce the complete shell/repeat/oracle/compiler/build record:

```sh
node --unhandled-rejections=strict --import tsx benchmarks/shell-stress/review.ts
```

It intentionally exits nonzero while strict oracle failures remain. Raw output
and exact commands are retained rather than interpreting exit 1 as a harness
failure or suppressing advanced cases.

## Previous harness follow-up (historical)

Recorded August 26, 2026, **19:09:39.317–19:10:03.809 UTC**:
**102 tests, 87 passed, 15 failed**, zero cancelled/skipped/TODO tests. The exact
assertions were retained while another worker fixed source defects.

- All four process-harness safety tests pass: raw bytes/nonzero exit status,
  hard killing a synchronous infinite loop, combined output limits, and removal
  of descendants retaining inherited pipes after the parent exits.
- All five syntax contracts pass. Of 70 exact Bash differentials, 56 pass and
  14 fail. Of 22 lifecycle/budget probes, 21 pass and one fails. The provenance
  test passes.
- The scoped strict compiler invocation for owned test/report entry points and
  imports exits **0**, with no diagnostics. There is no remaining `helpers.ts`
  detached-option type error and no unsafe cast hiding one.
- Global `tsc --noEmit` exits **2**, with only two TS2367 diagnostics at
  `src/commands/text-programs/awk-syntax.ts:177:46` and `:262:113`.
  A separate `npm run typecheck` reproduces the same errors. Those files belong
  to another worker and were not edited here. This is not a global type pass.
- HEAD before/after: `958bd7d918864235adbe479720f75a031dd66224`.
- Whole-source aggregate before/after:
  `a3bd88e884fad72da968512f30a7742fa0f22265b0117b7af270e474c34adfda`.
- Runtime SHA-256:
  `024f96bc297906c92f0c840367ba439d1cd2fde4d793b36ac4ff49673fdf5113`.
- Parser SHA-256:
  `4fe457c890b2f4a8a245b82a5c03b89716b47271479fdfca7b595bae12e25af6`.
- Input SHA-256:
  `792824bc75b41ec1afcadb810fcf033df4d2d50db6dada116a89d14ceea815b4`.

No source changed during this final run. The preceding follow-up measured 83
passes/19 failures while WebDAV files changed; subsequent shell fixes changed
the runtime/parser fingerprints and eliminated four failures. These are observed
source changes, not harness fixes disguising test failures. The complete final
source and harness maps, commands, TAP, and compiler outputs are in
`harness-followup-evidence.json`.

### Remaining failure classification

The 15 failing tests are not 15 interchangeable runtime defects:

- **Ten exact semantic/unsupported-feature differences:** descriptor move;
  `read -n`; `read -d`; empty-IFS quoted `$*`; `$(<file)`; ANSI-C quoting;
  tab-stripped heredoc; multiple heredocs; here-string; POSIX bracket digit class.
  Existing heredoc tests were retained, not expanded in this follow-up.
- **One cancellation responsiveness failure:** the busy shell loop starves its
  20 ms abort timer. The independent watchdog kills it with `SIGKILL` at roughly
  4.6 seconds. This remains a failing runtime assertion; the passing harness
  kill/cleanup tests establish that the runner itself stays bounded.
- **One deliberate prevalidation policy difference:** malformed substitution
  syntax prevents earlier effects in virtual, unlike installed Bash 3.2.
- **One versioned status/diagnostic difference:** fatal `: "${missing:?stop}"`
  now correctly prevents following file effects, but returns 1 rather than
  installed Bash's 127 and uses different diagnostic text.
- **Two diagnostic-only differences:** fatal arithmetic expansion and a fatal
  expansion inside substitution now match stdout, status, and filesystem effects;
  only stderr bytes/text differ. Those exact comparisons remain failing rather
  than being silently normalized or reported as continuing-write defects.

Previously failing upstream side effects/status, inherited descriptor routing,
redirect-expansion ordering, escaped/mixed/trailing-IFS reads, glob byte budgets,
quoted removal patterns, NUL substitution, export-prefix persistence, and local
initialization now pass the corresponding regressions. Source fixes are owned
by the separate worker; this assignment did not edit them.

## Run

From the repository root:

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 tests/shell-stress/*.test.ts
node --import tsx benchmarks/shell-stress/run.ts
```

The second command emits JSON containing raw TAP, counts, exact commands,
reference version, before/after source SHA-256 fingerprints, authored-harness
fingerprints, and global/scoped TypeScript results. It exits nonzero for failed
tests, failed typechecks, or source changes. It has a 180-second test-suite
deadline and 30-second deadlines for each compiler invocation.

To replace the owned evidence artifact using `apply_patch`:

```sh
set -o pipefail
node --import tsx benchmarks/shell-stress/run.ts --patch | apply_patch
```

The patch is emitted even when tests fail. With `pipefail`, the command still
reports failure; without it the patch utility's success can mask the runner's
exit status. Read the artifact's `exitCode`, `totals`, and `validations` fields.

Individual tests can be selected without weakening their assertions:

```sh
node --import tsx --test --test-name-pattern=early-reader tests/shell-stress/differential.test.ts
node --import tsx --test --test-name-pattern=timer-cancellation tests/shell-stress/lifecycle.test.ts
```

## Scope and oracle

The suite uses the actual public `Shell`, `CommandRegistry`,
`createStandardCommands`, `MemoryFileSystem`, and byte-stream helpers from
`src/index.ts`. Custom commands only expose streaming, cancellation, and
side-effect observations; none implements shell parsing or evaluation.

The existing 88-case fixture corpus and `tests/shell/oracle.ts` were inspected,
not modified or recategorized. Their setup pattern is retained, but their
in-process AbortSignal timeout is insufficient for a wedged evaluator. Existing
`tests/shell/helpers.ts` installs synthetic commands rather than the public
standard command set, so this suite provides a small standard-command setup and
hard-isolated wrapper instead. No existing fixture is reclassified as a pass.

Differentials compare exit status, stdout/stderr text **and exact bytes**, and
recursive regular-file bytes plus directory presence. No trimming, whitespace
rewriting, diagnostic suppression, or expected-failure inversion is applied.
The explicit syntax-contract tests separately assert exit 2, no output/effects,
and a nonempty diagnostic for both engines; their unmodified diagnostics are
recorded, but prose equality is not a syntax-contract requirement.

The installed reference is `/bin/bash`, GNU Bash 3.2.57(1)-release,
arm64-apple-darwin25, not the version documented by the current GNU manual.
Reference identity is checked on every suite run. Modern-only features such as
`|&` are not inferred to work in this older oracle. NUL-substitution diagnostic
behavior and exact fatal-expansion exit codes can vary across Bash releases;
the stored evidence is specifically for the installed version.

Six generated glob/pipeline cases use the deterministic LCG seed `0x5eed1234`.
Other cases are minimal, fixed scripts rather than randomized shell input.

## Safety and cleanup

- Every reference script runs under `mkdtemp`, with `--noprofile --norc`, fixed
  `LC_ALL=C`, and a small allowlisted environment. Parent `BASH_ENV`, `ENV`,
  `NODE_OPTIONS`, credentials, and shell options are not inherited.
- Scripts are manually reviewed, finite, and local-only: no network, auth,
  background jobs, or host paths outside the temporary directory are used for
  effects. The helper is for these reviewed scripts, not a general sandbox for
  untrusted Bash. Fixture paths are checked for lexical escape.
- Bash and virtual children have 5-second hard `SIGKILL` deadlines and a 1 MiB
  combined stdout/stderr capture ceiling. The helper uses documented async
  `spawn(..., { detached: true })`, with no unsafe option casts or excess-property
  workaround. POSIX process groups are killed on exit, timeout, or output overflow
  to remove descendants, including ones keeping captured pipes open. This harness
  explicitly requires POSIX; it does not silently reduce cleanup on Windows.
- Temporary reference directories are removed recursively in `finally`.
  Virtual scripts use only the memory filesystem. Virtual children also have
  cooperative 3.5-second signals and a 4-second watchdog. An independent Node
  worker thread additionally kills the virtual process group after 4.5 seconds;
  a blocked main thread or loss of the parent cannot starve that watchdog. Normal
  completion terminates the worker. The parent deadline remains the final guard.
- Every virtual invocation fingerprints the source before/after. A changing
  tree produces an explicit race failure, not a shell-semantic attribution.
  Fingerprints cover all `src` files plus package/config/fixture inputs, so an
  unrelated worker's source change can conservatively trigger this guard.
- Source fixes require independently failing regressions. Unsupported syntax
  remains failing coverage; there are no skips, TODOs, or inverted failures.

## Reference documentation

Primary GNU manual sections consulted on August 26, 2026:

- Redirections: left-to-right evaluation, descriptor copying/closing/moving,
  heredocs, and here-strings.
  `https://www.gnu.org/s/bash/manual/html_node/Redirections.html`
- Pipelines: connections precede explicit redirections and pipeline status.
  `https://www.gnu.org/s/bash/manual/html_node/Pipelines.html`
- Command Substitution: trailing-newline removal, quoted results, and `$(<file)`.
  `https://www.gnu.org/s/bash/manual/html_node/Command-Substitution.html`
- Special Parameters: quoted `$*` with empty versus unset `IFS`.
  `https://www.gnu.org/s/bash/manual/html_node/Special-Parameters.html`
- Bash Builtins: `read` delimiters, escaping, and character counts.
  `https://www.gnu.org/s/bash/manual/html_node/Bash-Builtins.html`
- Shell Parameter Expansion and Shell Arithmetic: fatal noninteractive
  parameter errors and division-by-zero errors.
  `https://www.gnu.org/software/bash/manual/bash.html`
  `https://www.gnu.org/software/bash/manual/html_node/Shell-Arithmetic.html`

The manual is supporting semantics, not a substitute for running the recorded
local Bash version. In particular, whole-source virtual prevalidation is a
deliberate safety-policy difference: Bash 3.2 can execute earlier commands before
reporting a syntax error inside a substitution. That differential remains a
failure of exact compatibility, not a recommendation to weaken prevalidation.

The process API was checked against the official documentation for the installed
Node version, specifically `spawn`/`options.detached` and process `exit`/`close`
events: `https://raw.githubusercontent.com/nodejs/node/v22.22.2/doc/api/child_process.md`.
The original inline `spawnSync(..., { detached: true })` TS2769 was reproduced
with the installed compiler using an in-memory source file. The prior structural
workaround already compiled when this follow-up started; it has now been removed
in favor of the supported, typed async API. No reproduction file was created.

## Investigation handoff

The read-only investigator's handoff and retained concrete probe scripts were
read. Fifteen useful differentials and a glob-byte budget regression were added
initially. The recovered 144-line report was reread during this follow-up; it was
not overwritten. Missing input-descriptor/shared-offset and trailing-IFS-read
reproductions were added, along with a zero-command-budget/no-redirection-effect
contract. No heredoc, case, or array expansion was added in this follow-up.

`initial-evidence.json` retains an intermediate 77-test run: 66 passed and 11
failed, including one explicitly detected concurrent-source race in
`src/fs/mount/index.ts`/`README.md`. It is not the final acceptance result.
`pre-isolation-evidence.json` preserves the original 95-test delivery.
`evidence.json` is the current follow-up run; its raw failures and provenance are
authoritative for the recorded working tree, not future concurrent revisions.

## Initial delivery results (historical)

Final expanded run: **95 tests, 68 passed, 27 failed**, with zero cancelled,
skipped, or TODO tests. The 68 Bash differentials contribute 43 passes and 25
failures; all five syntax contracts pass; the provenance test passes; 19 of 21
isolated lifecycle/budget contracts pass. Failures are intentionally ordinary
failing tests, not accepted baselines.

- Time: August 26, 2026, 18:59:55.371–19:00:18.735 UTC.
- HEAD before and after: `7db81494b5a7a9bcbe6d984456040c8dc26e0212`.
- Node: `v22.22.2`; host: `darwin/arm64`.
- Source aggregate before:
  `28b25084545683ee5f744460de967ec8b72819caf234d362a5b31ac3768d2811`.
- Source aggregate after:
  `c4ef0655cb76bcef0f8e2c5086757082c2b655d6a4a56978d4d08d4128a878a0`.
- Runtime SHA-256:
  `7f8bb7f07a9f4f0bc71897f1616d4e7197425fa9c54186c05221ffca4c3c6b20`.
- Parser SHA-256:
  `c9a405900c55c9d7d2d648cc9218ac8a55cd548174467eadcb5476c86651835c`.

The final whole-run fingerprint changed because another worker edited
`src/fs/webdav/webdav.ts` and `src/fs/webdav/README.md`. No shell source changed,
and no final individual test reported a source race. This is still recorded as
a whole-tree race rather than silently claiming an immutable checkout. The
preceding expanded 94-test run observed the same 27 failures with unchanged
whole-source fingerprints; the added backpressure test passes in the final run.

Both final typechecks exit **0**: repository-wide `tsc --noEmit`, and the explicit
strict compilation of owned test/report entry points and their imports. Exact
arguments and empty compiler output are in `pre-isolation-evidence.json`. An intermediate
typecheck saw seven TS2339 errors in concurrently authored
`src/commands/text-programs/regex.ts`; those were not edited here and are absent
from the final validation. No full `npm test` or build claim is made.

### Concrete failures

| Reproduction | Bash 3.2 reference | Virtual observation | Attribution |
| --- | --- | --- | --- |
| `{ :; : >after; } \| :` | Creates empty `after`, status 0 | No file, status 0 | High-confidence shell pipeline lifecycle defect; builtin-only |
| `printf abc >out \| true` | `out` contains `abc` | `out` is empty | High-confidence early upstream cancellation; companion builtin-only test rules out a missing command |
| `set -o pipefail; { true; false; } \| true` | Status 1 | Status 141 | High-confidence synthetic SIGPIPE replacing real upstream status |
| `: "${missing:?stop}"; : >after` | Status 127, no file | Status 0, creates `after` | High-confidence fatal-expansion continuation; exact 127 is version-specific |
| `: "$((1/0))"; : >after` | Status 1, no file | Status 0, creates `after` | High-confidence fatal arithmetic-expansion continuation |
| `{ printf x >&3; } 3>out` | `out` contains `x`, status 0 | Empty `out`, bad-descriptor diagnostic, status 1 | High-confidence inherited-descriptor loss |
| `printf hi 2>err >"$(printf diagnostic >&2; printf out)"` | `err` contains `diagnostic` | External stderr contains `diagnostic`; `err` empty | High-confidence redirect/substitution ordering |
| `read first second` with `a\ b c` | `first='a b'`, `second=c` | `first=a`, `second='b c'` | High-confidence escaping lost before IFS splitting |
| `mark *`, one 20-byte filename, `maxExpansionBytes: 8` | Contract expects `ShellLimitError('maxExpansionBytes')`, no mark | No rejection | High-confidence quota bypass; budget contract, not Bash semantics |
| `while true; do true; done` with a 20 ms abort timer and large finite count limits | Contract expects abort-reason rejection | Child hits 5-second `SIGKILL` deadline | Observed timer starvation; exact wall-clock latency is not specified by the API |

Remaining exact differentials cover descriptor moves, `read -n`/`-d`, empty-IFS
quoted `$*`, `$(<file)`, ANSI-C quotes, heredocs/here-strings, fatal substitutions,
mixed-IFS reads, quoted removal patterns, POSIX bracket classes, NUL substitution,
export-prefix persistence, and uninitialized locals. Raw expected/actual output,
bytes, status, and file snapshots are retained for each failure.

The nested-substitution syntax differential is separately classified as the
known stricter prevalidation policy, not a safety defect. Error-producing
differentials retain exact stderr, so future fixes may leave wording-only
differences; those must be classified from the raw record rather than counted as
proof of a surviving data/status defect.

### Created paths and ownership

- `tests/shell-stress/model.ts`
- `tests/shell-stress/helpers.ts`
- `tests/shell-stress/cases.ts`
- `tests/shell-stress/probes.ts`
- `tests/shell-stress/virtual-child.ts`
- `tests/shell-stress/differential.test.ts`
- `tests/shell-stress/lifecycle.test.ts`
- `tests/shell-stress/process.ts`
- `tests/shell-stress/process.test.ts`
- `benchmarks/shell-stress/run.ts`
- `benchmarks/shell-stress/README.md`
- `benchmarks/shell-stress/initial-evidence.json`
- `benchmarks/shell-stress/pre-isolation-evidence.json`
- `benchmarks/shell-stress/evidence.json`

No source, existing test, oracle fixture, package manifest/script, root document,
or other benchmark harness was edited. No dependencies were added. Nothing was
staged or committed. Final cleanup inspection found no retained reference
temporary directories.
