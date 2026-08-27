# Bounded errexit author checkpoint

2026-08-27. Author implementation, **not independent acceptance or full Bash
parity**. Hidden `errexit-holdout` and `errexit-consumer` cases/expectations were
not inspected or executed. No contracts, root exports, manifests, dependencies,
core commands, filesystem, creation-mask or lifecycle implementation changed.

## Implemented

- `bash`/`sh` invocation accepts ordered/repeated `-e`/`+e`, including repeated
  `e` and combinations of `-c`, `-s`, `-e` in one minus option. Existing `--`/`-`
  invocation terminators, literal command name/arguments, file/default stdin and
  `-s` input-unit parsing remain. `+c`, `+s`, other flags and invocation `-o`
  remain explicit unsupported options, not silently ignored.
- `set -e`, `set +e`, `set -o errexit`, `set +o errexit`, existing pipefail aliases,
  repeated options and positional arguments are supported. `set --` clears or
  replaces positionals; `set -` terminates options without clearing positionals
  when no operands follow. Option-only calls retain positionals. Bare `set`
  listing remains unsupported. `$-` and `${-}` expose **only implemented `e`
  presence**, not invented native `hBc` or other flags.
- Stored option state is separate from a private ignored-return execution
  frame. Conditions, negation, nonfinal and/or elements and tested compound/
  function/source/eval bodies propagate the frame without mutating reusable
  ASTs, global runtime state or the actual flag. Redirections preserve it.
- Simple/function-call, arithmetic, subshell and pipeline aggregate failures
  obey `e`; successful handling of an ignored failure inside a group/loop is not
  reclassified by a blanket compound-result guard. Nonlast pipeline stages can
  terminate internally while the parent still uses last-status/pipefail rules.
- Existing exit unwinding terminates the appropriate unit/child/stage, without
  aborting the shared Budget. Explicit return/exit and cancellation/limit
  exceptions keep their existing boundaries and cleanup paths. Literal invoke
  returns its status to a custom command that may choose its own final result.
- Subshells/stages inherit the flag; ordinary Bash command substitutions clear
  it, while the existing `sh` profile retains it. A tested substitution also
  inherits its ignored context. Fresh interpreters reset option/context before
  applying their own arguments; headerless fallback starts with `e` off. Source
  and eval preserve current-shell changes. Separate `Shell.exec` calls remain
  fresh executions, not a persistent interactive option session.

No ERR/EXIT traps, `shopt`, configurable `inherit_errexit`, SHELLOPTS/startup
inheritance, nounset, job control or broad grammar claims are made. Existing
budgets, cancellation identity, byte accounting, stdin cursor/origin and virtual
capability/path boundaries remain in place; no native product execution exists.

## Shebang protocol and retained refusals

The virtual protocol is an interpreter path followed by zero or **one literal
optional argument**; it does not shell-split or quote-interpret the remainder.
Existing outer shebang space/tab trimming remains. Existing allowlisted direct
paths `/bin/bash` and `/usr/bin/bash` now permit a single `-e`/`+e` argument
(including repeated e). Script path and user arguments remain literal.
Explicit `bash FILE` options control that invocation: a recognized file header's
`-e` is not applied a second time. Existing interpreter validation still occurs;
this does **not** relax unknown-header/invalid-UTF8 policies even where native
explicit Bash would simply treat the header as a comment. No new direct `/bin/sh`
allowlist entry was added; the existing plain `#!/usr/bin/env sh` binding remains.

Plain `#!/usr/bin/env bash`/`sh` retain their virtual bindings and registry override
checks. `env bash -e` is a single unsupported literal target, refused126. `env -S`,
quoted option strings, `-e -e` as one argument, and shebang `-c` are explicitly
unsupported. No implicit host env/PATH lookup or generated source is used.

`errexit-design-native.json` preserves the 16 original bounded argv-recorder
observations, binary hashes, C recorder source/compiler and profiles. Its
`errexit-design-probes.mjs` reproducer also retains the earlier design controls.
Under actual Darwin25.4.0 **both** native parent profiles gave a recorder
`[recorder,alpha,beta,./script,tail]` for `#!recorder alpha beta`; quotes remained
literal while whitespace split. `/usr/bin/env` received separate bash/-e there,
but direct `env` with literal `"bash -e"` failed127. Darwin env `-S` worked in
the measured simple form, without establishing a complete GNU split language.
Therefore the frozen Darwin `env-single-kernel-argument` row remains a deliberate
virtual-protocol loss, not a pass manufactured by splitting the string. The
original seven/36/72 or independent hidden cohorts were not replayed here.

## Native freeze and red evidence

`errexit-cases.ts` and `errexit-native.json`: 54 cases × actual argv0 bash/sh,
**108 rows per binary**, frozen before any source edit. `errexit-initial.json`
retains all initial virtual observations and hashes: **0/108 primary passes**.
The complete initial TAP remains at `/tmp/safe-bash-errexit-initial.tap`; its
assertion data are durably represented by the raw initial observations and the
frozen goldens, not discarded or changed into skips.

