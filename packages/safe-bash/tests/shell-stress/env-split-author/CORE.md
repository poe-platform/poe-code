# Core env split candidate — runtime shebang support remains separate

August 27, 2026. Source-author implementation follows the frozen preparation in
`71c5829` and `db3680fc`; none of those inputs, expected tuples or89 tests changed.
Different-verifier hidden/consumer fixtures were not inspected or executed.
Independent and packed-consumer acceptance are still required.

## Product scope

Only the env definition in `src/commands/execution.ts` changes, plus its necessary
import and new private `src/commands/env-split.ts`. Automated comparison against
starting HEAD `c3fbda6279028fd2bde9f6d967970870ff7546aa` proves that directExecutor,
argumentsFrom and every non-env execution command remain byte-for-byte unchanged.
No runtime/contracts/internal helper/barrel/package/config/FS/dependency changes.

The helper implements GNU-style S tokenization, not shell evaluation. Supported
forms: `-S STRING`, `-SSTRING`, `--split-string STRING`, `--split-string=STRING`,
combined supported short options, and finite nested/repeated S option reinsertion.
Existing i/u/0/C options and assignments retain their env implementation. Parsing
stops at an operand or `--`; a lone `-` clears env and stops option processing,
including after `--`. This corrects the old leading-dash rewrite's continued option
scan instead of treating a following `-u` as a command operand.

The finite-state grammar supports ASCII whitespace, single/double quotes and
concatenation, empty arguments, documented control/punctuation escapes, `\_`,
`\c`, comments, and `${NAME}`. Only the original incoming exported `context.env`
is consulted; -i/-u/assignments do not change expansion lookup timing. Values are
literal, not re-split or re-expanded. Absent and present-empty variables differ.
BOM/Unicode characters remain argument data; NUL is explicitly refused.

No command substitutions, shell operators, startup files, host execution or
ambient process.env lookup occur. Core env still uses real `context.invoke` with
replaceEnv:true and the existing direct fallback, forwarding cwd, byte sinks,
signal, default-input provenance and cleanup context without fresh shell budgets.
Environment listing order remains6b81bb3's reversed-new/inherited sequence.

All split parsing completes before cwd lookup or dispatch. Split syntax/cap errors
return125; ordinary option usage errors retain existing status2. Unsupported env
argv0/debug/signal options and long-option abbreviations remain explicit refusals.
This is not complete GNU env utility parity: existing non-S validation conventions,
including usage diagnostics and -C-without-command handling, are not globally
migrated. The -0/command conflict is now checked before cwd lookup, not afterward.

## Private API and runtime routing

The module's private exports are:

```ts
class EnvSplitError extends Error {}
parseEnvOptions(
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<ParsedOptions>
```

`ParsedOptions` is the existing internal flags/values/operands shape. The helper
does not mutate args/environment, perform VFS work, construct a Shell, dispatch a
command, or materialize child environment/cwd. Ordinary non-S strings are never
split. Module exports are not root/package API exports; no export map changed.

Root's separate runtime adapter can call this helper with the **single literal**
kernel optional argument followed by file/user argv, use i/u/assignment/C results
to prepare the child context, then apply the existing interpreter allowlist and
full argv rules. It must preserve source charging and choose the actual file after
cwd/operand changes; it cannot always run the initially inspected script body.
Core env's ordering and replacement construction stay in its existing definition.

No runtime adapter is included. Runtime SHA256 remains
`2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b`.
scriptFile still recognizes only plain env bash/sh headers and bypasses registered
env. **All eight frozen protocol examples still refuse126**, including all S forms;
the non-S literal `bash -e` refusal is intentional and remains unsplit. These are
preserved scope limits, not env-S shebang completion or waived native losses.

## Bounds and cancellation

