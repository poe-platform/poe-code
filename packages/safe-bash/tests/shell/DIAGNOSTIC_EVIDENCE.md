# Diagnostic implementation checkpoint — 2026-08-26

GNU Bash 5.3.0 is the explicit primary implementation **design choice**, not a
user requirement. The original Bash 3.2.57 cohort, helpers, fixtures and expected
results remain unchanged. `Shell.exec` has the fixed invocation identity
`shell`; implementation does not switch labels or reference versions by case.
This checkpoint does not establish all-Bash compatibility, superiority to
just-bash, completion of the product scope or 72 hours of work.

This diagnostic work is **paused** at root's priority transfer to the independent
remote audit `4e26ce0`, cases S08/D08. Independent diagnostic final validation
has not been completed or authorized to restart. Source ownership transfers
to the dedicated pipeline leaf; this checkpoint does not attempt that fix.

## Baseline before source changes

The independent baseline-ready marker was read before diagnostic implementation
edits. Its virtual source hashes were unchanged. Its complete inventory is the
original 105 tests and current 13 tests, including all five previously weakly
asserted syntax cases: 88 portable fixtures, 24 virtual resource probes, and six
identity/process-harness checks. Both complete native profiles were captured
twice with both the original `shell-stress` identity and uniform `shell` identity.
No original helper, fixture, expectation or independent test was edited here.

| Exact portable fixture comparison | Pass | Active failures |
| --- | ---: | ---: |
| 3.2, original `shell-stress` identity | 74/88 | 14 |
| 5.3, original `shell-stress` identity | 74/88 | 14 |
| 3.2, uniform `shell` identity | 74/88 | 14 |
| 5.3, uniform `shell` identity | 86/88 | 2 |

**All seven previously reported diagnostic rows already matched the modern,
uniform-identity profile before these changes.** They comprise the fatal
parameter, arithmetic and substitution diagnostics, NUL warning, two moved-FD
diagnostics, and current-gap fatal-parameter diagnostic. No fictitious source
fix is attributed to those seven rows. The two genuine complete-cohort modern
residuals were `unterminated-quote-after-write` and
`missing-group-terminator-after-write`.

The independent profile/expectation commits are separate from implementation.
Baseline artifacts and hashes:

- `/tmp/safe-bash-shell-diagnostic-native-complete-baseline.json`:
  `0cb9d0b498331434ec2a49dd4f75b30dcfb10db2ff8fd029613d948f119d4cf3`.
- `/tmp/safe-bash-shell-diagnostic-virtual-baseline.json`:
  `fd95054242fb24d1b6d8614812a1e14fcdd01a81b71833c905f1f48cc9a5320d`.
- Readiness: `/tmp/safe-bash-shell-diagnostic-profiles-baseline-ready.txt`.

## Source changes and pinned new regressions

Source plus new regressions commit:
`a3ef9d6a0590406fcb8dc2434ca81558f079836c`.

- Unterminated single/double/ANSI-C quotes carry their opening-line diagnostic
  metadata without replacing the existing syntax error reason, offset or status.
  Shell CLI rendering uses native EOF wording. Incomplete brace groups retain
  their opening command context, including nested groups and trailing newlines.
- NUL warnings and fatal parameter/arithmetic expansions use the executing
  command's diagnostic line, not simply the expansion token's physical line.
  Multiline assignments, arguments, redirections, functions, substitutions,
  heredocs and here-strings have pinned controls. NUL removal, warning count,
  stdout bytes, statuses and file effects remain separately asserted.
- `cd` filesystem failures use a narrow errno-description mapping with command
  and requested-path context. Original errors reach middleware unchanged;
  only terminal shell presentation uses the separately stored diagnostic.
  Redirection errors likewise retain their original error object internally.
- Per-command diagnostic contexts share the original descriptor slots before
  isolation. A focused test caught and prevented an intermediate regression in
  moved standard-input closure/provenance; no old assertion was weakened.

