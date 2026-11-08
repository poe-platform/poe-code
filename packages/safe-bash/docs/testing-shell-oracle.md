# Deterministic shell oracle corpus

`tests/fixtures/shell-cases.json` is a data-only differential corpus for the
TypeScript virtual Bash implementation. It contains **88 fixtures: 64 core and
24 advanced-pending**. Expected results come from independently executed
`/bin/bash`, not the virtual implementation. This delivery adds no test runner,
dependencies, or implementation claims.

## Acceptance tiers and feature tags

Every fixture has a `tier` and a nonempty `tags` array:

- `core`: mandatory baseline behavior. An unsupported core fixture is an unmet
  requirement, not a pass. The tier does not assert current implementation support.
- `advanced-pending`: an executable Bash reference for eventual shell support.
  Keep these visibly pending/unsupported until the relevant virtual-shell
  capabilities exist. Do not silently exclude them from reported totals or
  count an expected failure, skip, or missing implementation as a success.
- Tags identify the exercised features, such as `shell.quoting.single`,
  `shell.stdin.shared-offset`, `shell.loop.while`, and `command.awk`. They support
  filtering and diagnosis; they are not an exhaustive parser capability graph.
  A future runner must consider the entire script, not assume that one matching
  tag proves the script is supported.

A future report should separate Bash-oracle verification, virtual-shell passes,
virtual-shell mismatches, and unsupported/not-run cases for each tier. All
four expected result fields must match before a virtual-shell case can pass.
Do not make a fixture pass by weakening its expectations or promoting pending
behavior without executing it. A nonzero expected exit code is a valid test
result, not a reason to skip the case.

## JSON contract, version 1

The top-level object has `schemaVersion`, `oracle`, and `fixtures`. The oracle
object records the executable, argument template, fixed environment, umask,
and per-case deadline. `{script}` in `oracle.argv` means one literal argv
element containing the fixture's script; it is not text interpolation into a
second shell command. `shell-oracle` is a fixed `$0`; no positional arguments
are supplied.

| Fixture field | Meaning |
| --- | --- |
| `name` | Unique, stable, lowercase hyphen-separated identifier. |
| `tier` | Exactly `core` or `advanced-pending`. |
| `tags` | Nonempty array of unique feature identifiers. |
| `script` | Complete Bash program, supplied verbatim as the argument after `-c`. |
| `initialFiles` | Optional map of relative POSIX paths to UTF-8 text. Default `{}`. |
| `env` | Optional map of environment variable names to literal string values. Default `{}`. |
| `stdin` | Optional UTF-8 text supplied once to the shell's stdin, then EOF. Default `""`. |
| `expected.stdout` | Exact captured stdout, including all whitespace and final-newline state. |
| `expected.stderr` | Exact captured stderr, independently of stdout. |
| `expected.exitCode` | Integer process exit code from 0 through 255. |
| `expected.files` | Complete resulting map of regular-file paths to exact UTF-8 contents. |

`expected` and all four of its fields are required, even when empty. File maps
are snapshots, not changesets: unchanged input files remain in `expected.files`.
An extra file, missing file, or unexpected truncation is a failure. `{}` means
that there must be no regular files, not that filesystem checking is disabled.
Map key order does not matter; file bytes and stream bytes do. Do not trim,
normalize line endings, sort output, or add missing final newlines when comparing.

Create parent directories for `initialFiles` before execution. Paths must be
nonempty, normalized, relative POSIX paths: no absolute paths, `.` or `..`
components, empty components, backslashes, trailing slash, or NUL. Reject a
file path that is also an ancestor of another file path. Spaces and dotfiles
are allowed. Materialized inputs are ordinary files with mode `0644`; use
directory mode `0755`. The file-content schema does not assert directory
entries, empty-directory persistence, metadata, permissions after execution,
links, or binary encodings. Unexpected symlinks and special files must be
rejected, not followed or silently omitted.

