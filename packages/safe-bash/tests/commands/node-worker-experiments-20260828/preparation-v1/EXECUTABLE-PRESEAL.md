# Finite regular-CLI source checkpoint — NOT executable GO

2026-08-28. This preseal precedes all checks of these new source files. No syntax
parse, import, compiler, Worker or engine trial is permitted. Runtime outcome:
**UNRUN / INPUT BLOCKED**, not a passing permission-denial test.

## Concrete source delivered

`parent-entry.mjs` is a normal static local ESM Node CLI entry, not a data URL,
Node REPL import or orchestrator metadata shim. `worker-entry.mjs` is a normal
static Worker file with `eval:false`, `execArgv:[]`, `env:{}`, fixed resourceLimits.
No guest-supplied entry, source splice, loader, preload, package search or native
code evaluation. Parent `supervisor.mjs`, `owner.mjs`, `fixtures.mjs`,
`parent-rpc.mjs`, `wire.mjs`, `sync-bridge.mjs`, `errors.mjs`, `reservations.mjs`
and `worker-body.mjs` contain the actual bounded transport/ownership candidate.
The single `scaffold.guest.js.data` is interpreted only by public ordinary run.
The parent output collector records independent effect/admission/ACK/delivery/
exit/cleanup facts plus raw identity observations; it does not map Shell failures.

`MODULES.json` binds the author files and approved role builtins. The static
bootstrap TCB is entry + load-guard and their explicit Node builtin imports;
the guard installs synchronous hooks before subsequent dynamic imports. It does
not use module.register's loader thread. Dynamic source hashes are checked from
actual load-hook source, not merely expected filenames. This guard is UNRUN,
including CJS result.source support and Node22 synchronous-hook compatibility.
The bootstrap itself requires external archived-body verification before launch;
a module cannot authenticate the code that already loaded it by assertion alone.

## K1 — bounded provider/scaffold recipe

Use one public run with ordinary non-async primitive callback. The raw callback
is a global only in the trusted scaffold scope; the sibling guest function has
an explicit `__wrqBridge` parameter passed undefined. It has no lexical access to
the provider IIFE's raw/root/cache variables. Facades close over the raw callback
but never return it. No guessed global constructor or native eval/Function.
Guest module records and parsed JSON are constructed/retained inside the run;
fs/node:fs aliases return the same guest record, not fresh host-copy envelopes.

The admitted grammar is exactly the hash-sealed scaffold text, with only the
finite fixture selector values in CASES.json. There is no arbitrary source parser
or user-source interpolation. JSON, Error, Promise, Object.keys/hasOwn/freeze and
String are source-inspected public intrinsics, not assumed host globals.
Every options record used by those exact guest branches is a fixed data literal.
Public Object descriptor APIs are absent, and ordinary bridge argument copying
occurs before callback admission. Thus generic accessor/extra/prototype-sensitive
original-options validation remains K1-blocked; no copied-object validation is
misrepresented as original-descriptor proof. Full D1 CLI forms, useful arbitrary
options and full scaffold grammar are deferred rather than silently deleted.

## K2 — postcopy, errors, outcomes recipe

Native bridge returns a primitive JSON string. After legitimate ordinary bridge
copy, the interpreted wrapper parses that string and constructs any guest Error
and all fields. Only then it calls the hidden marker with primitive sequence/tag.
The Worker records that marker, not ACK, and terminal includes `deliveredSeq`.
No fresh returned host object is used as a guest cache identity. A parse/copy/
construction failure before the marker leaves it absent; cancellation before
terminal leaves parent delivery unknown and preserves typed originals.

Future observations must check guest catch/output fields, actual missing-file
typed origin, all28 codes, absent/own-undefined/empty optional fields and explicit
raw caller/sink/cleanup controls. They must distinguish actual marker admission,
ordinary callback entry, wrapper count, transport ACK and guest catch. Current
L02 is held: no compiled FsError constructor/provider is selected; `DEV_MISSING`
does not authenticate product FsError. No class-field behavior is tested now.
Actual Shell mapping/priority remains a separate public consumer prerequisite.
Raw expected undefined is an explicit own-value channel, not native abort(undefined).

## K3 — allocation and cooperative ownership recipe

Parent enrolls cleanup before SAB/Worker acquisition, keeps acquisition states
separate from actual exit, and registers each operation before fixture.start.
It stages complete upload before effect admission. `FINAL_ACK` carries no data
and never clears the payload. Stop/wake cannot steal peer payload ownership.
The5s timer starts before startup and closes at normal cutoff; it does not bound
cleanup. Normal cutoff retains preadmitted effects. Caller control aborts owned
cooperative work, wakes and requests termination immediately, with zero grace.
After real exit the presealed L06 barriers release cleanup, not a sleep heuristic.

The reservation source is deliberately NOT a completed K3 proof: operation-pool
release at cleanup/FREE can precede primitive envelope copy/postcopy/engine journal
retirement. Public bridge/parser/clone/journal precharge cannot be inferred from
the16MiB named ledger. No full-profile admission until these lifetimes are fixed
or exact finite source/clone bounds are independently established. No whole-guest,
mutated graph, RSS, oversized arbitrary producer or uncooperative host guarantee.

## K4 — exact launch proposal and hard stop

