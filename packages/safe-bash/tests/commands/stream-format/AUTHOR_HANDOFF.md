# Four-command source-only author handoff

## Ownership and dispatch evidence

Root scope release was read from `/tmp/safe-bash-stream-next-format.ready`.
Only `src/commands/stream-format/**`, `tests/commands/stream-format/**` and
`tests/commands/stream-format-author-stress/**` are owned. No split implementation,
root export, package subpath, aggregate factory, existing stream-inspection tool,
grep/regex engine, root README or ledger edit was made by this author.

At discovery HEAD `a4c7824ef62e5e053218c234c373d93999ff46c9` the shared worktree
had unrelated dirty shell files. Actual `Shell + agentCommands()` dispatch ran
`seq 1 3`, `nl /input`, `rev /input`, `unexpand /input`, `split /input /piece`.
Each returned127, empty stdout, and exactly
`shell: line 1: NAME: command not found\n`. `/input` remained hex
`6162630a2020780a`; the before/after root listing contained only that file.
The actual initialized registry and `createAgentCommands()` both counted60.
Existing stream-inspection names were exactly tac, expand, fold, strings.
Author contract tests re-execute all five absent default dispatches and confirm60;
explicitly installing the new plugin gives64 in that Shell only, not new defaults.

## Atomic commits and API

- `3722afb`: minimal local bounded session/byte helpers only.
- `8e0f7b1`: seq source, tests, initial native evidence and opt-in entry.
- `e7093c4`: nl source, tests, native evidence and original zero-join failure.
- `44f9736`: rev source, tests and actual Apple locale/error controls.
- `752d6df`: unexpand source, tests and native tab controls.
- `98a28f1`: seq native-format correction and regression evidence.

The source-only entry `src/commands/stream-format/index.ts` exports
`createStreamFormatCommands(options?)`, `streamFormatCommands(options?)`,
`StreamFormatCommandsOptions`, and `StreamFormatLimits`. The factory returns
seq, nl, rev, unexpand. Plugin name is `stream-format-commands`; collision
preflight precedes registration; `replace` is one intentional policy.
No public package/export or default-support claim is made.

Final positive-safe-integer per-invocation limits: input33554432,
output67108864, record8388608, chunk1048576, files64, steps268435456,
argumentBytes65536, numericDigits4096. Option keys use `max` prefixes exactly as
declared in shared.ts. These do not replace the enclosing Shell's shared budgets.

## Validation and native counts

At the source freeze, all144 owned tests passed, no skips/TODOs. This includes
author tests and author stress, not independent proof. The native denominator is
116 actual cases, not144: remaining tests exercise contracts/integration/limits.
`evidence/freeze-native.json` records every argv/input byte, locale, native and
virtual status/stdout/stderr, reference identity/hash, product source hashes and
host platform. Counts below are exact stderr-inclusive versus selected semantic:

| Tool | Native cases | Strict status/stdout/stderr | Selected semantic |
| --- | ---: | ---: | ---: |
| seq | 37 | 29 | 37 |
| nl | 30 | 24 | 30 |
| rev | 19 | 17 | 19 |
| unexpand | 30 | 24 | 30 |
| Total | 116 | 94 | 116 |

Selected semantic means identical status and stdout plus identical stderr
presence, not identical diagnostics. The22 remaining exact diagnostic differences
are retained, not silently waived. Read-only command cases do not write VFS files.
No time/performance comparison or universal native parity is claimed.

GNU references are the existing read-only coreutils9.7 executables under
`tests/commands/metadata-stress/.oracle/coreutils-9.7/src` on Darwin25.4.0 arm64.
This is not GNU/Linux evidence. Rev is `/usr/bin/rev`, Apple/BSD-derived, not
coreutils and not util-linux. No reference was installed/rebuilt. Explicit C,
POSIX, UTF-8 and environment-cleared rev controls are recorded. Host Node22.22.2.
The existing second GNU directory was discovered but not used for these cohorts.

Validation commands, scoped to author-owned entry/tests:

```sh
node --import tsx --test tests/commands/stream-format/*.test.ts tests/commands/stream-format-author-stress/*.test.ts
node_modules/.bin/tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck src/commands/stream-format/*.ts tests/commands/stream-format/*.ts tests/commands/stream-format-author-stress/*.ts
node_modules/.bin/tsc --declaration --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck --rootDir src --outDir tests/commands/stream-format-author-stress/.build src/commands/stream-format/index.ts
node --import tsx tests/commands/stream-format-author-stress/verify.mjs
```

