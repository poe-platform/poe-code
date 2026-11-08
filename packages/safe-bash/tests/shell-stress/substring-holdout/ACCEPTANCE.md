# Initial independent substring acceptance — August27,2026

## Source and execution identity

ROOT resumed this leaf after READY for
`f1bb98b4ec8fd9cc198959e85f96e38880e72243`. The notice explicitly relinquishes
the source write lease. Current and committed hashes were checked before import:

- Runtime: `e8f1edb842d04498050d314091269974df157b11ab13cabba41d9c84a0191538`.
- Parser: `feb6cbb2f03ec0c409adeb816bec506788fb3014a23c8dd02f4002362dc4b9f2`.

All seven original29a6795 files remain byte-identical; cases, host controls and
all96 native observations are reused unchanged. Binary/locale-tool/helper hashes
were rechecked; **no native recapture** occurred. No author expectations supplied
the oracle. New source inspection was limited to the exact feature diff and
relevant parser/runtime/arithmetic paths after the independent freeze.

One complete run at **04:56:11.374–04:56:37.516 UTC** executed all24 cases once
under each of four comparison profiles, then both unchanged host controls once.
The same virtual Bash implementation is compared to modern/historical references;
the historical label does not select a fabricated Bash3.2 runtime mode.

Every native-row product invocation is uniformly `bash -c SOURCE shell`, with
exact original source bytes and positional args confirmed at actual middleware
dispatch. Native `--noprofile --norc` only disables host startup files; virtual
interpreters have no host startup loading and reject those flags, so they are
not forwarded. That fixed setup difference is recorded for every row, not varied
to improve diagnostics. The frozen native shell name remains `shell`, and each
VFS cwd exactly equals its archived native cwd string. Environment/stdin and
seeded0644 fixture bytes match. No output/name/path/encoding normalization occurs.

## Exact results, with full effects

| Reference profile | Exact/accepted | Fail | Guard-invalid |
| --- | --- | --- | --- |
| GNU5.3 / C |20/24|4|0|
| GNU5.3 / en_US.UTF-8 |23/24|1|0|
| Historical3.2 / C |15/24|9|0|
| Historical3.2 / en_US.UTF-8 |18/24|6|0|
| Frozen host controls |2/2|0|0|

These are96 comparisons of24 unique recipes, not96 unique cases. Exact matches
include correctly reproduced native failures; they are not merely status0 counts.
All **96/96 relative namespace/file effects, including modes, match**. No
creation-mode difference happens in these seeded-file recipes; this does not
close the separately known0666-vs0644 creation-policy gap. Zero skips, xfails,
timeouts, overflows, child signals, native-unavailable or waived unsupported rows.
The strict driver exits1 because exact losses remain.

### Additional diagnostic finding: invalid octal

`invalid-octal-offset` is a newly observed exact mismatch in both modern locales
and both historical comparisons, beyond the declared invalid-UTF8 limitation.
Reproduction is the unchanged recipe, with phase initially `seed`, mode0644:

```bash
printf before > phase; VALUE=abcdefghij; printf "<%s>" "${VALUE:08:2}"; printf after > phase
```

GNU5.3 expected stderr:

```text
shell: line 1: VALUE: 08: value too great for base (error token is "08")
```

Actual stderr:

```text
shell: line 1: VALUE: 08: arithmetic syntax error: operand expected (error token is "8")
```

Both have empty stdout, status1 and phase=`before` mode0644, with no trailing
effects. This is an **error-classification/token-fidelity gap**, not a demonstrated
new successful-substring/state corruption. It remains an exact FAIL, not a waiver.

Read-only audit: `src/shell/arithmetic.ts` integer() detects invalid octal, but
parseArithmetic() catches the numeric error and replaces it with Invalid
arithmetic operand. evaluateArithmetic() renders operand-expected and token8;
the new substring path delegates to those existing helpers. The arithmetic file
is byte-identical to baseline3243c5a, SHA-256
`5e2d784b8fd333972e6e413f4c3478163462a3c1abf8cc5ff7173963420440bd`.
Thus this is pre-existing helper diagnostic behavior newly exposed here, not
proof f1bb98b introduced that helper defect. No extra baseline product execution
was needed for this provenance claim. ROOT decides whether/how to route it;
this leaf makes no source fix, warning-policy change or expectation adjustment.

