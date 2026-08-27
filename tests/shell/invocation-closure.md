# Invocation acceptance closure — serialized author track

This is a bounded continuation of shell source `21a6b91`, not full Bash,
full POSIX sh, lifecycle acceptance, or a superiority claim. Initial inspected
HEAD was `f06f2886300885c51a90cac0794a6a6d53be53fd` on 2026-08-27. Three
separate commits cover discovery/dispatch, read-N, then sh assignments.
Contracts, commands, filesystem adapters, root exports, dependencies, independent
expectations, and frozen invocation-mode tests are not owned or modified here.

## Group 1: discovery and command dispatch

`command [-v|-V] [--] name ...` performs discovery. Without these flags,
`command [--] name args ...` dispatches in the current shell state while bypassing
functions. Each dispatched target still traverses middleware, the same budgets,
signal and descriptors; `cd`, declarations and exit retain their builtin effects.
Literal command-prefix declaration arguments retain assignment expansion.
`command -p` is explicitly rejected (status 2): there is no host/default PATH.
Other unsupported flags are rejected, not ignored. Last `-v`/`-V` wins.

`type [-aftpP] [--] name ...` supports all matches, function suppression, kind,
ordinary path-only and forced PATH search. Last output-mode flag wins. No names
returns zero. `command` discovery succeeds if any name is found; `type` requires
all names. `type -ap`/`-aP` require actual files, not hidden builtin matches.

Resolution is function, actually implemented builtin, registered command,
virtual bash/sh, then VFS PATH. This corrects the prior builtin-before-function
precedence. The same internal selection is used by dispatch and discovery;
`command` suppresses only functions. Registry changes are immediately visible.
Registered commands report `command` / “registered command”; virtual interpreters
report `interpreter` / “virtual shell interpreter”. These honest extension labels
are not native Bash builtins or external host executables. Unregistered printf,
cat and other optional commands are not falsely advertised. Parser keywords and
aliases are not currently discovery categories; aliases are unimplemented.

PATH uses effective shell variables (including locals/prefix assignments), fresh
VFS stat/access and backend symlink resolution. No hash cache or host fallback.
All-path queries preserve candidate order. Relative paths in sh discovery are
cwd-prefixed as native sh does; explicit slash names retain their spelling.
An internal profile field is introduced here for this presentation distinction;
assignment policy is the third serialized group, not enabled by this commit.
Native non-executable last-resort discovery is deliberately not advertised:
this runtime requires an executable permission capability and X_OK. Discovery
finds executable candidates, not a promise that later read/shebang/UTF-8 checks
will succeed; execution retains the previous strict text/interpreter policy.
Stat/access/read is not an atomic lease and makes no new adapter security claim.

Function descriptions come from the stored AST, with lexical word spelling
retained during parsing (no new grammar). Simple grouped definitions match the
native cohort exactly. Complex compound formatting is a faithful representation,
not a claim of byte-for-byte GNU pretty-printer parity for every AST form.

Initial 42-case regression: **2 pass / 40 fail** before source changes. The final
expanded author group is **50/50**, including six five-second hard-bounded strict
Node children for depth/commands/output/source/loop budgets and late lookup
rejection with typed cancellation identity. The combined existing semantics plus
initial discovery group is **271/271**. No first-read probes ran.
Fresh complete live-native comparison: **36/36 primary, 30/36 historical**.
The six historical differences are mixed-name type status, missing-name verbose
diagnostic prefixes and empty-PATH discovery spelling, each in both argv0 modes.
They remain exact failures in `invocation-closure-discovery-checkpoint.json`, not
normalized or dialect-waived. Build-config noEmit passes. A later global noEmit
retry instead encounters four unowned missing declarations in the concurrently
created structured jq independent review; no owned shell errors remain.

## Native evidence and reproducibility

`invocation-closure-cases.ts` contains the complete scenario inputs.
`invocation-closure-discovery-reference.json` captures every native record for
18 cases × bash/sh argv0 × two binaries: **72 observations**. Primary 5.3 is the
uniform expectation profile, historical 3.2 is retained separately. Native sh is
the actual selected binary launched with argv0 `sh`, never mislabeled `/bin/sh`.
Direct `#!/bin/bash` fixture execution really uses historical `/bin/bash` under
both parents; the evidence explicitly records that provenance.

Every native invocation has a scrubbed environment, isolated repository temporary
directory, 2.5-second process-group deadline and 256-KiB output bound; the group
is killed on deadline/close, all streams observed and directories removed.
Snapshots compare exact stdout/stderr bytes (base64), status and all file bytes.
There is no stderr masking or per-case oracle selection. Generated cwd is recorded
as an input; the virtual filesystem is populated at that identical path, rather
than normalizing path-bearing output. The first red capture lacked this namespace
input; the full cohort was recaptured after recording it, not patched per case.
Every comparison guards all shell TS source hashes; imports assert runtime.ts.

Pinned primary: GNU 5.3.0(1)-release, aarch64-apple-darwin25.4.0,
`/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
Historical: GNU 3.2.57(1)-release, arm64-apple-darwin25, `/bin/bash`, SHA256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
The evidence embeds full version strings, source hashes and scenario hash.

```sh
node --unhandled-rejections=strict --import tsx --test tests/shell/invocation-closure-discovery.test.ts
node --unhandled-rejections=strict --import tsx tests/shell/invocation-closure-native.ts --capture
node --unhandled-rejections=strict --import tsx tests/shell/invocation-closure-native.ts --verify
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsc -p tsconfig.build.json --noEmit
```

Official GNU 5.3 manual sections consulted (native raw evidence resolves option
ordering and exact formatting, rather than guesses from the prose):

- `https://www.gnu.org/s/bash/manual/html_node/Bash-Builtins.html`: command/type/read.
- `https://www.gnu.org/software/bash/manual/html_node/Special-Builtins.html`.
- `https://www.gnu.org/software/bash/manual/html_node/Bash-POSIX-Mode.html`.

At group-1 validation global noEmit is blocked by unowned structured-input
`toWellFormed` lib targeting, entry-comparison optional typing and structured jq
author-report implicit-any errors. An owned FsError-construction type error was
fixed, not waived. Fresh final type results follow in the final group. Five known
custom first-read cases and nine historical native findings remain separate;
no contracts/lifecycle/source-eval or broad NUL diagnostic changes are included.
