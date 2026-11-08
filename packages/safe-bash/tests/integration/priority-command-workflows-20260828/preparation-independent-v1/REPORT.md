# Independent preparation review — STATIC/DATA only

Date: August 28, 2026. Disposition: **HOLD for preparation repairs; no product GO or acceptance.**

This different verification leaf reviewed committed source as text and authenticated
data. It did not import or execute the adapter, supervisor, accepted product, accepted
Worker, or stub subjects. No build, install, native oracle, comparator, service,
private runtime, XAN or array run occurred. No worker was delegated. Only this
evidence directory and the two assigned `/tmp` coordination files were written.

## Exact identities

| Input | Identity |
| --- | --- |
| Frozen packet | `5d432becbe385eb323c10feecfa5e982bfd3b099` |
| Reviewed executable candidate | `116f5dd79f14032ebcf9a2e46de0d912005c3ffa` |
| Root-routed final evidence/seal commit | `8bb0ac19518a227c06a67d6ef8d273af2111894c` |
| Final preparation-seal SHA256 | `4561e4e3d6ea34ff3c7803ce02294cc2ce61e127c6dddd427e1aef79d253341f` |
| Ordered twelve-file code-set SHA256 | `8d7f684650803c2ec2e5e4471616138341dc22c471921f285d6b7858ef909462` |
| Previous source | `812a72b52827f88f03ae87dcf0a0d885b0e011e9` |
| Previous evidence | `699859078ab59f023b9f1a46e5d3086e3f3f3941` |
| Accepted coherent78 archive authority | `633f6c82f738f1c69d6c7b6c91672524ec8688b2` |
| Derived selected composition | `8437e4eda904e1248c25eeef0d9d455b1d251495` |
| Selected-input table SHA256 | `c6efddf8b14d2b15231b95e3a5be975c9c93c7c10f309acf77c80883f9cc074c` |
| Encoded archive SHA256 | `a49b8a7055ac2902d1368ddb638d62c5a1896dc9ed25c18b025816a710077509` |
| Full858 package SHA256 | `6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e` |

Root's response confirmed that the final seal retains the reviewed executable
candidate and requested completion of this bounded pass. All twelve code files
match both commits byte-for-byte. All eighty final-seal file pins match committed
bytes. No moving HEAD source was used. Live Git status/index were inspected only
to preserve unrelated work and make a scoped evidence commit.

## Findings

All source anchors below refer to the executable candidate above, under
`tests/integration/priority-command-workflows-20260828/`, unless stated otherwise.
They are static control-flow findings, not newly executed product counterexamples.

### F1 — High: actual Worker dependency admission refusal is not a sticky STOP

`worker-preload.mjs:22` checks actual returned source bytes, but its load hook
throws admission errors without emitting an independent refusal receipt.
`worker-observer.mjs:48` records an emitted Worker error only in `row.errors`.
`admission.mjs:87` validates known exit and termination settlement but does not
reject that error array. `future-supervisor.mjs:201` checks only the parent's
constructor-admission refusal array, entry-load receipt and exit receipt. At
`future-supervisor.mjs:215`, an ordinary `pass:false` merely appends a failure and
allows another subject.

The final sealed **benign** `stub-evidence-v2/loader-drift` receipts contain this
exact observation shape: accepted stub entry load, refused dependency digest,
Worker error `LOAD_HASH_REFUSED`, exit1, no pending/error termination, no emergency,
and `admissionRefusals:[]`. `stub-child.mjs:40` accepts `observer.close()` after
that refusal. This is existing historical evidence from the reviewed code, read
as DATA, not a real regex-worker run. It establishes that parent constructor
refusal tracking does not cover actual child dependency admission.

**Bounded repair:** retain a sticky, out-of-band child-hook refusal record with
the rejected URL and reason, and make the supervisor STOP before another subject
even if a subject catches/maps the thrown error. Preserve exact accepted entry,
dependencies and loader bytes; disclose any additional harness instrumentation.
Add a bounded data/synthetic or separately authorized benign caught-refusal
control. Do not infer admission provenance merely from arbitrary error text.

### F2 — High: adapter safety failures aggregate as ordinary semantic FAIL

