# Column author handoff — frozen for independent verification

Author ownership: only new `src/commands/column/**` and
`tests/commands/column/**`. Root exports/package/default registration, AGENTS,
shared table-text readers and all other owners' sources were left untouched.
`/tmp/safe-bash-column-api.txt` carries the early API/progress report.

## Candidate and checks

Frozen owned source digest (SHA-256 of the ordered source-path/hash object):
`62fa56a685eb5a4850b6fa782266a2f5d21b8c9335f4f0f030f4f5767e1bfdb2`.

`author-verification.json` records all five source hashes, a 199-entry source /
configuration / owned-input snapshot, full command arguments/output/status, and
no changes during checks. The check-time base was
`a767c48eb477cf3248febaeb21d266d0bf5a3362`; new owned files were uncommitted during
that run. The enclosing author commit freezes them afterward. Historical root
commits changed concurrently before the final check; no claim is made that the
initial checkout head was the final candidate. Snapshot inventory is not proof
of tests or consumers outside this column scope.

- `node --import tsx --test tests/commands/column/*.test.ts`: **113/113**,
  zero failures, cancelled, skipped or TODO tests.
- `node tests/commands/column/capture-native.mjs --verify`: all **28** raw
  pinned BSD records reproduced; this is not 28 native parity passes.
- Scoped strict NodeNext `tsc --noEmit` over every owned `.ts` test/helper:
  passed. Exact flags/file list are in the evidence JSON.
- `npm run build`: passed. No unrelated baseline build/type failures observed;
  no full repository runtime/typecheck-all gate was run.
- Direct built ESM command invocation: passed. This is **not** packed standalone
  or public package-subpath acceptance.
- Scoped `git diff --check`: passed; final owned staged patch also checked.

Verification artifact SHA-256:
`3de8a1ccc14137b42624d365199f8f96ff08164234efbc7bce08f369e7bc39c3`.
Native record artifact SHA-256:
`b08e377cd1c4f6eb8089512ac6c8ebdaaf603a2f310b39e882385c8608d00810`.
`verify-author.mjs` and capture without `--verify` refuse overwriting existing
evidence; reruns must use a new explicit evidence destination/revision rather
than deleting history. Standard tests and native `--verify` remain rerunnable.

## API and bounds

Internal module `src/commands/column/index.ts` exports `columnCommands`,
`createColumnCommands`, `createColumnCommand`, `ColumnCommandsOptions`,
`ColumnLimits`. Options: `replace?: boolean`, `limits?: Partial<ColumnLimits>`.
No root/public integration has happened. `column -t`, `-s`, `-o`, `-c`, `-x`,
documented long aliases, help and `--` are implemented. Source README gives
complete parsing, Unicode, tab, multi-file, partial-output and unsupported-option
profiles. The command uses existing table-text readers/budget APIs through a
local cleanup/ownership wrapper, with no shared edits and no product dependencies.

Default limits:

| Setting | Default |
| --- | ---: |
| Input / stdout bytes | 8,388,608 / 16,777,216 |
| Diagnostic bytes | 65,536 |
| Record / chunk bytes | 65,536 / 1,048,576 |
| Rows / cumulative cells | 50,000 / 250,000 |
| Fields per row / operands | 1,024 / 64 |
| Work steps / argv bytes | 4,000,000 / 65,536 |
| Expanded cell/requested fill width | 65,536 |

All limits accept positive integers up to 67,108,864. No recursive format exists,
so no depth option is invented. Default fill width is 80, reduced when the host
configures a lower `maxWidth`. stdout and diagnostics have separate cumulative
budgets. Padding admission precedes allocation. Empty records count toward rows.

## Native profile and preserved failures

Executable `/usr/bin/column` is **Apple/Darwin BSD**, macOS 26.4.1 build 25E253,
arm64; `-V` is unsupported and its raw probe is preserved. Binary SHA-256:
`c6d7b469d8e8437c7185bedd356626ca69867c9c6b002cbb0020d995a6e4cc5f`.
Native stdin/file/output/stderr bytes, argv, locale and man hash are recorded.
No native download/build/install was needed. Primary util-linux manual and v2.41
source were inspected, but no util-linux executable was tested.

Effective 28-case classification: **15 exact**, **9 qualified divergences**,
**2 BSD-unsupported options**, **2 product-unsupported features**. Original
`cases.json` and raw `native.json` retain the initial 17-exact classification;
`qualifications.json` explicitly records the two failed assumptions and corrects
the effective denominator. They concern short unterminated records, which BSD
rejects as “line too long” while the product accepts them. All input bytes remain
unchanged. Unsupported/qualified checks assert product behavior only, not parity.

Author fixture/type mistakes, their failing counts, and exact corrections are in
`author-corrections.json`. No global diagnostic assertion relaxation occurred.
There are no native scratch directories left by the capture script; no other
workers' native artifacts were removed.

## Required verifier attention / known limits

- **Shell-owned external stdin:** `ShellInput` exposes no iterator `return`.
  The original actual-Shell probe settled exec/dispose before its hidden external
  return gate completed. This is preserved/reported, not fixed outside ownership.
  Column cleanup does await directly supplied sources and its owned VFS streams;
  actual Shell/VFS disposal, delayed return, overlapping cleanup, cancellation,
  late host rejections, backpressure and borrowed Buffer reuse have tests.
- Opaque stat/next/write work cannot be forcibly stopped; late rejection is
  observed. A genuinely uncooperative registered iterator return can delay exit.
- Fixed scalar-width ranges are deterministic but not full Unicode wcwidth or
  grapheme/terminal semantics. Invalid UTF-8 and retained controls are rejected;
  retained tabs expand, and fill padding emits tabs. No ambient locale/terminal.
- Table mode buffers all input, ignores `-c` for truncation, and supports no
  headers/JSON/tree/wrap/color/selection. Missing opens continue; read/format
  failures abort before layout, rendering failures may leave an output prefix.
- VFS without readStream has the documented maxChunkBytes readFile fallback cap.
- No full gate, provider deployment acceptance, superiority comparison,
  performance claim, packed consumer or public integration. No 72-hour-duration
  claim. `du` remains deferred.

After the atomic author commit the author stops source changes. A **different
verifier** now owns frozen holdouts, stress/fix decisions and packed standalone
acceptance; public/root integration belongs to the assigned integration owner.
