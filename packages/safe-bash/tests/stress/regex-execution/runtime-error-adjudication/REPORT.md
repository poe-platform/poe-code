# Independent adjudication: ordinary throw is the wrong layer

## Disposition

No source defect was found in the assigned error-precedence question. The exact
original assertion is wrong for an ordinary registered-handler `Error`: it
expects a public execution rejection where both pre-change and selected current
dispatch produce a completed status-1 result and stderr. This is **not** a claim
that a formerly valid assertion became stale after the cleanup change.

All meaningful benign precedence obligations in this narrow assignment have
positive independent controls: result versus rejection, sole/multiple cleanup
failures, selected genuine rejection identity, and caller abort during drain
with all four originally skipped errno/falsy reasons. Sixteen distinct positive
variants pass across four distinct groups; the exact original failing assertion
is additionally reproduced and preserved. There is no remaining demonstrated
semantic gap in that scoped matrix. There **is** still an unrebaselined original
prepared-suite failure: its reported **7/8 remains 7/8**, not 8/8. No full benign
lifecycle certification, canonical rewrite, rebaseline approval, risky-gate
clearance, default acceptance, or superiority claim follows.

## Immutable inputs and independence

- Runtime: `1b133a8662a32ee84524794842074c9c98d5f6c3`.
- Registration: `01aa1bffe0568cc6787d5ff8e0331e024a787385`.
- Fixture: `10273352f8d65d929cbf5a23e69119414dacee60`.
- Pre-cleanup baseline and contract: `07acb1a4d30b7592cf247a0220250317be4e2038`.
- `EXPECTATIONS.md` was written and SHA-256 frozen before inspecting source or
  the main leaf's supplemental findings:
  `d0d2aaea2142d47248d33964df3fad69a89731a443ac298013ca134a4ccf0b77`.
- Current snapshot: 216 source/metadata files and 704 emitted files verified
  against the supplied freeze/build manifests; baseline: 196 and 636. No live
  production source or live dist was executed. Relevant source was also checked
  against immutable Git, with per-file hashes retained in both result files.
- Current freeze SHA-256:
  `11393027a812e9e25cc4af47309c38b9f444f8f8099e4772a04e6dfc145dd70a`.
  `identity-checks.json` separately records registration/fixture ancestry and
  exact file equality at the selected runtime.
- The original prepared harness comes from fixture Git bytes, SHA-256
  `34c3d137b96c4e963573977c92d478f3bd0d670fd2b7bf32bace1fdf852dd007`.
  `original-group.mjs` changes only the wrapper to inject existing helpers; the
  entire group body, including its first assertion and all later branches, is
  byte-equal to that immutable fixture. Both runs verify this before execution.
- Only after independent freeze, inspection, and reproduction did this verifier
  read `/tmp/regex-runtime-lifecycle-findings.txt` and the main triage evidence.
  The latter reports 13/13, but is not included in this verifier's pass counts
  or independently certified. Its read-time hash is in `identity-checks.json`.

## Contract and actual execution paths

The normative `src/contracts/command.md` at both immutable commits, lines
99–109, selects: caller reason; otherwise the rejection already selected by
execution; otherwise sole/aggregate cleanup failure; otherwise completed result.
It explicitly says a completed nonzero result cannot hide cleanup failure.

Current `src/shell/runtime.ts:769` wraps dispatch errors with `ExecutionFailure`;
the command catch at line 494 unwraps the original. At lines 498–512 it preserves
specific execution-control errors, including `ShellLimitError`, but converts an
ordinary `Error` into `shell: line 1: selected execution failure\n` and status 1.
The baseline has the same normalization at lines 489–507. Baseline `runUnit`
at line 290 and current at line 294 only translate exit-flow termination; neither
turns a normalized command result back into the original exception.

Baseline `Shell.exec` awaits `runUnit` and rethrows non-syntax execution
rejections. Current `src/shell/shell.ts:87` records the execution result or exact
rejection, awaits `scope.close()`, then checks caller abort, the saved rejection,
and cleanup failures in that order. Its private execution path still specially
normalizes syntax errors, not `ShellLimitError`. `src/shell/cleanup.ts` collects
each hook's failure and awaits all registered hooks; multiple failures become
`AggregateError('Invocation cleanup failed')` only after no higher-precedence
outcome remains. The observed ordinary-throw result therefore matches the contract.

