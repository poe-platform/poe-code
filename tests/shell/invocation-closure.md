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

## Group 2: exact-count read

Group 1 commit: `7e69fe19521d806782f135f4d1827052ef6b8976`.

`read` adds `-N count` to `-r`, `-n`, `-d` and `--`. Count may be attached,
signed nonnegative decimal, or a separate argument; safe-integer bounds remain
explicit. Once any `-N` appears, delimiter recognition and IFS splitting remain
disabled even if a later `-n` replaces the count. Last count wins. `-d` is ignored
in exact mode. NUL is skipped rather than counted; raw mode preserves backslashes,
otherwise escapes and backslash-newline continuation are processed. EOF assigns
the partial result and returns 1. Count zero assigns empty without pulling input.
With multiple names the complete value goes to the first and the rest are empty.

Counts use Unicode codepoints in UTF-8 locales and bytes in C/POSIX. Virtual shell
variables remain UTF-8 text: invalid input or a count ending inside a multibyte
sequence fails explicitly rather than manufacturing replacement text. Unread
binary tail bytes stay on the same shared cursor; this is not arbitrary-byte
shell variable parity. The existing generic unsupported-option diagnostics and
legacy read-n invalid-count profile are not broadly rewritten.

Red author cohort: **5/69 pass, 64 fail**. After the input-reader mode flag and
runtime option/splitting changes: **69/69**. An additional invalid-name red case
checks status/diagnostic and validates all names before consuming input, bringing
the final group to **70/70**. Five chunk-size cases split Unicode
input at every byte, then compare the exact raw binary tail. Four isolated bounded
children cover cooperative cancellation/late rejection, source/output/loop limits.
The source reader is not eagerly collected; read-N data consumption precedes the
next stdin source unit. Input cleanup/lifecycle implementation is unchanged.

Frozen invocation132 and file-entrypoint41 passed unchanged during the 199-case
run; its sole failure was the old read-options assertion explicitly rejecting
`-N 2`. Only that obsolete array member is removed, as a transparent activation
of the newly implemented option, not a weakened invalid-option test. All other
invalid options and all frozen invocation expectations remain unchanged.

The complete native read cohort is 28 cases × both argv0 modes × both binaries
(112 observations). `en_US.UTF-8` is present in `/usr/bin/locale -a` and supplied
explicitly to Unicode cases; exact per-case locale is embedded in reference JSON.
GNU 5.3 source `builtins/read.def` confirms sticky ignore-delimiter state, empty
IFS for N, and separate count parsing (lines 356–367 and 416–423). Source from the
already signature-verified official 5.3 distribution has SHA256
`f4c50b4e13cb7208ba871234b3efc874d9896c03ef8922121a3e6e0cca3c181f`.
Related official source hashes: type.def
`bd6fda6403e4bd872830c105e5e4f0eef6ee0a2e2fe9f5db792c8e405e1d41b6`,
command.def `0189759e29c50d527fa89932654ef585cc29b98b592a6b59744f6ca84aa79d34`.
These references supplement the official manual, not a copied implementation.
Official source archive: `https://ftp.gnu.org/gnu/bash/bash-5.3.tar.gz`, SHA256
`0d5cd86965f869a26cf64f4b71be7b96f90a3ba8b3d74e27e8e9d9d5550f31ba`.
The supplied capture's signature log records GOODSIG/VALIDSIG for GNU maintainer
key `7C0135FB088AAF6C66C650B9BB5869F064EA74AB`; the native binary remains pinned
separately by its own hash rather than equating a parent version with child mode.
The fresh complete native comparison passes **56/56 primary, 2/56 historical**;
historical 3.2 does not implement N. All 54 differences remain in the raw
checkpoint, not excused as passes. Global and build-config noEmit pass at this
group's retry (earlier concurrent errors remain recorded above).

The combined regression run before the additional name case reports **334/335**:
50 discovery + 69 read-N + 26 old read-options + frozen132 + file-author41 +
file-holdout17. Its one genuine frozen holdout mismatch is
`builtin-function-registry-shadow`: that old expectation encodes builtin-before-
function precedence, which group 1 intentionally corrects using primary and
historical native evidence. The holdout is not edited, skipped or waived; route
this required expectation review to its owner. Thus the prior file cohort is
**57/58**, not a clean 58/58 claim. No independent new closure expectations were
read, and frozen invocation132 remains unmodified and passing.

```sh
node --unhandled-rejections=strict --import tsx --test tests/shell/invocation-closure-read.test.ts
node --unhandled-rejections=strict --import tsx tests/shell/invocation-closure-native.ts --capture read
node --unhandled-rejections=strict --import tsx tests/shell/invocation-closure-native.ts --verify read
```

## Group 3: explicit sh assignment profile

Group 2 commit: `6370e717c0f540991fb980a10b36725f301e2f3c`.

Only actual virtual `sh` invocation selects this profile, across file, -c and
stdin/-s modes. `bash` resets to Bash policy; commandname/$0 does not select a
profile. Top-level Shell remains Bash even if a supplied environment contains
POSIXLY_CORRECT. No startup files, implicit env-driven mode changes or complete
POSIX parser are introduced. Subshells, functions, substitutions and literal
invoke retain the profile; fresh interpreter processes isolate state as before.

For implemented special builtins (`:`, break, continue, exit, export, readonly,
return, set, shift, unset), sh retains prefix assignments and their export
attribute. Regular utilities and function-prefix assignments remain temporary in
the GNU 5.3 profile. Historical 3.2 sh differs on function-prefix/local and unset
behavior; the modern result is not inferred from old documentation. Special
builtins precede functions in sh discovery/dispatch, and defining a function with
one of these implemented special names is a fatal error. `command` bypasses
functions and suppresses special prefix-assignment/fatal-error treatment, while
explicit export/unset of a named variable still has that builtin's effects.

