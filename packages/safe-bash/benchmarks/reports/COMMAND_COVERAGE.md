# Command inventory and comparative recipe coverage

## Optional curl addendum — August 26, 2026

A separate frozen package/registry audit at
`b98e239374ccdb53860c88f41b06a4bc977ecc1d` includes the accepted curl author
commits `6854a6b` and `deab14d`. **Default plugin names remain the same 49**.
`curl` is a separately registered, authorization-required optional command;
`safejs` remains a separately injected optional command. Enabling both gives
51 registered plugin names, not 51 default tools. With the inspected 15 kernel
builtins and three overlaps, the default union remains **61**, or **63 only
with both opt-ins**. Alias factories do not add extra command names.

`networkCommands`/`curlCommands` and definition factories are available from
`virtual-bash` and `virtual-bash/commands/network`. The root aggregate never
auto-registers network access. Archimedes now owns network production and its
author/independent tests; independent curl acceptance is pending, not established
by export-map checks. Metadata authoring stays deferred until that checkpoint.

`PACKAGE_AUDIT.json` records the exact archive and source hashes, successful
frozen build/typecheck, all **15 expanded package exports** importing with packaged
declarations, **zero runtime dependencies**, and **zero external/computed imports**
across 106 emitted JavaScript files and 288 import sites. The dry-run package has
426 entries, with no tests, benchmarks or node_modules; no tarball was written.
Dedicated memory/real/shell and other command-family subpaths are not currently
declared (root exports provide their APIs); the audit adds none.

This is an additive inventory update, **not a comparator rerun**. The original
snapshot, recipes, observations and recommendation history below and in JSON
remain unchanged. In particular, historical 19-unshadowed-plugin coverage does
not grow just because optional curl now exists. Curl's former recommendation
has an author implementation awaiting independent review, not full curl parity
or evidence that the broader superiority/72-hour goal is complete.

## Scope and provenance

Captured August 26, 2026 from committed source
`33ddb70c75865e3e695cf471b942ab0add98a891`, not the moving worktree.
Node `v22.22.2`; installed isolated comparator **just-bash 3.4.2**.
The JSON companion records the archive, relevant source and installed bundle
SHA-256 hashes, package-lock integrity entry, exact registries, recipes, argv
events, byte outputs, statuses, script effects and a reproducible capture program.
No dependencies were installed, product implementations changed, native virtual
commands spawned, or provider credentials used. Runtime dependencies remain zero
in the captured root manifest. Only these two inventory reports are delivered.

This is an inventory and bounded coverage audit, not a new full benchmark or
superiority result. All broad product goals remain unproven. Independent family
tests are not silently added to the comparative denominator. Current upstream
documentation was consulted for context; installed 3.4.2 source, not upstream
`main` or remembered command lists, determines this inventory.

## Names versus implementations

Our profile is `new Shell(...).use(agentCommands())` using root exports, **not**
an assertion that a bare Shell automatically installs all tools. Optional
`safeJsCommands()` requires explicitly supplied runtime hooks for execution and
is not installed by the aggregate or this comparison.

| Measure | Our captured profile | just-bash 3.4.2 default profile |
| --- | ---: | ---: |
| Registered plugin/command names | 49 | 83 |
| Public kernel dispatcher names | 15 | 40 |
| Registered/kernel overlap | 3 | 3 |
| Unique names with a dispatcher or registry implementation | **61** | **120** |
| Names classified as shell builtins | 19 | 59 |
| Classified-only names without dispatcher/registry implementation | 0 | **13** |
| Union including those classified-only names | 61 | 133 |
| Explicitly optional extra names | `safejs` | `curl`, `python3`, `python`, `js-exec`, `node` |

Neither 61 nor 120 means that many fully implemented utilities. A dispatcher can
be partial: baseline `wait`, for example, returns success without native job
waiting. Recognized builtin names are especially not proof of implementation.
The baseline's internal `__just_bash_tee_restore` helper is excluded from public
command counts. No arbitrary dynamic user-defined functions or aliases are counted.

### Our exact names

49 plugin names:

