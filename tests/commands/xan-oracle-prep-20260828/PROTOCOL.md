# PRE-EXECUTION developer discovery protocol

Author scope, not independent acceptance. Frozen before **any** native xan process,
including version/help. Target exclusively official xan 0.54.0; Darwin arm64,
non-TTY byte pipes. Execution requires this file, ROWS.json, provenance.json and
run.mjs committed together, with clean owned paths and a recorded commit ID.
No product code exists in this directory. This opt-in `.mjs` is not a `.test.*`
or TypeScript input; JSON and `.data` files are native-oracle data, not TS fixtures.
No canonical test writer or discovery/configuration changes are authorized.

## Binding and budget

`ROWS.json` contains exactly 28 commands; all observations are UNKNOWN-DISCOVERY,
not pass expectations. No extra command, including retry/help/version, is allowed.
Each row runs once in its own newly created OS-temp directory with exact fixture
bytes and piped stdin, no shell and no network operation. Paths in fixtures are
relative VFS-equivalent ordinary files. Only declared output paths may change.
Per child: 5 seconds, 1 MiB aggregate stdout/stderr, 1 MiB aggregate output files,
64 KiB stdin and fixture bytes. Aggregate child wall budget <=140 seconds.
All 28 rows including version and four help probes count against the budget.
File growth is checked every 20ms and at close; polling can overshoot a hard OS
quota, so these tiny bounded CSV inputs and non-expanding commands are required.
No host root fixtures, external/user data, unbounded generators or whole benchmark.

Environment is replaced, not inherited: LC_ALL=C, LANG=C, TZ=UTC, NO_COLOR=1,
TERM=dumb, PATH=/usr/bin:/bin, HOME=<row cwd>, TMPDIR=<row cwd>.
Cwd is unique per row; argv[0] is the pinned absolute binary. Source/binary hashes,
exact stdin/fixtures, argv, env, cwd, timestamps, stdout/stderr base64, code/signal,
effects, PID, timeout/limit flags and child `close` receipt are retained.
Darwin observations are not Linux claims. No Rust build or toolchain invocation.

## Lifetime and capture

Runner creates one detached process group per child, pipes all descriptors,
observes stdin EPIPE, and awaits `close` (process exit plus stdio close). Timeout,
output-limit or parent signal sends SIGKILL to the owned group. Following close,
kill(group,0) must return ESRCH; unexpected surviving group is killed and the run
stops rather than admitting another row. No watchers, SIGSTOP or escaped children
are authorized. This proves settlement for known child/groups, not arbitrary
malicious process escape. No wall limit claims for uninterruptible kernel work.

Evidence goes only into a fresh owned OS-temp run directory. Retained small JSON
reports are copied with apply_patch into this subtree after execution, in a
separate evidence commit. Frozen inputs and protocol never get rewritten to green.
Preparation failure is preserved separately; no successful provision claim before
the version row. Source-only fallback is mandatory if the binary cannot run.
There is no native product fallback, dependency installation, quarantine bypass,
system configuration, global cache mutation or private checkout access.

## Deliberate coverage limits

This is author observation, not an independent fixture freeze or stress suite.
No timing/RSS comparison, symlink/hardlink destructive test, cancellation oracle,
all-flags combinatorics or arbitrary-chunk product acceptance occurs here. These
remain future review obligations. Stop at 28 rows even if surprises occur.