Special-builtin failures terminate the virtual noninteractive sh, including
redirection failure. Shift's range failure remains nonfatal. Existing return,
shift and set option/diagnostic limitations outside the covered cases remain;
this is not a broad diagnostic rewrite. `command set` in sh suppresses the
special fatal treatment even for explicitly unsupported options.

Bounded scalar `readonly [--] name[=value] ...` and `readonly -p` support is added
to test actual assignment failures rather than inventing readonly state. Other
readonly options (arrays/functions) are rejected. Attributes protect assignment,
export/local/unset/read, arithmetic and parameter writes and loop variables;
local attributes unwind and interpreter process environments inherit values,
not readonly attributes. Listings contain only actual virtual attributes, not
invented native BASHOPTS/UID/etc. Complex declaration/attribute printing and
special-variable interactions are not universal native parity claims.

Readonly read errors happen after consumption and preserve earlier successful
name assignments; the intermediate-name status differs from final-name status
as captured from 5.3. Failed fatal readonly assignments are checked before
target redirection effects, while ordinary successful prefix assignments do not
retroactively alter redirection-word expansion. The new native file snapshots
caught and fixed unwanted marker-file creation on four profile/effect cases.

Initial group: **31/71 pass, 40 fail**. Three additional controls all failed
(endless empty chunks, readonly read assignment order, special redirection
fatality); all were fixed. The empty-chunk case initially hit its five-second
child deadline, not a caller-rescued pass. The bounded reader now yields after
128 input pulls even when chunks are empty; cursor ownership/close lifecycle is
unchanged. A test output ceiling equal to the exact four-byte result was corrected
to three bytes (a stronger bound, not a relaxed result). Later native file-effect
expansion reproduced **87/91 pass, 4 fail**, then the final group passed **91/91**.

## Final author checkpoint

- New author cases: **211/211** (50 discovery, 70 read-N, 91 sh).
- Final combined cohort: **684/684**, comprising those 211, frozen invocation132,
  file-author41 and existing semantics300. No skips, xfails or TODOs.
- Prior file holdout: **16/17**; combined prior file cohort remains **57/58**.
  The unmodified old builtin-before-function assertion requires its owner's
  review. It is not waived and this is not independent acceptance.
- Complete live native cohorts: **162/162 GNU 5.3**, **69/162 historical 3.2**.
  Discovery is 36/36 versus 30/36; read is 56/56 versus 2/56; sh is 70/70 versus
  37/70. All 93 historical differences stay failures, and all three verification
  commands return nonzero because of them. Do not merge these counts with the
  earlier nine historical invocation findings; those are a separate open cohort.
- Global, build-config and benchmark-config TypeScript checks pass with noEmit.
  Earlier moving-worktree failures are retained above. No emitting tsc ran.
- An actual loader hook confirms **30 imported product .ts files**, including
  shell and imported contracts/core/memory dependencies, with hashes before/after
  loading. The final 684-case run also checks those 30 dependency hashes unchanged.
  No source/dependency guard invalidation occurred in that guarded run.
- Six discovery, four read and six sh/safety checks use hard-bounded isolated
  strict-rejection children. Native processes use bounded process groups. All
  owned children finish or are killed by their bounds; no watchers are retained.

`invocation-closure-checkpoint.json` records source/scenario/import hashes,
revision provenance, frozen-test hashes and counts. The group reference JSONs
retain exact native observations; sh's final raw comparison is in
`invocation-closure-sh-checkpoint.json`. The import proof and its runnable source
are committed, not only a /tmp assertion. A new final-source recheck is needed
after any source/dependency change; this is still a moving-worktree author
checkpoint, not clean-product certification.

Public/root/shell-index export names changed: **none**. The only new source module
is the internal AST function-display helper; parser word spelling is metadata,
not new syntax. No contracts, manifests, dependencies, commands or FS sources
are changed by this author. The five custom first-read failures, prior nine
historical differences and pending NUL diagnostic remain open and unrerun here.
No source/dot/eval, arrays, jobs, startup/interactive features or host execution
are added. UTF-8 variable/boundary limits, non-atomic VFS lookup, unsupported
command -p, keyword/alias discovery and full compound pretty-print parity remain
explicit limits. Full Bash, superiority and the 72-hour objective remain pending.

```sh
node --unhandled-rejections=strict --import tsx --test tests/shell/invocation-closure-sh.test.ts
node --unhandled-rejections=strict --import tsx tests/shell/invocation-closure-native.ts --capture sh
node --unhandled-rejections=strict --import tsx tests/shell/invocation-closure-native.ts --verify sh
node --unhandled-rejections=strict --import tsx tests/shell/invocation-closure-imports.ts
node --unhandled-rejections=strict --import tsx --test tests/shell/{invocation-closure-discovery,invocation-closure-read,invocation-closure-sh,invocation-modes,script-entrypoint,core,parser-regressions,input-units,runtime-regressions,lifecycle,inline-input-limits,glob-budget,variable-scope,descriptor-inheritance,descriptor-moves,stdin-origin,fs-error-diagnostics,invoke,read-options,heredoc}.test.ts
node --unhandled-rejections=strict --import tsx --test tests/shell-stress/script-entrypoint/holdout.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsc -p tsconfig.build.json --noEmit
./node_modules/.bin/tsc -p benchmarks/tsconfig.json --noEmit
```

## Native harness and reproducibility

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
