# Targeted shell corrections: evidence and limits

The later diagnostic checkpoint is recorded in `DIAGNOSTIC_EVIDENCE.md`.
Independent complete-cohort capture confirmed that all seven historically
reported diagnostic rows already matched the fixed modern `shell` profile;
source commit `a3ef9d6` fixes other reproduced modern EOF/source-line/`cd`
diagnostics and adds pinned native and typed-FsError regressions. Original
historical expectations remain unchanged, with all nine failures explicit.
One GNU command-substitution pretty-printer line-number limitation remains
recorded separately rather than being counted as a successful comparison.

Reference capture on 2026-08-26 uses `/bin/bash` version
`3.2.57(1)-release (arm64-apple-darwin25)`, sanitized `LC_ALL=C`, isolated
temporary directories, literal argv, a two-second deadline and bounded output.
`bash-bugfix-helpers.ts` owns this capture. A separate isolated GNU 5.3 reference
became available during the corrections; its provenance is recorded below.
The independent unchanged stress baseline is 95/105 passing, ten failing;
raw records are `/tmp/safe-bash-shell-gap-baseline.json`.

## Descriptor moves

`descriptor-moves.test.ts` captures output, status and file effects independently
for literal moves, duplicate aliases sharing input/output offsets, redirection
order, functions, pipelines and opposite-direction descriptor moves. Both move
operators copy the open descriptor before closing the original; they do not
change the descriptor's access mode. Cancellation and nondefault stdin origin
have separate contract tests.

Initial descriptor implementation incorrectly treated two observed differences
as possibly historical. Independent paired GNU 5.3 calibration confirmed both
are bugs in that implementation; the descriptor follow-up corrects them. With
`{ say outer >&3; { say inner >&4; } 4>&3-; say restored >&3; } 3>out`, Bash
leaves descriptor 3 closed (status 1, `bash-probe: 3: Bad file descriptor`,
file `outer\ninner\n`). Both native versions leave the moved source closed in
builtin/function/group environments, and virtual-bash now does too. With
`target=3-; { say moved >&4; } 3>out 4>&$target`, Bash returns 1,
`bash-probe: 3-: ambiguous redirect`, empty file; virtual-bash now rejects the
expanded numeric-dash target before running the body. A literal final dash
selects move syntax, including `$fd-`, `'3'-` and `3\-`; a quoted final dash
or a dash produced entirely by expansion does not. The new regression replaces
the original incorrect scope/expanded-target policy assertion transparently.

Descriptor slots are distinct from shared streams: closing a moved source does
not close copied aliases or lose offsets. Earlier redirects of that source are
restored normally; moving a descriptor onto itself is a no-op. Subshell,
pipeline and substitution environments isolate slot closure; builtin/function
and redirect-only commands persist it. Failed later redirects retain earlier
move effects. Standard-input slot closure preserves nondefault origin metadata.

Primary reference: GNU Bash manual, Redirections / Moving File Descriptors,
https://www.gnu.org/software/bash/manual/html_node/Redirections.html .

## Read count and delimiter

`read-options.test.ts` compares count/delimiter consumption, escaping, raw mode,
IFS splitting, default REPLY, EOF and combined flags to the bounded reference.
UTF-8 character counting is additionally captured with `en_US.UTF-8`: installed
Bash 3.2 counts bytes, so `read -rn2` on `é😀z` assigns only `é`, leaves `😀z`,
status 0, empty stderr. The virtual text model counts Unicode characters
independently of host locale, assigns `é😀` and leaves `z`. This is an explicit
native difference, not an exact-Unicode-parity claim across versions/locales.
Paired GNU 5.3 calibration confirms Unicode character counting in UTF-8 locales
and zero-count no-consumption. GNU 5.3 counts bytes under `LC_ALL=C`; the read
follow-up now counts bytes for explicit C/POSIX locale and characters otherwise.
`LC_ALL`, then `LC_CTYPE`, then `LANG` determine the requested locale. A C count
that ends within a UTF-8 character explicitly fails with an unsupported-text
diagnostic instead of assigning replacement characters; unconsumed bytes remain
available to later commands. This boundary limitation is tested and not hidden.
Delimiter matching uses the first encoded byte; an empty argument selects NUL.
Skipped NUL bytes follow the modern manual for these option forms, not a claim
of Bash 3.2 binary-text compatibility. Non-option reads retain prior behavior.
Unsupported flags, malformed counts and counts outside safe integer range are
rejected before input consumption with status 2. No timeout or descriptor-read
flag is silently accepted.

