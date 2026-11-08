# Bounded invocation modes and VFS PATH dispatch

Author checkpoint, August 26, 2026. This extends the accepted file-entrypoint
increment; it is not full Bash/POSIX compatibility, superiority evidence, or
fulfillment of the requested 72 hours. Source/dot/eval remain a separate future
atomic batch. No host product process, ambient host filesystem/PATH/startup
environment, dependency, root export or shared contract is added.

## Exact grammar

```text
{bash|sh} {-[cs]+}* [--|-] [operands...]
```

These are virtual interpreter fallbacks after existing builtin, function and
registered-command resolution. A registered `bash`/`sh` still wins. Invocation
options scan until a non-option operand or the first `--`/`-`. Repeated and
clustered `c`/`s` flags are accepted; any `c` selects command-string mode even
with `s`. Other flags, plus-flags, long/interactive/login/startup options are
explicitly unsupported, status 2, and never silently ignored.

| Mode | Operand handling | `$0` |
| --- | --- | --- |
| `-c` present | First operand is required source; empty source is valid. Next operand, if present, is the command name; the rest are literal positional arguments. | Command name, including empty/dash-leading name; otherwise exact `bash` or `sh`. |
| No `-c`, with `-s` | Every remaining operand is a positional argument. | Exact `bash` or `sh`. |
| Neither flag, no operands | Read command source from stdin. | Exact `bash` or `sh`. |
| Neither flag, operands remain | First operand is a VFS file; the rest are its arguments. | Supplied filename, as before. |

`bash -c -- ''` is valid empty code; `bash -c --` is missing code, status 2.
`bash -s -- '' -x` supplies two arguments. `bash -- - argument` reads the literal
VFS file `-`; a terminator is not processed a second time. `bash ''` still means
an empty filename, not empty stdin. `sh` selects the existing virtual grammar,
not a new POSIX parser or native startup semantics. `/bin/bash` and `/bin/sh`
command paths are not magic aliases; they remain direct VFS paths.

Explicit file loading retains the prior whole-file preparse and strict UTF-8/
text/shebang/access policies. Only `/bin/bash` and `/usr/bin/bash` shebang tags,
without interpreter arguments, select this runtime. `sh file` does not newly
admit `#!/bin/sh`; arbitrary interpreters, `env` shebangs and headerless direct
ENOEXEC fallback remain unsupported. Searching PATH for a `bash file` operand
is not added; the new search is executable command dispatch.

## Input and process semantics

`-c` executes existing complete input units, just like top-level `Shell.exec`:
earlier complete newline units may take effect before a later syntax failure.
Stdin mode parses one complete existing input unit at a time, including existing
compound commands, multiline quotes, continuations, substitutions and heredocs.
It executes that unit before requesting the next source line. At actual EOF it
finalizes the pending parse; fatal syntax does not wait for an unnecessary EOF.

The source reader shares the existing descriptor cursor with commands. It
preserves unread bytes from a chunk, so `read`, `cat`, nested interpreters and
the caller after child `exit` see the remaining bytes. Source is not eagerly
collected, and source line counting excludes bytes consumed as command data.
Byte data, including NUL/invalid UTF-8, passes unchanged when consumed by a byte
command. Bytes consumed as stdin source use the existing strict file-source
policy: valid UTF-8, excluding NUL/DEL and ASCII controls other than TAB/LF/CR.
Invalid source rejects that unit with status 126; prior completed effects remain.
Command-string mode receives an already-decoded string and keeps the existing
parser's source-validation rules.

The necessary shell-local additions are `ShellInput.sourceLine()` and the
internal `parseShellInputUnit()` partial-input seam. The latter defers incomplete
input, including heredocs, instead of treating each physical line end as final
EOF. No new shell syntax is added; existing final-input parse APIs and cursor
ownership/close/cancellation policy are unchanged. Partial parsing reparses the
bounded current unit; this is not a constant-work incremental parser for enormous
compound commands. Cooperative yields during source reading and partial parsing
allow cancellation even for endless empty chunks or incomplete units.

All modes start an isolated child state from exported environment plus effective
cwd/PWD, with fresh functions, locals, positional parameters, status and options.
`-c`/stdin `$0` is retained through substitutions/subshells. Descriptor maps are
isolated but stream cursors are shared. `stdinIsDefault` is inherited unchanged;
reading source/EOF does not alter provenance. Registry, middleware, literal
`invoke` overrides and filesystem authorization remain in force. Startup files,
`BASH_ENV`, `ENV`, `SHELLOPTS` and ambient credentials are not activated.