Authenticated public66 contains core.ts but NOT its static `./lint.js` target's
source (`src/lint.ts`). Existing63 emitted hashes do not include core/index.
The root export has further missing static dependencies. Neither entry closes.
The guard and compile-entry stop before loading a compiler/engine or constructing
a Worker. Compile-entry is an explicit blocker stub, not a working compiler.
No tool guesses, lint stub, root export rewrite, deep import, private read,
source materialization or extra source discovery can repair this under current GO.

ROOT input required: authenticated public core/lint transitive source closure,
corresponding expected regular-file emissions/compiler closure, and acceptance
of a new complete preseal after different review. Future compiler work may use
only exact TS5.9.3 tool bodies and source inputs at the pinned commit. It must
verify existing63 emission hashes, add authenticated missing emission authority,
use regular isolated files, never a data URL/metadata shim/private factory or
copy/symlink/worktree of the private checkout. No compiler import now.

The proposed runtime executable identity is the historical Node v22.22.2 arm64
body in TOOLS.json, not an executed `node --version` observation. Future launch
must reauthenticate its regular file and the full tool/bootstrap/emitted closure.
Candidate parent argv (not run, and not a grant):

```text
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
--permission
--allow-fs-read=/Users/kjopek/Workspace/safe-bash/tests/commands/node-worker-experiments-20260828/preparation-v1
--allow-fs-write=/Users/kjopek/Workspace/safe-bash/tests/commands/node-worker-experiments-20260828/preparation-v1/runtime/RUN-WRQ-SYNC-V3-01
--allow-worker
--disallow-code-generation-from-strings
--unhandled-rejections=strict
/Users/kjopek/Workspace/safe-bash/tests/commands/node-worker-experiments-20260828/preparation-v1/parent-entry.mjs
```

An external trusted launcher must use exactly the environment map
`{"LC_ALL":"C","TZ":"UTC","NODE_DISABLE_COMPILE_CACHE":"1"}`, no inherited
NODE_OPTIONS/PATH/HOME/credentials, and the preparation directory as cwd. Worker
native environment is empty; guest env is separate synthetic data. Child process
spawns are zero. One parent process, up to11 sequential Workers/10 guests, peak1,
zero retries. A future separately authorized compiler process would be a distinct
serial phase; not hidden in Worker startup and not permitted by this grant.
No npm/install/network/native oracle/VM/loader thread or private ABI run.

The permission/flag/hook combination and OS/native dependency closure are not
qualified by source inspection. Unknown loaded modules or unresolved native
dependencies STOP rather than widen an allowlist. Node flags are not a promise
of sandboxing trusted host JavaScript. The uncontained heap control remains held.

## Admission, capture, archive and cleanup

Overall120000ms and per-invocation5000ms are ADMISSION ceilings only. Current
admissible counts are zero. A fresh explicit one-shot grant must bind exact source
commit, both seals, PROFILE/CASES/MODULES/TOOLS/SOURCES hashes, selected identities,
different-review commit/decision, ROOT identity, expiration, process/Worker/guest
counts, permission roots and independent containment. No booleans imply approval.
GRANT.template.json is false/no selections/zero counts. The current entry is a
source candidate and not yet a fully verified enforcement implementation of all
grant fields; unresolved closure also refuses unconditionally before admission.

Only `runtime/RUN-WRQ-SYNC-V3-01/{CLAIM.json,WRQ*-v3.json,LOADS.json}` and a future
explicit final manifest/archive are canonical runtime outputs. No runtime files
exist now. Claim creation is exclusive, one-shot; no overwrites/retries. Trusted
native capture <=64KiB/instance, total evidence <=1MiB; unexpected native output
stops. Each real receipt must fit64KiB and preserve original failures.
Real loaded-body evidence, guest-entry evidence, archive bytes, final output
inventory/hash, post-run source inventory including new entries, and separate
capture/reap ownership must be frozen before a future run. Current collector
does not yet transmit Worker load-hook inventory or an entry witness to parent:
these are additional K4 source gaps, not invented loaded-closure proof.

Unknown exit, unclosed cleanup, capture failure or identity mismatch stops later
admissions and leaves ownership unsettled. Parent process containment/observer
rescue requires separate exact reviewed authority; no5s cleanup deadline or
fabricated clean kill. A rescue, if later authorized, must be reported as rescue,
not subject cleanup. Heap non-enforcement after its bounded loop is negative,
never a retry/expanded allocation. No current archive/reap success is asserted.

## Source seal and DATA-only followup

SEAL.json freezes every author source/data/document body except itself and later
`evidence/` files; it records the exact recursive inventory, not just existing
tracked paths. It covers source bodies, CASES, CONTROL, PROFILE, manifests and
HANDOFF. The design seal is independently complete. Complete seal hashes are
reported externally to avoid recursive hashing. Commit source/preseal first.

Then the only permitted new check is zero-child DATA-only JSON parsing/digests/
exact field/count/source-text binding inspection via the existing tool host.
Maximum300000ms,16MiB capture,64MiB logical work, no code import/eval/parser/VM/
compiler/Worker/engine execution. Compare presealed inventory exactly and detect
unexpected new files outside evidence. A separate evidence commit records checks
and retained errors, never changes the sealed sources. There is no semantic score.