`future-adapter.mjs:176` and `future-adapter.mjs:181` throw on extra authorization,
extra request or post-close request. `future-adapter.mjs:269` and
`future-adapter.mjs:279` collect runtime/cleanup errors. Its final assertions at
`future-adapter.mjs:293` check listener/pending-resource counts, mandatory stage
observations and namespace effects; `future-adapter.mjs:316` converts every such
assertion into `pass:false`. The supervisor's line215 then continues.

The frozen packet's `EXECUTION-RECIPE.md:145` expressly separates these safety
conditions from ordinary output/status mismatches: unadmitted request, missing
mandatory trace, pending work/listener leak, cleanup failure and unexpected
namespace mutation require STOP before the next subject. Current enforcement
does not implement that separation. A transport or authorization assertion caught
by the product is not an independent sticky admission refusal.

**Bounded repair:** add structured sticky safety-stop fields/codes and validate
them independently of ordinary result assertions. Persist raw observations, then
STOP before dispatching another case for admission, cleanup/resource, mandatory
trace or namespace-boundary failures. Continue aggregating only complete, safely
cleaned observations with ordinary semantic differences. Keep all frozen
expectations unchanged.

### F3 — Medium: failed command settlement can return already-used Worker budget

`future-supervisor.mjs:82` can throw after OS-child close for abnormal termination,
capture failure or integrity failure. Worker receipt parsing/debit occurs only
after `command()` returns, at `future-supervisor.mjs:193`. Thus a runtime child
that logged a Worker start and then required emergency SIGKILL reaches STOP with
no Worker debit for that child. `future-supervisor.mjs:223` returns the unchanged
remaining Worker reservation. Missing/incomplete logs mean unknown, not zero.

This does not assert that the stopped supervisor itself retries or exceeds its
cap. It means its resource report can incorrectly offer already-consumed or
uncertain reservation back to the coordinating owner.

**Bounded repair:** reconcile admitted attempts, known starts/exits and unknown
acquisitions on every command settlement, including STOP. Alternatively reserve
up to four starts before dispatch and refund only fully reconciled unused
capacity. Keep uncertain capacity reserved and label uncertain counts explicitly.
Do not increase caps or silently create a fresh budget.

### F4 — Medium: final receipt writes and processing escape terminal accounting

`future-supervisor.mjs:85` performs the per-command scratch check. The subsequent
`observed.json` write at line216 and `RESULTS.json` write at line227 occur after
it. There is no final scratch/deadline validation before PASS selection at
line225. An inherited scratch allowance just above the last checked footprint
can be exceeded by those retained receipts without a STOP. Last-child
postprocessing can also cross the inherited whole-window deadline unnoticed.
The returned `remaining.scratchBytes` is unchanged although this root is retained.

**Bounded repair:** reserve finite terminal-receipt capacity, account projected
and retained final bytes, and check the inherited final deadline before choosing
the terminal status. Report retained storage reservation/usage explicitly; do not
make retained bytes look like newly reusable capacity. This asks for correct
logical accounting, not a kernel disk quota, arbitrary host preemption or RSS cap.

## What is implemented coherently, by static inspection

- **Exact cohort:** all eight packet files remain byte-identical. All31 case and
  fixture IDs and all93 sealed calls retain exact script/case/fixture hashes,
  three layouts and UNEXECUTED status. The original eight malformed-data controls
  are unchanged, not rerun by this leaf. Declaration matrix `da935256` is unchanged
  (SHA256 `5a3504266fe566e56c67ff8303b1878f5c08d6e4d8b2dfad768e0539c21e6208`).
- **Real public interfaces:** the authenticated selected source exposes
  `Shell`, `MemoryFileSystem`, `ReadOnlyFileSystem`, `FsError`, `agentCommands`
  and explicit `networkCommands`. `Shell.use`, `exec`, byte results and shared
  `dispose` completion match the adapter's call shapes. Selected
  `src/contracts/command.ts:23`, `src/shell/types.ts:29`,
  `src/shell/shell.ts:109`, `src/shell/shell.ts:307`,
  `src/commands/network/types.ts:5` and `src/index.ts:1` are source-data anchors,
  not claims about live source or compiler/runtime acceptance. No fake commands
  are registered. Find child argv is correctly qualified as effects-only evidence.
- **Grant before setup/product:** supervisor lines11–36 require exact command,
  grant/seal, repository and exclusive inherited reservation before fresh-root
  setup. Its initial imports are harness/builtins, not product. Runtime entry
  lines8–31 checks grant/layout and observes Workers before public product import.
  The final template deliberately says `PREPARATION_ONLY_NOT_A_GRANT`.