Reject duplicate JSON keys and duplicate fixture names. Treat scripts, file
contents, stdin, and environment values as literal data; never interpolate them
into harness shell commands. Environment names must be valid shell identifiers,
and environment values and scripts must not contain NUL. This corpus uses text
only; extending it to arbitrary bytes or richer filesystem entries requires an
explicit schema decision rather than lossy decoding.

## Reproducible Bash execution

For each manually reviewed fixture:

1. Create a fresh, private temporary directory and resolve its physical path.
   Use it as the process working directory and the only fixture data root.
   Populate `initialFiles` without executing their contents.
2. Construct a new environment, without inheriting the user's environment.
   Start with the JSON baseline: `PATH=/usr/bin:/bin`, `LANG=C`, `LC_ALL=C`,
   and `TZ=UTC`. Set `HOME`, `TMPDIR`, and `PWD` to the temporary root, then
   add the fixture's `env` entries. Set the child umask to `0022`.
3. Do not let fixture environment entries override harness controls, including
   `PATH`, `HOME`, `TMPDIR`, `PWD`, `OLDPWD`, `LANG`, `LC_*`, `TZ`, `IFS`,
   `BASH_ENV`, `ENV`, `SHELLOPTS`, `BASHOPTS`, `CDPATH`, `GLOBIGNORE`,
   `POSIXLY_CORRECT`, or exported function names (`BASH_FUNC_*`). Do not import
   aliases, functions, startup files, shell options, or host-specific variables.
4. Invoke `/bin/bash` directly with the recorded argv. Use `--noprofile` and
   `--norc`, noninteractive execution, and a pipe for stdin. Supply the fixture
   stdin exactly once, closing the writer at EOF. Do not run the script through
   a login shell, command-string wrapper, terminal, or the virtual shell.
5. Capture stdout and stderr separately, enforce the 5,000 ms deadline, and
   record the exit code. A timeout, signal termination, spawn failure, or output
   limit breach is a harness failure, not a substitute expected exit code.
   Use a separate process group so deadline cleanup terminates descendants too.
6. Enumerate the entire temporary tree, including dotfiles and nested paths,
   using non-following metadata inspection. Compare regular files and streams
   exactly with the expected data. Reject links and special files. Clean up the
   temporary root only after all case processes have exited.

Use bounded output capture (a 1 MiB combined stream budget is ample for this
corpus), a 1 MiB per-file limit, and small total filesystem limits. Every current
script produces only a small, fixed amount of output; every loop is bounded by
fixed input or a three-iteration counter. These limits are safeguards, not a
reason to execute unfamiliar programs.

The stdin pipe is important: sequential `cat` commands must share the same
consumed stream, not receive fresh copies. `read` consumes one line before
`cat` sees the remainder. A redirected command must not consume the inherited
stdin stream, and a pipeline input redirection overrides that pipeline endpoint.

The current fixtures use these Bash builtins: `printf`, `true`, `false`,
`export`, `exit`, `test`, `read`, `local`, `return`, and `set`. Their external
commands are system `cat`, `tr`, `sed`, `sort`, `uniq`, `awk`, `grep`, `cut`,
and `wc`. Reserved words and shell syntax are not external commands. No
fixture requires a package manager, interpreter installation, network access,
or project source files. The chosen scripts run on the verified Bash 3.2
baseline; they do not require Bash 4/5-only syntax.

## Safety and portability

A temporary working directory is isolation for deterministic data, **not a
security sandbox**. Execute only reviewed, repository-authored fixtures. Never
feed downloaded scripts, user-supplied programs, or generated unknown inputs to
the host Bash oracle. Review edits before rerunning, including commands hidden
inside expansions or heredocs. System executables are the only intentional
outside-root dependencies; fixture data reads and writes stay inside the root.

The corpus does not access absolute data paths (including `/dev/null`), traverse
parent directories, use the network, inspect host files, start background jobs,
delete host paths, or use unbounded recursion. It avoids clocks, PIDs, random
values, interactive input, environment dumps, and filesystem enumeration order.
`LC_ALL=C` fixes byte-oriented glob and sort order; text-tool arguments avoid
GNU-only options and unspecified `echo` behavior. Cross-platform portability is
a design constraint, not a claim of having run on an untested operating system.

