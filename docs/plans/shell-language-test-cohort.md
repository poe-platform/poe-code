# Shell language/environment test cohort

## Authorization and scope

The parent approved only language/environment cohort 1: 14 direct files under
`packages/safe-bash/tests/shell/`, renamed to byte-identical `.cases.ts` modules
and imported by one static `shell-language.test.ts` entrypoint. Preserve every
original registration, name, assertion, and per-case state. No runner changes,
concurrency changes, discovery exclusions, helper edits, or duplicate wrappers.

Approved basenames: ansi-words, case, core, env-replacement, env-shebang,
expanded-gaps-env-host, expanded-gaps-fallback-host, fatal-expansion, glob-budget,
parser-regressions, pathname-classes, runtime-regressions, substitution-nul,
unsupported-options.

Russell owns remote-close.test.ts, first-read-probe.ts, remote-close-probe.ts,
and related process-helper work; do not inspect, edit, or run those files.
Other shell cohorts, old/current-shell subdirectories, root configuration,
completed diff-patch/text-program cohorts, and the frozen checkout are outside
this implementation. Parent retains commit, whole-workspace gate, and release
ownership.

Per-file process isolation intentionally becomes per-family isolation for these
14 modules only. Qualification must establish observed case-state independence;
do not confuse shared module startup with shared mutable fixtures.

## Qualification plan

1. Verify exact current bodies, fresh helper construction, and active filename
   consumers without reading excluded ownership paths; retain audit limits.
2. Capture complete original-path baselines and exact registrations/unique names.
3. Rename bodies unchanged and add only the static aggregate; verify discovery.
4. Counterbalance serial old-layout and aggregate runs using the same case paths.
5. Repeat forward/reverse/forward in one process; check descriptor/resource,
   environment, cwd, and listener stability with temporary owned probes.
6. Compare intentional failure names, counts, and source attribution across old
   and new layouts; remove all probes, restore hashes, and run final scoped checks.
7. Record every old/new path, body hash, measurement, count, caveat, and result;
   settle this cohort before any further assignment.

## Qualified result

Ready for parent review/commit. The 14 approved modules now have one static
entrypoint and retain **163 registrations, 163 unique names**, all original
assertions and byte-identical bodies. Direct shell entrypoints change 75 -> 62;
package discovery changes 557 -> 544, with every other discovered path unchanged
at both the rename and final qualification checkpoints. No runner configuration,
concurrency, discovery exclusion, compatibility wrapper, helper or production
change is part of this cohort. Cohorts 2/3 have not started.

### Inspection and isolation boundary

The approved files have no global hooks, mocks, process uses or mutable global
fixtures in the inspected syntax. Static fixture tables supply registrations;
case-owned setup creates fresh MemoryFS, command registry and Shell state. The
existing helper body is unchanged. Case budgets, cancellation controls and custom
hosts remain local to their original callbacks. There is no native fixture-file
or source-seal rewrite in this patch.

This intentionally replaces **per-file process isolation with per-family process
isolation**. Fresh per-case state is preserved; the repeated/reversed checks below
provide observed independence, not a promise against arbitrary future module
state. Do not extend the aggregate with a global-hook/process-state test without
new review.

The current permitted-input consumer audit visited 1,349 paths before renaming
and 1,350 afterwards, following resolvable relative references from maintained
admitted test/script inputs. It found no active references to the 14 original
entry paths/basenames. This is a bounded audit, not proof about excluded owners
or arbitrary dynamically generated imports. Before content reads it excludes
Russell's remote-close/probes/process-helper ownership and all shell subdirectories.
The reachable omitted set contains 21 existing files: 19 shell-subdirectory tests,
remote-close.test.ts and tests/shell-stress/process.ts. Those contents were not
inspected by this audit. Metadata-only discovery is not execution of those tests.
Historical protocols/manifests/evidence remain unchanged; no old gate is resealed
or claimed to validate this moving checkout.

### Exact path and body inventory

Each row records complete old/new workspace-relative paths and the SHA-256 shared
by the original and renamed body. All source line numbers are preserved.

