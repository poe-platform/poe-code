# Two discovery fixes — author checkpoint, 2026-08-27

This closes only the two source findings routed from independent commit
`d02c3b53982d84d6ae74887c2fbf85510f4628bc`. Independent acceptance remains pending.
Original findings are preserved in
`tests/shell-stress/invocation-closure/POST_READY.md` and the coordinator's
`/tmp/safe-bash-shell-invocation-closure-review-findings.txt`.
No independent expectations, earlier READY files, read-N or POSIX policy changed.

## Source change

Only `src/shell/runtime.ts`, inside `discoveryBuiltin`, changes:

- `command -V` makes a relative PATH-search result absolute using the virtual
  cwd. It removes one leading `./`, not embedded dots, parents, repeated slashes
  or symlinks. Names containing `/` retain their supplied spelling. Existing
  `command -v` and `type` displays remain distinct, including the sh profile.
- Unknown `command` flags fail with status2, the first invalid flag, the existing
  script-name/line diagnostic prefix, and GNU usage text. Repeated/combined v/V
  remain last-wins, and `--` terminates option processing. `command -p` remains
  explicitly unsupported; the standard usage spelling is not a promise of a
  host default PATH. `type` option parsing is unchanged.

No changes to dispatch precedence, registry roles, FS resolution, data access,
middleware, budgets, cancellation, stdin origin, exports, public API or dependencies.
The BOM capture fix in `shell.ts` is unchanged. No host execution in product code.

| Source | SHA256 |
| --- | --- |
| runtime before (3aa3a41 / baseline d02c3b5) | `8af9bb685fee68e6f199e1ebf9613ac8da50572f357fd98599e570d30810e820` |
| runtime after | `bb629885983de4169d8419c97f8d09be2ae1729841ae306675ce530cd8287d7c` |
| unchanged shell (abdc741) | `4ac91162195c150848793c92b8b1e90f15a36e67b5ae8a2652fe7ed9dcf4fb5e` |

## Native evidence and profiles

`invocation-discovery-fixes-native.json` contains both complete profiles:
26 sources × actual argv0 `bash`/`sh` = **52 rows each**, plus two version calls.
The same sources and fixture bytes run in both, in fresh isolated directories.
The VFS reproduces each recorded native cwd before evaluation: stdout/stderr
hex and status comparisons need **no output normalization**. Native before/after
file-content, symlink and namespace snapshots are exact. The virtual FS wrapper
rejects data reads and mutation methods during every native-backed discovery row.
PATHs cover relative/absolute/empty/components/dots/parents/repeated-slashes,
direct-slash names, cwd changes, spaces, symlinks, prefix/local assignments,
real builtin `true`, flags and diagnostics. Native fixtures are discovered, never
executed; their literal `/bin/bash` shebang does not impersonate a 5.3 child.

- Primary: GNU bash **5.3.0(1)-release**, aarch64-apple-darwin25.4.0;
  `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA256
  `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
- Historical: GNU bash **3.2.57(1)-release**, arm64-apple-darwin25;
  `/bin/bash`, SHA256
  `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
- `argv0=sh` selects that exact binary's sh behavior; no `/bin/sh` surrogate.
  This is not a claim of complete POSIX parser support.
- Exact argv: `--noprofile --norc -c SOURCE shell`; environment only
  PATH empty, LC_ALL/LANG=C, HOME=case cwd, TZ=UTC. Empty stdin.
- Each native child has a 2.5-second detached-process-group deadline and 256KiB
  output cap. All **106 child PIDs/groups were absent**, and native directories
  were removed. No watcher is used.

Primary sources consulted: GNU Bash manual 5.3, Bash Builtins
(`https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html`), and
the local pinned GNU5.3 source extracted from
`https://ftp.gnu.org/gnu/bash/bash-5.3.tar.gz`.
`builtins/command.def` assigns CDESC_ABSPATH only to verbose command discovery;
`builtins/type.def` bypasses that transformation for direct-slash names;
`lib/sh/makepath.c` removes one leading `./` without canonicalizing the result.
Those source SHA256s respectively are
`0189759e29c50d527fa89932654ef585cc29b98b592a6b59744f6ca84aa79d34`,
`bd6fda6403e4bd872830c105e5e4f0eef6ee0a2e2fe9f5db792c8e405e1d41b6`,
`347048944ca16e15eed00bd18ea950838d36e547e17290fa1e3db1dcad24d88d`.
The batch did not repeat the earlier tarball-signature verification.

## Results and retained failures

