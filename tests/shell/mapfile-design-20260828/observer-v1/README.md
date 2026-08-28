# New observer v1 — SYNTHETIC preparation only

Seven concrete, separately hashed modules; no old observer imports or copied
supervisor. `PRECODE.json`/cc471485 precedes the implementation. `MODULE-SEAL.json`
must be committed before any synthetic execution. Original32 remain unchanged;
11 separately sealed additions make43 prospective launches, not native results.

## Modules and boundaries

- admission: complete protected-byte/module-directory checks, exact GO/row/binary
  binding, per-row/aggregate input admission and canonical output-root boundary.
- storage: prospective ownership before mkdir, immediate acquisition record,
  identity check; exclusive bounded receipts; no recursive deletion. Unbound or
  replaced directory is retained/reported, never guessed safe to remove.
- lifecycle: actual spawn/exit/close flags separate from attempt/submission and
  persistence; output counted before retention, TERM/KILL/terminal clocks, bounded
  group polling. Missing close or surviving group terminates reporting at3000ms
  with cleanup uncertainty, never a fabricated close or second launch.
- observer: whole-cohort admission, one child at a time, registered file/resource
  records, before/after EACH row and FINAL post-cleanup/post-persistence integrity.
- node-driver: new detached POSIX Node spawn/stream/group adapter; code only in
  this phase. Error listeners remain installed for late failures; release destroys
  owned stdio and unrefs the child when reporting stops. No reaping guarantee for
  a still-live group. Stdin EPIPE is allowed for early consumer exit; other write
  errors are faults. No inherited env, startup config, credentials or extra FDs.
- cli: no default run; four explicit arguments bind ROOT authorization and module
  seal paths/hashes. No authorization file is provided here. Read-only admission
  completes before creating the native port; native mode is Darwin arm64 only.
- synthetic: imports complete modules, including the unused real adapter, but
  injects finite in-memory FS/clock/child drivers. No process is spawned and no
  Bash script is interpreted. Model files/children are dependency observations,
  not native/product behavior or actual OS cleanup proof.

Node primary API reference for the real adapter's source review:

```
https://nodejs.org/download/release/v22.12.0/docs/api/child_process.html
```

Node documents spawn, exit and close as distinct events; close can follow an
error when spawning fails. The adapter preserves those distinctions. The cited
documentation is not an executed Node22.22.2 child control or a native oracle.

## Prospective native admission (NOT authorized)

After different review and separate ROOT GO only, invoke cli with exactly:

```
node observer-v1/modules/cli.mjs ABS_AUTH_JSON AUTH_SHA256 ABS_MODULE_SEAL_JSON SEAL_SHA256
```

ROOT's new JSON must have kind ROOT_NATIVE_GO, exact moduleSealSha256, combined
recipeSha256, explicit selected rowIds, and fresh outputRoot matching
`/private/tmp/mapfile-observer-[A-Za-z0-9-]+`. This is explicit trusted coordinator
authorization, not cryptographic protection from malicious host JavaScript.
The seal binds all seven modules, original/additive recipes, protocol/config and
original source-binding files. Authorization bytes and external GNU primary
source/binary bytes are rechecked by admission and final checks. Original and
addon counts/IDs must be reported separately, no semantic pass expectations.

Row ceilings remain2500ms TERM/2750ms KILL/3000ms terminal,64KiB combined captured
stdout/stderr and1MiB aggregate; scripts/input each4KiB and32KiB aggregate.
Whole admission/reporting deadline150000ms. At most132 exclusive receipt files
and4MiB serialized receipts; parent CLI output<=4MiB. Synchronous bounded metadata
reads/writes and OS scheduling are not preemptible: these are checked bounds and
timer-driven terminal reporting, not a kernel-service deadline guarantee.

`final.json` is explicitly PROVISIONAL before final control authentication.
The authoritative completed report is CLI stdout AFTER final checks, captured by
the external owner. If persistence fails after spawn, in-memory launch records
and stdout retain the attempt/spawn/close facts; file persistence is not used to
infer whether a process existed. A crashed/blocked observer cannot guarantee a
durable final capture. No infinite post-timeout polling or false cleanup claim.

Fixture home/tmp/fixture directories are removed only after bound identity and
empty-directory checks. Unknown/new entries or replacements are retained with
failure. Root/records are explicitly retained for evidence, not claimed removed.
All result paths are in the newly acquired task-owned root. This is a declared
stable-ancestor task-owned profile, not hostile pathname/PID-ABA security.

## Authorized synthetic command and qualification

```
node tests/shell/mapfile-design-20260828/observer-v1/modules/synthetic.mjs
```

The28 predeclared control names are data in PRECODE. Each uses the whole imported
admission/storage/lifecycle/observer code, except the isolated outside-receipt
control directly exercises the complete storage module. CLI missing-admission
also runs directly. Faults modify model dependency state, not production or
observer source. Actual module hashes and pre/post seal checks bind execution.
This is neither28 native cases nor28 product mutant kills. Captures use unique
exclusive filenames; failed first attempts must be retained.

Model ceilings:4096 events/scenario,150001 virtual milliseconds,2MiB retained
JSON report,0 actual children/native/product imports. The model drives late events
to exhaustion and discards only its own in-memory entries. Its synthetic zero-
child result cannot prove OS process group closure, actual stdio timing or spawn
failure ordering. A different reviewer should inspect the real adapter before
ROOT considers native43 GO. If concrete OS checks are needed, propose and approve
a separate finite harmless-Node child cohort first; none is run by this packet.

## Version2 supplemental hardening

Initial module candidate9418c3cf and its28/28 capture remain immutable in Git and
RESULTS-v1. PRECODE-v2 adds nine synthetic controls without replacing the28.
MODULE-SEAL-v1.json preserves the original seal; MODULE-SEAL.json now binds the
complete revised modules before their execution. Original32/additive11 native
recipes are unchanged and remain unexecuted.

Prospective ROOT authorization additionally requires `runtime` with canonical
absolute `path`, exact `version`, `platform`, `arch`, `bytes` and `sha256` for the
existing parent Node executable. No self-selected runtime is authorized by this
CLI. Full authentication checks actual process identity, canonical regular-file
path, exact size and bytes before every launch and after cleanup/final persistence.
Node binary ceiling256MiB, GNU binary16MiB; native hashing uses64KiB scratch and
exact-length descriptor reads with before/after metadata/path identity checks.
These synchronous finite reads are not kernel-preemptible or hostile-ancestor
race protection. The real driver, including this hashing path, is still unrun.

Receipt contents now retain size/hash metadata and are checked along with exact
directory entries after final persistence. No successful result can rely solely
on the provisional final.json. Repeated output faults schedule only one initial
fault escalation; ordinary deadline/KILL/group checks retain their roles. The
supplement drives200 overflow callbacks and checks finite timers/signals.

The synthetic parent records its own existing Node identity by read-only metadata
and streaming hash, plus actual imported module URLs/hashes. This parent execution
is not a native recipe or an actual child-process control. No new runtime
dependencies, product imports, fixtures outside this subtree, or permission probes.