| Old path | New path | Cases | Unchanged body SHA-256 |
| --- | --- | ---: | --- |
| `packages/safe-bash/tests/shell/ansi-words.test.ts` | `packages/safe-bash/tests/shell/ansi-words.cases.ts` | 8 | `6582568c0e3b5339d40b734b7eeb37267484ff005ac4102da4bf47eb20aa280b` |
| `packages/safe-bash/tests/shell/case.test.ts` | `packages/safe-bash/tests/shell/case.cases.ts` | 12 | `d3b0f67733fb6ad513d0b6971dc2af230010c874a454a54d7a1740b462359df7` |
| `packages/safe-bash/tests/shell/core.test.ts` | `packages/safe-bash/tests/shell/core.cases.ts` | 13 | `73f978e9461f0bfe1df6ba74af0fba3d557dea71501683d4e1e242ba6e6685c1` |
| `packages/safe-bash/tests/shell/env-replacement.test.ts` | `packages/safe-bash/tests/shell/env-replacement.cases.ts` | 30 | `089d0a4157b35602c85e0ad7d12cca3c699487e4a512b2bbc8ff6c7399f066f1` |
| `packages/safe-bash/tests/shell/env-shebang.test.ts` | `packages/safe-bash/tests/shell/env-shebang.cases.ts` | 29 | `9a74b1d3aa1df33e53b1f137080e5e38cda26d212673e92e17a2dbf3015f1dec` |
| `packages/safe-bash/tests/shell/expanded-gaps-env-host.test.ts` | `packages/safe-bash/tests/shell/expanded-gaps-env-host.cases.ts` | 6 | `d01394e6938cfc4758c6ee3c88a4f0660b0f6cf0aa2596a181ad71a26216628e` |
| `packages/safe-bash/tests/shell/expanded-gaps-fallback-host.test.ts` | `packages/safe-bash/tests/shell/expanded-gaps-fallback-host.cases.ts` | 6 | `73e77cc4788e67ea1769c5a060e5bc92e86fb01845d10ea747a65d03a76759a0` |
| `packages/safe-bash/tests/shell/fatal-expansion.test.ts` | `packages/safe-bash/tests/shell/fatal-expansion.cases.ts` | 21 | `fba0db645dfd56c804e1fdd00293b324058425d3ccd2a765d23834c92533dee7` |
| `packages/safe-bash/tests/shell/glob-budget.test.ts` | `packages/safe-bash/tests/shell/glob-budget.cases.ts` | 8 | `103188376375d16e335edef7de7ae4fa1c24e51a1c46ee6deedb51d4e98b5b50` |
| `packages/safe-bash/tests/shell/parser-regressions.test.ts` | `packages/safe-bash/tests/shell/parser-regressions.cases.ts` | 7 | `472aaeb11f94d053a03caf14736033458ba7a0564fe0508c5aefc3f74e601761` |
| `packages/safe-bash/tests/shell/pathname-classes.test.ts` | `packages/safe-bash/tests/shell/pathname-classes.cases.ts` | 2 | `e4563e846069805a10ece87e5d073b7954d6590ad1fee8399ddc8e5b9cbefd81` |
| `packages/safe-bash/tests/shell/runtime-regressions.test.ts` | `packages/safe-bash/tests/shell/runtime-regressions.cases.ts` | 12 | `f7965b4a8f098d5db4eef30abeb8e070e923a5fcde13760d7174c773a6914ea1` |
| `packages/safe-bash/tests/shell/substitution-nul.test.ts` | `packages/safe-bash/tests/shell/substitution-nul.cases.ts` | 6 | `e5cf65055c369820dce2583c15bbd127c2bff3330a431b8f5e1689e8e03067c8` |
| `packages/safe-bash/tests/shell/unsupported-options.test.ts` | `packages/safe-bash/tests/shell/unsupported-options.cases.ts` | 3 | `57738443866d0f7e3ef8f79f643412857c53a6622cb96e3fdecf0c6e05f77ed4` |

Added aggregate: `packages/safe-bash/tests/shell/shell-language.test.ts`, SHA-256
`b76ed46cac35ea99ea366db06ab315e194ced25fa19b2ff7ef842de452a4dbba`. Its only statements are the 14 static side-effect imports in the
inventory order, using .cases.js specifiers for TypeScript ESM resolution.
Added plan: docs/plans/shell-language-test-cohort.md (this document).
Unmodified helper: packages/safe-bash/tests/shell/helpers.ts, SHA-256
`ea3bfd82b48886c5da020ef3983243d5139b9da23821a6a36336cb58eb804cb4`.

### Serial timing evidence

