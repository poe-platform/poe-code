# Concrete cap/error decision before implementation

2026-08-29. Source preparation only; zero product/native/build/test/Worker runs.
No production files edited. This is the narrow decision requested by root if an
existing limit mechanism cannot accurately represent the approved new cap.

## Frozen binding verified

Unit2 manifest SHA256
`75ac56902fdce22f8292c17c14d48287063a5544c46ac8c526b5d4572143bde2`,
derived tree `26215b99cb379a9f825f803454f758fab5a3c8e9`.
Current owned parser/runtime/display bytes match that manifest exactly, as
recorded by PREP.json. Unit2 remains provisional, its original fixtures untouched.
Raw source-preparation status/index captures retained at the PREP.json root.

## Source fact

* `src/shell/types.ts:18` enumerates ShellLimits; none represents conditional
  nodes. `:63` ShellLimitError accepts only `keyof ShellLimits`.
* `src/shell/runtime.ts:80` Budget.fail accepts that same union and aborts the
  shared budget controller with the resulting ShellLimitError.
* `src/shell/parser.ts:118` and `:591` currently classify the existing syntax
  nesting64 boundary as ShellSyntaxError, not ShellLimitError.
* `src/shell/shell.ts:279` maps ShellSyntaxError at the public parse boundary;
  an unrelated new parser error would instead escape as a rejection. That file
  and public types are outside this unit's authorized production write set.

Thus using `maxSourceBytes` or `maxExpansionBytes` as the label for a4096-node
parse cap would be inaccurate. A cast/new public limit key would violate scope.
Depth64 already has a syntax-admission precedent; node4096 needs an explicit
classification, not an invented resource label.

## Recommended choice A: fixed syntactic-complexity admission

Root explicitly classify node4096 and conditional parse-depth64 as limits of the
supported grammar, reported through existing ShellSyntaxError with truthful
reasons `Conditional syntax exceeds 4096 nodes` / `Conditional syntax nesting
exceeds 64`, and the source offset. Check before constructing each node/entering
the additional level. Public Shell behavior then follows existing syntax-error
status2 and budgeted diagnostics, not a fabricated ShellLimitError.

This is **not** claiming syntax invalidity under GNU Bash: it is an explicit
virtual grammar-complexity refusal. Existing real expansion/pattern/output
budget exhaustion still uses its actual ShellLimitError and unchanged caller
precedence. No new public field/type/override or shell.ts edit is needed.

## Alternative B: resource rejection, not syntax admission

If root requires these particular caps to be resource failures rather than
grammar-profile refusals, it needs an explicit private parser-resource error
boundary decision (and potentially shell.ts mapping/type scope) before coding.
Do not silently introduce a public limit key or map an arbitrary new error to2.

Implementation/actual preseal have not begun while this requested decision is
pending. All other ratified profile choices stand; no broader policy reopening.
