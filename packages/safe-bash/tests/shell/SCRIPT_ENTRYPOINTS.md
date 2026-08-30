# Contained virtual script entrypoints

Historical file-only checkpoint. The subsequent bounded invocation batch in
`INVOCATION_MODES.md` adds command-string/stdin modes and PATH dispatch, superseding
only the unsupported-mode/PATH statements below. Its unchanged file-loader
policies and this checkpoint's original results remain recorded here.

Author checkpoint, August 26, 2026. This adds VFS script dispatch to the existing
virtual shell, not a native Bash executable or a new public plugin/API. The full
Bash goal, superiority requirement and requested 72 hours remain unfulfilled by
this increment. No runtime dependency, native process, host filesystem fallback,
ambient networking, credential loading or startup-file execution is added.

## Supported entrypoints and resolution

- Existing resolution remains shell builtin, shell function, then registered
  command. Only an unresolved name reaches script dispatch. Middleware still
  wraps dispatch and every command in the script; denying the entrypoint prevents
  its VFS stat/read. Registered commands/functions named `bash` retain precedence.
- `bash [--] file [args...]` reads a VFS file, relative to the effective cwd unless
  absolute. It requires read access, not execute access. Without `--`, leading
  `+`/`-` options are rejected. With `--`, dash-prefixed filenames are literal;
  the exact `-` stdin mode remains unsupported. Missing file argument/options
  return 2; an empty filename is a missing path, status 127.
- An unresolved name containing `/`, such as `./tool` or `/tools/tool`, runs a
  readable/executable regular VFS file with a supported Bash shebang. Direct
  execution requires `fs.capabilities.permissions === true` and backend
  `access(R_OK | X_OK)`. Unknown/false permission capability fails explicitly,
  rather than trusting synthetic mode bits. Explicit `bash file` remains usable
  on such backends if their read operations permit it.
- The only accepted shebang interpreter tags are `/bin/bash` and `/usr/bin/bash`,
  with optional surrounding horizontal whitespace and no arguments. These tags
  select this virtual runtime; they do not open or execute a host/VFS interpreter
  binary. `/bin/bash file` is not an alias: it attempts to dispatch the VFS file
  `/bin/bash`. No PATH lookup, `env` shebang, `sh`/POSIX mode or ENOEXEC fallback
  for headerless direct execution is provided. Explicit `bash file` accepts a
  headerless file but rejects any incompatible shebang too.
- Missing/dangling paths return 127. Directories, backend access failures,
  unexecutable files, unsupported interpreters/capabilities and binary/non-UTF-8
  source return 126 with a path-bearing diagnostic. Source must be UTF-8 without
  NUL, DEL or other ASCII controls except TAB/LF/CR. These are intentionally
  stricter policies than native Bash's permissive script fallback behavior.

## Process, input and resource boundaries

Scripts receive literal positional arguments, including quoted empty strings;
`$0` is the supplied script filename (not its resolved/symlink target path).
Child variables start from the exported command context plus effective `PWD`.
Private variables, functions and function-local scopes do not enter the new
script. Positional parameters, last status, loop/function depth and `pipefail`
start fresh. Child cwd/environment/options and `exit` do not mutate/terminate the
caller. Host-injected commands and middleware remain available; their authority
is unchanged. `BASH_ENV`, `ENV` and `SHELLOPTS` are not evaluated as startup hooks.

Source is read separately from stdin. Inherited stdin remains a streaming byte
source; binary input is not decoded as script text. Stream position is shared
with the caller, so unread bytes remain available after script exit. Scripts do
not acquire ownership or close that inherited stream. Descriptor maps are copied
while retaining underlying streams/sinks, preserving inherited offsets and
preventing child descriptor closure from closing the parent's descriptor.
`stdinIsDefault` passes through unchanged; no read probes infer its origin.
Literal `invoke()` retains its existing overrides, middleware and provenance
rules. A script adds no input-lifecycle policy or output lease.

All entrypoints use the existing runtime and its shared budget and cancellation
signal. Initial `Shell.exec` source plus every script read, including repeated
reads, cumulatively consume `maxSourceBytes`. Read requests carry the remaining
byte ceiling; returned bytes are checked again. Commands, loop iterations,
output, expansions and pipeline buffering retain existing shared limits. Every
script consumes one depth level under `maxSubstitutionDepth`, including scripts
entered through `invoke`; recursion cannot construct a fresh budget. Backend
stat/access/read work receives the signal and abort-aware waiting observes late
rejections. Host side effects cannot be undone and synchronous parser work cannot
be interrupted mid-call.

The complete file is parsed before any script-body command runs. Caller argument
expansion/redirection effects still occur before dispatch. Syntax failures are
reported against the script filename and return the parser's failure status to
the caller. Commands use file-relative line positions, including nested scripts.
This is deliberately not native complete-input-unit execution: a later syntax
error prevents earlier script-body effects (even before an `exit`). Lexical locale
is fixed from inherited environment for this whole-file preparse; later locale
assignments do not retroactively/repeatedly parse the file. No parser/lexer or
broad diagnostic rewrite is part of this patch.

