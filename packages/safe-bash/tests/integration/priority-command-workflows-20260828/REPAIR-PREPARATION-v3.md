# Preparation repair v3 — NO GO

August 28, 2026. Successor executable source and pre-run protocol:
`2a63780fd8ddd8bd97b6f2ad31ac33e969da5bae`. Independent closure of this successor
is pending. This document does not claim readiness, product acceptance, parity,
superiority, or a completed72-hour work period.

## Scope and immutable history

Only this preparation directory changed, excluding the separately owned
`preparation-independent-v1/` and `preparation-independent-v2/`. Original eight packet files at
`5d432becbe385eb323c10feecfa5e982bfd3b099` and declaration `da935256` are unchanged.
The selected78 composition remains `8437e4eda904e1248c25eeef0d9d455b1d251495`,
not live HEAD. Full858 package SHA256 remains
`6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e`.
Derived composition/AGENTS154 identities are not newly required to be stored Git objects.
The source/test DATA and qualified tool closure authorities in the packet remain authoritative.

Initial source `812a72b5`, first receipts `69985907`, prior executable
`116f5dd79f14032ebcf9a2e46de0d912005c3ffa`, and prior seal/evidence
`8bb0ac19518a227c06a67d6ef8d273af2111894c` remain historical evidence.
`PREPARATION-SEAL.json`, `GO.template.json`, both prior protocols and both41+8
receipt cohorts are untouched. Their source hashes certify their historical
versions, not the successor. Historical loader-drift failures are retained.
The independent historical review at `3b094276a7c669427493de5828aab70364ef7b14`
contains437 DATA checks, not successor execution or acceptance. Its counts are
not merged with author314 stored-object observations or this repair's controls.

## Four bounded repairs

- F1: each observed child receives a private shared refusal word. Its synchronous
  load hook sets that word before throwing and writes an out-of-band first-refusal
  receipt with URL/reason. Reaping snapshots the sticky word. Supervisor admission
  rejects either the shared refusal or the child receipt, even when the benign
  subject catches the dependency rejection and exits0 without a Worker error.
  Parent error mapping cannot remove it. Unknown/missing load or exit receipts
  still STOP. Product entry/dependency bytes and requested options remain unchanged;
  effective `--import` instrumentation is explicit, not transparent execution.
- F2: request/authorization refusal, post-close admission, capture/hook refusal,
  cleanup failure, outstanding resources/listeners/cursors, missing mandatory
  stage/lifecycle/network traces, and unapproved namespace effects use structured
  sticky safety receipts separate from ordinary semantic assertions. Cleanup still
  runs; supervisor persists the observation then checks safety before the next
  subject. Output/status and declared TypeError-versus-FsError mismatches remain
  ordinary failures after clean safety checks. Literal31 inputs/expected bytes,
  statuses and trace expectations are unchanged. The injected fault source now
  retires its own cursor when its `next()` throws; this is a disclosed fixture
  bookkeeping correction, not a changed fault reason/input or product fix.
- F3: four Worker starts are debited before each runtime dispatch. Complete,
  matching attempt/start/exit/retirement accounting alone returns unused slots.
  Any earlier STOP withholds the whole reservation. Unknown starts are `null`,
  not zero; `productWorkerStartsKnown` counts completely authenticated children
  only, and `workerStartsWithheld` reports unresolved reservations. Attempt counts
  and starts are distinct. This intentionally can retain a conservative charge
  even when a stopped child's logs contain partial observations.
- F4:16MiB of the unchanged512MiB scratch ceiling is reserved for a fixed-size
  terminal JSON receipt, reducing usable nonterminal scratch. Per-command and
  observed receipt writes preflight projected space and check retained space/time.
  Terminal accounting includes the fixed receipt bytes, returns actual retained
  logical-storage use rather than unused scratch, checks the inherited deadline,
  and permits only a bounded STOP-receipt correction after a post-write violation.
  It does not authorize another subject, retry, or deadline/cap increase. The
  trailing JSON whitespace is intentional reserved capacity, not extra captures.
  Disk monitoring remains sampled and logical, not a kernel quota or RSS bound.

## Qualification actually executed

`REPAIR-PROTOCOL-v3.json` was committed with the executable source before execution.
Its one exclusive run is `repair-evidence-v3/`:42 checks PASS, comprising9 parse-only
module checks,29 DATA/SYNTHETIC safety/admission/accounting checks and4 actual benign
stub controls. The latter are natural exit, caught dependency-load refusal,
parent-mapped dependency-load refusal, and independent listener/Worker cleanup.
No fake command or substitute public API was registered. DATA exercises only
exported harness classification/accounting helpers, not product behavior.

Four tracked OS children and four benign Workers started, all reaped with known
exit and termination settlements. The additional controlling driver PID72573
exited0. No unexpected failures occurred; intentional synthetic/refusal outcomes
are required control observations, not suppressed failures. Exact captures,
timestamps, PIDs, requested/effective options, load/refusal logs and resource
receipts are retained. No retries or evidence overwrite occurred.

Across the two historical preparation runs plus this successor run:24 tracked
children and26 benign Workers, all recorded reaped, plus three controlling drivers.
This is mixed-version preparation evidence only; the historical82 checks and16
malformed controls do not become current qualification. No actual product import,
command execution, accepted-worker dispatch, native oracle, comparator, network,
private service, XAN/YQ/array experiment, build, pack or install occurred here.

## Successor binding and physical future recipe

`PREPARATION-SEAL-v3.json` binds the exact successor code, finite protocol and
receipts. `GO-v3.template.json` binds that seal but has decision
`PREPARATION_ONLY_NOT_A_GRANT`. The supervisor now requires this versioned seal;
the historical template cannot authorize it. Neither actual `GO.json` nor any
future-run directory has been created.

All31 frozen subjects across three physical layouts remain93 **UNEXECUTED**.
The unchanged `CALLS.json` supplies their exact identities. A separate explicit
root-issued exact command/grant and exclusive inherited budget would be required:

```text
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/integration/priority-command-workflows-20260828/future-supervisor.mjs --grant /Users/kjopek/Workspace/safe-bash/tests/integration/priority-command-workflows-20260828/GO.json --budget /Users/kjopek/Workspace/safe-bash/tests/integration/priority-command-workflows-20260828/PARENT-BUDGET.json
```

Working directory is `/Users/kjopek/Workspace/safe-bash`; the single-use physical
root is `tests/integration/priority-command-workflows-20260828/future-run-01`.
It contains source app parent `source` importing `./dist/index.js`, genuinely
offline-installed app parent `consumer` importing `virtual-bash`, then the actual
rename to app parent `physically moved consumer`, again importing `virtual-bash`.
Installed/moved product roots are their `node_modules/virtual-bash` subdirectories.
Runtime entries live inside those app parents; process cwd stays outside.

Future ceilings remain100 OS children (3 setup+4 admissions+93 runtime), one
concurrent child,2 concurrent product Workers,4 starts per runtime/372 total,
97 Node-managed loader requests,20s runtime/60s setup,4MiB combined capture,
512MiB logical scratch,1200s whole window, reduced by the inherited parent budget.
No spare processes or automatic cap increases. OS-process reaping is not a separate
loader-thread-exit receipt, arbitrary host-work preemption, all-native-thread bound,
or RSS guarantee. Independent successor review and any future GO remain separate.
