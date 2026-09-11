# Issue 693: bounded select loops

## Validated scope

Support `select NAME in LIST; do BODY; done`, including an omitted list using
the current positional parameters. The initial maintained memory-only tests
failed 11/11 because the parser rejected select. Evidence:
`/tmp/poe-693-red.log`; the independent public Shell reproduction is
`/tmp/poe-693-public-red.log`.

This adds stream-driven menu selection, not terminal editing, job control,
traps, process substitution, or a native shell fallback. The parser reuses the
existing for-list grammar and parse admission. Function display retains the
new compound command's syntax.

## Behavior

The list expands once using existing field, pathname and owned-byte expansion.
Menus and the literal PS3 value go to stderr; PS3 defaults to `#? ` and is read
again between body executions. Numbered selection uses decimal input with
optional sign and surrounding ASCII whitespace. REPLY retains the input after
read-style backslash processing and NUL removal, independently of IFS.
Invalid selections execute the body with an empty selected variable. Blank
replies redraw the menu without executing the body; clearing REPLY in the body
also requests a redraw. Selected items and REPLY retain original bytes.

EOF, including an unterminated final reply, publishes REPLY, leaves the selected
variable unchanged, emits a newline on stdout and returns status 1. An empty
list returns 0 without reading or writing. Existing break/continue/return,
loop-depth restoration, readonly assignment and body status paths remain shared
with other compound commands. The body consumes the same input cursor, so read
and nested loops observe the remaining bytes.

GNU Bash 5.2.37 on Darwin supplied the exact oracle. Records are
`/tmp/poe-693-select-oracle.json`, `/tmp/poe-693-select-edge-oracle.json`,
`/tmp/poe-693-select-readonly-oracle.json`,
`/tmp/poe-693-select-bytes-oracle.json` and `/tmp/poe-693-menu-oracle.json`.
Menu geometry follows the qualified column-major algorithm with eight-column
tab stops, COLUMNS/default 80, and the single-row-to-single-column rule.
The C raw-menu sizing/indentation behavior was qualified from exact output;
it is not inferred solely from the available GNU source. UTF-8 layout handles
combining/format characters and common wide CJK/emoji ranges. Locale-dependent
Unicode display width is not a guarantee of identical behavior across every
host libc/Unicode revision; item bytes are never modified for alignment.

## Bounds and ownership

Every prompt/read attempt consumes the shared maxLoopIterations budget,
including blank replies. Menu scans and numeric input classification share a
cooperative work budget. Menu bytes, decoded text and item metadata are admitted
before retention; decode processes bounded chunks and preserves unrelated
decoder failures. Writes are awaited, retaining output limits/backpressure.

Select has a dedicated byte-preserving line reader on the existing ShellInput
cursor; the read builtin is unchanged. It scans at most 1024 bytes per turn,
admits buffers/fragment metadata before allocation, retains owned byte values,
and concatenates once per reply. Existing input/output and value-allocation
limits bound long lines, retained fragments and work. The original abort reason
is propagated, body dispatch stops on cancellation, and the existing invocation
input ownership closes the cursor. No new limit configuration is introduced.

## Focused validation

The final select tests pass 26/26 in 444 ms:
`/tmp/poe-693-final-focused.log`. They cover menu/prompt output, valid/invalid/
blank/EOF replies, positionals, raw bytes and chunk boundaries, function
display, one-time list expansion, shared input, nested break, live false/object
cancellation with cleanup/recovery, backpressure and loop/field/output/command
limits. Tests use memory only. Initial raw test fixtures accidentally called
unregistered printf and were corrected to an explicit byte-observation command;
the independent installed-style consumer uses the actual public printf.

The select/language/input-closure cohort passes 286/286 in
`/tmp/poe-693-cohort.log`; exact test admission passes 100/100 in
`/tmp/poe-693-admission.log`. The additional shell-io cohort initially passed
109/110: its existing here-string substitution test still expected lossy
U+FFFD replacement after issue 694's validated exact-byte preservation change.
The original failure is retained in `/tmp/poe-693-read-cohort.log`; it is not
counted as a passing cohort.
The here-string assertion was then corrected to exact `FF C3 A9 80 0A`,
qualified against native Bash in `/tmp/poe-693-here-string-byte-oracle.json`.
This is a narrow test correction for issue 694's existing byte contract, not a
select production change. The first rerun collided with the normal build's
temporarily absent dependency bundle (`/tmp/poe-693-read-cohort-green.log`) and
did not run the cohort. After the normal build completed, final verification
passed 110/110 in `/tmp/poe-693-read-cohort-final.log`.

Strict NodeNext checking passed in `/tmp/poe-693-final-types.log` using:

```sh
node ../../node_modules/typescript/bin/tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --types node tests/shell/select.test.ts
```

The root's 43-case source consumer passes, including buffered/single-byte input,
raw C/UTF-8 menus/replies and cancellation/budget controls. Independent review
approved the implementation. The root owns the final normal build, actual
installed Node/Bun/browser/workerd qualification, visual inspection, guarded
lint and atomic delivery; local results do not establish those later stages.


## Final integration gates

After the private-context correction, the maintained normal build passed
(`/tmp/poe-693-final-build.log`). The refreshed candidate at
`/private/tmp/poe-693-final-komeyey_` passed 122 checks each on Node, Bun,
browser and actual workerd: 74 parameter-transform checks and 48 select/public
boundary checks. All three strict public type profiles passed, as did the
45/44-input browser/workerd graph checks. Retained middleware contexts remain
free of private symbols. The root inspected the representative select menu
screenshot at `/private/tmp/poe-693-public-m78ufcq6/screenshots/node-demo.mjs.png`.

The final maintained `npm run lint` passed in 169.41 seconds: all 10,518
configured files, zero errors, zero warnings and 25 receipts, followed by
successful type and workflow checks (`/tmp/poe-693-final-lint.log`). No
repository files changed while the gate ran. The earlier 144.25-second lint
run was deliberately terminated for the validated private-context repair and
is not counted as a passing gate. These local checks do not establish release
publication.