Per env parser invocation:128KiB cumulative UTF8 bytes for all S inputs plus generated
output,10,000 generated arguments,32 S expansions,1MiB work after S activates.
Counts are shared across repeated S rather than reset per string. Bounds precede
copies/joins; environment expansion bytes count. Normal non-S large assignments
do not acquire a new split-work limit. Work yields every4096 accounted units and
checks the inherited signal before/after yielding. No abort controller, Budget,
opaque host join or lifecycle API is added.

The additional isolated10-control child covers byte and argument boundaries,
Unicode counting, cyclic S, NUL refusal, cancellation during parsing, preserved
large non-S invocation and error precedence. One initial new author assertion
miscounted the byte boundary: for `rec ` plus n ASCII bytes, input+output is
`(4+n)+(3+n)=7+2n`, so65532 passes and65533 fails. Only that new test's arithmetic
was corrected; its original failure is retained. No frozen test changed.

## Verification

- Frozen89/89 author tests pass unchanged; additional bounded test passes all10
  controls, giving90/90 test cases in the final author run.
- 528/528 selected existing execution/env/errexit/invocation/input/origin/descriptor/
  accounting/cleanup/source/eval tests pass. Exact file/command lists are in evidence.
- Raw core tuples:59/63 exact against the single pinned primary expectation set;
  four retained differences are runtime missing-target diagnostics, separately
  tested as127/no child effects rather than disguised as GNU host-exec formatting.
- Fresh native whole cohorts:90 original env rows,16 fixed interpreter-argument
  rows,8 Darwin-kernel rows and36 supplemental rows. **150/150** raw tuples match
  their frozen captures, with no per-case oracle switches or normalization.
  GNU env9.7 is Darwin/libSystem; shell parents/selected children are pinned5.3
  and3.2 as recorded. Apple env/kernel controls remain separately labeled.
- Scoped strict noEmit and build `tsc -p tsconfig.build.json --noEmit` pass.
- Global `tsc --noEmit` returns2 with11 unrelated test errors:3 TextEncoder-as-type
  errors in file/text-bound.test.ts and8 broken imports/typing errors in flattened
  filesystem-inspection sealed input copies. Exact diagnostics are retained; no
  unrelated repairs, suppressions, excludes or retry-to-green were attempted.
- 213 product source files and3,730 configured global TypeScript root inputs were
  prelisted/hashed; guards remain unchanged through checks. Actual runtime/env/helper
  imports resolve to `.ts`. No emitting build, hidden test suite or full benchmark
  gate ran. This inventory is not a claim that all fixtures passed compilation.

Core source/evidence hashes, full commits, raw logs and external failures are sealed
in the final core handoff. All owned test/native children ended, scratch trees
were removed, and foreign staging was preserved. Stop after this author handoff.

### Post-validation integration qualification

Source commit: `84ab66ca717e0dff21abf57051b41cb553f3c7f3`. Its two env hashes match
the tested hashes exactly. After the validation guard closed, concurrent commit
`b2821599` changed `src/commands/network/body.ts` and `src/commands/structured/jq.ts`
before the env commit was made. The final seal detects and records both changes.
Thus the checks had stable inputs **during execution**, but the final integrated
source commit is not a whole-input revalidation of those later foreign changes.
No source edit, silent waiver or repeat-to-green is made for them. Independent
acceptance must bind to the complete committed candidate, not inherit a false
all-current-source gate from this author report.

## Reproduction

```sh
node --import tsx tests/shell-stress/env-split-author/core-verify.mjs /tmp/env-core-check-new.json
node --import tsx tests/shell-stress/env-split-author/core-observe.mjs /tmp/env-core-raw-new.json
node tests/shell-stress/env-split-author/capture.mjs /tmp/env-core-native-new.json
node tests/shell-stress/env-split-author/resume-native.mjs /tmp/env-core-extra-native-new.json
```

Use fresh output paths and the recorded existing tooling. Native evidence follows
the previously browsed official GNU env manual and inspected pinned9.7 source;
no GNU implementation code or new runtime dependency was copied into the product.
