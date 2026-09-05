# Bugfix #637: brace expansion

## Root review

Root independently ran both brace suites together with the seven-file parallel
xargs cohort: 312/312 passed under normal node:test isolation. The maintained
test registry passed 98/98. A separate read-only reviewer ran 14 bounded probes
covering range/product cardinality, padded-range byte admission, lexical-replay
parse admission, falsey cancellation, generator return/throw cleanup and opaque
byte provenance. No concrete blocker was found in that bounded review; all
observed helper ownership was released after failure or early termination.
Parameter/substitution-produced syntax remained data without executing the
observer. The reviewed final helper hash is
`22ae0b1ee28e47dc211b3e4818bad0b30634205ffca3aecad6c54ea9863bd55f`.
These checks and the typecheck correction recorded below are not a full gate,
verified remote delivery or release.

## Scope and ownership

Implement the validated literal-brace defect in virtual-bash. The issue's proposed
`shopt` interface is not the Bash interface: use `set -B` / `set +B` and
`set -o braceexpand` / `set +o braceexpand`, enabled by default. Preserve existing
`shopt` behavior. This work does not add README content, packages, host-shell
fallbacks, runtime dependencies, build output, registry changes or Git mutations.

The current issue author/body were read with `gh issue view 637` from
`poe-platform/poe-code`; the author is `kamilio` (Kamil Jopek).

Initial implementation ownership was limited to:

- `packages/safe-bash/src/shell/runtime.ts`
- `packages/safe-bash/src/shell/parser.ts`
- `packages/safe-bash/src/shell/brace-expansion.ts`
- `packages/safe-bash/tests/shell/brace-expansion.test.ts`
- This plan.

An independent worker owns
`packages/safe-bash/tests/shell/brace-expansion-differential.test.ts` and reviewed
the implementation. No adjacent state, type, cleanup, array-ledger or value-arena
implementation files were edited. Registration, maintained full qualification,
commits, remote-main delivery and release monitoring remain with the root owner.

## Implementation

1. Parse unquoted literal brace punctuation into bounded choice/product/range
   nodes without evaluating parameter or command substitutions. Preserve original
   parts and their byte/array-selector/quote-marker identities. Leave malformed
   forms literal while still expanding valid nested expressions.
2. Support comma lists, empty alternatives, nested/cartesian products, ascending
   and descending numeric/alphabetic ranges, signed steps, zero steps, decimal
   padding and Bash signed-64-bit endpoint validity. Materialize one ranked word
   at a time rather than allocating the complete cartesian result.
3. Admit structural and materialization allocations against existing parse and
   value budgets; check cardinalities and repeated-prefix byte costs before
   generating results. Check aggregate argv capacity before appending. Use CPU,
   cancellation and cooperative-yield checkpoints in scans, aggregation and
   generation, with `finally` ownership cleanup for failure and early return.
4. Run brace expansion before tilde, parameter, substitution, splitting and glob
   expansion. Text produced by parameters/substitutions and literal invoke argv
   never becomes brace syntax.
5. Preserve original lexical source spans for quoted and nontext parts. For an
   alphabetic range that generates backslash/backtick syntax, replay only the
   affected lexical suffix with admitted source and parse work. This is not an
   eval or a reparse of rendered values. Position-indexed opaque atoms retain
   byte-value identity; ANSI-C translation precedes replay. Expansion-phase
   quote removal tolerates the native unmatched trailing quote/escape behavior.
6. Keep braceexpand state in the existing runtime state; clone it for inherited
   scopes and reset it for fresh interpreters. Expose the `B` flag, option listing,
   conditional option query and child interpreter switches in the existing Bash
   profile without introducing a `shopt` option.

## Context admission

| Context | Behavior |
| --- | --- |
| Command argv, declaration argv, `for` word lists | Expand braces |
| Ordinary compound-array values | Expand braces |
| Explicit indexed compound entries | Expand the original whole entry; a changed entry becomes ordinary sequential values |
| Scalar assignment RHS and individual indexed assignment RHS | Do not expand braces |
| `[[` operands, case subject/patterns, parameter operands | Do not expand braces |
| Here-string and here-document content | Do not expand braces |
| Ordinary redirects | Expand, then reject multiple targets before file effects |
| Functions, source/eval, subshells, pipelines, command substitutions, VFS scripts | Apply the context rules and existing scope/state semantics |

## TDD and verification, September 5, 2026

Baseline root-reported commit:
`af9f1b23b660890c17f346fb6d44b8fe6060f179`.
Before any implementation edits, the source suite produced **10 failing tests
and 1 passing test**, including literal brace output and missing product-limit
rejection. An independent pre-edit differential suite separately produced
**36 failures and 8 passes**. These are semantic RED results, not sandbox-launch
failures. Sandbox subprocess failures were retried with the identical prescribed
command outside the sandbox; no fixture files were created on the host filesystem.

