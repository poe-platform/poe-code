# Independent remaining-gap audit, 2026-08-26

This is a leaf audit, not an implementation handoff acceptance or superiority
claim. Only the two new `current-gaps/` trees are owned. Existing tests, their
expectations, the harness, and all product sources remain untouched by this
auditor. There are no skip/todo exceptions or diagnostic normalizations.

## Unchanged baseline

`baseline.json` archives the initial coordination report, full source and harness
SHA-256 hashes, raw TAP, and invocation. The original three test files ran with
strict unhandled rejections and concurrency one: **95/105 pass, 10 fail**, zero
cancelled/skipped/todo, process exit 1. HEAD was
`7b1cb3b8424f5347be954d6a4c06d8d62500fbe7`, after metadata commit `27e5c58`.
The source aggregate stayed
`34d6c696e2104d8430a989dda5a1a5697ecc7eab459439f04fa7829f99f5d08a`
from 20:41:31.337Z to 20:41:52.938Z. The worktree contained other workers'
uncommitted edits, so HEAD alone does not identify this snapshot.

Immediate coordination files were `/tmp/safe-bash-shell-gap-baseline.txt` and
`/tmp/safe-bash-shell-gap-baseline.json`. New cancellation findings were published
promptly to `/tmp/safe-bash-shell-gap-findings.txt` before the extended audit.

## All ten old failures, unchanged

These classifications describe the stable baseline, not a later author's state.
`evidence.json` independently recaptures every exact Bash script and byte result
in its first ten `cases` entries. The original expected results remain active in
`tests/shell-stress/differential.test.ts`.

| Old failing case | Baseline classification and exact observed difference |
| --- | --- |
| `descriptor-move-closes-original-after-copy` | Missing descriptor move. Bash writes `moved` to `saved`, status 0; virtual creates empty `saved`, status 1, `shell: 3-: Bad file descriptor\n`. |
| `read-n-consumes-exactly-two-characters` | Unsupported `read -n`. Bash stdout `[ab]cdef\n`; virtual `[]abcdef\n` plus unsupported-option diagnostic. Both scripts ultimately exit 0 because `cat` follows. |
| `read-d-consumes-through-delimiter-only` | Unsupported `read -d`. Bash stdout `[ab]cd:ef\n`; virtual `[]ab:cd:ef\n` plus unsupported-option diagnostic. |
| `command-substitution-file-shortcut-reads-and-trims` | Silent missing file shortcut: Bash `<one\ntwo>` versus virtual `<>`, both status 0 and unchanged input file. |
| `ansi-c-quoted-word-decodes-escape-before-argument-passing` | Unsupported ANSI-C word: Bash `<one\ntwo\tthree>`, status 0; virtual syntax diagnostic at offset 15, status 2. |
| `nested-substitution-syntax-error-does-not-prevent-earlier-effects` | Compatibility versus documented prevalidation-policy conflict; see next section. Bash creates `marker=touched` and exits 0; virtual creates nothing and exits 2. |
| `fatal-parameter-expansion-prevents-following-file-effect` | Correct no-following-effect boundary, but status and diagnostic differ. Bash 3.2 returns 127 and `shell-stress: missing: stop\n`; virtual returns 1 and `shell: missing: stop\n`. |
| `fatal-arithmetic-expansion-prevents-following-file-effect` | Correct no-following-effect boundary and status 1; raw diagnostic differs: Bash `shell-stress: 1/0: division by 0 (error token is "0")\n`, virtual `shell: Arithmetic division by zero\n`. |
| `fatal-expansion-in-substitution-stops-substitution-only` | Same stdout `<>:1\n`, outer status 0, no files; stderr differs only in shell identity prefix (`shell-stress:` versus `shell:`). Still an exact-comparison failure. |
| `glob-posix-bracket-digit-class` | Missing pathname POSIX class: Bash `<1.txt>\n`; virtual `<[[:digit:]].txt>\n`, both status 0. Case-pattern class support does not establish pathname-class support. |

That is six functional gaps, one unresolved policy conflict, and three exact
diagnostic/status differences. None is excluded from the failure denominator.
The statuses above are measurements of the pinned Bash 3.2 executable, not
assertions that every Bash version or POSIX shell must return those numbers.

## Prevalidation: decision required, no waiver

Exact old script:

```bash
printf touched >marker; printf '%s' "$(true |)"
```

Bash: stdout empty, `marker` contains `touched`, status 0, stderr
`shell-stress: command substitution: line 1: syntax error: unexpected end of file\n`.
Virtual: stdout empty, no files, status 2, stderr
`shell: Expected command at offset 6\n`.