No nested `Budget` is constructed. Initial source and every interpreted code
string/file/stdin-source byte share `maxSourceBytes`, counted as UTF-8 bytes,
including repeated interpretations. Data drained by a command is not charged as
source; normal output/command/loop/expansion/pipeline budgets still apply. Each
interpreter/file child consumes depth under `maxSubstitutionDepth`, and `invoke`
retains its own existing depth charge. The original cancellation signal reaches
lookup, source reads and command work; late rejections remain observed. Host
effects cannot be rolled back and synchronous parser calls cannot be preempted.

## PATH resolution

Resolution is existing builtin → function → registered plugin → virtual
`bash`/`sh` entrypoint → VFS lookup. Slash-containing names remain direct paths.
PATH uses the effective shell variable, including nonexported assignments,
command-prefix assignments and middleware overlays. Child processes still
inherit only exported values. There is no host PATH import or compiled host
default, no native executable discovery and no command-location cache.

Components may be absolute, cwd-relative or empty (cwd). Empty PATH yields
`./name` as script `$0`; explicit `unset PATH` attempts bare `name` in cwd and
preserves its missing-path diagnostic. Initially absent configuration also uses
cwd, but retains the legacy command-not-found diagnostic on absence; it does not
pretend that native Bash's system-dependent startup default was installed.

Missing/dangling candidates and directories are skipped; execute-access denials
are remembered while later candidates are considered. The first regular file
passing backend `X_OK` is selected. A read denial, binary body or incompatible
interpreter on that selected file is terminal, not a reason to try another file.
No candidate gives 127; remembered permission failure gives 126. Unknown/false
permission capability fails explicitly with 126 rather than trusting fabricated
mode bits. Unexpected backend errors are not hidden. PATH's byte size and number
of components are bounded by existing expansion byte/field limits.

Lookup uses the existing virtual lexical path functions and backend symlink/
permission operations. It does not provide descriptor-relative identity, atomic
stat/access/read, race resistance or new wrapper/remote parity. Source and data
still go through the injected VFS. `type`, `command -v` and `hash` were inspected
and are not existing shell/standard-command builtins; this increment does not
invent introspection for the new resolver. A host may still register commands.

## Native evidence and genuine limits

Official GNU sources consulted for invocation, names, PATH and statuses:

- `https://www.gnu.org/software/bash/manual/html_node/Invoking-Bash.html`
- `https://www.gnu.org/software/bash/manual/html_node/Command-Search-and-Execution.html`
- `https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Variables.html`
- `https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html`
- `https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html`

The manual describes `-c`/`-s`, command names, option terminators, PATH components,
and 126/127 statuses. It also distinguishes Bash invoked as `sh`, which enters
POSIX mode. Our native harness sets actual process `argv0` to `bash` or `sh` on
the specified binary, never calls `/bin/sh` and labels it modern Bash, and makes
no corresponding full-POSIX claim for the virtual interpreter.

| Profile | Exact executable/version | SHA-256 |
| --- | --- | --- |
| Primary | `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`; 5.3.0(1)-release, aarch64-apple-darwin25.4.0 | `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c` |
| Historical | `/bin/bash`; 3.2.57(1)-release, arm64-apple-darwin25 | `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3` |

All 52 fixtures run for both actual invocation names under both fixed binaries:
**208 native observations**, with the same complete cohort in every profile.
PATH script fixtures intentionally contain the same `#!/bin/bash` bytes on both
sides. Their child interpreter is therefore the pinned historical `/bin/bash`
even when the resolving parent is 5.3; only that parent's lookup is 5.3. This
provenance is not relabeled as modern child execution.

The frozen 35-KiB `invocation-modes-reference.json` contains exact base64 stdout,
stderr, status and complete file/directory/symlink snapshots, plus versions and
fixture/binary hashes. `invocation-modes-cases.ts` contains all source/arguments/
input/files; `invocation-modes-native.ts` recreates isolated repository temporary
directories with scrubbed environment, two-second/256-KiB limits and cleanup in
`finally`. A normal rerun must reproduce the entire frozen native capture before
comparing virtual results. No per-case oracle switches, stderr/path normalization
or unsupported-case exclusions are used by that comparator; it exits nonzero.

Exact comparison: **98/104 primary**, **82/104 historical**. All losses remain in
the denominator. Both primary `read -N` cases genuinely fail stdout/status/stderr:
that option was already explicitly unsupported in `read-options.test.ts`, and
adding a read flag is outside this invocation batch. They remain failing tests,
not skipped/xfail or passing guest-semantics characterizations. The supported
`read -n` has an additional successful cursor control. Four primary diagnostic
losses retain the earlier explicit virtual binary/unsupported-interpreter policy;
their byte/namespace effects and status agree, but stderr does not.