Prescribed tool environment:

```sh
TOOLCHAIN=$(cat /tmp/kamilio-toolchain.path)
BASE=$(cat /tmp/kamilio-569-575-validation.path)
PATH="$TOOLCHAIN/bin:$PATH"
TMPDIR="$BASE/tmp"
TSX_DISABLE_CACHE=1
```

Final independent source execution used Node 22 with `--import tsx --test` on
the two brace test files: **75/75 passed** (14 implementation tests and 61
independent tests). Before/after hashes of all five source/test inputs matched.
Coverage includes native `/bin/bash` comparisons, the original VFS
touch/mkdir/mv/echo workflow, brace-before-glob, explicit context admission,
option inheritance/observability, signed limits, raw bytes, cancellation identity
and zero retained helper allocations after failure/return/cancellation.

The independent oracle profile was GNU Bash 5.0.17, x86_64 Linux, with
`/bin/bash` SHA-256
`025cf78cd9d276019e916b97b0decd10cacb14902db8eb9f28233019babfb331`;
the test runtime was Node 22.22.0.

The following focused existing suites ran with Node 22,
`--import tsx --test --test-concurrency=1`: **672/672 passed**.

```text
packages/safe-bash/tests/shell/unsupported-options.test.ts
packages/safe-bash/tests/shell/byte-values.test.ts
packages/safe-bash/tests/shell/parse-budget.test.ts
packages/safe-bash/tests/shell/parse-admission.test.ts
packages/safe-bash/tests/shell/shell-language.test.ts
packages/safe-bash/tests/shell/script-entrypoint.test.ts
packages/safe-bash/tests/shell/indexed-arrays-author-20260828/foundation.test.ts
packages/safe-bash/tests/shell/indexed-arrays-author-20260828/syntax.test.ts
packages/safe-bash/tests/shell/dotglob-author-20260828/dotglob.test.ts
```

The first existing-regression execution had 671/672 passes: newly allocating
unused lexical spans for unquoted literal text changed the fixed parse-budget
test's charge. Removing that unnecessary metadata restored the maintained
admission contract; no existing test was modified or waived.

### Evidence hashes

| Evidence | SHA-256 |
| --- | --- |
| Baseline runtime | `027e65fd7b79c38bea8683afa5102b8542cbf1b525858c4c12c23b843ac3c1d7` |
| Baseline parser | `8d91697db72102e37ebcce69a4966319d4ab6d1b34319e555ce3c040e0ebf5e8` |
| `/tmp/brace-637-red.log` | `6aa195de45b2b099399f243c9ec1a674dd172bdd179b8f818c2e368f09f817fd` |
| `/tmp/brace-637-regressions.log` (671/672) | `cd02319d5e8f24308eff66dd5a0831eb842f3aad31f7120bc0ddb6d6369a2472` |
| `/tmp/brace-637-regressions-final.log` (672/672) | `b18f848bc6c5bcc03d8feed4ee63a4fe18e72dd30379a86933c80a1bce567a92` |
| `/tmp/brace-637-independent-final-20260905-1.log` (75/75) | `39ede928b55d56d3eaf65fb4b20d5d466cfc4cab70b4702a8926678abbd089de` |
| `/tmp/brace-637-independent-final-20260905-1.after.sha256` | `88a10e16c860394df41473df3bb7dafb463d4c1318e0a41262a9cb655a31f324` |

### Frozen source/test hashes

| Path | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/shell/brace-expansion.ts` | `10b1eb2a5bf31b0f3df08ba0a44db7b03b319775726618de86fc54b65fff1d5c` |
| `packages/safe-bash/src/shell/parser.ts` | `7a1386ec0371ace8d41292f2838fc22d78c0492ba9b059d86963c6941978a2a5` |
| `packages/safe-bash/src/shell/runtime.ts` | `bd3e8973a0ffa7215de1cc79774065a504f4793e6732443edaf211c9d568e145` |
| `packages/safe-bash/tests/shell/brace-expansion.test.ts` | `c54fcf320ee00c6e961fe6e822287f3d87b71df155c00cdd2b52715ca9de103f` |
| `packages/safe-bash/tests/shell/brace-expansion-differential.test.ts` | `f49484dba729e18d2a69b1ef68ca9dbb5e4ed154766089e8b8e93951094079bb` |

## Authorized typing follow-up

After the original source-only qualification, root authorized the maintained
`npm run typecheck:all --workspace virtual-bash` route, including its required
build, for a narrowly scoped typing correction. The original root preflight log
remains unchanged at
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp/issues-637-641-types-preflight.log`
(SHA-256 `e38cd010c8e0c637e2739df6e938c3ac9d91fae46539970abe6c42b7de38b627`).
Its seven TS2339 errors were validated against the current helper: combining
`product` and `choice` in one union member prevented TypeScript from narrowing
the remaining branch to `range`. Splitting them into distinct discriminated
members fixes that typing defect without a cast, suppression or runtime change.
The corrected helper SHA-256 is
`22ae0b1ee28e47dc211b3e4818bad0b30634205ffca3aecad6c54ea9863bd55f`;
the earlier frozen manifest remains the historical source-test input record.