```text
[ awk base32 base64 basename cat cksum cp cut diff dirname echo env false find
grep gunzip gzip head jq ln ls md5sum mkdir mv od patch printf pwd readlink
realpath rg rm rmdir sed sha1sum sha256sum sort tail tee test touch tr true
uniq wc xargs xxd zcat
```

15 kernel names:

```text
: break cd continue exit export false local pwd read return set shift true unset
```

`false`, `pwd`, `true` overlap the registry and kernel. `echo`, `printf`, `test`
and `[` are additionally classified as builtin names but supplied by plugins.
Optional `safejs` raises the configured union to 62 only when explicitly added;
it does not establish actual SafeJS engine correctness or upstream defect closure.

### Baseline exact names

83 registered names, verified against both `getCommandNames()` and a constructed
`Bash.commands` map:

```text
alias awk base64 basename bash cat chmod clear column comm cp cut date diff
dirname du echo egrep env expand expr false fgrep file find fold grep gunzip
gzip head help history hostname html-to-markdown join jq ln ls md5sum mkdir
mv nl od paste printenv printf pwd readlink rev rg rm rmdir sed seq sh
sha1sum sha256sum sleep sort split sqlite3 stat strings tac tail tar tee time
timeout touch tr tree true unalias unexpand uniq wc which whoami xan xargs yq zcat
```

40 public kernel dispatcher names, extracted from the installed dispatch body:

```text
. : [ break builtin cd command compgen complete compopt continue declare dirs
eval exec exit export false getopts hash help let local mapfile popd pushd
read readarray readonly return set shift shopt source test true type typeset
unset wait
```

`false`, `help`, `true` overlap the registry. Six further registry names are
builtin-classified: `alias`, `echo`, `history`, `printf`, `pwd`, `unalias`.
The remaining 13 classified names have no public dispatcher or registry entry:

```text
bg caller disown enable fc fg jobs kill suspend times trap ulimit umask
```

Each of those 13 was directly invoked on a fresh baseline shell and returned
**127, command not found**. Raw results are `recognitionOnlyProbes` in JSON.
They are not counted as available baseline workflows. Optional network/Python/JS
names are listed separately and were not enabled or executed.

### Aliases, variants and alternatives

- `[` shares predicate behavior with `test` but requires a closing `]`.
- Baseline `egrep` delegates to `grep -E`, and `fgrep` to `grep -F`. Our grep has
  these modes without alias names; this is not a wholly missing search workflow.
- Baseline `source`/`.` share a handler; `declare`/`typeset` and
  `mapfile`/`readarray` also share respective handlers.
- Baseline `bash` and `sh` are separate wrappers over shared virtual interpreter
  machinery; their names do not prove complete or distinct native dialects.
- `gzip`, `gunzip`, `zcat` are related modes, not three independent coverage wins.
- Our five default names absent from the baseline dispatcher/registry union are
  `base32`, `cksum`, `patch`, `realpath`, `xxd`. Alternative workflows may exist;
  absence of a name does not prove absence of its entire capability.

The JSON `summary.baselineOnlyDispatchNames` contains all **64** actual baseline
names absent from our profile; the classified-only 13 are excluded.

## What the comparative recipes actually reach

The existing 118-task comparison consists of **115 fixture recipes** plus three
stress probes. This audit traces all 115 recipes: 88 shell-oracle, 18 deterministic
(seed `1526603814`), seven plugin-integration and two pinned GNU-sed dialect cases.
The three stress probes were source-inspected, not rerun: concurrent pipelines
use `printf`/`cat`; cancellation and backpressure use custom benchmark commands,
not additional shipped utilities.

Our middleware records actual dispatch, including nested calls and kernel names.
It reaches **27/61 configured names**, including **21/49 registered names**.
Two of those 21, `true` and `false`, execute through the kernel; only **19
unshadowed plugin names** are reached. This is not proof all 21 plugin
implementations ran. The optional SafeJS command is not exercised here.