Paths use existing virtual POSIX lexical resolution followed by backend
stat/access/read, including backend symlink handling. This is not descriptor-
relative execution, native symlink/`..` equivalence, an atomic permission/read
transaction, immutable inode identity or a security upgrade to backend wrappers.
The author suite exercises memory VFS and a capability-restricted proxy; it does
not establish remote-adapter, real-provider or mount/overlay execution parity.
Future filesystem identity/capability design requires the contracts/fs owners.

## Evidence and reproduction

The initial 36-test author suite reproduced 33 failures and 3 existing controls.
After dispatch and diagnostic propagation it passed 36/36. Five added adversarial
cases exposed one more empty-filename status error; the final suite passes
**41/41**, with no skips/TODOs, followed by three strict-rejection repeats of
41/41 each. Seven cases run in isolated strict-rejection Node
children with five-second parent deadlines: recursion, cancellation during stat,
read and registered-command work, late read rejection, pipeline output limits,
and a backend exceeding the requested source ceiling. No pending first-read
probe or first-read cleanup test was run in this track.

The separate native harness compares the same 12 interpreter-file fixtures
against both pinned profiles: **12/12 GNU 5.3 and 12/12 historical GNU 3.2**.
Comparisons use exact stdout/stderr bytes, exit status and VFS/native file bytes;
there is no normalization, per-case oracle selection or unsupported-case skip.
All native work uses bounded isolated repository temporary directories, a
scrubbed environment and two-second/256-KiB process limits; directories are
removed in `finally`. This native evidence covers arguments, status, input and
one script-line diagnostic, not direct-shebang execution or broad Bash parity.

| Profile | Executable / exact version | SHA-256 |
| --- | --- | --- |
| Primary | `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`; GNU bash 5.3.0(1)-release, aarch64-apple-darwin25.4.0 | `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c` |
| Historical | `/bin/bash`; GNU bash 3.2.57(1)-release, arm64-apple-darwin25 | `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3` |

```sh
node --unhandled-rejections=strict --import tsx --test tests/shell/script-entrypoint.test.ts
node --unhandled-rejections=strict --import tsx tests/shell/script-entrypoint-native.ts
node --unhandled-rejections=strict --import tsx --test tests/shell/{core,parser-regressions,input-units,runtime-regressions,lifecycle,inline-input-limits,glob-budget,variable-scope,descriptor-inheritance,descriptor-moves,stdin-origin,fs-error-diagnostics,fatal-diagnostics,invoke}.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsc -p tsconfig.build.json --noEmit
```

The final targeted existing cohort passes **234/234**, with no skips/TODOs or
concurrent source-guard invalidations observed. Global typecheck and build
configuration typecheck both pass with `--noEmit`; nothing was emitted. No full
owned/product suite was run. These are author checks in a moving worktree, not
independent acceptance or a clean-repository certification. The separately
recorded five pending first-read failures and paused NUL diagnostic discrepancy
remain genuine unresolved findings, not waived or relabeled by these results.

Initial HEAD: `906d66bb9cc74cba1c7010748b6f2e19e98d5509`; observed post-validation
HEAD before this commit: `cb707e69a4733a5cf1a7ff5e48060c2984934796`. Owned product
edits are only `runtime.ts` and one line of `shell.ts` to account initial source.
Root/shell-index exports, contracts, parser, input lifecycle, commands, manifests
and dependencies are unchanged by this author.

| Source | Final SHA-256 |
| --- | --- |
| `src/shell/runtime.ts` | `dabbb60ffc499a7e64fae8071f12b465b5845e7246510e19da15b406f8481d10` |
| `src/shell/shell.ts` | `f4b9e55515e00ef456d48f6a3da60cf5b19b5af7fb91c700c151bd92726f6bb7` |
| Unchanged `src/shell/parser.ts` | `73749cb5af6b6affe91014153aa4a6358bc8441807e8ad47fe09f74927c8c7b0` |
| Unchanged `src/shell/input.ts` | `c7492bb41555d865a0dcda9e3c7e8b2b3f5c5a1e73dc6e1bdb9b3fe6e7ed9a6d` |

Native capture asserts `.js` specifiers resolve to actual `.ts` source and guards
source hashes before/after. A separate Node load-hook smoke check records actual
loads of every shell `.ts` module and a script exit of 23. No adjacent generated
shell JavaScript artifacts were present. Raw evidence uses the prefix
`/tmp/safe-bash-shell-script-entrypoint-`: `red.log`, `additional-red.log`,
`final-tests.log`, `final-targeted.log`, `native.json`, `native.stderr`,
`final-typecheck.log`, `final-build.log`, `repeat-{1,2,3}.log`, and `imports.log`. The exact committed
handoff and source freeze are published in `ready.txt` under that prefix.