The prescribed Node 22/TMPDIR command first encountered sandbox EROFS creating
its temporary directory and was rerun identically with escalation. That complete
maintained run, `/tmp/brace-637-typecheck-followup.log` (SHA-256
`22179a4a4034ff2819f33d17d6075ca1f7d5c51abf60fcb16265759aa333927d`),
passed its build and all 26 current consumer groups but failed source-and-tests
on TS2554 at `brace-expansion-differential.test.ts:152`: the async generator
`return` call requires an explicit argument. The independent fixture was not
edited without requesting root authorization. The maintained result reported
`typecheck-failed`, one build, four held evidence inputs, zero runtime executions
and successful cleanup; its three negative validators produced their expected
exit-2 outcomes. This failed run is retained rather than rewritten as GREEN.

Root then explicitly authorized the independent fixture correction: only
`await expansion.return()` changed to `await expansion.return(undefined)`.
This supplies the same default return value explicitly without weakening the
early-return cleanup assertions. Its prior SHA-256 was
`f49484dba729e18d2a69b1ef68ca9dbb5e4ed154766089e8b8e93951094079bb`;
the corrected fixture SHA-256 is
`6b6d08d14a690a2c98a850c7e3e47295e83f6d5e7820bdff5557ef1c556c56b3`.
Runtime, parser and the implementation-authored brace test remain unchanged from
the original frozen manifest. No additional source semantics or adjacent paths
were changed in this typing follow-up.

The final expressly authorized maintained command completed successfully:
`/tmp/brace-637-typecheck-followup-final.log` has SHA-256
`cf908a34a7fb62a4f8e130e07bbb9cee066803c49a35f94943a400bf8bd04e42`.
Build and source-and-tests exited zero; all 26 current consumer groups passed,
and the negative validators retained their expected exit-2 outcomes. The summary
was `typecheck-passed-not-runtime-acceptance`, one build, four held evidence
inputs, zero runtime executions and successful cleanup. The sandbox EROFS
startup failure was again handled by the identical escalated rerun.

After that maintained check, only the two brace source suites were rerun as
authorized: **75/75 passed**, with no skipped/cancelled/TODO cases, in 621.088 ms.
The unique runtime-sanity log `/tmp/brace-637-typecheck-followup-runtime.log` has
SHA-256 `e478a677bf8a6065f272fefdd0f526ddb23009f20b3308d0b3c7461c8bf22150`.
The native-oracle sandbox startup was retried with the identical escalated
command. These results cover the typing follow-up and the existing brace cohort;
they are not a full root gate, universal shell compatibility or release proof.

## Authorized gate-failure follow-up

Root authorized exactly three failure corrections against committed input
`fa43ae5ebf537b77720ecfbb6629ae7711e2647c`: the stale default-flag assertions,
the obsolete unsupported-braceexpand case, and a real structural parse-budget
regression in here-document parameter operands. The authorization covered
`parser.ts`, the existing `errexit-host.test.ts`, new brace regressions and this
plan. No runtime/helper semantics, unrelated options, Git operations or full root
gate were changed or run by this worker.