The independently added script
`printf before; printf marker >marker; printf "%s" "$(true |)"; printf after`
also demonstrates Bash continuing the outer execution: `beforeafter`, status 0,
`marker=marker`, and the same substitution diagnostic. Virtual does neither
earlier nor later effects, returning status 2.

Local evidence:

- Root `AGENTS.md`, Requested product and workflow, preserves the full-shell
  goal and disallows treating partial compatibility as complete. It does not
  specify whole-source prevalidation or authorize a compatibility exception.
- `tests/shell/README.md:11` explicitly documents whole-source validation,
  including substitutions, before execution and calls its Bash difference
  intentional. `tests/shell/core.test.ts:47` tests this no-earlier-effects rule;
  `src/shell/shell.ts` parses before constructing execution state.
- `tests/shell/HEREDOCS.md:141` already describes this as intentional, but that
  classification does not make the raw oracle test pass.
- `src/contracts/command.ts` and `src/shell/types.ts` expose cancellation and
  shell result contracts; they do not grant a prevalidation compatibility waiver.

Changing execution to match this Bash observation would conflict with the
documented safety invariant and its author tests. The root/user must decide
whether to retain the difference or revise the invariant. This audit neither
waives the original test nor instructs the author to remove prevalidation.

## New unmatched-bracket cancellation regression

`tests/shell-stress/current-gaps/pattern.test.ts` contains two active bounded
regressions: direct matcher and public `Shell.exec`. Both failed on three focused
runs with stable per-test source guards. Each child schedules an abort at 10ms;
the parent kills the detached process group at 1500ms and caps combined output
at 65536 bytes. Parent test timeouts are 4000ms. A failed child cannot hang the
parent test runner.