`diagnostic-reference.json` freezes 38 new cases under **both** native profiles,
two identical repetitions each: 152 bounded case children plus two version
probes. Each child uses literal argv, fixed `shell` identity, sanitized C locale,
isolated temporary cwd, 2-second deadline, 256-KiB combined output cap, and
process-group cleanup. Exact stdout/stderr/file bytes are base64, not normalized.
The initial unpublished capture rejected a temp-directory-dependent `pwd`
control; that new fixture was corrected to relative effects before freezing.

The fixed primary profile is used for all 38 regression expectations. Their
pre-source run was 13 passing and 25 failing; final run is 38/38. This is a
new bounded regression set, not the denominator for the original seven or
the full product. Frozen reference SHA256:
`568d8bb1e653497844ba12a36001ca5c13c2c572ddedc6caf8b59bd043df6fb8`.
The test pins that hash and the fixture hash; the artifact also records its
capture-script hash. Regeneration requires the explicit pinned executables:
`node --import tsx tests/shell/capture-diagnostic-reference.ts` emits an
`apply_patch` document; it does not overwrite evidence itself.

## Public FsError versus CLI presentation

`fs-error-diagnostics.test.ts` adds 20 shell-owned tests. Eight mapped errno
codes are checked at both typed-API/plugin and redirection boundaries. Frozen
`FsError` objects retain identity, code, errno, syscall, path, destination,
message, stack descriptors and cause through direct filesystem calls, plugin
commands, literal `invoke`, and middleware rethrow. `cd` terminal rendering is
tested separately from those public errors. Namespace and cwd remain unchanged.

Additional controls retain arbitrary code-looking messages and exact
plugin-provided stderr bytes, respect middleware replacement errors, preserve
factory/setup `FsError` rejection identity, and propagate typed cancellation
reasons rather than turning them into CLI results. No contracts, filesystem
adapters or command-family implementation was changed. The unowned adapter-tool
matrix's `cat` diagnostics remain command-owner scope; shell formatting is not
permission to strip errno strings from arbitrary command errors.

## Validation and historical failures

All test commands used `node --unhandled-rejections=strict --import tsx --test
--test-concurrency=1` with explicit owned or unchanged cohort paths. The audit
is `/tmp/safe-bash-shell-diagnostic-author-validation.json`; individual raw
outputs are `/tmp/safe-bash-shell-diagnostic-author-{name}.stdout` and `.stderr`.

| Fresh author run | Result | Source/test guards |
| --- | --- | --- |
| Full owned shell (`owned707`) | 707/707 pass | unchanged |
| Existing modern holdout (`modern57`) | 57/57 pass | unchanged |
| Existing boundary holdout (`boundary12`) | 12/12 pass | unchanged |
| Unchanged historical cohorts (`historical118`) | 109/118 pass, 9 fail | unchanged |
| Whole-repo `tsc --noEmit` | exit 0 | only three unowned diff-patch Markdown files changed |
| Whole-repo `tsc --noEmit`, completed repeat | exit 0 | source hashes unchanged |
| `tsc -p tsconfig.build.json --noEmit` | exit 0 | unchanged |

The completed typecheck repeat is recorded separately in
`/tmp/safe-bash-shell-diagnostic-author-typecheck-repeat.json`.

The original cohorts remain 100/105 and 9/13, not green by reclassification.
All nine retained failures are explicit:

- `move-output-really-closes-source`
- `move-input-really-closes-source`
- `prevalidation-prior-output-and-file`
- `fatal-parameter-preserves-only-earlier-effects`
- `nested-substitution-syntax-error-does-not-prevent-earlier-effects`
- `fatal-parameter-expansion-prevents-following-file-effect`
- `fatal-arithmetic-expansion-prevents-following-file-effect`
- `fatal-expansion-in-substitution-stops-substitution-only`
- `command-substitution-removes-nul-bytes`

Seven are the historical diagnostic differences; two are genuine same-unit
status/effect conflicts with 3.2. Unsafe historical effects were not adopted.
The independent baseline also recorded a process-harness cleanup failure;
the author's unchanged fresh harness checks passed. This does not erase that
earlier observation. The author's initial pre-source full649 run had one
unowned-source-change guard invalidation, not a semantic failure or stable pass;
the final 707 run supersedes it with unchanged hashes.