The original gate artifacts remain preserved under
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/issues-637-641-gate.Wgj5w8/`:

| Artifact | SHA-256 |
| --- | --- |
| `npm-test.log` | `fd29dd9c9357b677b7e190f70d43554569a334ed6ac3d42497590ea6ace37cc3` |
| `termination.json` | `27b5e70ef05911ade4a4cfca2ef1c6e0488ec1ec85b01c1219f818212d14ab51` |

The termination record explicitly classifies that root orchestrator run as
incomplete: tool exit 143, despite shell-trap status zero. The trap status is
not a successful `npm test` result. The three test diagnostics are actionable
evidence, not a full-gate PASS.

Before editing implementation or the stale expectations, a fresh six-file
isolated run reproduced **187 tests, 184 passes and exactly 3 failures**:
`/tmp/brace-637-budget-followup-red.log`, SHA-256
`061471b78353f3d887a7475bf75d97fc3fbda3ef754be0955f75036889312c6f`.
The run used the prescribed Node 22/TMPDIR/TSX environment and
`node --import tsx --test --test-concurrency=1`, retaining default per-file
process isolation. The native-oracle sandbox failure was retried with the same
test command and escalation; no `--test-isolation=none` mode was used.

Corrections are narrowly scoped:

- Update both `$-` expectations in the existing errexit-isolation test to retain
  the default `B`: `[B][eB][B][eB]` and `[B]`.
- Remove only `braceexpand` from the explicit unsupported-option list and replace
  its case with a supported named-option test that also verifies unchanged
  errexit state. Every other unsupported/invalid-option case remains intact.
- When `documentLine` identifies a here-document expansion lexer, omit both the
  replay-provenance allocation and its admission. Here-document operands cannot
  consume brace replay metadata. Separate parsers for nested commands retain
  normal admitted metadata, including quoted text and parameter spelling.

The existing `parameter-depth.test.ts` remains byte-for-byte unchanged, including
its exact five-unit assertion. Added bounded brace regressions verify absence of
unused heredoc metadata and its charge, the exact 25-unit admission needed for
a brace-consuming quoted parameter word (24 rejects), and retained provenance
inside a command substitution nested in a here-document. These tests avoid
uncharged allocations and do not weaken the original structural limits.

The same six suites with those three new regressions pass **190/190**, with zero
failures, skips, cancellations or TODOs. GREEN log:
`/tmp/brace-637-budget-followup-green.log`, SHA-256
`c9f1bf87c3b9a06450120b2514b1ba013ef1c3819003a7a0d8ef65fab3ef3df9`.
Exact isolated suite membership:

```text
packages/safe-bash/tests/shell/brace-expansion.test.ts
packages/safe-bash/tests/shell/brace-expansion-differential.test.ts
packages/safe-bash/tests/shell/parameter-depth.test.ts
packages/safe-bash/tests/shell/errexit-host.test.ts
packages/safe-bash/tests/shell/parse-budget.test.ts
packages/safe-bash/tests/shell/parse-admission.test.ts
```

| Follow-up input | SHA-256 |
| --- | --- |
| Updated `src/shell/parser.ts` | `e7a9590b9966b01a473873ae79a712385578872efcb8173cf0cd61356fd8cea8` |
| Updated `tests/shell/errexit-host.test.ts` | `84c0474cfb97f7ce39eade9a1cfb1d5fca02b6fdbd154cbf6c571ca69cb30406` |
| Updated `tests/shell/brace-expansion.test.ts` | `68d8bc4c0bd1b55671835a724b9a04af72aa3f0587dc2e419d3a81c89c6e5492` |
| Unchanged `tests/shell/parameter-depth.test.ts` | `b1bdd6fc6199955034f66c1fd6e4409159233a6c620fe95fe0bc6658e271aa7d` |
| Unchanged `src/shell/brace-expansion.ts` | `22ae0b1ee28e47dc211b3e4818bad0b30634205ffca3aecad6c54ea9863bd55f` |

After the focused GREEN run, the authorized maintained
`npm run typecheck:all --workspace virtual-bash` command also passed. Its new log
is `/tmp/brace-637-budget-followup-types.log`, SHA-256
`cf908a34a7fb62a4f8e130e07bbb9cee066803c49a35f94943a400bf8bd04e42`.
Build and source-and-tests exited zero; all 26 current consumer groups passed,
the three negative validators retained their expected exit-2 outcomes, and the
summary reported `typecheck-passed-not-runtime-acceptance`, one build, four held
evidence inputs, zero runtime executions and successful cleanup. The prescribed
TMPDIR sandbox EROFS startup was retried with the identical escalated command.
These focused and maintained-package results do not turn the preserved
incomplete root gate into a pass or establish remote-main/release delivery.

## Remaining integration work

Root independently repeated the six corrected brace/parse/errexit suites with
the seven-file parallel-xargs cohort: 427/427 passed under normal process
isolation. The maintained integration registry passed 98/98. Logs are retained
as `issues-637-641-root-correction-focused.log` and
`issues-637-641-root-correction-registry.log` below
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp`. This is focused verification
before the corrected candidate's full maintained build/test/lint run.

The original scoped source results are not a maintained full-package, typecheck,
lint, build, packed-consumer, remote-main or release qualification. That original
assignment ran no build/shared dist or full guard; the later expressly authorized
maintained build/typecheck follow-up is recorded separately above. No full root
gate or release qualification is claimed. Root owns test registration; a concurrent root-owned
registry diff already includes both new brace test paths. This assignment did not
edit that registry. Root must run the authorized maintained integration checks
and separately report any local commit, verified remote-main delivery and
successful release. No visual CLI surface was changed.
