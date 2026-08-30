# Executable preparation v1 — no activation authorized

Additive successor to `7600d9cbebe2114594377186774017ab85d9cf4c`.
Every original file and frozen guest/input/expected byte remains unchanged.
This subtree contains executable supervisor, loader and child source as inert
`.mjs.data`, not canonical tests. Preparation never imports these modules.

## Revision-specific activation

ROOT must separately approve this subtree's commit and `MANIFEST.json` SHA256.
The exact future command, from `/Users/kjopek/Workspace/safe-bash`, is:

```sh
C78_ROOT_GO='C78-SAFEJS-GO:<commit40>:<manifestSHA256>:G01,G02,G03:installed,moved:6:<unique-run-id>' /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --input-type=module < tests/integration/coherent78-safejs-independent-20260828/executor-preparation-v1/supervisor.mjs.data
```

This is a format, **not an issued token or GO**. The gate authenticates the
manifest at the named commit, every executor payload, the original preparation
seal, tool/engine hashes and package bytes before materialization. Run IDs are
single-use; existing output paths refuse. Any later changed input, continuation,
closure expansion or retry requires a separately sealed revision and ROOT GO.

`CONTROL.json` specifies exact command families, counts, guards and exclusions.
`TOOLS.json` lists the exact Node/Git/compiler files and 808 npm regular files.
The npm set is a static, install-only, seed-reached dependency envelope with
tests/docs/other command families excluded. It is **not proven dynamically
minimal**. Text-scanner false positives are retained; unknown actual loads stop,
never trigger fetching, copying extra files or a relaxed loader. Compiler and
engine source transformation are future execution, not preparation checks.

## Actual bridge and receipts

Only one root Shell exists in each child. Awaited middleware captures its actual
safejs context. Guest `shell.exec` uses public `makeSafeJsShellModule` and actual
`declareHostOperation`; its executor calls the existing
`context.invoke('bash',['-c',source,'c78-guest'],options)` mechanism. It forwards
the borrowed signal, explicit stdin provenance, cwd and exact replacement env,
and captures bounded owned byte chunks. It never creates a second Shell, shell
budget or native process. The only `new Budget` is the legitimate SafeJS budget
hook, separate from the shared shell budget.

Wrapper calls/settlement, actual engine calls/settlement, guest-origin stdio
entry callbacks and shell-bridge calls/settlement are separate counters/events.
Guest proof also requires matching frozen source, actual authenticated engine
loads and subsequent guest-dependent host work. No host-written marker, helper
pass, aborted signal or opaque wrapper promise proves guest entry/retirement.
The declared stdio wrapper is explicitly marked read-side-effect; realm identity
and reason-equality provenance are never inferred.

G02 uses body-next and disposal gates, manual deadline delivery, held cleanup and
pending-public-settlement checks. Request/header/authorization/caller assertions
remain explicit. Caller-priority collisions are excluded. Source bytes and all
G01/G02/G03 outcomes remain the original preparation's planned assertions.

## Boundaries and acceptance

Maximum: six guest evaluations, six Shells, one installer, four read-only Git
children; eleven spawned children/twelve processes including the supervisor,
below the inherited twenty-process ceiling. Execution children run serially.
Inherited step/output/disk/containment limits remain enforced. The parent applies
append-detecting private-src/refs guards before every child and copy stage and
after children/cleanup, without private status/index refresh. Selected external
tool guards do not cover sibling additions. Excluded private directories remain
explicitly outside any unchanged claim.

Offline installation precedes engine/compiler staging to avoid npm pruning
those injected packages. The complete consumer is physically renamed for the
moved layout; the old path must be absent. Product858 inventory is distinct from
actual product module loads, copied engine63 actual loads and tool/compiler loads.

Only clean semantic failures may continue to the next frozen case. Integrity,
load, resource, containment or unexpected-child failures stop. Raw evidence is
archived and authenticated before removal of intact owned scratch. Final
acceptance requires matching successful `CLOSURE.json`, removed scratch, no
`STOP.json`, six PASS receipts and naturally reaped direct children. Raw
pre-cleanup workflow success alone is insufficient. No universal process census,
hard preemption, timing, native, network or full-gate claim is made.

Preparation checks: metadata/hash parsing and syntax-only checks of these three
new files. **Zero product/engine/guest/native-oracle evaluations, private copies,
builds, installs or executed before/after-guard certification.** Stop for ROOT GO.