| Cohort | Result |
| --- | --- |
| Red, before production edits | 44/112: primary20/52, historical19/52, host5/8 |
| First source-fixed run | 95/112: primary52/52, historical36/52, host7/8 |
| Final author run | **96/112: primary52/52, historical36/52, host8/8** |
| Unchanged legacy72 + author132 | **204/204** |
| Unchanged earlier author211 | **210/211**, diagnostic expectation conflict |
| Earlier file41 + unchanged independent17 | **58/58** across named runs |
| Global/build/benchmark noEmit | exit0 / exit0 / exit0 |

All raw failures remain failing assertions: no skips, TODOs, xfails or
historical per-case oracle selection. The new test suite intentionally exits1
for its **16 historical raw disagreements**: two empty-PATH `command -v`/`type`
spelling rows and fourteen diagnostic-line rows (3.2 line0/1 versus 5.3 line1/2).
The original nine historical findings are separate and were not rerun.

One new author control initially set maxCommands=2 and incorrectly expected
`command command -V true` to exceed it. It needs two ticks, so that expectation
was a harness error, not a source bug. The corrected control proves success at2
and failure at1. Both original red and first-fixed results remain immutable.

The old author assertion `unsupported discovery options do not silently dispatch`
still expects `/unsupported option/` for `command -x`. Actual now is exactly:

```text
shell: line 1: command: -x: invalid option
command: usage: command [-pVv] command [arg ...]
```

That old test is **unchanged and failing**, not silently waived. Original
independent query-V/type printf-role conflicts remain untouched: native printf
is a builtin while the virtual registry's printf is a registered command.
This batch independently tests real builtin true plus explicit custom registry
and virtual-interpreter labels; it does not falsify kinds. The new independent
role-corrected version was not inspected or executed before this source freeze.

## Guards and reproducibility

Node **v22.22.2**, direct TS through tsx; no emitting compiler command.
The load hook records actual `.ts` URL, source hash, PID and module format.
New cases import22 distinct product TS files; legacy/earlier author import34.
Their imported product hashes match both run endpoints. Source and scenario
hashes, exact commands, TAP, process statuses and endpoint maps are retained in
the `-red.json`, `-validation.json`, `-checkpoint.json`, and `-file-guard.json`.

The legacy204 run's broad guard was **invalidated** by foreign
`src/fs/s3/filesystem.ts` changing from
`728119796aaa3ffa8b6c50fffae7df7919263352c8a48a4633e77901bbf4c9e1` to
`97f91913c3b2a9916218776d286eeaf25928d3aebbe3df60f0bf2d24d1635f6f`.
Its actual imports were stable; this is not whole-tree acceptance. Other foreign
source changes between phases are visible in endpoint maps, not flattened into
an imaginary frozen product. No drift-driven retry loop was performed.

The first file17 guard omitted two test helpers outside its enumerated directory.
Their load hashes are preserved as two mismatches, not called a stable full
guard. The guard includes those two paths now; the narrowly repeated file17
run passes with zero imported/endpoint mismatches. The first type run guarded
the shell/source snapshot only; the final type run additionally pre-enumerates
all actual compiler inputs: **929 global /296 build /411 benchmark**, with no
changed or unguarded compiler inputs. Endpoint hashes do not prove absence of
transient writes/reverts. No current-clean-HEAD or aggregate acceptance claim.

Run from repository root (evidence writers require NEW output names):

```sh
node --unhandled-rejections=strict --import tsx tests/shell/invocation-discovery-fixes-native.ts /tmp/discovery-native-new.json
node tests/shell/invocation-discovery-fixes-verify.mjs final /tmp/discovery-validation-new.json
node tests/shell/invocation-discovery-fixes-verify.mjs checkpoint /tmp/discovery-checkpoint-new.json
```

The verifier records, rather than suppresses, nonzero test statuses; inspect
each run's status/counts, not the evidence writer's exit status. The native
replay creates new isolated paths; the committed tests reproduce the original
captured coordinates solely in VFS. Compiler commands are explicitly
`tsc --noEmit`, `tsc -p tsconfig.build.json --noEmit`, and
`tsc -p benchmarks/tsconfig.json --noEmit` (with `--listFiles` for guards).

No first-read, paused NUL, frozen remote audit, full suite or old historical9
replay. The five custom first-read failures remain open. No source/dot/eval;
full-shell scope, independent acceptance and superiority remain unproven.

Final cleanup checked **130 recorded PIDs and their process groups absent**,
including native children, validation parents and recorded TS-loading children.
No owned native directories or watcher remain. Eight named frozen regression/
finding files were byte-compared with baseline d02c3b5 and remain identical.
The repository advanced concurrently to observed HEAD
`d5b8fff0f146b6789899390bc6edcadfa1684e3a`; only the owned runtime source is
included in this fix, not foreign in-progress FS/structured/benchmark work.
