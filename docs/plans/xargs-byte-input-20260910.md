# Xargs delimited byte input — September 10, 2026

## Scope

Fix the independently reproduced `xargs -0` UTF-8 decoding failure without
changing runtime/parser or the frozen 215-case review corpus. Delimited input
(`-0` and the existing ASCII `-d` path) is bytes, not repaired text. Keep the
existing default quoted-input grammar and invocation lifecycle.

## Design

- Scan bounded tokens, preserve empty records and an unterminated final record,
  and copy retained producer data before the next pull.
- Admit token/batch/expanded argument bytes, including terminating NUL costs,
  before materializing child argv. Keep the existing 128 KiB maximum and `-P`
  capacity/backpressure/cleanup behavior.
- Replace literal patterns without decoding byte input; preflight output sizes
  and bound matching work. Record exact value-consumption indices and attached
  offsets with an optional shared `options` callback; old callers are unchanged.
  Xargs option prefixes are ASCII, so their parser string offsets are also byte
  offsets. Recover the authoritative pattern from the owned argument carrier,
  never by comparing decoded strings or rescanning argv. Yield during long scans
  for cancellation.
- Keep public options unchanged. Do not claim full GNU option/diagnostic parity:
  existing default-input UTF-8 restrictions, ASCII-only `-d`, and diagnostic
  quoting remain explicit bounded profiles. Invalid-byte verbose arguments use
  tagged ANSI-C octal escapes rather than GNU shell-escape quoting. This avoids
  aliasing invalid bytes with literal ASCII backslash/octal text. Emit the exact
  native ineffective `-E` warning (including its double newline) with `-0`/`-d`,
  before input admission and through the existing diagnostic output budget. An embedded
  NUL with a non-NUL delimiter is explicitly refused, not silently truncated.
  Never display repaired raw bytes.

## TDD and evidence

Native comparator: installed GNU findutils 4.7.0-1ubuntu1. Ubuntu DSC-bound
source archives and utility paths are in `/tmp/issue683-xargs-source-m1zo7w49`;
the sole Debian patch affects a find testsuite, not xargs. Read `read_line`,
`read_string`, invocation dispatch, `bc_do_insert`, and `bc_push_arg` before
implementation. This is tokenizer/build-command coverage, not full source or
codec/native-process parity.

Tiny native receipts (including differences, not normalized passes):
`/home/kjopek/project/poe-code-unit-55fyhF/issue683-xargs-native-14cn2lfd/results.json`.
Canonical tests use only memory filesystems and embedded exact bytes.

Capture focused failure first, then validate byte oracles, producer reuse,
replacement amplification, argument/byte bounds, falsey cancellation and
parallel drains. Run existing execution/xargs suites and unchanged independent
215-case corpus, focused types, and report exact logs/hashes. No builds, Git,
shared discovery, exports or frozen-test edits.

## Additional preserved evidence

Raw pattern identity and verbose ambiguity: 19 tests initially 6 pass / 13 fail,
`/tmp/issue683-xargs-pattern-red-v1.log`; the case file stays unchanged. Native
receipt: `/home/kjopek/project/poe-code-unit-55fyhF/issue683-xargs-pattern-native-5s5vljbt/results.json`.
Value-origin callback controls: `/tmp/issue683-xargs-options-red-v1.log` (9 red /
1 control before callback implementation).

Warning receipts: `/home/kjopek/project/poe-code-unit-55fyhF/issue683-xargs-warning-native-989yzbdj/results.json`.
Preserved warning red v1 contains an additional fixture-only Buffer/Uint8Array
prototype comparison error; v2 compares exact hex bytes, keeps all cases, and
captures the actual missing-warning/budget failures before the production fix.

Control-byte trace holdouts: `/tmp/issue683-xargs-trace-controls-red-v1.log`
contains two real replay failures and two controls; ANSI-C quoting also covers
decoded C0/C1 controls before diagnostic escaping. Native receipts are in
`/home/kjopek/project/poe-code-unit-55fyhF/issue683-xargs-trace-native-_y0ip6l_/results.json`.
Remaining exact trace differences: GNU uses additional empty-quote segments,
mnemonic escapes for some controls, locale-dependent quoting of valid Unicode,
and a trailing separator before newline. Our trace preserves/replays the tested
argv bytes but is not byte-identical GNU stderr. The warning comparison is exact
with comparator argv[0] set to `xargs`; earlier absolute-path comparator prefixes
are preserved in their original receipts, not normalized away.