## Active diagnostic limit

`diagnostic-limits.json` preserves two repeated pinned modern observations and
the final source hashes, separately from passing regression expectations.
GNU reparses a printed dollar-substitution command tree; this implementation
does not reproduce every line-number effect of that internal pretty-printer.
For the following already-supported source, native warns on line **6**, virtual
on line **8**; both return status 0 with empty stdout:

```bash
value=$(:


printf '%s' "$(printf 'a\0b')"
)
```

The paired multiline backtick control matches line 4. The dollar-substitution
row remains a real modern diagnostic limitation, not a dialect exception,
successful guest-semantic characterization, or a claim that all source-line
contexts are complete. No broad syntax was added to emulate a GNU pretty-printer.

## Import provenance and generated artifacts

An initial eval-parent `import.meta.resolve` probe selected existing untracked
JavaScript siblings. That established a direct-JavaScript import hazard, **not**
proof that TypeScript test entries were shadowed. The independent actual
`NODE_DEBUG=esm` TS-entry trace showed tsx remapping TypeScript-parent imports to
TypeScript dependencies even while their generated siblings still existed.
The initial blanket contamination inference was corrected; prior TS test runs
are not retroactively invalidated from that inference.

After root coordination, the author verified nine untracked owned files against
byte-identical TypeScript 5.9 emission, copied and hashed them, and removed only
those generated files with `apply_patch`:

- `src/shell/arithmetic.js`
- `src/shell/index.js`
- `src/shell/input.js`
- `src/shell/locale.js`
- `src/shell/parser.js`
- `src/shell/pattern.js`
- `src/shell/runtime.js`
- `src/shell/shell.js`
- `src/shell/types.js`

`generated-artifact-cleanup.json` retains every SHA256 and the backup location
`/tmp/safe-bash-shell-generated-backup-KZWd54`. No tracked or user-authored file
was removed. Other owners handled unowned artifacts; none was deleted or moved
by this author. Actual fresh helper-entry trace:
`/tmp/safe-bash-shell-diagnostic-author-loader.stderr`. Current source resolution
is TypeScript; no shell JavaScript siblings remain. Validation used no-emit
build checks and did not produce build artifacts.
Runtime dependencies remain zero, with no manifest, export or package rename.

## Native and primary-source provenance

- Primary executable: `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`,
  SHA256 `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
- Historical executable: `/bin/bash`, GNU 3.2.57,
  SHA256 `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
- Existing GNU archive: `https://ftp.gnu.org/gnu/bash/bash-5.3.tar.gz`,
  SHA256 `0d5cd86965f869a26cf64f4b71be7b96f90a3ba8b3d74e27e8e9d9d5550f31ba`.
- GNU manual browsed for command substitution and redirections:
  `https://www.gnu.org/software/bash/manual/html_node/Command-Substitution.html`
  and `https://www.gnu.org/software/bash/manual/html_node/Redirections.html`.
- Pinned source `subst.c:6716` drops NUL and warns once; `error.c:74` and
  `error.c:222` attach execution-line context. `parse.y:4632` prints command
  substitution trees; `parse.y:5851` records the simple-command line after
  lexing its initial word. Exact native captures, not a manual inference or
  latest-version assumption, determine regression bytes.

Pinned source SHA256 values: `subst.c`
`cf96a7f33e7f9281f18c7b02d8840ad2d817f14243dd38377f8090249a7edf85`,
`error.c` `1437faf7b83170a35abb9381c2d169d66b6c6c925ad7fbec7329a3f02316f402`,
`parse.y` `076a16d00c5b065137b3d2730d2b94a1f6c89a1bbb5d2f4bd72d31e00947e27f`,
`execute_cmd.c` `edca6ab242353ca928d2d991eb5cd92d6267b6be39f990aac6532263bfe0548d`.