### Declared C-byte gaps remain actual failures

The three C-only cases `unicode-single-boundaries`, `unicode-negative-and-tail`
and `combining-codepoints-not-graphemes` all return explicit fatal1 rather than
native0/raw byte slices. Expected stdout hex is respectively:

```text
3cc33e7c3ce73e
3c823e7c3ca9e78cabf09f99825a3e
347c3ccc3e7c3ccc813e
```

Actual stdout is empty, with `substring expansion splits a UTF-8 character in a
byte locale` stderr. They are **native FAILS**, not successful unsupported-error
characterizations. UTF-8 versions match exactly. The combining case also exposes
the frozen C character/byte distinction, but execution aborts before printf, so
this run does not independently isolate its length field from the slice error.

Historical losses additionally include negative-length endpoint behavior,
inverted-length diagnostics, nested-default operands, division-error diagnostics
and malformed-expansion diagnostics. The frozen native captures already expose
these version differences. Historical behavior does not override the modern
profile; all losses remain in their own denominators. No other incorrect
successful-output/state/field/effect result was observed within these24 recipes;
this does not cover untested readonly/array/special-parameter or broader grammar.

## Host controls and guards

Both original hosts pass: typed maxExpansionBytes denial with no output/marks;
and offset-command cancellation retaining the caller's exact reason, entering
the host command, observing its late rejection and preventing trailing effects.
No accepted accounting/head0/custom-first-read suite is rerun. Product subprocess
entry points are trapped before library import; no forbidden call is recorded.

Each of98 executions has before/load/after source and fixed-file guards:
**172 source files,187 fixed snapshot inputs,135 actual source imports per row**.
All imported sources equal committed f1bb98b bytes; runtime/parser match READY.
Seven stable stream-inspection files are present in the worktree but absent from
f1bb98b; none is imported. They remain explicit non-shell provenance differences.
Per-row changes/mismatches and overall input endpoint drift are zero.

HEAD moved from `4af1b107d4b9449a2c4e7fed467d187448392fd5` to
`aba917c69ba949ffaa5f844b4181c713415fe891` during foreign work. Exact statuses,
index observations, inventories and hash maps are retained; stable measured
inputs are **not a clean aggregate-product claim**. All child groups are absent
and the owned trace directory is removed. No SIGSTOP, watcher, source edit,
product rerun or polling follows this initial checkpoint.

## Evidence and handoff

- `acceptance-f1bb98b.json`: all raw child results, tuples, actual argv/cwd/env,
  per-row manifests/imports/guards, READY and fixed-source provenance.
- `acceptance-audit.json`: classified losses, exact tuple evidence, immutable
  original-file checks and source-helper audit. A postprocessing script's stray
  patch-marker syntax error is preserved; it caused no product rerun or edits.
- `acceptance.mjs` and `acceptance-product.mjs`: modest bounded replay driver,
  reusing the existing pinned child helper and actual import trace.

Existing integrity tests pass3/3; new drivers pass syntax checks. No global
typecheck/build or original36+72/core/FS/old9/custom5/accepted-accounting run.
To reproduce after ROOT explicitly authorizes a source snapshot and verifies its
READY/hash mapping, use a fresh output filename:

```sh
node tests/shell-stress/substring-holdout/acceptance.mjs acceptance-new-date.json
```

The current driver deliberately pins f1bb98b; a later source update requires a
separately documented READY integration, never an oracle change. ROOT received
initial profile counts before documentation completion, and the additional
diagnostic finding is routed in `/tmp/safe-bash-substring-holdout-findings.txt`.
This checkpoint freezes partial exact acceptance and then stops. No full scalar
family, complete Bash/kernel parity, broader lifecycle closure or superiority.