Environment: Node v22.22.2, package-local tsx 4.23.12, Darwin arm64. The parent
and other owners were active in the same live worktree; these are local serial
measurements, not a dedicated-host or CI wall-time guarantee. Caches were not
purged. No unrelated process was stopped.

The original-path baseline ran three complete serial sweeps before renaming:
- Baseline 1: wall 6278.932 ms; # duration_ms 6242.465375.
- Baseline 2: wall 7178.739 ms; # duration_ms 7134.948667.
- Baseline 3: wall 7245.487 ms; # duration_ms 7203.327625.
All three passed 163/163 with the exact same ordered names. The 14 additional
per-file runs also passed and concatenate to precisely that name sequence. An
initial single-entrypoint discovery assertion failed before implementation, then
passed after the aggregate was added; the initial aggregate passed 163/163.

The following counterbalanced series used the same renamed body paths throughout.
Old = explicitly run all 14 .cases.ts files as separate isolated Node test files;
new = run only shell-language.test.ts. Both use the same existing serial option,
--test-concurrency=1, with default file isolation. There is no --isolation=none.
Every row passed 163/163 with exact original ordered names, no failures,
cancellations, skips or todos, and empty stderr.

| Run | Layout | External wall ms | TAP duration ms |
| ---: | --- | ---: | ---: |
| 1 | new | 1875.033 | 1826.302666 |
| 2 | old | 8409.342 | 8364.317459 |
| 3 | old | 8184.471 | 8139.023875 |
| 4 | new | 2300.833 | 2229.353708 |
| 5 | new | 2067.605 | 2023.801583 |
| 6 | old | 8733.308 | 8689.794 |
| 7 | old | 8058.577 | 8016.640833 |
| 8 | new | 2026.914 | 1977.948583 |
| 9 | new | 1881.481 | 1834.421791 |
| 10 | old | 7319.964 | 7278.062625 |
| 11 | old | 7166.849 | 7124.601917 |
| 12 | new | 1573.737 | 1536.308542 |

Six-sample median: **old 8.122 s -> new 1.954 s**,
**75.94% lower**, saving
**6.167 s per family sweep**
(4.16x speedup). This removes 13 startup processes,
not 13 tests. Timing variation is retained rather than selecting the fastest pair.

The 248 admitted production TypeScript files have the same before/after/final
fingerprint: `23c44178009dddc3c7e2741b4b331004fab44379b25b68abfa3477899abcd2a1`. This fingerprint covers the admitted runtime input
set only, not the whole repository, excluded evidence or other owners' files.

### Repeated/reversed state and resource controls

A temporary owned, file-based probe statically imported the 14 modules in forward,
reverse-module and forward order with three distinct query suffixes, while sharing
the same underlying helpers/runtime modules. Each process therefore ran the 163
original registrations three times: 489/489. The reverse run reverses module order,
not statement order inside a module. The expected emitted names were exactly the
original per-file name lists concatenated forward/reverse/forward.

Three complete serial probe processes passed:
- Probe 1: 3585.075 ms wall, 489 pass, 0 fail/cancel/skip/todo, empty stderr.
- Probe 2: 3423.027 ms wall, 489 pass, 0 fail/cancel/skip/todo, empty stderr.
- Probe 3: 3437.749 ms wall, 489 pass, 0 fail/cancel/skip/todo, empty stderr.

Before/after each case, after two setImmediate settling turns, the temporary hooks
compared immutable invocation-local snapshots of /dev/fd identities (fd/dev/ino/mode),
active resource type/counts, process listener names/counts, cwd and a SHA-256 of
sorted environment entries. Environment values were never printed. The file-based
census took an explicit descriptor root, ignored only transient EBADF entries,
and used fresh local counters. It rejected new/replaced descriptors or resource
count growth, and required exact listener/cwd/environment equality. Stdio was
initialized before the baseline. Each process checked all 489 case boundaries;
maximum observed descriptors was 15 in each process.

Three intentional negative controls per probe were rejected: an open /dev/null
descriptor, an active interval timer and an added process listener. Each was cleaned
in finally, then baseline restoration was checked. These assertions do not add to
the original test count. Temporary hooks/probe files were removed before final
runs. This observes settled own-process resource stability, not whole-host resource
isolation, heap retention, opaque external resources or every possible future leak.

### Failure attribution and restoration