- **Selected source and layouts:** selected268 source inputs, full emitted
  inventory, full858 pack and installed manifest are pinned. No raw-HEAD source
  reconstruction is used. Source imports built public index; installed/moved
  imports the public package from distinct physical app parents with outside cwd.
  Supervisor line183 performs an actual consumer rename, not a logical alias.
  Complete protected-root inventory comparisons detect appended entries there;
  seal-file rehashing alone does not promise an append-proof whole repository.
- **Child evidence design:** Worker requested `execArgv:[]` and limits are checked;
  effective `--import` instrumentation is explicitly disclosed. Same-thread child
  hooks hash actual loaded bytes. Constructor/parent logs do not substitute for
  child receipts. PID/thread/token, requested/effective options, actual entry,
  start, known exit, product termination and emergency ownership are represented.
  Pre-hook harness bootstrap authentication is a separate role, not an actual
  post-hook load receipt. F1 remains material despite these good distinctions.
- **Resource design:** explicit100 direct OS children=3 setup+4 admission+93
  runtime, one concurrent;2 concurrent product Workers,4 starts/runtime,372
  cumulative;97 requested parent-loader threads. No metadata subprocess is hidden
  in the future path: stored-object existence is preparation-time evidence.
  The20s/60s child timers,4MiB stdout/stderr-plus-log accounting, sampled512MiB
  scratch and inherited1200s deadline are present, without per-layout resets.
  F3/F4 qualify terminal accounting. Proposed ceilings are not measured adequacy.
- **Lifecycle and limitations:** C05 registers cooperative cleanup before
  acquisition, gates cleanup, tests caller-reason identity and shared disposal;
  C06 separates owned-output closure from sibling file work; C07 releases the
  opaque late rejection. Known Worker exits and termination settlements are
  checked; emergency retirement is not accepted as product cleanup success.
  Node-managed loader reaping via OS-process exit is qualified, not presented as
  an individual loader-thread exit receipt or cap on every native thread/RSS.

## DATA validation and limits

`DATA-RESULTS.json` records **437 named DATA checks** (some contain multiple
assertions), all passing in the final validation. These are not437 product tests.
The validator uses Node builtins and synchronous, bounded Git DATA reads only;
it never imports/evaluates reviewed code. Its final invocation used221 reaped
Git metadata children, separately from the proposed future100-child product
window. No Worker threads or subject subprocesses were started by this leaf.

Validated material:268 selected inputs;9 commit witnesses;16 stored reachable
tree witnesses;13 recomputed derived trees;293 source/commit/tree requests in one
Git DATA batch; all314 final source-auth receipt bindings;858 tar members and214
declarations;80 final-seal pins;12 unchanged code files;93 exact call bindings.
The derived8437 composition is computed from canonical Git tree bytes and five
overrides without demanding that the derived hash name a stored Git object.

The selected emitted Worker's static relative-import closure contains four
modules, each hashed in the results. That graph is **not actual child-load proof**.
Both author's41+8 qualifications remain version-specific synthetic/benign
historical receipts. The second qualification's loader-drift record is read as
existing DATA; no subject was replayed by this reviewer.

Verifier development retained in this record: an initial validation attempt
incorrectly assumed that the archive carried every source path's full tree chain.
It stopped at `fdbb9d78316afeeb53523db4302151e791c23634` for
`src/commands/archive/README.md`. This was a reviewer assumption, not a subject
defect. The corrected validator reports43 source paths covered by available tree
witnesses and independently checks all268 `revision:path` bindings against actual
stored Git blobs. The candidate-only pass then completed353 checks; the final
437-check pass adds root-routed final-seal/call/receipt inspection.

Reproduce DATA-only validation, with no artifact mutation:

```sh
node tests/integration/priority-command-workflows-20260828/preparation-independent-v1/inspect-data.mjs verify --summary
```

The full result capture was added with `apply_patch`; the checker only prints.
No build, typecheck or product test is implied. Root acknowledged all F1–F4 and
routed them to repair leaf `01a04970`. Concurrent live harness edits were observed
and preserved, not inspected as a successor or folded into this pinned review.
No repaired successor was reviewed. All93 real calls remain unexecuted.
