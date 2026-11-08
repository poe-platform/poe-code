# R1 replay: fixed within independently checked scope

**R1 is fixed in `1b133a8662a32ee84524794842074c9c98d5f6c3`.** The original
22 holdouts pass unchanged, all three original disposal-control tuples match the
retained old `07acb1a` observations, and one necessary setup-isolation control
passes. These are three separate denominators, not a combined 26-case lifecycle
or native-worker acceptance claim.

## Source and first unchanged replay

- Candidate shell.ts SHA256:
  `538f7ea1504019fcde03abc2781c1f903573243a0332033b87501804a1c4ac5c`.
- runtime.ts remains
  `2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b`;
  cleanup.ts remains
  `134f55641d6437681cd185960a2923d68086096921758717c5b8059595304385`.
- Contract `07acb1a4d30b7592cf247a0220250317be4e2038` and callback
  `01aa1bffe0568cc6787d5ff8e0331e024a787385` are ancestors with exact relevant
  content unchanged. Original package, lockfile, public root exports and tsconfigs
  match `4c16d9c`.
- All 20 prior owned preparation/acceptance files remain byte-identical to
  `45051f5a0c6e1fd8042dee0196f37545fb6eee31`. In particular, no H01–H22 assertion,
  D1–D3 fixture, prior failure, profile or proof was rewritten.

The prepared runner executes H01–H22 **once**, unchanged, from a full committed
candidate archive. Result: **22/22**, no unexecuted cases, all children exit 0,
one build exits 0 with empty build stdout/stderr. All **216 source/config**,
**704 emitted** and copied-helper identities remain unchanged; all **3,520 actual
main-thread import records** and 22 actual archived public-root imports pass.
The full snapshot contains other committed source additions, so these counts
differ from the older 4c snapshot; this is not a claim that the entire repository
diff consists solely of shell.ts. No live overlay or narrowed public API is used.

The original scope remains 21 public-Shell compound cases plus one direct
optional-host control. Existing status/byte/sink/budget/provenance/errexit,
cleanup failure precedence, opaque nonjoins, nested closed admission and local
lease assertions remain intact. The previously disclosed dispose-only outcome
ambiguities are not silently strengthened or waived.

Proof: r1-holdout.json and r1-holdout-scratch.json. No retry, second compiled
cohort, global typecheck or mutation expansion was performed.

## Original D1–D3 replay, unchanged fixture

Only candidate 1b is executed for this replay. Old 07 and failing 4c tuples are
read from their immutable proof, **not rerun**. The new recorder differs from the
old recorder only in profile selection and new evidence filenames; it copies the
original setup-disposal-control.mjs and trace without changing their bytes.

| Original control | Retained 07 | Retained 4c | New 1b |
| --- | --- | --- | --- |
| D1 explicit setup rejection | Exact setup reason to exec; disposal resolves; prior successful plugin disposed | Same | Exact match |
| D2 queued setup + immediate dispose | setup-start, middleware-installed, plugin-dispose; lease=false | setup-start only; lease=true | Exact 07 match; lease=false |
| D3 completed setup + disposal failure | Exec 0/empty byte fields; reverse disposal; one exact AggregateError member | Same | Exact match |

**Three of three tuples match the original accepted behavior.** D2 explicitly
restores the skipped plugin disposer and closes its small host lease marker.
It is not a native Worker leak/retirement measurement. The setup-rejection catch
itself remains compatible; D1 is not reinterpreted as a new rejection policy.

This supplementary replay uses the actual public root TypeScript API via existing
tsx, full committed source, and pinned imports. It does not add a second tsc
build. The one child exits 0; public-index, source, helper, 157 product import and
183 total file-import records pass their guards. The only subprocess stderr is
Node's loader warning. Raw data: r1-disposal-data.json; cleanup receipt:
r1-disposal-scratch.json.

## Narrow source review and one necessary control

Candidate shell.ts:33 keeps public use admission guarded. Its private #install
creates an independent host facade and active flag **per setup execution** at
:43–56. The facade's use/registerFileSystem callbacks admit that already-accepted
setup while it is active, without clearing the Shell's disposed flag. Each setup's
finally permanently ends its own active privilege. An unrelated completed host
does not borrow another setup's privilege. Public register/registerFileSystem/exec
guards remain in place at :62/:68/:87.

Disposal still sets the disposed flag synchronously at :188 and retains the same
active-invocation drain path. At :202–206 it awaits the current readiness chain
until its identity stops changing, covering nested setup appended by an accepted
setup. Plugin disposal then runs in reverse registration order at :208–210.
Runtime cleanup scope/error selection code is byte-identical to 4c.

D2 alone would not detect a global “setup is active” bypass reopening external or
saved-host admission. Therefore **one** additional compound control, S1, is run
once after the unchanged replays. It verifies:

- A completed host cannot use/registerFileSystem during a different async setup
  after disposal starts; public use/register/registerFileSystem/exec also reject.
- Accepted async and queued setup can finish middleware/FS registration without
  invoking any FS factory. The factory call count remains zero.
- A nested setup extends readiness; disposal stays pending behind a controlled
  nested-release gate. Completed active/queued hosts remain closed while that
  different nested host is active.
- Distinct setup hosts remain distinct, repeated disposal shares its promise,
  all four fixture-owned leases close, and disposal order is exactly nested,
  queued, active, completed. Saved nested host and public admission stay closed
  after disposal.

Result: **S1 1/1**, child exit 0, empty remaining lease set, zero factory calls,
and all source/helper/public-index/import guards pass. Gates are released only by
the planned fixture schedule; there is no rescue or forced child termination.
Raw proof: r1-isolation-data.json; fixture: r1-setup-isolation-control.mjs.

Nested plugin installation via host.use is exercised as the existing JavaScript
runtime behavior requested for review, **not** a claim that PluginHost.use's
TypeScript signature has expanded beyond middleware. Saved hosts retain their
previous admission behavior while the Shell is still open; the scoped privilege
distinction matters during disposal. The shared public CommandRegistry is not
newly frozen or treated as a sandbox. No global lifecycle API is proposed.

## Preservation and limits

All three exact outside-repository archives are removed only after durable proof,
without traversing the development-tool symlink. All 22 holdout children and both
supplementary children finish naturally; no children remain. No source, contracts,
core/FS, root exports/manifests, other fixtures or dependencies are edited.
Only new owned evidence/support files are committed with explicit --only paths.

The 45051f5 failure evidence, old profiles and all frozen assertions are preserved.
Arch's independent real-worker/packed checks remain separate. Author 96/96 is not
used as independent evidence. No global types, foreign six-fixture TS2304 changes,
Arch duplicates, old five custom first-read probes, native Bash, kernel or broad
feature runs. This checkpoint accepts the independently exercised R1 correction
and frozen holdout scope, not universal cleanup or native parity. Stop for ROOT.