| Reached name(s) | Recipe count per name | Example exact recipe ID |
| --- | --- | --- |
| `printf` | 79 | `single-quotes-preserve-metacharacters` |
| `cat` | 35 | `sequential-cats-share-consumed-stdin` |
| `false` | 10 | `semicolon-continues-after-failure` |
| `test` | 7 | `test-numeric-string-and-directory-predicates` |
| `awk` | 5 | `ordinary-assignment-is-not-exported` |
| `grep` | 5 | `grep-cut-sort-text-pipeline` |
| `read` | 4 | `read-then-cat-consume-one-shared-stream` |
| `sed` | 4 | `sed-selects-and-rewrites-lines` |
| `tr` | 4 | `fixture-stdin-flows-through-pipeline` |
| `rg` | 3 | `plugin-rg-empty-pipe-implicit` |
| `sort` | 3 | `sort-uniq-count-pipeline` |
| `true` | 3 | `and-or-lists-have-equal-left-associativity` |
| `base64`, `sha256sum` | 1 each | `plugin-bytes-encode-decode-hash` |
| `gzip`, `gunzip` | 1 each | `plugin-bytes-compression-roundtrip` |
| `diff`, `patch` | 1 each | `plugin-diff-patch-roundtrip` |
| `jq` | 1 | `plugin-jq-map-pipeline` |
| `cut` | 1 | `grep-cut-sort-text-pipeline` |
| `uniq` | 1 | `sort-uniq-count-pipeline` |
| `wc` | 1 | `no-match-pipeline-still-counts-zero-lines` |
| `exit` | 1 | `explicit-exit-stops-subsequent-commands` |
| `export` | 1 | `export-makes-variable-visible-to-child` |
| `local` | 1 | `function-local-variable-restores-outer-value` |
| `return` | 1 | `function-arguments-and-return-status` |
| `set` | 1 | `pipefail-preserves-earlier-pipeline-failure` |

Counts are unique recipes, not invocations. JSON `entries[].ours.cases` and
`entries[].justBash.cases` map every traced name to every exact recipe;
`fixtures[]` includes complete scripts, inputs, initial files, recorded
expectations, observed argv events and stream/status results.

**28 of our plugin names are not reached by those comparative fixtures:**

```text
[ base32 basename cksum cp dirname echo env find head ln ls md5sum mkdir mv od
pwd readlink realpath rm rmdir sha1sum tail tee touch xargs xxd zcat
```

Seven kernel names are also unreached: `:`, `break`, `cd`, `continue`, `pwd`,
`shift`, `unset`; `pwd` overlaps the preceding list. Total unreached configured
names: **34**. This does not mean they have no independent family tests.

Baseline registry tracing observes 17 names: `awk`, `base64`, `cat`, `cut`,
`diff`, `grep`, `gunzip`, `gzip`, `jq`, `printf`, `rg`, `sed`, `sha256sum`,
`sort`, `tr`, `uniq`, `wc`. Kernel-only baseline dispatch is **not measured**;
an empty case list for a builtin is not proof it was never executed. The JSON
lists the remaining registry names as *not observed*, not absent or unsupported.

The initial builtin-coverage callback caused loader/defense-in-depth errors.
Those invalid tracing observations are preserved under `instrumentationHistory`,
not scored as product failures. A focused callback toggle isolated the issue.
Final capture disables that callback and has no such diagnostics or thrown errors.

For transparency, stream/status-only observations match fixture expectations in
115/115 of our runs and 108/115 baseline runs. **Filesystem assertions and the
three stress probes were not replayed here**, so these are not full benchmark
pass totals. All seven baseline mismatching recipe IDs and raw bytes remain in
JSON; prior full-comparator reports retain their separate denominators.

## Script execution and common option checks

Nineteen additional probes use fresh filesystems and shells. Script files have
mode `0755`; file effects and source-variable persistence are checked separately
from name registration. These probes are not added to the 115-fixture denominator.