A temporary assertion was inserted at the first test callback in each of the 14
owned case modules. Parameterized registrations expand those 14 insertion sites
to **52 failing tests**, leaving 111 passing. Old-layout TAP, aggregate TAP and the
maintained concise reporter each exited 1 with 163 tests, 111 pass, 52 fail and
zero cancelled/skipped/todo. Old/new TAP have identical full registration and
failed-name sequences. Every failed name is visible through the maintained
reporter (accounting for TAP backslash escaping). All three outputs identify the
correct case source files and injected assertion lines for all 14 modules, not
merely the aggregate entrypoint. Stderr is empty.

Temporary insertion lines (not present in final bodies):
- tests/shell/ansi-words.cases.ts:12
- tests/shell/case.cases.ts:13
- tests/shell/core.cases.ts:7
- tests/shell/env-replacement.cases.ts:27
- tests/shell/env-shebang.cases.ts:10
- tests/shell/expanded-gaps-env-host.cases.ts:11
- tests/shell/expanded-gaps-fallback-host.cases.ts:9
- tests/shell/fatal-expansion.cases.ts:15
- tests/shell/glob-budget.cases.ts:16
- tests/shell/parser-regressions.cases.ts:7
- tests/shell/pathname-classes.cases.ts:6
- tests/shell/runtime-regressions.cases.ts:8
- tests/shell/substitution-nul.cases.ts:7
- tests/shell/unsupported-options.cases.ts:6

The injections were removed in finally. All 14 body hashes again match their
originals, old paths are absent, aggregate bytes match the static import list,
and helper bytes remain unchanged. Final clean runs:

- Aggregate TAP: 163 tests, 163 pass, 0 fail/cancel/skip/todo;
  # duration_ms 1395.340334.
- Aggregate maintained concise reporter: 163 tests, 163 pass,
  0 fail/cancel/skip/todo; duration_ms 1433.047583.
- Maintained integration-inputs + test-reporting regressions: 106 tests,
  106 pass, 0 fail/cancel/skip/todo; duration_ms 22472.186125.
- Final permitted-input audit: zero old-path consumers, 1,350 visited and the
  same 21 ownership omissions. Final discovery: 544 paths, unchanged since rename.
- Final source and helper fingerprints unchanged. No probe files or injected
  failures remain. No whole-shell, Russell, whole-workspace or release gate is
  claimed by this bounded qualification.

### Reproduction and handoff

Run from packages/safe-bash. The exact baseline filename list is the new-path
inventory above with the packages/safe-bash/ prefix removed; pass those 14 paths
explicitly, not a whole-directory wildcard. For old-layout reproduction:
node --import tsx --test --test-concurrency=1 --test-reporter=tap <14 case paths>.
For aggregate reproduction:
node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/shell/shell-language.test.ts.
For the maintained reporter replace --test-reporter=tap with
--test-reporter=./scripts/test-reporting.mjs. Runner regression command:
node --test --test-concurrency=1 --test-reporter=tap scripts/integration-inputs.test.mjs scripts/test-reporting.test.mjs.

For a fresh manual state audit, use a temporary owned entrypoint with the three
static import sequences and distinct query suffixes described above; compare all
489 names and instrument the specified settled case boundaries. Exercise and
restore each descriptor/timer/listener negative control before running cases.
For failure controls, insert an assertion only at the listed first callback sites,
compare full old/new/concise outcomes, then restore exact hashes in finally.
Remove all temporary files; finish with the clean aggregate and body checks.
These are manual qualification steps, not new permanent QA/runner infrastructure.

Owned cohort files are settled for the parent's commit queue. No Git, hook,
release, concurrency or factory work was performed here. Russell's scope, other
shell cohorts, historical evidence, prior diff-patch/text-program handoffs and
/tmp/poe-speed-integration-20260901 remain untouched by these edits. Parent retains
normal-hook commit, integration and release responsibility.

## Complete ordered registration evidence

The JSON arrays below record all emitted TAP names, in original file and
registration order (TAP-escaped names are retained exactly). There are 163 entries
and 163 distinct entries; no deduplication or skipped cases is used.

### ansi-words.test.ts (8)

