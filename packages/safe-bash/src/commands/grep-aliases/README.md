# Bounded grep aliases

This source module adds **two spellings, not new matching capabilities**:
`egrep` directly calls the existing bounded grep handler with `-E` prepended;
`fgrep` does the same with `-F`. Neither dispatches a command named `grep`,
parses a shell command string, spawns a native process, nor adds a dependency.
All product file and pattern-file access uses the supplied VFS.

## Module API

- `createGrepAliasCommands(options?: GrepAliasOptions)` returns both definitions.
- `grepAliasCommands(options?: GrepAliasOptions)` returns a plugin registering
  both names with collision preflight before either registration.
- `egrepCommand(options?: GrepAliasOptions)` and
  `fgrepCommand(options?: GrepAliasOptions)` return standalone definitions.
- `GrepAliasOptions` has optional `regex: RegexExecutionOptions` and
  `replace: boolean`. Replacement defaults to false and affects plugin setup,
  not returned definitions. Invalid regex configuration is rejected by the
  existing executor policy.

One family call creates one underlying grep definition and one executor shared
by both aliases. Its worker count, queued request count/bytes, active-request and
startup timeouts, idle timeout and worker memory/stack settings retain the
existing `RegexExecutionOptions` semantics. Separate family/standalone factory
calls create separate executors; they do not create a shared global shell budget.

The wrapper forwards the original signal, streams, stdin provenance, VFS, env,
cwd, invocation and cleanup hooks. Only `command` (diagnostic spelling) and
literal `args` change. The underlying `withRegexSession` still registers cleanup
synchronously before session acquisition and awaits retirement in `finally`.
The wrapper acquires no resource and adds no pre-handler asynchronous work.
Opaque, uncooperative host work is not forcibly stoppable; cancellation inherits
the underlying byte-I/O and session-cleanup contract.

The source import is `src/commands/grep-aliases/index.ts`; after a build the
internal module is `dist/commands/grep-aliases/index.js`. These names are **not
root exports, a package subpath or default aggregate commands in this patch**.
Integration proposal for the root owner: export these four functions and the
options type, optionally expose `./commands/grep-aliases`, and decide aggregate
registration separately with the existing collision/replacement policy.

## Inherited option and diagnostic profile

The inspected grep parser supports `-E -F -i -v -n -c -l -L -q -h -H -o -w -x
-a -e -f -m -s -z` and its existing corresponding long options. These wrappers
do not implement `-G`, `-P`, recursive/context options, native help/version, or
any additional grep syntax. Repeating the alias's own matcher flag is accepted;
combining `-E` with `-F` is an error, including an explicitly conflicting alias
flag. `--`, option arguments and pattern operands retain literal argv semantics.
Native alias option precedence is not universally identical to this profile.

Stdin, explicit `-`, file operands, `-e`, `-f` (including stdin pattern files),
quiet/early-stop behavior and exit statuses are those of existing grep: normally
0 selected, 1 unselected, 2 utility error, with existing `-q` error precedence.
Diagnostics have the alias prefix, e.g. `fgrep: conflicting matchers specified`.
VFS error wording, short usage messages, matcher diagnostics and sink-error
handling are inherited, not advertised as byte-identical GNU/BSD diagnostics.
The bounded engine's byte-oriented matching and ordered alternatives remain;
for example `egrep -o 'a|ab'` on `ab` yields `a`, not POSIX leftmost-longest `ab`.
This is not a complete POSIX/GNU grep implementation or a new regex engine.

The aliases emit **no obsolescence warning**. The official GNU Grep Usage manual
states that GNU 3.8 introduced such warnings (section “What happened to egrep
and fgrep?” at `https://www.gnu.org/software/grep/manual/html_node/Usage.html`,
consulted 2026-08-27). This is a deliberate profile difference, not evidence that
GNU native stderr matches. Native capture retains raw stdout/stderr as base64;
no warning removal, stderr normalization or latest-version claim is made.

## Author evidence and limits

See `tests/commands/grep-aliases/REPORT.md` for the frozen native corpus,
source/worker hashes, scoped commands, original failures and handoff status.
The always-runnable corpus is native-derived BSD evidence, not an all-input
proof. GNU capture requires a genuine local pinned GNU installation; its absence
is an explicit prerequisite gap, not a pass. Neither scoped tests nor type/build
checks establish a whole-package gate, broad native parity or superiority.
