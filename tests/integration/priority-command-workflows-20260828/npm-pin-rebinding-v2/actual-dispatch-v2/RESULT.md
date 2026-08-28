# Single actual dispatch v2 — STOP, no retry

Authorization commit: `8f0a9fdaa84d7bae59040617577e2b0ee028d29b`.
Supervisor PID964 ran the exact authorized command once, with no added arguments
or behavior-changing environment. It started August 28, 2026 at
20:40:49.022 UTC and finished at 20:42:06.628 UTC: 77606ms measured by the frozen
supervisor. Its effective deadline was 21:00:49.022 UTC, below the unchanged
parent deadline of August 29, 2026 at 18:02:36 UTC. Outer wait observed exit1.

## Exact subject accounting

| Layout | Planned | Attempted | Exec + dispose completed | Pass | Ordinary fail | STOP | Unrun |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| source-build | 31 | 16 | 16 | 15 | 0 | 1 | 15 |
| offline-installed | 31 | 0 | 0 | 0 | 0 | 0 | 31 |
| physically-moved | 31 | 0 | 0 | 0 | 0 | 0 | 31 |
| Total | 93 | 16 | 16 | 15 | 0 | 1 | 77 |

P01–P15 passed in source-build. P16 stopped; P17–P24 and C01–C07 were not run
there. All31 IDs in each remaining layout were not run. Workflow accounting is
16 attempted /15 pass /1 STOP /56 unrun out of72; all21 control calls are unrun.
“Completed” means an actual exec settlement and completed Shell.dispose were
recorded, not that safety admission passed. No unused slot is counted as success.
All93 individual identities and raw receipt references are in RECONCILIATION.json.

## Exact STOP, not a repaired expectation

The frozen adapter recorded `MANDATORY_TRACE_STOP` with
`UNDECLARED_STAGE`, `2 !== 0`, in source-build P16. Its runtime child PID1675
exited1, without a signal or emergency kill. The supervisor then recorded
`ADAPTER_SAFETY_STOP` and admitted no dependent subject.

P16's Shell returned exit0, 51 stdout bytes and zero stderr bytes, exactly equal
to its frozen literal output/status; the whole before/after VFS was unchanged.
The raw stage trace contains sed, find, and two rg child argv observations.
The two rg argv arrays are also present as literalChildArgv in the frozen packet;
the frozen validator nevertheless recorded the mandatory-trace STOP. This is
only a statement of retained DATA, not a new diagnosis, oracle amendment, pass,
or permission to modify or rerun the harness. Its assertion failure remains
inside the stopped row; the supervisor's ordinary-failure list remains empty.

P16 stdout SHA256:
`e240c048bfb02f33992c73af9717848c739a07158a6a98e951eb7bd66855f1be`.
Original row: `future-run-01/receipts/source-build-P16.observed.json` under the
original priority-command-workflows-20260828 directory. All original raw parent,
Worker, stdout, stderr, statuses, VFS snapshots and trace records remain intact.

## Roles, cleanup and retained escrow

- Three setup roles succeeded: fresh build, full npm pack, genuine offline install.
  All four admission roles produced the expected refusal before product imports.
  These are separate from the16 actual public calls, not additional product passes.
- All23 direct children have exit/close/reaped receipts. Outer wait reaped the
  supervisor: 24 observed OS lifetimes including it, peak2 within this supervisor
  graph, not a global OS census. There was no OS emergency kill or blind cleanup.
- Twenty parent loader roles were requested. Their20 OS processes reaped; no
  separate per-loader exit receipt or all-native-thread observation is invented.
- Raw traces contain17 Worker constructor attempts, starts, preloads, entry loads,
  exits and product-owned terminate calls. Driver-owned terminate calls and
  emergency Worker retirements are zero. All16 observed Shell disposals completed;
  recorded owned/fixture pending work and listener counts at end are zero.
- Frozen accounting completed only15 Worker starts. P16's two raw start/exit
  observations do not override its unknown four-slot reservation: aggregate
  productWorkerStarts remains null and workerStartsWithheld remains4. No frozen
  settlement validator was replayed after STOP and no escrow is returned.
- Remaining exclusive counters are children77, workerStarts353, loaderThreads77,
  captureBytes418174207 and scratchBytes347730492. Parent JSON is unchanged:
  301 bytes, SHA256
  `86e8f86c74aad9f721b266ce49c6799285daeb8e56577da180017844a81f3dd0`.

Direct-child streams total156266 bytes; original logs total1099927 bytes, matching
the exact aggregate charge1256193 bytes. Largest child capture is96639 bytes.
Outer supervisor stdout is62 bytes; stderr is empty, separately identified from
the frozen child charge. Retained scratch is189140420 sampled logical bytes,
including the16777216-byte padded terminal receipt, not RSS or a kernel quota.
No hard post-SIGKILL settlement bound or arbitrary opaque-host drain is claimed.

## Binding and preserved evidence

Fresh preauth authenticated all100 seal pins, mapped code14,348 stored object
requests,268 selected inputs, derived8437 and full858 package identity, plus
Node and complete originalRows inventories for all four tools. Historical-null
roles were not converted into stored Git requests. Accepted O6 and prior controls
remain qualified DATA dependencies; no independent review cohort was repeated.

Postchecks preserve selected source268, full source emission, all tool inventories,
and the858-file installed manifest SHA256
`484c1dd76c63f126376cff810b445c8185e791825ec83fd94e996691b2b1eb5d`.
The actual759089-byte packed tarball remains SHA256
`6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e`.
Installed runtime admission was not reached; physical move did not occur and the
original installed consumer remains. Curl cases were not reached; actual recorded
network requests are zero. No product Git/apply_patch/Node, native oracle, private,
comparator, XAN, arrays, YQ, or ambient-network test was performed.

The original run root is preserved in place. RUN-ROOT-INVENTORY.json enumerates
all5785 entries and their exact kinds/modes/hashes, detecting append changes when
compared as a whole. Sealed-input postchecks cover the enumerated pins, not an
append-proof inventory of every surrounding sealed directory. Commit scope is
only new execution/evidence records and original captures/admissions/package/logs;
copied product, tool, cache-content and temporary trees are retained but not staged.

The original16777216-byte RESULTS.json SHA256 is
`4851193778874cd65ffbfc99b3ab70beed37c4060f3acf86cec6b28440c0d420`.
RECONCILIATION.json preserves an administrative `ReferenceError: runInventory is
not defined` after all93 subject memberships and23 raw child streams were captured.
ACCOUNTING.json completes only the remaining DATA arithmetic from the existing
saved inventory. The error and partial receipt are not overwritten; no actual
attempt, product, harness, expectation or frozen settlement was retried or changed.
ACCOUNTING.json is8289 bytes, SHA256
`7a46d1358a9947c7bce4742a16ac3d66be861187077ec352d5b06e79def2b850`.

This is a finite stopped run, not runtime acceptance of the unrun layouts,
full-product completion, release, parity, superiority, or72 hours worked.