```json
[
  "ANSI-C modern escapes from pinned GNU 5.3 capture: \\\\u00e9\\\\U0001f600'",
  "ANSI-C modern escapes from pinned GNU 5.3 capture: \\\\u1\\\\u12\\\\u123\\\\u1234\\\\u12345'",
  "ANSI-C modern escapes from pinned GNU 5.3 capture: \\\\q\\\\xZ\\\\uXY\\\\8\\\\cA\\\\c?\\\\c'",
  "ANSI-C modern escapes from pinned GNU 5.3 capture: \\\\c\\\\\\\\'",
  "ANSI-C words compose with assignments, substitutions and literal patterns",
  "ANSI-C words preserve expansion and malformed-source guards",
  "GNU 5.3 C-locale Unicode escapes retain canonical ASCII spellings",
  "ANSI-C locale follows input-unit parsing, not later same-unit assignments"
]
```

### case.test.ts (12)

```json
[
  "case modern grammar without Bash 3.2 parser artifacts: case x in x) say A ;& y) say B ;; esac",
  "case modern grammar without Bash 3.2 parser artifacts: case x in x) say A ;;& y) say B ;; x) say C ;; esac",
  "case modern grammar without Bash 3.2 parser artifacts: case x in x) say A ;& $(err BAD)) say B ;;& x) say C ;; esac",
  "case modern grammar without Bash 3.2 parser artifacts: say \"$(case x in x) say nested;; esac)\"",
  "malformed case fails before effects: say ran >marker; case x in x) :;;",
  "malformed case fails before effects: say ran >marker; case x x) :;; esac",
  "malformed case fails before effects: say ran >marker; case x in x|) :;; esac",
  "malformed case fails before effects: say ran >marker; case x in x) : ;& ;& esac",
  "malformed case fails before effects: say ran >marker; : ;; :",
  "malformed case fails before effects: say ran >marker; case x in x) :;; y) say \"$(true |)\";; esac",
  "case subject and patterns share expansion and command budgets",
  "adversarial case matching has bounded work before any arm effects"
]
```

### core.test.ts (13)

```json
[
  "quotes, escaped syntax, comments and empty arguments",
  "splitting expands only unquoted substitutions and joins adjacent parts",
  "variables, defaults, assignments, export and unset",
  "status, negation, and-or lists are left associative",
  "command substitution handles nested syntax and removes only trailing newlines",
  "parse whole script including substitutions before any command or redirect",
  "redirects truncate, append, consume stdin and preserve byte data",
  "descriptor duplicates are snapshots applied left to right",
  "cwd, environment and pipeline state isolate across executions",
  "if, elif, loops, break and continue",
  "functions, positional arguments, groups, returns and exits",
  "pathname expansion respects quotes, hidden entries and missing patterns",
  "missing commands and invalid statuses are diagnosed"
]
```

### env-replacement.test.ts (30)

```json
[
  "real agent pipeline: env -i A=1 B=2 env -u A",
  "real agent pipeline: env -i A=1 B=2 env -u A | cat",
  "real agent pipeline: env -i A=1 B=2 env -u A env",
  "real agent pipeline: TEMP=prefix env -i env",
  "real agent pipeline: env -i",
  "real agent pipeline: env -i EMPTY= VALUE=a=b env",
  "exact exported map: env -u PUBLIC report",
  "exact exported map: env -i report",
  "exact exported map: env -i -C /other PWD=caller report",
  "exact exported map: env -i -C /other report",
  "private/exported separation at bash startup",
  "private/exported separation at sh startup",
  "literal invoke replace=undefined supplied=false",
  "literal invoke replace=undefined supplied=true",
  "literal invoke replace=false supplied=false",
  "literal invoke replace=false supplied=true",
  "literal invoke replace=true supplied=false",
  "literal invoke replace=true supplied=true",
  "shell-local type mirrors the approved contract without casts",
  "replacement does not impose a lineage policy on later default invocation",
  "validation before entry {\"bad=name\":\"value\"}",
  "validation before entry {\"bad\\\\u0000name\":\"value\"}",
  "validation before entry {\"GOOD\":\"bad\\\\u0000value\"}",
  "parent function locals, exports, cwd survive replacement and child status",
  "private clone remains private until explicit export; no global lineage reset",
  "middleware sees exact child map; caller map is copied",
  "origin and binary cursor undefined",
  "origin and binary cursor ",
  "origin and binary cursor 0,255,195,169,10",
  "read consumes only its prefix before nested replacement"
]
```

### env-shebang.test.ts (29)

