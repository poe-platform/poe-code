# NUL diagnostic source contexts

Author evidence; independent acceptance remains required. Original old-nine
captures/tests and independent diagnostic-recheck fixtures are unchanged.

## Frozen controls and first fix

`diagnostic-context-native.json` freezes all25 author cases under each complete
profile before product edits. GNU Bash5.3 is the selected primary, Bash3.2 the
historical comparison, not a per-case oracle. The capture records executable
hash/version, C locale, OS argv0 bash, outer command name shell; nested bash uses
a temporary PATH symlink to that same profile's executable. No native product
processes or host PATH access are added. `/bin/cat` is a separately hashed native
test utility. Each oracle has a2500ms process-group deadline and256KiB output cap.
Temporary directories are removed after each capture; startup environment is
scrubbed by the existing bounded helper. Stdout/stderr are exact base64 bytes;
status and all regular-file effects are compared without normalization.

`diagnostic-context-red.json` preserves initial virtual3/25. The initial scratch
fixture used `/dev/null`, which the VFS does not provide implicitly; before source
edits this was transparently corrected to an ordinary scratch file, with its
bytes included in both observations. The earlier scratch capture remains at
`/tmp/safe-bash-diagnostic-context-native.json`; it is not the frozen acceptance
oracle. No existing fixture was modified.

The first source change renders NUL warnings using the existing script context,
and retains a function definition's source name on its copied body for later
calls, including functions defined by source/dot. Function registry kind and
function display remain unchanged. Author name controls10/10 and previous
source/dot/eval diagnostics48/48 pass. Line-mapping controls remain pending the
separate metadata fix. No other diagnostic policy or byte filtering is changed.

Reproduce from the repository root:

```sh
node --import tsx tests/shell/diagnostic-context-native.ts capture > /tmp/new-native.json
node --import tsx tests/shell/diagnostic-context-native.ts compare > /tmp/new-comparison.json
node --import tsx --test tests/shell/diagnostic-context.test.ts
```

The capture command does not overwrite the committed oracle. The comparison runs
virtual cases against both complete frozen profiles. Historical3.2 has no NUL
warnings and its differences are retained, not selected expectations or waivers.

## Warning-only line coordinates

First commit: `22ca649` (source names). The subsequent metadata commit is recorded
in the root handoff, not retroactively substituted for this initial red evidence.

The pinned GNU5.3 primary source's `parse.y` (`parse_comsub`, around4632) invokes
`print_comsub(parsed_command)`. `print_cmd.c:164` and its connection printer
preserve a newline connector once, not the original intervening blank/comment
lines. Semicolon, `&&`, `||` and pipe connectors print without continuation
newlines. Word text retains quoted newlines; nested dollar substitutions have
already undergone their own parse/print conversion. `subst.c` (`read_comsub`,
around6700) emits the warning while reading child bytes; `error.c` uses the
execution line and source name. Local pinned-source SHA256:

- `parse.y`: `076a16d00c5b065137b3d2730d2b94a1f6c89a1bbb5d2f4bd72d31e00947e27f`
- `print_cmd.c`: `7773f595d4ad23a05d480a2424164b7b9eede90a69ff9bb049d7b103a67d9552`

The implementation derives line spans and connector coordinates from the
existing parsed simple lists. It does not print/reparse command text or mutate
execution lines. A per-substitution map associates exact AST commands with their
warning coordinates, so a sourced/evaluated/new interpreter command does not
accidentally inherit another AST's mapping. Raw backtick coordinates are retained;
nested dollar word spans use their own parsed spans. Existing diagnosticOffset
and diagnosticLine still control parameter/arithmetic/FD diagnostics unchanged.
Redirection reconstruction preserves the separate warning metadata. No budget,
byte filtering, warning-count, cursor, cancellation or process-state policy changes.

This is deliberately NOT a general Bash command pretty-printer. Normalized line
metadata covers simple commands, ordinary redirections, lists, and-or and pipelines
with supported word spans. Compound command bodies, heredocs, redirect-only
commands and ANSI-C quoted words conservatively retain previous warning-line
handling; universal diagnostic fidelity for those forms is unproved. Their syntax
and execution remain available as before, not silently disabled or skipped.

## Validation and remaining boundaries

`diagnostic-context-validation.json` preserves source/case/native hashes, actual
TS import maps, pre-enumerated compiler-input counts/digests, mismatches, historical
comparison and the initial owned test-helper TypeScript failure. Detailed unique
guard maps and raw logs have separately recorded scratch paths/hashes. The durable
runner reproduces all checks without depending on those scratch files:

```sh
node tests/shell/diagnostic-context-verify.mjs /tmp/new-diagnostic-validation.json
```

- Author native25/25 GNU5.3 exact; historical1/25 exact (binary-stream control),
  with24 silent-NUL-warning differences preserved. Both whole native cohorts ran
  before product edits; no per-case native selection or stderr normalization.
- Author26/26 TAP includes25 native-backed cases plus one hard-bounded child with
  nine resource/state/origin/callback/cancellation checks and late rejection under
  strict unhandled-rejection handling. Initial author3/25 remains durable.
- Existing diagnostic/parser/descriptor/input controls171/171.
- Existing source/dot/eval86 plus prior diagnostics48 =134/134.
- Independent current-shell43 rows plus wrapper =44/44 TAP. Its nested children
  enforce their own source guards; our parent loader sees the test entrypoint.
- Global/build/benchmark noEmit final exits0/0/0, with1079/302/411 prelisted inputs,
  no unguarded compiler inputs and no changed hash guards. Initial global exit2
  was our fresh test's inline spawn options excess-property error; an inferred
  options object fixes typing without casts/ignores or runtime behavior changes.
  Initial build/benchmark were already0; all observations remain recorded.

No frozen independent NUL or original old-nine rerun is claimed here: root routes
those after source freeze. The original nine remain original-profile losses,
not modern fixes or waivers; the independent pre-edit GNU5.3/shell88/88 evidence
and its unrelated unimported-S3 hook failure remain separate. Five custom
first-read requirements and broader syntax/diagnostic parity remain open.
Accounting and environment-ordering policy are untouched. No public export
names, contracts, dependencies or manifests changed. This bounded author result
requires different-agent acceptance; it is not full Bash or superiority.