`errexit-extra-native.json` adds six adjacent cases × two modes, frozen before
the subsequent `set -` fix. It transparently records the partially implemented
source hashes and **8/12 initial passes**, not falsely a preimplementation run.
Final exact primary results are **108/108 + 12/12 = 120/120**. Historical exact
results are **97/108 + 10/12 = 107/120**, retaining 13 differences:
source-tested, source-enables-option, eval-enables-option,
substitution-tested-enable and arithmetic-status in both modes; sh
substitution-tested; group-redirection-failure in both modes. Historical failures
can allow later effects; no code was changed to reproduce them. These are not
the archived old9 or five custom first-read cases.

Both whole native cohorts use pinned GNU5.3 as the uniform primary and actual
Apple Bash3.2.57 as historical, C locale, scrubbed environment, isolated temporary
directories, 2.5-second detached-process-group deadlines and bounded output.
Native nested bash/sh names are symlinks to the selected profile binary; cat is
explicitly `/bin/cat`. PATH is empty (the controlled cwd), never ambient. Raw
stdout/stderr bytes, exit status and marker presence/bytes are compared; file
mode/creation-mask parity is not claimed. No per-case oracle or normalization.

- GNU5.3 binary: `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA256
  `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
- Historical `/bin/bash`: `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
- Darwin `/usr/bin/env`: `9eb7c5aed7f3c7fe07b77d9a84d0a7c6a8c68c17a15aa3dace0d8ff02d352776`.

Primary source guidance: pinned Bash5.3 `doc/bashref.texi:5929` and `:7828`,
`execute_cmd.c:2890` and `:4993`, `flags.c:261`, `subst.c:7349`; official GNU Bash
manual sections The Set Builtin, Invoking Bash, Bash POSIX Mode, Command Execution
Environment; GNU Coreutils env invocation documentation (not a claim that the
Darwin env binary is GNU/Linux). The preimplementation design report is
`/tmp/safe-bash-errexit-author-design.txt`; its critical facts are preserved here.

## Validation and honest legacy conflicts

`errexit-host-initial.tap`: initial **13/30** host passes. One author source-budget
fixture originally allowed24 bytes while its aggregate was23; it was corrected
to22, rather than changing runtime accounting. Final **30/30** host controls
cover cancellation identity and late rejection, shared budgets, actual agent
env/pipeline accounting, middleware dispatch witnesses, stdin binary/provenance,
delayed draining/failure, process state and literal shebang refusals.

Guarded author **150/150**; parser/state **157/157**; invocation **348/349**;
source/eval **86/86**; current-shell **44/44**; file-entry **78/80**. Total scoped
run **863/866**, not a green full gate. The three untouched old assertions are:

1. `invocation-modes.test.ts:36`: -e was classified unsupported before stdin
   consumption; now it executes the valid stdin command, yielding0 rather than2.
2. `script-entrypoint.test.ts:175`, options row: valid `#!/bin/bash -e` was expected
   to refuse126. It now executes its successful body and returns0.
3. `unsupported-options.test.ts:6`: real `set -e; false` now exits1, not unsupported2.

These native-backed feature activations are visible failures awaiting separately
authorized expectation review. No old test was edited, skipped or weakened.

Final global/build/benchmark `--noEmit` exit **0/0/0**, with **1698/309/424**
pre-enumerated compiler inputs, no unguarded actual inputs, no changed snapshots
and no loaded-TS hash mismatches. The first global check found two implicit-any
diagnostics in the new author capture's `rows` array; that local type annotation
was fixed and only author+compiler checks repeated. Both attempts remain in
`errexit-validation.json`, with compact shared file/manifest tables. No unrelated
type errors were hidden or fixed. Test children were bounded15s; compiler
children90s. All owned child groups were stopped, no SIGSTOP or watchers.

Repro (write fresh output paths, do not overwrite frozen evidence):

```sh
node --import tsx tests/shell/errexit-native.ts capture > /tmp/errexit-new-native.json
node --import tsx tests/shell/errexit-native.ts capture-extra > /tmp/errexit-new-extra.json
node --import tsx tests/shell/errexit-native.ts actual > /tmp/errexit-new-actual.json
node tests/shell/errexit-verify.mjs /tmp/errexit-new-validation.json
node tests/shell/errexit-design-probes.mjs
```

## Source provenance / release

Source parent `f1bb98b4ec8fd9cc198959e85f96e38880e72243`; initial inspected HEAD
`66046dce7fbdda6fd2d7e31e210e13ab1498773e`. Other owners advanced HEAD during this
work; guarded content stayed stable. This report's owning atomic commit is the
source checkpoint (`git log -1 -- tests/shell/errexit-report.md`); the full ID is
also published in `/tmp/safe-bash-errexit-author-ready.txt`.

Changed source SHA256, also actually loaded from TS in the final guarded tests:
- `src/shell/runtime.ts`: `5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb`.
- `src/shell/parser.ts`: `10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e`.

Unchanged shell/contract hashes remain in raw source manifests. Public export
names/API/dependencies changed: **none**. Source writer relinquishes the lease
at READY; hidden review and unchanged benchmark replay belong to different
verifiers. No overall kernel/Bash completion or superiority claim.