For errors, the missing-input and missing-grep-file cases capture diagnostics
into a shell variable and emit only the original failure status and whether a
diagnostic exists. This checks error behavior without freezing a Bash version,
platform-specific wording, line number, or executable prefix into the golden
data. The final fixture exit code may be zero because the reporting command
succeeds; the failed operation's status is asserted in stdout. Exact stderr
cases use intentional `printf` output instead of native error messages.
The `wc` pipeline normalizes tool-specific count padding within the reviewed
script, never in the comparison logic.

## Coverage inventory

| Tier | Coverage |
| --- | --- |
| Core | Comments, token boundaries, single/double/adjacent quotes, escaped metacharacters and newlines, empty arguments, and whitespace. |
| Core | Parameter expansion, field splitting, literal environment values, assignment order, assignment-only behavior, command-local assignments, and export scope. |
| Core | Semicolon lists, `&&`/`||` short-circuiting and equal left associativity, explicit exit, and default pipeline status. |
| Core | Text pipelines using `printf`, `cat`, `tr`, `sed`, `sort`, `uniq`, `awk`, `grep`, `cut`, and `wc`. |
| Core | Input/output/append redirection, descriptor duplication order, multiple truncations, redirection-only commands, and file side effects. |
| Core | Shared stdin consumption, repeated `cat -` operands, input-redirection isolation, and input redirection overriding a pipe. |
| Core | Command substitution newline stripping, field splitting, concatenation, stderr separation, and assignment exit status. |
| Core | Star/question/bracket globs, C-locale ordering, dotfile exclusion, unmatched/quoted patterns, paths containing spaces, and nested files. |
| Core | Missing-input and missing-file errors, preventing later truncation after a failed redirect, and no-match pipelines. |
| Advanced-pending | Parameter default/alternative/assignment operators, length and pattern removal, and arithmetic expansion. |
| Advanced-pending | `for`, `while`, `until`, `read -r`, line preservation including EOF without a newline, `if`/`elif`/`else`, predicates, and `case`. |
| Advanced-pending | Functions, arguments, return status, local variables, subshell scope, brace groups, and persistent file effects. |
| Advanced-pending | `pipefail`, pipeline negation, pipeline-local variable scope, nested substitution, quoted/unquoted heredocs, and here-strings. |

This is a deterministic seed corpus, not exhaustive full-shell coverage or a
large-input stress benchmark. Later suites should separately address additional
syntax, malformed programs, bytes/NUL, Unicode/locale behavior, option variants,
filesystem mutation APIs, permissions, signals/job control, large streaming
backpressure, performance, and provider-specific filesystem behavior. Do not
infer those capabilities from this corpus.

## Recorded verification

On **2026-08-26**, all 88 fixtures were checked on macOS (`Darwin arm64`) with
`/bin/bash` reporting `3.2.57(1)-release`:

- A temporary Python verifier rejected duplicate JSON keys, checked schema,
  names, tags, safe paths, environment restrictions, and file-map invariants.
- Every script passed Bash syntax checking, then ran in a fresh temporary root
  with a clean environment, piped stdin, a deadline, and exact result comparison.
- All 88 stdout/stderr/exit-code/file-snapshot comparisons matched, including
  64 core and 24 advanced-pending cases and 73 distinct feature tags.
- A separately written Node verifier reran the corpus in forward, reverse, and
  rotated order, using byte comparisons, active output limits, process-group
  timeout handling, and fresh file snapshots. All 264 executions matched.
- Together the two independent verifiers completed 352 matching Bash executions.
  There are 22 cases with initial files, seven with explicit stdin, and five
  with an expected nonzero final exit code. No virtual-shell results are claimed.

The verification scripts are intentionally not shipped: this assignment owns
the fixture corpus and this document only. Subsequent oracle refreshes must
repeat independent checks, inspect every changed golden result, and record the
host and Bash version. Passing the host oracle establishes fixture validity;
it does not establish that the virtual Bash implementation passes any fixture.