```json
[
  "env shebang uses the public Shell without registering env",
  "single optional argument is not shell-tokenized without S",
  "short, attached, long and nested S preserve quoting and literal arguments",
  "split expansion reads incoming exports before clear, unset and assignments",
  "C resolves actual selected source and keeps parent cwd and state",
  "absolute original source survives C and is charged and read only once",
  "alternate operand, c and s select source rather than original body",
  "explicit interpreters ignore headers while direct interpreter guards remain",
  "bash/sh flags retain e, +e, --, combinations and invalid flag status",
  "env errors retain parser, usage and VFS status and ordering",
  "reserved interpreter resists hijacks while exact registered targets execute",
  "binary stdin, pipelines, unread cursor and inherited descriptors survive",
  "stdin provenance is forwarded without probing or local promotion",
  "initial and alternate file permission, binary and syntax refusals retain effects",
  "shared source, command, output, depth, loop and generated argv limits",
  "aggregate plugin direct env behavior remains literal and separate",
  "selected file, c string and s input each charge their actual source",
  "env parser caps and carriage-return command bytes survive the bridge",
  "guarded completion: executable VFS delegates retain literal argv and normal body resolution",
  "guarded completion: slash targets never normalize basenames or bypass VFS checks",
  "guarded completion: exact registered definitions beat functions and builtins and stay pinned",
  "guarded completion: missing bare names refuse PATH, files, functions and builtins",
  "guarded completion: env and target middleware observe exact exports, cwd, argv and provenance",
  "guarded completion: env pipeline middleware is transparent and adds no command or depth charge",
  "guarded completion: env middleware short circuits, wraps and observes original target errors",
  "guarded completion: registered nested invoke stays ordinary and replacement streams share budgets",
  "guarded completion: direct delegate cycles and registered cycles use shared limits",
  "guarded completion: env scoped invoker owns replacement streams without inherited exports",
  "guarded completion: target middleware can change scoped state or short circuit without fallback"
]
```

### expanded-gaps-env-host.test.ts (6)

```json
[
  "explicit env interpreter outcome \"/usr/bin/env bash -e\"",
  "explicit env interpreter outcome \"/usr/bin/env -S bash -e\"",
  "explicit env interpreter outcome \"/usr/bin/env python\"",
  "explicit env interpreter outcome \"/usr/bin/env\"",
  "explicit env interpreter outcome \"/usr/bin/env bash\\\\r\"",
  "env shebang refuses a registry override rather than silently bypassing it"
]
```

### expanded-gaps-fallback-host.test.ts (6)

```json
[
  "fallback safety nonexecutable",
  "fallback safety binary",
  "fallback safety invalid-utf8",
  "fallback prevalidates syntax before file effects",
  "fallback symlinks preserve argv and parent cursor",
  "fallback shares recursive depth budget"
]
```

### fatal-expansion.test.ts (21)

```json
[
  "fatal expansion stops its execution environment: : \"${missing:?stop}\"; : >after",
  "fatal expansion stops its execution environment: { : \"${missing:?stop}\"; : >inside; }; : >after",
  "fatal expansion stops its execution environment: func() { : \"${missing:?stop}\"; : >inside; }; func; : >after",
  "fatal expansion stops its execution environment: : \"${missing:?stop}\" || : >recovered; : >after",
  "fatal expansion stops its execution environment: value=\"${missing:?stop}\"; : >after",
  "fatal expansion stops its execution environment: : >\"${missing:?stop}\"; : >after",
  "fatal expansion stays isolated in a child environment: value=$(: \"${missing:?stop}\"; : >inside); status=$?; : >after; exit \"$status\"",
  "fatal expansion stays isolated in a child environment: (: \"${missing:?stop}\"; : >inside); status=$?; : >after; exit \"$status\"",
  "fatal expansion stays isolated in a child environment: set -o pipefail; { : \"${missing:?stop}\"; : >inside; } | :; status=$?; : >after; exit \"$status\"",
  "fatal expansion stays isolated in a child environment: : \"$(: \"${missing:?stop}\"; : >inside)\"; : >after",
  "fatal expansion stops its execution environment: : \"$((1/0))\"; : >after",
  "fatal expansion stops its execution environment: { : \"$((1/0))\"; : >inside; }; : >after",
  "fatal expansion stops its execution environment: func() { : \"$((1/0))\"; : >inside; }; func; : >after",
  "fatal expansion stops its execution environment: : \"$((1/0))\" || : >recovered; : >after",
  "fatal expansion stops its execution environment: value=\"$((1/0))\"; : >after",
  "fatal expansion stops its execution environment: : >\"$((1/0))\"; : >after",
  "fatal expansion stays isolated in a child environment: value=$(: \"$((1/0))\"; : >inside); status=$?; : >after; exit \"$status\"",
  "fatal expansion stays isolated in a child environment: (: \"$((1/0))\"; : >inside); status=$?; : >after; exit \"$status\"",
  "fatal expansion stays isolated in a child environment: set -o pipefail; { : \"$((1/0))\"; : >inside; } | :; status=$?; : >after; exit \"$status\"",
  "fatal expansion stays isolated in a child environment: : \"$(: \"$((1/0))\"; : >inside)\"; : >after",
  "arithmetic command errors remain nonfatal command failures"
]
```

