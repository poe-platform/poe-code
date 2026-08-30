# B1 final-admin-r5 independent review — HOLD

No actual B1, publisher, product, Worker, compiler/build/install, native oracle,
network or private-engine execution occurred. ROOT's prospective authorization
string is a binding value only. This receipt does not authorize activation.

## C01: four live startup files, two-file reservation

`final-admin-r5/PUBLICATION-BINDING.json:53` declares four live files: outer-owner
stdout/stderr and publisher stdout/stderr. `admin-owner-r2/publish.mjs:140` admits
each at up to4096 bytes. However, line144 retains the inherited
`ledger.charge(8192 - startupBytes)`. Initial startup bytes are already in the
ledger, so their combined prepayment is exactly8192, irrespective of four files.
The final loop at line193 again checks each file at4096, without reconciling the
four-file total against that8192 reservation.

Frozen **N08 FAIL**: four individually admitted4096-byte files have a16384-byte
ceiling; the exact pure Ledger operation used by that source charges8192.
The explicit startup reservation is short by8192. Generic tail prose/reservations
do not reconcile this four-file total in the executed accounting path. The same
formula can also become negative when initially observed bytes exceed8192 even
though every individual file is within its bound.

This establishes a **SOURCE/DATA accounting inconsistency**, not an observed
runtime overflow, lost bytes, or actual-publisher bypass. The novel control
imports only Ledger; it does not evaluate publisher.mjs. It deliberately retains
the literal failing expected property rather than treating a counterexample as a
passing safety assertion. No author source has been edited.

Minimal requested author repair: derive the startup reservation from the exact
authenticated member count and4096 ceiling, precharge that complete amount,
and reconcile final observations consistently. Preserve the64MiB aggregate cap;
do not simply raise it. Alternatively an explicit aggregate8192 policy requires
consistent enforcement and ROOT adjudication of its narrower per-file aggregate
profile. Rebind changed source/packet and review the affected boundary before GO.

## Frozen identities

- Source: `c4a2cc65e76c7f1015b8b0206c8a7cdec9f70645`; evidence: `0d6163dca28e2f0ad7fef45fcfdfb11bf9c717ac`.
- FINAL:23784 bytes, SHA256 `d7cdc4e0261c4752b518fdc42c327f2afa2d777c83c33048c8d14ad86b5b0e65`.
- Runtime preseal:20784 bytes, SHA256 `576f604888158f8114c6e25dddf976820ef91c7cc4859b763b2dd55fad40aec5`.
- Publisher binding:4052 bytes, SHA256 `ab385dcbc7850c82ca81871aa2aa72554440540e7a353e907a8fbd2a78644288`.
- Package:930368 bytes, SHA256 `2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca`, streamed only.
- Independent preseal commit: `ef58f3547ca0f6f71b87d4b8ba91891af0c7af27`; PRESEAL SHA256 `34e510ba218751bb7e5dda0b489254d6895e3da5c4cb0b8cc7519d8553f18365`.

NUL Git inventories bind selected r5 and admin-r2 source/control records. The
15-call coherent source309/StageA1012/package1014 profile is inherited unchanged,
not freshly executed or recensused. Strict DATA comparison confirms runtime
preseal changes only workRoot relative to accepted r4. Fifty-five explicit
runtime input pins, owner/preimport/publisher helper closure and both tools are
authenticated; 101 original binding postchecks pass, including repeated bindings.
The six fresh root/startup-capture paths remain absent. This is not a reservation
against another process, nor an append-proof global source census.

## Actual bounded results

- Author admin-r2: **8/8 PURE** and **2/2 harmless parent-chain children** pass.
- R5 binding/source controls: **4/4** pass.
- Independent additional controls: **7/8**, with literal N08 failure retained.
- Harmless child PIDs33655/33657: natural status0, exit+close+both stream EOFs
  observed, no remaining active child. Their combined captured streams total1425
  bytes. These are preimport-like/publisher-like probe modules, not real roles.
- Two helper entrypoints only, no replay/rebaseline,24 sealed file postguards
  around the independent controls. Raw stdout/stderr and ownership rows remain
  committed. Fixture identity points at the sealed probe preparation source;
  it is not production authority.

## Ownership and timing delta that does check out

`ledger.mjs` permits exactly one LIVE_ADMIN_OWNER bound to the actual preimport
parent PID. Every other prior role must have observed start/exit/close. Falsy or
missing observations, duplicate IDs/PIDs, foreign parents, extra live roles,
missing counts and over-cap named reservations reject in the finite controls.
Preimport retirement is required before publisher admission; the publisher and
Git starts are added as observations, not an old implicit+2. Reservations remain
RESERVED_NOT_STARTED, and no closed-owner fiction is used.

The real entry uses one captured administrative Node owner, direct runtime,
preimport and publisher calls, with nested runtime/Git PID+role reconciliation.
Runtime and publisher nested EOF fields remain null/UNOBSERVED, not inferred from
exit or close. Final owner disposition remains EXIT_PENDING_EXTERNAL_OBSERVATION;
only external tool/session return can qualify its exit. Root-approved known-role
scope is not a universal transitive OS census or sandbox. Source alone does not
prove all actual nested processes will retire.

The owner subtracts elapsed preauthentication time from its1800s wall budget;
runtime/preimport/publisher stay on that same owner clock, including180s tail.
No late invocation receives a renewed window. Publisher's own deadline uses the
same actual start/expiry authority. Its argument slots are filled from the
same-written authority identity after preimport exit/close, without another OS
start between those events. These routes were source-inspected, not activated.

## Bound command — DO NOT RUN while HOLD

UTC August29: issued15:41:47.955, latest16:01:47.955, expiry16:31:47.955.
Prospective36 known OS/peak3;1800s inclusive(1620active+180tail);64MiB capture;
768MiB logical work;15 guest calls/maximum5 live;Regex0/async-loader0. The new36
ceiling does not retrospectively repair old r4 c441 PID-gap STOP or32-role limits.

Set exactly `B1_ADMIN_ROOT_GO=ROOT_B1_R5_LIVE_ADMIN_EXPLICIT_AUTHORIZATION` in the
launch environment; repository cwd, login=false. The fully resolved candidate
command below is recorded only as DATA and still needs repair/review/fresh GO:

```sh
exec /bin/zsh '/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/final-admin-r5/launch.sh' '/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/final-admin-r5/FINAL.json' 'd7cdc4e0261c4752b518fdc42c327f2afa2d777c83c33048c8d14ad86b5b0e65' '23784' 'ROOT_B1_R5_LIVE_ADMIN_20260829_ONE_ACTUAL_AFTER_FINAL_ACCEPTANCE'
```

Initial trusted host/shell startup remains outside the profile. All old failures,
unexecuted real cases and prior qualifications remain unchanged. No actual grant
was installed or consumed by this review.