| Recipe / behavior | Our result | Baseline result |
| --- | --- | --- |
| `bash -c ...`, `sh -c ...` with `$1` | 127, missing command | 0, `argument` plus LF |
| `bash FILE argument`, `sh FILE argument` | 127 | 0, argument output and `script.out` bytes `file` |
| `bash`, `sh` with script on stdin, no flags | 127 | 0, respective `stdin-bash` / `stdin-sh` output |
| `bash -s -- argument`, `sh -s -- argument` | 127, missing command | 127, treats `-s` as missing filename |
| `source FILE`, `. FILE` then print caller variable | 127 | 0, `loaded` plus LF and `source.out` bytes `sourced` |
| `eval 'printf evaluated'` | 127 | 0, `evaluated` |
| `./script.sh argument`, absolute script path | 127 | 0, argument output and file effect |
| `script.sh argument` after prepending virtual cwd to PATH | 127 | 0, argument output and file effect |
| `command printf command`, `builtin printf builtin` | 127 | 0, respective literal output |
| `set -e; false; printf SHOULD-NOT-RUN` | 2, unsupported option | 1; later print absent |
| `set -u; printf ... "$absent"` | 2, unsupported option | 1, unbound-variable diagnostic |
| `read -a fields` on `a b` plus LF | 2, rejected option | 0; this probe alone does not validate array contents |

Our host API `Shell.exec(source)` **does** parse and execute source strings; it
must not be confused with a `bash` command, sourcing into caller state, or executing
virtual file paths. Source inspection confirms builtin/function/registry dispatch
with no executable-file fallback at this revision. The baseline's successful
script modes do not imply all `bash`/`sh` flags: the observed `-s` failures are a
concrete partial-option limitation, not “stdin execution missing.”

## Option support is not binary name coverage

No command on either side receives a **fully supported options** label here.
Exact observed argv is retained rather than treating every dash-prefixed operand
as a flag or extrapolating one successful invocation to native parity. For example,
our `set` is present while `-e` and `-u` are rejected; baseline `bash` is present
while the tested `-s` forms fail. Sed/awk/jq/rg remain bounded subsets.

Our standard-family README option table is copied into JSON as declared coverage,
not independently proved coverage. Its statement that sed/awk are not installed
applies to that family, **not** the aggregate. Family documentation and limitations
are referenced in JSON; this report does not claim to audit every listed flag,
locale, protocol, cancellation path, permission, or filesystem capability.

## Recommended next workflow increments

This ordering is engineering judgment about basic coding workflows, **not measured
agent usage**, popularity, or a user-authorized reduction of the full goal. It is
not a proposal to implement all ten at once. Root chooses the next concrete batch.

1. **Virtual script entry points:** `bash`/`sh` command strings, files, stdin and
   executable-path/PATH dispatch. Preserve arguments, cwd, environment, streaming,
   budgets and cancellation; never launch a native process.
2. **Caller-state scripts:** `source`/`.` and bounded shell `eval`; verify variable,
   function, positional-argument and error propagation rather than name-only stubs.
3. **Reliable shell control:** `set -e/-u`, `command`, `builtin`, `type`, then cleanup
   traps. `trap` is not implemented by either inspected profile; baseline recognition
   alone is not a successful reference implementation.
4. **Metadata/permission workflows:** `stat`, `chmod`, `umask`, with truthful adapter
   capability semantics. Baseline `umask` is likewise classification-only here.
5. **Safe temporary paths:** `mktemp`, exclusive creation, concurrent collision and
   cleanup behavior across mounts. The name is absent from both inspected defaults.
6. **Bounded archives:** `tar` creation/extraction, with traversal, symlink, size and
   cancellation protection and actual backend effects.
7. **Text/table composition:** `comm`, `join`, `paste`, `nl`, `tac` for manifests,
   columns and diagnostics; choose coherent tested subsets before broadening flags.
8. **Scalar/environment helpers:** `seq`, `expr`, `printenv`, with explicit numeric,
   locale and environment semantics rather than brittle shell workarounds.
9. **Time and bounded waiting:** `date`, `sleep`, `timeout` with injectable clocks
   and cancellation. Do not silently introduce unrestricted host process control.
10. **Authorized HTTP:** optional injected-policy `curl`, default-deny network,
    bounded redirects/output/time and no ambient credentials. It is optional in
    the baseline too; a registered name is not a safe networking implementation.

These findings do not alter S3 same-ETag/ABA limits, SafeJS upstream failures,
historical test cohorts, the 72-hour objective, or the unproven requirement to be
“better than just-bash, much better.”
