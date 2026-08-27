# Expr worker extension — author checkpoint, 2026-08-27

## Identity and scope

Source/test candidate: `fe7083d99b8ccfdfbbb9b7209e0a6abbe7979724`.
Implementation leaf performed the work directly; no delegation. Only the three
explicitly approved shared regex files and existing expr/expr-author trees were
edited. No package, root export, default dispatch, other source or independent
expr-stress contents were edited/read. Concurrent work and staging were preserved.
The initial design was written to `/tmp/expr-extension-design.md` before product
edits. This is a bounded implementation checkpoint requiring different-agent
review, not full native parity or completion of the overall project.

Historical nonregex source `85675366efe962c0d52993bb8aa286dc9683f6a6`, evidence
`d96f9ffe`, and `nonregex-85675366.json` remain unchanged. Their 1,381/1,381 result
is scoped nonregex evidence, not a regex denominator.

## Implementation

- Separate `ExprMatchDescriptor`, `ExprMatchRequest`, `ExprMatchReply`,
  `ExprMatchResult`, limits and typed syntax/unsupported/limit errors. Legacy
  Descriptor/Request/Reply unions and validators remain unchanged.
- `RegexSession.matchExpr` and an executor overload use the existing queue,
  copying/admission policy, slot budgets, startup/active deadlines, signals and
  retirement. Existing grep/rg/glob response semantics are not changed.
- Worker dispatch alone imports the BRE compiler/interpreter, which also refuses
  main-thread execution. No RegExp translation, private executor, dependency,
  product subprocess, implicit host filesystem or ambient credential access.
- Anchored bounded matching returns original byte spans and capture-presence
  separately from matched/unmatched/empty capture. UTF-8 scalar boundaries map
  back to original byte positions; C captures can preserve partial UTF-8 bytes.
- Exact expr message shape, identity, safe numeric limits, byte bounds, capture
  inclusion, anchoring, scalar boundaries and charged work are validated. Invalid
  patterns on empty subjects still compile/fail. Skipped regex branches produce
  zero jobs. No stdin access for direct argv-only execution.
- `withRegexSession` registers synchronous idempotent cleanup before admission;
  the same cleanup is awaited by finally. Existing argv/parser/BigInt/string/
  output bounds remain, with explicit compilation/state/allocation bounds and
  successful regex work charged to the remaining invocation allowance.

## Primary and native basis

Official primary sources fetched through web.run on 2026-08-27:

- `https://raw.githubusercontent.com/coreutils/coreutils/v9.7/src/expr.c`
- `https://raw.githubusercontent.com/coreutils/coreutils/v9.7/doc/coreutils.texi`
- `https://www.gnu.org/software/coreutils/manual/html_node/String-expressions.html`
- `https://www.gnu.org/software/grep/manual/html_node/Fundamental-Structure.html`

The pinned expr implementation uses POSIX_BASIC with CONTEXT_INVALID_DUP and
NO_EMPTY_RANGES cleared, disables newline anchors, starts re_match at byte zero,
and uses syntactic capture count plus register 1. The rolling manuals are not
the version-pinned oracle. Controls cover implicit/explicit anchors, literal vs
escaped BRE operators, leftmost-longest whole match, GNU greedy/ordered capture
ties, closed-group backreferences, capture absence/nonparticipation/emptiness,
syntax errors on empty input, byte/scalar differences and common path/version
extraction. This is not arbitrary POSIX/GNU subexpression tie qualification.

Authenticated native oracle:
`tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr`, GNU coreutils 9.7,
SHA256 `e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`.
Native subprocesses are bounded test oracles only (2s, 16,384 output bytes,
controlled argv/env). Profile: Darwin 25.4.0 arm64, Node v22.22.2, C and C.UTF-8.
No Apple expr comparison and no GNU/Linux claim. Existing legacy tests retain
their separately labeled BSD/rg evidence and optional native replay skips.

## Results and exact denominators

| Scope | Outcome |
| --- | --- |
| Build | `npm run build`, exit 0 (`build-final.log`) |
| Owned strict source/test check | `node_modules/.bin/tsc -p tests/commands/expr/tsconfig.json`, exit 0 (`typecheck-final-v2.log`) |
| All canonical expr tests | 130 passed, 0 failed/skipped/TODO (`expr-tests-final-v2.log`) |
| Historical nonregex cohort rerun | All 1,381 exact native tuples within the canonical native test; immutable original capture unchanged |
| New primary regex controls | 148/148 exact GNU9.7 status/stdout/stderr tuples |
| Nullable capture author audit | 220/231 exact tuples; 11 explicitly unsupported, not passes |
| Deliberate native capability-gap controls | 0/6 exact tuples; all 6 explicitly unsupported |
| Combined new regex capture | 368/385 exact, 17 differences; capture exits **1**, not a parity success |
| Existing regression scope | 334 passed, 0 failed, 2 skipped of 336 tests (`legacy-regressions.log`) |

The 130 passing tests include safety assertions that unsupported cases reject;
that does NOT turn 17 native differences into parity passes. Primary controls,
nullable audit and capability gaps are separate cohorts, not duplicate counts
of the historical nonregex result.