NoEmit and the owned-output ESM/declaration build passed. The emitted plugin was
actually loaded into the source Shell: `seq 3 | rev | nl -w2 -s: | unexpand`
returned0, empty stderr, stdout ` 1:1\n 2:2\n 3:3\n`; compiled factory names were
the four assigned commands and the default factory still60. Root dist was not
emitted. Temporary owned .build output is removed after this check.
The verifier imports author-case modules, so it also runs20 already-counted author
tests; these are not additional independent cases. Optional report path is limited
to new JSON files inside the two owned evidence directories and uses apply_patch.

## Preserved failures and actual limits

`evidence/nl-original-failure.json` preserves the original incorrect negative
fixture for GNU `-l0`, actual native success, and original source failure. A
nonempty native probe proved zero means one; source and fixture were corrected
separately and the original was retained. The temporary unrelated rg.ts transform
failure during concurrent work is recorded, not fixed by this author.

`evidence/seq-format-original-failures.json` preserves six concrete native
format/negative-zero failures before correction and an intermediate two-rounding
JavaScript vs observed Darwin fused-arithmetic difference. The exact decimal-only
formatter was not simply relabeled superior: explicit formatting now follows the
measured binary64 path, and all9 targeted regression controls match strictly.
Unformatted arbitrary decimal progression remains exact/bounded and deliberately
separate from platform floating arithmetic. This extension is not evidence of
matching every GNU floating edge. `%a`, hex/nonfinite operands, locale numeric
punctuation and x86 extended precision are not supported profiles.

`stream-format-author-stress/harness-corrections.json` preserves three initial
contract harness mistakes and the typed VFS fixture correction. The actual Shell
rejects on collision/cancellation/budget errors; middleware must return the next
result. No product change was used to conceal those fixture defects. The first
ad-hoc TypeScript command omitted `--lib ES2023` and hit unrelated WebDAV DOM
RequestInit.duplex; the corrected project-equivalent scope passes, no WebDAV edit.

Rev follows actual Apple malformed UTF-8 behavior: emit the reversed nonempty
valid prefix plus LF, report failure, skip the rest of that file, continue later
operands. It never inserts replacement characters. C/POSIX/unset guest locale
reverse raw bytes; explicit UTF-8 reverses code points, not graphemes. Other
encoding locales fail explicitly; explicit `-` is an Apple-style literal file.

Unexpand uses byte columns and ASCII space/tab classification. It is not a
Unicode display-width implementation. NL counts bytes for field separators and
matches byte/C-locale BRE. The subtree README lists actual flags and bounds.

## nl matcher capability evidence

Read-only reused source identities are in freeze-native.json:
`text-programs/regex.ts` sha256
`23df19386627659c3a5175562a2f8eeda873b81e3dc3e78d3cf51aafa7b3b06f`;
`text-programs/shared.ts` sha256
`fec28a956be858e725811f9e83a7f325d99d3152da0231af0d619847e8e6206e`.
`Pattern(source, false).find(text, budget)` executes its own instruction machine,
not a user-pattern native RegExp. Position/transition loops and backreference
byte comparisons call Budget.step; queued/visited state storage checks
maxBufferBytes. Compilation limits pattern length8192, depth64, instructions16384,
repetition1000. The local PatternBudget override charges Session.charge and thus
the same invocation step counter as input/output work; state cap is maxRecordBytes.
The author adversarial repeated-pattern control fails at configured1000steps.
No inherited regex source changes or new regex engine were made.

Matching is synchronous: instruction signal checks see an already-aborted signal,
but a timer cannot run midmatch. Cooperative event-loop yields occur in surrounding
input/output work, not arbitrary host/native preemption. The work cap is the bound
for an in-progress match; lower maxSteps should be selected for hostile patterns.
No equivalence/collation classes or Unicode locale matching are claimed.

Primary documentation was checked through web.run: official GNU seq/nl/unexpand
manual pages (live manual labels9.11, not the pinned runtime), Apple text_cmds
rev source, and the upstream util-linux rev manual. Actual pinned binaries, not
live documentation version assumptions, determine these native controls.

## Coordination

The independent verifier's hidden fixtures/corpus were not inspected. This source
freeze is separate from Plato's prior e36dab2 fullgate. Root subsequently
authorized normal author closure in `/tmp/safe-bash-stream-next-author-close-order.txt`
and `/tmp/safe-bash-stream-next-format-close.ready`: independent product execution
must wait until root observes both authors actually exited. This author closes
after completed validation/evidence, not after independent review. No full completion,72-hour duration, superiority,
default65 integration or next-tool claim is made. Concurrent owners' staged,
dirty and temporary native files remain untouched.