### glob-budget.test.ts (8)

```json
[
  "glob expansion enforces byte budget before effects: {\"source\":\": * >after\",\"paths\":[\"aaaaaaaaaaaaaaaaa\"],\"limit\":16}",
  "glob expansion enforces byte budget before effects: {\"source\":\": * >after\",\"paths\":[\"aaaaa\",\"bbbbb\",\"ccccc\"],\"limit\":14}",
  "glob expansion enforces byte budget before effects: {\"source\":\": * >after\",\"paths\":[\"ééééé\"],\"limit\":9}",
  "glob expansion enforces byte budget before effects: {\"source\":\": */ >after\",\"paths\":[\"abcdefgh/file\"],\"limit\":8}",
  "glob expansion enforces byte budget before effects: {\"source\":\": */* >after\",\"paths\":[\"aaaa/bbbb\",\"aaaa/cccc\"],\"limit\":17}",
  "glob expansion enforces byte budget before effects: {\"source\":\": $patterns >after\",\"paths\":[\"aaaaaaaa\",\"bbbbbbbb\"],\"limit\":15,\"env\":{\"patterns\":\"a* b*\"}}",
  "glob expansion enforces byte budget before effects: {\"source\":\": */nonexistent >after\",\"paths\":[\"abcdefghijklmnop/file\"],\"limit\":14}",
  "glob results can fill the byte budget exactly"
]
```

### parser-regressions.test.ts (7)

```json
[
  "non-shell whitespace remains literal and never stalls tokenization",
  "continuations preserve keyword, operator and descriptor recognition",
  "misplaced negation and unsupported expansion syntax reject before effects",
  "parameter alternates inherit outer double-quote rules",
  "compound commands require separators before quoted and expanded words without effects",
  "missing compound separators reject recursively in skipped branches and functions",
  "compound commands still accept separators, list operators, closing parentheses and EOF"
]
```

### pathname-classes.test.ts (2)

```json
[
  "unmatched bracket tokenization yields to cancellation",
  "pattern compilation consumes finite work before matching empty subjects"
]
```

### runtime-regressions.test.ts (12)

```json
[
  "synchronous cancellation observes already-rejected command promises",
  "synchronous cancellation observes already-rejected input promises",
  "blocked upstream reads require caller cancellation, not consumer completion",
  "broken-pipe writes cancel signal-waiting upstream commands",
  "redirected input resources close after partial, zero and failed consumption",
  "independent truncate descriptors maintain offsets, duplicated descriptors share them",
  "redirection failure diagnostics honor descriptors already established",
  "declarations preserve expanded whitespace and functions export prefix values",
  "builtins honor middleware cwd and environment overlays",
  "read and repeated commands share one non-replayable stdin offset",
  "syntax validation does not even initialize inherited input",
  "arithmetic stays bounded and handles short circuit, updates and overflow"
]
```

### substitution-nul.test.ts (6)

```json
[
  "command substitution removes NUL before trimming newlines: \"a\\\\u0000b\"",
  "command substitution removes NUL before trimming newlines: \"a\\\\u0000b\\\\n\\\\n\"",
  "command substitution removes NUL before trimming newlines: \"a\\\\n\\\\u0000\"",
  "command substitution removes NUL before trimming newlines: \"\\\\u0000\\\\u0000\"",
  "command substitution removes NUL before trimming newlines: \"é\\\\u0000🙂\\\\n\"",
  "substitution sanitization leaves ordinary binary pipelines unchanged"
]
```

### unsupported-options.test.ts (3)

```json
[
  "native-backed errexit forms stop before subsequent commands and file effects",
  "combined errexit and nounset options succeed without taking the failure branch",
  "supported set forms still execute normally"
]
```