Minimal public-shell invocation, **only inside the bounded child harness**:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(new Error("audit abort")), 10);
await shell.exec('case x in $PATTERN) : >unexpected;; esac', {
  env: { PATTERN: "[".repeat(65536) }, signal: controller.signal,
});
```

`src/shell/pattern.ts` at hash
`c468d0e671872a2a0eada8811bf621fb69ac436a0a78a01c8933143a3815af9d`
scans the remaining suffix for each unmatched `[`, synchronously constructing
class contents. This tokenization occurs before the matcher's work accounting
and yield/cancellation checks. This is the identified cause of starvation;
the regression does not prescribe a source patch.

One formal growth sample per length/mode in `evidence.json`:

| Pattern length | Matcher internal elapsed | Public shell internal elapsed |
| --- | --- | --- |
| 2048 | 23.812ms, returns false, abort timer never fires | 27.082ms, status 0, no files, abort timer never fires |
| 8192 | 320.474ms, returns false, abort timer never fires | 331.309ms, status 0, no files, abort timer never fires |
| 32768 | Parent deadline kills at 1500ms | Parent deadline kills at 1500ms |
| 65536 | Parent deadline kills at 1500ms | Parent deadline kills at 1500ms; source guard changed, sample invalid for attribution |

The invalid sample changed only the compression README, but it is still not
treated as valid. Both subsequent focused 65536 regressions reproduce under
stable source hashes. A preliminary direct-only series used the same four
lengths; no prolonged repetition campaign was run. These local latency samples
are not a broad timing claim or a comparison benchmark. Installed Bash completes
the bounded 65536-bracket reference with `nomatch`, status 0, empty stderr.
The small literal `[` case passes in both engines.

## Reference identity and isolation

Reference: `/bin/bash`, GNU Bash **3.2.57(1)-release**, arm64-apple-darwin25,
binary SHA-256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
Node: **v22.22.2**, darwin/arm64. No modern Bash binary is claimed.

`reference.ts` uses literal argv `--noprofile --norc -c SCRIPT shell-stress` via
the read-only `isolatedSpawn` harness (`shell:false`, detached process group).
Each reference has an isolated temporary directory under the owned test subtree,
an allowlisted environment with C locale, no inherited startup variables,
1500ms hard deadline, 65536-byte combined output cap, and recursive cleanup in
`finally`. Scripts use builtins plus bounded `cat` on supplied input. No fixture
executes deletion, external network activity, or arbitrary host commands.
Raw stdout, stderr, base64 byte representations, statuses, and all file contents
are retained. Diagnostic identity is deliberately not rewritten.

## Mixed-source extended capture

`evidence.json` ran from 20:45:32.132Z to 20:45:48.816Z at HEAD `e432c52`.
It contains **21 observations: 2 pass, 19 fail, 0 per-case guard errors**;
the ten old cases were **1 pass, 9 fail** during this interval. Descriptor move
was already changed by its author. These are not a new baseline: the aggregate
changed from `137489fb10bb61d8c2c9239d729730522181520f85cbd5d8e6536976e9292889`
to `fd5fda600f3da522b3291d873651d99722de54a8fb4801b974b1204942b4dd5f`.
Changed paths: `src/shell/input.ts`, `src/shell/runtime.ts`, and
`src/commands/bytes/compression/README.md`. Thus the aggregate run is invalid
as a single-source product result even though individual virtual cases passed
their existing source guards. The report exits nonzero and preserves all rows.
Its embedded two-test regression result remains **0/2 pass, 2 fail**, with
stable per-test aggregate hashes. Reference results are independent of product
source changes.

The eleven follow-up cases are now active exact differential tests in
`compatibility.test.ts`: descriptor-source closure in both directions, read
newline/NUL/EOF behavior, shortcut stdin provenance, ANSI-C quotedness, pathname
class negation, earlier prevalidation effects, fatal earlier-effect retention,
and the unmatched-bracket literal control. Original ten tests are not duplicated
or removed. All failures, including diagnostic-only differences, remain failures.

## Primary semantic sources

Consulted on 2026-08-26 using web search. Current GNU manual text is semantic
context; installed Bash 3.2 bytes/statuses are the actual oracle. No modern-only
syntax has been silently added to these fixtures.

- GNU Bash manual 3.6.9: descriptor moves duplicate the source and close it.
  `https://www.gnu.org/s/bash/manual/html_node/Redirections.html`
- GNU Bash manual, `read`: `-n` respects an earlier delimiter; `-d` selects the
  delimiter, including NUL for an empty delimiter; EOF is nonzero.
  `https://www.gnu.org/s/bash/manual/html_node/Bash-Builtins.html`
- GNU Bash manual 3.5.4: the file shortcut substitutes file contents with trailing
  newlines removed.
  `https://www.gnu.org/s/bash/manual/html_node/Command-Substitution.html`
- GNU Bash manual 3.1.2.4: ANSI-C words decode escapes and retain quotedness.
  `https://www.gnu.org/software/bash/manual/html_node/ANSI_002dC-Quoting.html`
- GNU Bash manual 3.5.8.1: bracket character classes and C-locale matching.
  `https://www.gnu.org/s/bash/manual/html_node/Pattern-Matching.html`
- POSIX.1-2024 Shell Command Language 2.6.2 and 2.8.1: unset/null required
  parameters and expansion errors require a diagnostic/nonzero exit; errors in
  a subshell end that subshell while the invoking environment continues. These
  rules do not establish Bash 3.2's exact 127 status or diagnostic prefix.
  `https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html`

## Reproduction and limits

`validation.json` records the final owned-tree run, 20:48:49.596Z through
20:48:57.282Z, HEAD `2340844163cce1b2528e7c0165575165c00e9638`, stable source
aggregate `6b93af6d23e6ab2855e2ffeb42bdbd7c2102cf04d4bf5e390751bcac0841c9d4`.
**5/13 pass, 8 fail**, zero cancelled/skipped/todo, exit 1. The eight failures
are two descriptor-source-closure diagnostic-prefix mismatches, ANSI-C quotedness,
pathname classes, prevalidation, fatal parameter status/diagnostic, and both
unmatched-bracket deadline regressions. Read newline/NUL/EOF and shortcut stdin
cases now pass following concurrent author changes. This is not a replacement
for the unchanged 105-test baseline or final post-author verification.

Strict scoped TypeScript validation of every new `.ts` file exits 0 in that
same source-stable interval. An earlier scoped check encountered transient
`src/shell/input.ts:117` TS2322 (`Uint8Array<ArrayBufferLike>` versus
`Uint8Array<ArrayBuffer>`); the auditor did not edit that author's source.
Independent consistency checks confirm all ten recaptured Bash observations
equal the baseline's exact expected objects, every old harness hash is unchanged,
and all captured byte/text representations agree. `git diff --check` passes.
The validation file's owned hashes precede this final prose update; source and
test hashes are unaffected. No whole-repo typecheck or build claim is made.

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 tests/shell-stress/differential.test.ts tests/shell-stress/lifecycle.test.ts tests/shell-stress/process.test.ts
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 tests/shell-stress/current-gaps/*.test.ts
node --unhandled-rejections=strict --import tsx benchmarks/shell-stress/current-gaps/capture.ts
```

The capture command emits an `apply_patch` Add File payload, not a passing-test
summary; nonzero is expected while failures/source changes remain. Preserve the
historical evidence rather than applying a fresh payload over it. Its recorded
harness hashes describe the original capture before the new compatibility test
was added. Root will request final verification after author fixes; this audit
does not certify that concurrent changes are finished or regression-free.