There is a version-specific zero-count difference: Bash 3.2
`IFS= read -n 0 value` with `abcdef\n` consumes the entire line, assigns
`abcdef`, status 0. The virtual shell follows the GNU manual's explicit
zero-character behavior: succeeds without consuming input, assigns empty text.
The zero-count test asserts that the underlying iterator is not pulled.
An already-closed stdin descriptor still produces status 1 and assigns empty
text for `-n0`, without probing its iterator or consuming outer input. This is
separately captured from GNU 5.3 and covered by the frozen independent holdout.
Primary reference: GNU Bash manual, Bash Builtins / read,
https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html .

## File-only command substitution

`file-shortcut.test.ts` captures a single input redirect with no command,
including a trailing semicolon and nonzero input descriptor. Multiple redirects
do not select the shortcut. Reads use the filesystem stream directly, without
requiring a registered `cat`, and retain the shared capture/output limits and
cancellation. Target expansion variables remain isolated; opened files do not
advance an enclosing descriptor's offset. NUL removal precedes newline trimming.
Substitution status is visible to subsequent expansions in the same command,
as observed with `false; printf '<%s>:%s' "$(<input)" "$?"` (status field 0).
Target errors terminate the substitution environment, not the outer shell.
The modern follow-up emits the captured GNU 5.3 ignored-NUL warning once per
substitution, with its source line; the original GNU 3.2 warning-free reference
remains active and unchanged. NUL removal now occurs on bytes before UTF-8
decoding and trailing-newline removal. Ordinary binary pipelines are unchanged.
The independently captured GNU 5.3 directory-only shortcut on this macOS host
returns empty text/status 0 without a diagnostic; the shortcut follows that
captured behavior while ordinary input redirects retain their directory check.
This is not a cross-platform directory-read guarantee.

## Pathname classes and pattern cancellation

Pathname segments now use the same iterative matcher as case, including C/ASCII
POSIX bracket classes, negation and quoted bracket members. The separate
parameter-removal matcher is unchanged. Exact pathname output is compared to
the existing C-locale Bash reference. Locale collation is not claimed.

The auditor reproduced cancellation starvation for 65,536 unmatched `[` bytes
in both the matcher and public shell, externally killed after 1.5 seconds.
Tokenization now accounts for work and yields every 1,024 steps, before matching
starts; when no closing bracket exists it avoids repeated suffix scans.
Case retains its shared `maxExpansionBytes` work bound, now including compilation.
Pathname matching uses a finite work allowance of `4 * maxExpansionBytes + 1024`
(capped at the safe-integer maximum), separately from the unchanged strict
output byte/field limits, so exact-budget output remains permitted.

## ANSI-C word quoting