Canonical command:
`node --import tsx --test --test-reporter=spec tests/commands/expr/*.test.ts`.
Direct and actual Shell plugin cases exercise regex output, pipes/redirections,
byte output, Unicode scalars, invalid empty input, cancellation and sibling use.
Protocol/lifecycle cases exercise invalid messages/results, caps, actual active
timeout and controlled startup timeout, queued ownership/admission withdrawal,
exact abort reasons, worker exit/retirement, cleanup ordering/idempotence and
same-worker legacy matching. Native-dependent expr tests fail, not skip, if
the pinned oracle is missing or mismatched.

Regression command (unchanged tests):

```sh
node --import tsx --test --test-reporter=spec \
  tests/commands/regex-execution/executor.test.ts \
  tests/commands/regex-execution/commands.test.ts \
  tests/commands/regex-execution/cleanup-registration/controls.test.ts \
  tests/commands/regex-execution/followup/messageerror.test.ts \
  tests/commands/regex-execution/continuation/glob.test.ts \
  tests/commands/regex-execution/continuation/glob-transport.test.ts \
  tests/commands/regex-execution/continuation/public.test.ts \
  tests/commands/search.test.ts tests/commands/search/*.test.ts \
  tests/commands/grep-aliases/*.test.ts
```

The two skipped tests are existing opt-in strict GNU and BSD alias replays:
`GREP_ALIASES_GNU_NATIVE=1` with supplied pinned GNU capture prerequisites, and
`GREP_ALIASES_NATIVE=1` for pinned BSD replay. They are NOT passes. The regression
log precedes a whitespace-only indentation correction in expr/index.ts; the
shared executor/worker source bytes and legacy source/test inputs were unchanged
by that correction. Final same-worker legacy coverage is in the candidate's
130-test run. This is scoped regression evidence, not a full current gate.

## Preserved attempts and gaps

`../regex-capture-kdugBl` preserves the initial **dirty, uncommitted** worker
candidate, its full input hashes and all 385 fixture/result rows. It recorded
378 exact matches, the six known unsupported differences, and one additional
semantic mismatch in the 231-case nullable audit. Source bytes were not archived
as a Git commit for that dirty attempt; its raw results/hashes are not claimed
to be a frozen executable source archive.

For `aaa : '\(a*\)*\1'`, the pinned GNU9.7 oracle returned status 1 and an empty
line; the initial author implementation returned status 0 and `a\n`. Rather than
pretend JavaScript-style capture behavior or a subject-specific workaround is
GNU semantics, the compiler now explicitly rejects backreferences to captures
inside nullable repeated subexpressions. This conservatively affects 11 original
audit fixtures, including ten previously matching tuples. All remain in the
original denominator with exact raw native/virtual results retained.

`../regex-capture-UMC1hM` is the final capture on the exact committed source/test
candidate, with empty captured input status. Corpus hash is unchanged across
both captures: `76efe9e14d2b69037e5ed51c37c5500c40d9f3e2a24a36f8dbde6ef28ee57cdc`.
The final results hash is
`c66a8a5f0a058b92f485dcce3a261740446af609ce3f250d3c5653495f815263`.
Capture postchecks cover its explicitly enumerated source/test files, not new
entries; this is not an append-proof tree check. Capture does not overwrite old
data. Canonical tests do not write committed captures.

Other explicit unsupported constructs: word/buffer/alphabetic escapes, leading
escaped repetitions, stacked repetitions, repeated anchors, collating/equivalence
elements, class range endpoints, non-ASCII range endpoints, and named locale
classes on non-ASCII UTF-8 subjects. Invalid UTF-8 regex operands fail explicitly.
Limits may reject otherwise valid GNU workflows. Full subexpression/corner-case
parity is not claimed. C.utf8 remains a virtual scalar alias with the prior
documented Darwin-oracle naming discrepancy.

Earlier build/test attempts were not silently counted as passes:
- Initial compiler TypeScript narrowing error fixed by separate discriminants.
- Initial 99/100 run failed the obsolete pending-regex assertion; the assertion
  now checks actual matching and invalid-pattern failure, not status relaxation.
- An initial Shell fixture failed 127 because it did not register `cat`; fixed
  by explicit standardCommands test registration, not product/default changes.
- Initial lifecycle fixture errors: its override spread accessed a throwing
  getter before command execution; the controlled external worker exit bypassed
  the terminate spy. Fixtures now install the getter on the actual context and
  distinguish external exit from executor termination, retaining exact checks.
- Strict test errors for InvocationCleanup's void-or-Promise type and capture
  row inference were fixed in owned test/harness types.
- `expr-tests-final.log` retains 129/130 with an incorrect new glob expectation:
  legacy glob success is the existing `{start:0,end:0}` sentinel, not full-input
  length. Corrected only the new assertion after inspecting the unchanged
  matcher. `expr-tests-final-v2.log` records 130/130. No existing grep/rg/glob
  diagnostics or assertions were weakened.
The initial compile/fixture attempts above were terminal observations, not
claimed raw-log captures; later preserved files are clearly identified.

## Cleanup and remaining acceptance

Final lifecycle suite observed 20 owned workers, zero active before its safety
hook, zero active afterward; exact listener/termination assertions pass. Existing
executor regressions observed 17 workers, no active workers or owned listeners.
All direct/Shell sessions were closed/disposed; all tool sessions/native probes
settled. No background server, persistent own process or SIGSTOP was used.

No independent holdout was inspected. Different-agent final review, root public
integration/default dispatch and standalone moved-package proof remain outside
this checkpoint. No superiority, universal parity, full feature completion,
deployed-service, performance, or 72-hour duration claim is made.
