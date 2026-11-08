# Source/dot author checkpoint

2026-08-27; starting HEAD90cbf287b8533c2dad9211d87d6cb66290a80132.
Product writes began only after the coordinator's GRANTED lease was observed at
02:08:25Z. The preceding expanded-seven replay remains separate, not rerun here.

`.` and `source` now evaluate VFS text in the active Runtime/State, not a child
Shell. They require regular readable files, not executable permission or a
shebang. PATH search uses only virtual effective PATH, with Bash cwd fallback;
the sh profile does not fall back after a nonempty PATH search misses. Empty or
unset PATH permits the current directory. Direct slash paths are VFS resolved.
`--` is supported; other options, including GNU5.3 source `-p`, are explicitly
unsupported. Headerless *execution* and env-shebang dispatch are not added.

Variables/export/cwd/functions/options persist. Arguments temporarily replace
positionals and preserve $0; shift alone restores supplied arguments on return,
while set -- persists at top level. Function-scoped sourcing restores function
arguments. No-argument sourcing shares the original positionals. Return ends
the sourced script, not its caller; exit and loop control propagate. Subshells,
pipelines and invoke retain their existing isolation boundaries. Dot is a POSIX
special builtin; normal nonzero script status does not itself terminate sh.

Input units parse before their own effects; earlier complete lines may execute
before a later syntax error. The captured sh first-unit syntax failure is fatal,
but a later error after an executed unit returns2. Strict UTF8/control-byte
source policy is inherited from file invocation and intentionally narrower than
native arbitrary-byte input. No full Bash grammar, traps, startup files or
new parameter expansion is added. Source files are bounded-read in full before
evaluation; execution stdin is not the source file and retains its cursor/origin.

Depth, commands, loops, output and aggregate UTF8 source bytes share the caller's
budget/signal. Source reads pass R_OK, maxBytes and signal through the existing
VFS API. Cancellation preserves error identity and observes late rejection.
No shared contracts, exports, dependencies, FS/command code or BOM path changed.

## Evidence

- New entire primary native cohort: **48/48**, bash/sh ×24 definitions.
- Same entire historical cohort: **41/48**, seven raw diagnostic/profile losses
  retained in `source-dot-eval-source-comparison.json`, not normalized away.
- Source host bounded child: **1/1** checks recursion, source UTF8 boundary,
  command/loop/output budgets, exports, byte cursor/origin, readable symlinks,
  permissions, cancellation identity and delayed rejection. Deadline5s is a
  failure bound, never a caller rescue counted as success.
- Guarded source49/49 and build `tsc --noEmit`: exit0, stable endpoint/import
  hashes; **296** prelisted actual compiler inputs, none unguarded.
- `source-dot-eval-red.json` preserves initial **0/84** source+eval controls;
  eval is still unimplemented at this first semantic commit.

Primary `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`5.3.0 and historical
`/bin/bash`3.2.57 each run the complete cohort with actual argv0 bash/sh, C locale,
empty PATH, HOME=isolated cwd, TZ=UTC, empty/injected stdin and no ambient startup
environment. The reused author native helper supplies 2.5s process-group and
256KiB output bounds and removes each owned directory. Captures include actual
versions/hashes, fixture hash, exact bytes/status/file effects and source hashes.
No executable child fixture is launched, so its shebang metadata is irrelevant.
Virtual observations reproduce each native cwd in memory; no output rewriting.

Official references: GNU5.3 Bourne Shell Builtins manual and local pinned
`builtins/source.def`, plus POSIX.1-2024 Shell Command Language special builtins:
`https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html`
and `https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html`.
The source.def set-versus-shift positional restoration guided the implementation.

Reproduce (new output names required):

```sh
node --import tsx tests/shell/source-dot-eval-native.ts capture source /tmp/source-native-new.json
node --import tsx tests/shell/source-dot-eval-native.ts compare source /tmp/source-compare-new.json
node tests/shell/source-dot-eval-verify.mjs source /tmp/source-validation-new.json
```

The native comparison exits1 for retained historical mismatches. Validation
writers retain per-command statuses; their own exit is not an acceptance result.
No independent current-shell expectations read; no old9/firstread/NUL/jq/BOM or
full-suite run. Source/dot remains an author handoff pending independent review.