Historical additional differences include PATH-empty `$0` (`name` versus modern
`./name`), PATH error line/path wording, syntax line context and incomplete-command
EOF wording. Historical `read -N` also rejects the flag but prints different
stderr. There is no per-case historical emulation to improve the count. The
machine-readable checkpoint records every differing field and actual/expected
observation. Native failure totals are not a selected-dialect all-pass claim.

## Validation and reproduction

| Check | Recorded result |
| --- | --- |
| Guarded pre-source new suite | 1/129 pass, 128 genuine failures; original runtime/input/parser hashes asserted. |
| Original file suite before source | 41/41 pass. |
| Original expectations after feature | 39/41 pass; exactly two obsolete unsupported-mode/PATH expectations fail. |
| Updated file suite | 41/41 pass. Only those two authorized expectations changed; header/binary/access/isolation checks remain. |
| Final new suite | 130/132 pass, two genuine `read -N` failures; zero skips/TODOs/cancellations. Two strict repetitions give the same counts/failures. |
| Bounded child regressions | 13/13 pass, five-second parent limits, strict rejection mode; recursion, lookup/source/drain/command cancellation, empty/incomplete source yielding, limits, late rejection and fatal syntax without EOF. |
| Targeted existing suite | 300/300 pass; no observed source-guard invalidation. No pending first-read cohort or frozen remote audit run. |
| Owned-scope strict TypeScript | Pass, no emission. |
| Final global and build-config TypeScript | Both pass with `--noEmit` at observed HEAD `5ddce1b0550ad7de8f2a8082f0402fae7aa001b7`. Earlier moving-worktree archive errors are retained in checkpoint history, not fixed by this leaf. |

The two prior expectation changes are deliberate feature activation, not relaxed
failure criteria: a readable executable `program` on PATH now runs, and the
previously rejected `bash`, `bash -c 'say bad'`, `bash -s`, `bash -`, `bash --`
forms now execute against empty/default input. All five assert status 0 and exact
output; the same test still rejects incompatible headers and binary files.

```sh
node --unhandled-rejections=strict --import tsx --test tests/shell/invocation-modes.test.ts
node --unhandled-rejections=strict --import tsx tests/shell/invocation-modes-native.ts
node --unhandled-rejections=strict --import tsx --test tests/shell/script-entrypoint.test.ts
node --unhandled-rejections=strict --import tsx --test tests/shell/{core,parser-regressions,input-units,runtime-regressions,lifecycle,inline-input-limits,glob-budget,variable-scope,descriptor-inheritance,descriptor-moves,stdin-origin,fs-error-diagnostics,invoke,read-options,heredoc}.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsc -p tsconfig.build.json --noEmit
```

The first two commands intentionally remain nonzero for the documented genuine
failures/differences. `--capture` on the native harness emits a fresh capture to
stdout only; do not silently replace the reviewed reference. Full owned/product
comparators were not run. These are author results, not independent acceptance.
The five pending first-read cases and paused NUL diagnostic discrepancy remain
unchanged/unrerun; no lifecycle candidate is integrated or approved here.

## Source provenance

Initial HEAD: `17285d1afc105999b6ccb943ddfd3819d6148aec`. Only product files
`runtime.ts`, `input.ts`, `parser.ts` change. `shell.ts`, root/shell-index exports,
contracts, commands, FS, manifests and dependency inventory are not changed by
this leaf. The only new exported symbol is internal-module `parseShellInputUnit`;
it is not re-exported by the package or shell index. `ShellInput.sourceLine` is
likewise internal. Actual Node load-hook proof loads all shell modules from `.ts`
and passes a nested `bash -c 'sh -s'` binary-cursor smoke test. Nothing is emitted.

| Final product source | SHA-256 |
| --- | --- |
| `runtime.ts` | `6a86339d76e764031a26671586842467a40dc989895589ab416306e655496145` |
| `parser.ts` | `b7f4070c006221c44d822f8a6c45f24f896942ea8e7bef4290a936bb616eb2d6` |
| `input.ts` | `03fce524aef5c5fc87b65c72adefc2dd86e92b0c702d675719ebb0770b876314` |
| Unchanged `shell.ts` | `f4b9e55515e00ef456d48f6a3da60cf5b19b5af7fb91c700c151bd92726f6bb7` |

`invocation-modes-checkpoint.json` preserves source/harness hashes, failure
observations and validation history. Raw local logs additionally use prefix
`/tmp/safe-bash-shell-invocation-` with `red.log`, `green2.log`,
`old-baseline.log`, `old-postfeature.log`, `old-updated.log`, `targeted.log`,
`repeat-{1,2}.log`, `native-comparison.json`, `imports.log`, `scoped-types.log`,
`types{1,2}.log`, `build2.log`, `final-types.log`, and `final-build.log`.
Exact atomic commit and no-further-source-edits handoff are published in
`/tmp/safe-bash-shell-invocation-ready.txt`.