## Four small groups and exact counts

| Group | Distinct positive variants | Independent observation |
| --- | ---: | --- |
| Ordinary throw, no cleanup | 2 | Baseline and current both resolve status 1, exact stderr, empty stdout |
| Ordinary throw, failing cleanup | 2 | Sole failure preserves identity; two failures aggregate both exact objects; public settlement waits |
| Genuine execution rejection | 4 | Public `ShellLimitError` without cleanup on baseline/current; current with two failures; actual one-byte/zero-output-budget rejection with two failures |
| Abort during drain | 8 | `0`, `false`, `''`, and the exact `{code:'ENOENT'}` object each override ordinary result and genuine rejection after both cleanups finish |

The extra negative control runs the unchanged original group: first caller
`'none'` fails with the cleanup aggregate versus ordinary primary Error; later
caller variants are not reached in that original body. They are independently
covered in the fourth group rather than silently counted as original passes.
Selected primary errors retain their property descriptors in the genuine and
abort controls. Strict unhandled-rejection mode remains enabled throughout.

At 08:42:40 UTC on August 27, 2026, the initial run recorded **3/4 groups** because
the verifier incorrectly read `.errors.length` from `AssertionError.actual`.
Node's assertion copy retained the AggregateError prototype/message but not its
non-enumerable `errors` property. This harness-only failure occurred after the
ordinary cleanup checks and original identity assertion reproduction, and is
preserved in `results.json`. `initial-controls.mjs.txt` and `initial-run.mjs.txt`
preserve the exact first-run sources, verified against their recorded hashes.

The correction captures the real settled public outcome separately, leaving the
original group body untouched, and checks that aggregate's two failures. At
08:43:22 UTC only group 2 was rerun: **1/1 group**, with the original assertion
still failing as expected. `results-group2-correction.json` links the initial
evidence hash. This is not a fresh single-run 4/4 claim. Four distinct groups ran;
one was repeated solely for the disclosed verifier correction.

Both runs used Node v22.22.2 on Darwin arm64, one exact child per run, strict
unhandled rejections, 128 MiB heap, 15-second child watchdog, 16 KiB combined
output cap, and 1.2-second local observation bounds. Both children closed their
stdout/stderr with empty stderr and no watchdog/kill. Every created Shell was
disposed and tracked execution settled. No regex workers, risky patterns,
external oracles, broad tests, dependency installs, or original-five reruns were
needed. These are functional controls, not timing/performance measurements.

## Proposed valid control, not an approved fixture rewrite

Use the existing exported `api.ShellLimitError('maxCommands')` as the selected
primary in an **additional** public handler test, register both failing hooks,
throw that exact instance, and assert `result.error === primary` after the held
drain finishes. The existing command catch explicitly rethrows that public type;
`runUnit` and `Shell.exec` preserve it. This independently works without cleanup
on the old/current snapshots and with cleanup on the current one.

An additional implemented variant requires no synthetic rejection type: set
`maxOutputBytes: 0`, register the hooks, and attempt one byte through
`context.stdout.write`. Capture and rethrow the actual budget-generated error;
the final public rejection is that same instance after drain. No private runtime
API, middleware shortcut, production change, or regex execution is involved.

Keep the ordinary-throw controls separately as completed-nonzero-result tests.
Do not replace the original assertion with a generic rejection assertion or
claim its original 7/8 became green. Any canonical correction needs user approval.

## Historical and execution limits

Keep reported historical **99/100**, **110/111**, and **old-five 0/5** distinct.
The main leaf's new-five **compiled 5/5** and **packed 5/5**, each with **24/24
triples**, are supplied context, not rerun or certified here. Main original
prepared-runtime **7/8** and supplemental **13/13** are separate evidence cohorts.
No public-settlement worker/listener instrumentation or complete lifecycle gate
was independently rerun in this narrowly authorized adjudication.

Commands used for the two bounded runs:

```sh
node --unhandled-rejections=strict tests/stress/regex-execution/runtime-error-adjudication/run.mjs
node --unhandled-rejections=strict tests/stress/regex-execution/runtime-error-adjudication/run.mjs --group2-harness-correction
```

Evidence writes are exclusive: replay in this directory stops rather than
overwriting retained result files. No further execution is needed for this
disposition. All repository edits are confined to this new owned directory.