Common escapes have direct unchanged `/bin/bash` comparisons. Additional Unicode
and control escapes were captured using the isolated signed-source GNU Bash
5.3.0 binary `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, under
`en_US.UTF-8`, sanitized environment and a two-second per-command deadline.
Source archive SHA-256:
`0d5cd86965f869a26cf64f4b71be7b96f90a3ba8b3d74e27e8e9d9d5550f31ba`.
Full paired independent provenance is in `/tmp/safe-bash-shell-modern-reference.txt`
and its referenced 137-case capture. Existing native helpers were not redirected.

GNU 5.3 decodes `\u00e9\U0001f600` to `é😀`, `\c?` to DEL and trailing `\c`
literally; Bash 3.2 leaves Unicode escapes literal, maps `\c?` to U+001F and
leaves only a slash for trailing `\c`. The added modern tests use the exact
captured values, status 0 and empty stderr, not Bash 3.2 normalization.
Escaped UTF-8 bytes are decoded together. NUL truncates only its quoted segment,
so `$'a\0b'x` yields `ax`. Unknown/non-numeric escapes retain the backslash.
ANSI-C quoting is word syntax, not expanded inside double quotes or heredoc
bodies. Existing rejection of ANSI-C heredoc delimiters remains explicit.

In UTF-8 locale, non-scalar Unicode escapes are explicitly rejected before effects (status 2),
rather than silently approximated: GNU 5.3 emits invalid UTF-8 for `\uD800`
and `\U00110000`; those byte-valued textual forms are not supported by the
virtual UTF-8 string model. This is a recorded limitation, not parity.
The formerly unsupported valid-ANSI-C parser assertion is replaced by an
unterminated-ANSI-C no-effect assertion; supported forms have new positive tests.

The C/POSIX-locale follow-up preserves canonical ASCII spellings for Unicode
escapes above ASCII: `\U000000e9` becomes literal `\u00E9`, and `\u000A` still
becomes newline. Locale selection happens when parsing the current input unit,
as directly captured from GNU 5.3: changing LC_ALL on the same line does not
retroactively change ANSI-C decoding, whereas changing it before a new input
unit does. The initial locale comes from explicit shell/exec environment, not an
uncontrolled host locale. Existing `/bin/bash` references remain unchanged.

## Fatal status and diagnostics

`fatal-reference.json` is a direct, bounded GNU 5.3 capture generated by
`capture-fatal-reference.ts` with explicit executable and argv0 `shell`. Nothing
in the existing native oracle selects that executable implicitly. The capture
stores full scripts, raw stderr/stdout, status, files, environment, version and
binary hash. The shell's consistent diagnostic basename remains `shell`, not
any fixture's program name. Runtime diagnostics include source line numbers;
arithmetic diagnostics retain the expression and failing-token tail.

Required-parameter failures return 127 at top level (including functions), but
1 in isolated subshell/pipeline/substitution environments. Inline redirects keep
their established fatal-versus-command-failure boundaries; top-level external
inline-input failures now return 127 without aborting following outer commands.
Both native versions preserve earlier effects and reject recovery after fatal
arithmetic expansion; arithmetic command failures remain recoverable. Arithmetic
operand syntax is checked at evaluation, not treated as malformed outer shell
grammar. Source/depth limits and shell-delimiter validation remain upfront.

Updated owned tests retain all prior byte/file/scope checks while changing exact
status and diagnostic assertions to the captured modern values. Two old eager
arithmetic-operand assertions now check earlier effects plus fatal status 1.
Malformed ordinary substitution syntax in the current input unit is status 127,
not status 2. The old same-line Bash 3.2 differential remains unchanged and active:
it permits earlier effects that GNU 5.3 rejects.

The new newline-boundary capture is preserved in `input-units.test.ts` for the
separately assigned timing correction: GNU 5.3 executes `: >before;` before a
newline followed by malformed substitution. It was originally one of the 22
diagnostic captures; it is moved, not removed or waived, into its timing group.

## Complete input units

The separate timing group captures eleven bounded GNU 5.3 scripts in
`unit-reference.json`: same-line versus cross-line nested syntax, complete
compounds, continued and-or/pipelines, escaped/quoted newlines, queued heredocs,
exit/fatal stopping and shared input offsets. The previous no-effect assertion
for an invalid `if` following a completed heredoc unit now preserves the earlier
`marker` file and `body\n` output; all same-unit malformed-source controls remain.
No Bash 3.2 expectation or stress fixture is changed.

Runtime execution shares one state, budget and input cursor across units. Parsing
stops at the actual top-level newline token after its queued heredocs; it does
not split raw source strings on newlines. Future units are neither parsed nor
executed after exit/fatal completion. The public parse-only API still validates
the complete source, and the global source-size limit remains checked first.

## Final targeted checkpoint, 2026-08-26

The source checkpoint is `b4033fb96b353bf82025a28aafff6619066967dc`.
Its preceding semantic commits are `7ecd677` (moves), `e8abc84` (read),
`7a869af` (shortcut), `50cefdd` (patterns), `0aeaaf4` (ANSI-C), `1c66038`
(move scope), `19149d3` (diagnostics), `7367ce4` (input units), `3fe893b`
(read locale/closed input), and `f1c1167` (ANSI-C locale). No dependencies,
contract changes, independent expectation edits, or native-reference switches
were introduced by this work.

All test commands use `node --unhandled-rejections=strict --import tsx --test
--test-concurrency=1` followed by the paths listed below. Counts retain failures;
there were no skips, TODOs, or cancellations in these completed runs.

| Test paths | Result | Raw log under `/tmp/` |
| --- | --- | --- |
| `tests/shell/*.test.ts` | 614/616 pass; two external source-guard invalidations | `safe-bash-shell-final-owned.txt` |
| `tests/shell/inline-input-fatal-scope.test.ts` separate rerun | 30/30 pass | `safe-bash-shell-final-guard-rerun.txt` |
| `tests/shell-stress/{differential,lifecycle,process}.test.ts` | 100/105 pass; five failures | `safe-bash-shell-final-original-stress.txt` |
| `tests/shell-stress/targeted-holdout/*.test.ts` | 57/57 pass: 49 frozen GNU 5.3 cases and eight lifecycle tests | `safe-bash-shell-final-heldout.txt` |
| `tests/shell-stress/current-gaps/*.test.ts` | 9/13 pass; four failures, both cancellation probes pass | `safe-bash-shell-final-current-gaps.txt` |
| `npm run typecheck` | Exit 0 | `safe-bash-shell-final-typecheck.txt` |

The two owned-suite invalidations were the here-string subshell required-parameter
case and heredoc external arithmetic case. Whole-source fingerprints changed in
unowned diff-patch source and S3/SafeJS documentation while the suite ran; no
`src/shell` file changed. Before/after records are
`/tmp/safe-bash-shell-final-before.json` and
`/tmp/safe-bash-shell-final-after.json`. The affected file's separate clean rerun
does not turn the invalidated aggregate into a claimed 616/616 full-suite pass.
No source guards were weakened or rewritten.

The original five active failures remain precisely identified:

- `nested-substitution-syntax-error-does-not-prevent-earlier-effects`: incompatible
  Bash 3.2 same-unit effects/status versus pinned GNU 5.3 upfront rejection.
- `fatal-parameter-expansion-prevents-following-file-effect`,
  `fatal-arithmetic-expansion-prevents-following-file-effect`, and
  `fatal-expansion-in-substitution-stops-substitution-only`: diagnostic basename
  and source-line differences; stdout, status, and effects match.
- `command-substitution-removes-nul-bytes`: GNU 5.3 warning versus Bash 3.2's
  empty stderr; output bytes, status, and effects match.

The current-gaps failures are `move-output-really-closes-source`,
`move-input-really-closes-source`, and
`fatal-parameter-preserves-only-earlier-effects` (diagnostic basename/source line),
plus `prevalidation-prior-output-and-file` (the incompatible same-unit legacy
behavior). Independent fixtures remain unchanged and active; these outcomes are
not hidden, waived, or silently normalized into passes. The modern holdout uses
its independent symmetric extrinsic-prefix calibration, retaining meaningful
line numbers, diagnostic payloads, statuses, and effects.

This is a bounded targeted checkpoint for independent final review, not evidence
of full Bash compatibility, universal locale/binary-text support, superiority,
or completion of the requested work duration. The explicit text-model limits
documented above remain applicable.

## Deferred heredoc body correction

Independent final verification found one additional defect after the preceding
checkpoint: `printf before >before; false && cat <<EOF\n$(true |)\nEOF\nprintf
after >after` incorrectly failed during body collection. The raw independent
finding is `/tmp/safe-bash-shell-gaps-final-findings.txt`; complete observations
are `/tmp/safe-bash-shell-gaps-final-validation.json`. GNU 5.3 exits 0 with empty
outputs and both files, whereas the prior shell exited 127 without either file.

`deferred-heredoc-reference.json` contains 28 bounded, isolated native captures
from the same pinned GNU 5.3 executable, with exact scripts, raw output/status,
file bytes represented as text for these ASCII cases, environment, version and
binary hash. `capture-deferred-heredoc-reference.ts` regenerates that evidence
only with an explicitly supplied executable; no existing native helper changes.
The cases cover executed external/builtin/function/group redirections, skipped
branches and unused functions, malformed parameters and substitutions, quoted
literal controls, ordinary skipped substitutions, and skipped here-strings.

The implementation now stores collected bodies as raw data. Runtime expansion
parses/evaluates unquoted fragments incrementally in order, so earlier body
substitution effects survive a later bad parameter. A malformed `$()` body
substitution fails the redirection with status 1 and its native command-
substitution diagnostic; outer execution continues. A malformed but closed
backtick substitution fails only that child, producing empty substitution text;
remaining body expansion and the redirected command continue. Unterminated
backtick/arithmetic forms fail the redirection without becoming outer grammar
errors. Diagnostics retain captured line numbers and the actual failing source,
including the distinct compound-redirection location. No fixture names or
literal script-specific branches are used.

Complete-unit ordinary substitution validation, including unselected here-string
arguments, remains upfront with status 127 and no current-unit effects. Quoted
heredocs remain literal. The two obsolete owned eager-body syntax assertions now
retain the earlier marker and assert status 1: one is the executed redirection
failure, the other the unexecuted command's preceding `false`. No case is removed.
The depth assertion still rejects nesting above 64 with status 2 before executing
the redirected command; only its heredoc timing changes to retain the preceding
marker. Its here-string counterpart still rejects before any marker. Additional
controls retain source/expansion/substitution/command bounds, cumulative fragment
byte accounting, host and timer cancellation, and deferred nested EOF warnings.

Before source changes, the initial 26 native cases plus three safety controls
passed 5/29 and failed 24/29, recorded in
`/tmp/safe-bash-deferred-heredoc-before.txt`. The final two native delimiter-error
cases and nested-warning control subsequently failed before their corresponding
correction, while the timer-cancellation control passed; that intermediate run
was 30/33 in `/tmp/safe-bash-deferred-heredoc-boundaries-before.txt`. The corrected
33-case regression file plus the four existing inline-input limit controls passed
37/37 in `/tmp/safe-bash-deferred-heredoc-after.txt`. Broader post-fix validation
is recorded separately; preceding checkpoint counts are historical.

The post-fix focused heredoc/here-string/inline-input/fatal/unit/streaming run was
271/272 passing, with one external whole-source-guard invalidation in the
`read -r INPUT` prefix-assignment heredoc case and no observed semantic assertion
failure (`/tmp/safe-bash-deferred-heredoc-controls-final.txt`). The unchanged frozen
modern holdout passed 57/57 (`/tmp/safe-bash-deferred-heredoc-heldout.txt`). A fresh
global typecheck encountered an unowned error, TS2722 at
`tests/commands/diff-patch-stress/gnu-target-followup/helpers.ts:37`; the error is
recorded, not rewritten by the shell owner. A final full owned-suite run and
unchanged original stress rerun follow this source commit.

### Post-correction final validation

Source fix: `d0bf4ce6ccd4240fe937255a6b6a9676e535ff4e`. The single complete
post-fix owned-suite rerun passed **649/649**, with zero failures, skips, TODOs
or cancellations (`/tmp/safe-bash-deferred-heredoc-full-owned.txt`). This includes
all 33 new deferred-body tests and the focused prefix-assignment case previously
invalidated by an external source change. The frozen modern holdout remains
**57/57** passing on this source. Fresh final `npm run typecheck` exits 0 in
`/tmp/safe-bash-deferred-heredoc-final-typecheck.txt`; the earlier unowned typing
error was resolved outside this shell patch.

The unchanged original stress run records **99/105 pass, six failures**, not a
clean 100/105 aggregate (`/tmp/safe-bash-deferred-heredoc-original-stress.txt`).
Five are the same retained legacy differences enumerated above. The sixth,
`append-descriptor-observes-intervening-truncation`, is an external source-guard
invalidation, not a semantic assertion failure. A separate one-case replay
imports that unchanged fixture and its unchanged native/virtual helpers, passes
exact stdout/stderr/status/file comparison, and verifies a stable source hash
(`/tmp/safe-bash-deferred-heredoc-stress-guard-rerun.txt`). The original aggregate
and invalidation remain visible. Readonly current-gaps is unchanged at **9/13**,
with the same four legacy diagnostic/timing differences and both cancellation
probes passing (`/tmp/safe-bash-deferred-heredoc-current-gaps.txt`).

Whole-source before/after records are
`/tmp/safe-bash-deferred-heredoc-final-before.json` and
`/tmp/safe-bash-deferred-heredoc-final-after.json`. Only unowned
`src/commands/diff-patch/GNU-PATCH.md` and `src/commands/safejs/README.md` differ;
no shell source changed during validation. No guards, independent expectations,
fixtures, harnesses, contracts, dependencies, or manifests were changed. All
author-started validation commands finished. This remains a narrow correction
ready for independent review, not a broader compatibility or completion claim.
