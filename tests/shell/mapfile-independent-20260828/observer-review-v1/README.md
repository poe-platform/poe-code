# Independent observer review — HOLD before native/OS admission

2026-08-28. Candidate `f2352a6300925480aaa53a494f6014b1d54a9618`, author evidence
`73d05e85`. Independent obligations `1ea0c3f6`; concrete executor `79f09bac`.
Preseal followed author code/results and handoff inspection, but preceded reviewer
module-body inspection. Executor source was committed before its first run.
No product, private engine, array candidate, native recipe or real-driver child ran.

## Actual bounded result

- **Unchanged author37/37**: original28 + supplemental9; missing-admission CLI
  rejection also reproduced. This executes their complete selected modules with
  their dependency model, not their claimed results alone.
- **Independent26/32** model scenarios; six misses below. Separate direct complete
  storage-module control proves prospective registration precedes model mkdir.
  Counts overlap author mechanisms; do not add these into independent semantic
  passes. The all43 model scenario dispatches inert driver events, NOT recipes.
- All37 author and32 independent scenarios drain their model timers. Independent
  model:637 events,68 simulated starts; **zero actual observer children**. No
  model entry remains in the reviewer; no OS fixture/records roots were acquired.
- All seven actual module loads match sealed returned source bytes and immutable
  Git; exact directory closure and17 artifact hashes match before/after.
  Native driver was imported, **never instantiated** by the inspected call paths.
  Effect-denial wrappers record0 actual spawn/signal/mutation attempts during
  the synthetic execution. This is bounded harness instrumentation, not a JS sandbox.
- Reviewer coordinator exit **1**, no signal/stderr;452285 stdout bytes.
  `CAPTURE-01.json` preserves exact compressed stdout/status, including original
  full author JSON1702070 bytes and individual independent failures after drain.
  Capture SHA256 `abcf1f75930690da28c2c7535d691cda7bcc801443a69488829844f489ed6a7b`.

The existing Node22.22.2 binary/path/hash is captured. Existing78 metadata-check
evidence is byte-identical to959eff75; it was authenticated, not rerun/rescored.
Source/metadata Git commands and the reviewer interpreter are not observer child
controls. Author files/captures and original13/54 versus47/54 are unchanged.

## Six misses, three distinct classifications

### F1 — Four mode-policy gaps, not four demonstrated OS successes

`module-mode-only`, `native-not-executable`, `runtime-not-executable`,
`final-mode-only` all return success in the whole-module dependency model.
Same bytes, different permission modes: module644→777; executable755→644;
post-publication module644→777. Candidate authentication only sees kind/bytes/hash.
Real driver stat (`node-driver.mjs:15`) does not even return mode, and admission
(`admission.mjs:15–44`) has no expected mode policy. Current actual modules are644,
Node is755; those observations are not bound admission requirements.

This confirms **unbound mode**, not that a nonexecutable Bash would successfully
launch on Darwin. A real OS may reject at spawn, but that is later than prelaunch
admission. No executable-bit OS test ran. If mode is part of the requested frozen
tool/control admission, author must seal expected modes and expose/compare them
before launch and finally; owned directory/receipt modes also need an explicit
post-acquisition policy. Do not derive expected mode from the same mutable stat
being checked. Root could instead explicitly narrow the policy, not call it tested.

### F2 — Genuine late-admission bug (one control)

`deadline-crossed-during-auth`: initial authentication/setup uses virtual time0.
The second native-hash check (per-row authentication) advances time to150000,
the exact whole-run admission deadline. Expected starts0; actual starts1,
submitted=true, PID9001. Timers subsequently refuse/mark cleanup uncertainty.
The eventual report is red, but an inadmissible launch was already attempted.

Source `observer.mjs:21–22` tests time BEFORE potentially slow authentication;
`lifecycle.mjs:64–66` persists attempt and starts without a final time check.
No kernel-preemption promise is needed to fix this: recheck after authentication
and immediately before start, including after attempt persistence. A persistence
delay is a source-neighbor risk, not a separately executed control in this cohort.
Keep the attempted/no-spawn record and no-next-row behavior; never rewrite a
started child as unexecuted. Suggested author scope: observer/lifecycle + regression.

### F3 — Receipt consistency gap (one adversarial model control)

`close-without-spawn`: injected driver returns a positive PID, then exit+close
and absent group, but never a spawn notification. Actual `success:true`,
`launched:0`, `spawnCalls:1`, `actualCloseEvents:1`, remaining empty.
`lifecycle.mjs:39` accepts close+absent group without spawn accounting; observer
does not reconcile successful rows with observed starts.

This is a guard gap under an inconsistent driver trace, **not evidence that Node
normally emits successful close without spawn**. The real-driver ordering remains
unexecuted. Recommended guard: successful row requires actual submitted/PID/spawn/
close/group-absence facts; report inconsistency/uncertainty, never fabricate spawn
to make counts agree. Ordinary nonzero exit with those facts stays an observation.

**Recommendation:** hold native admission for F2 and a clear F1/F3 resolution,
then differently replay the unchanged failed controls against a newly sealed
candidate. Reviewer has not edited author modules or expectations.

## Five old gaps: actual model mechanisms versus remaining OS proof

| Mechanism | Independently observed in candidate modules | Qualification |
| --- | --- | --- |
| Ownership before mkdir | Direct storage callback sees planned record before mkdir; post-mkdir inspection failure records acquired/unbound path, starts0 | Real filesystem inode replacement/teardown unexecuted |
| Finite terminal path | Missing close/surviving group/late spawn stop at3000 virtual ms; no fabricated close; timers drain | Timer scheduling, real process group survival/reaping unexecuted |
| Final control authentication | Byte drift/new modules/auth/receipts refused after provisional publication; final publication failure remains red | Modes unbound (F1); real descriptor hash reader unexecuted |
| Post-spawn publication failure | One actual model spawn remains launched1/close1 despite persistence failure; release1, red report | Real Node event/write-failure timing unexecuted |
| No fake close on spawn failure | Sync throw and async no-PID error stay launched0/close0; late callbacks drained | Real error/close order unexecuted; F3 success consistency still missing |

The initial final.json is provisional, not acceptance. Candidate storage retains
planned paths on failed writes and checks written receipt bytes/new entries.
Root/records evidence is retained; only verified empty fixture directories are
removed. A failed initial acquisition produces additional failure diagnostics,
not success or unowned deletion. None of this retroqualifies the old supervisor's
five static gaps,16 native observations, or STOPPED_FINAL_INTEGRITY.

## Real-driver static review and proposed separate OS control admission

Inspected whole `node-driver.mjs`: explicit detached executable/argv/cwd/env;
three pipes; child/group PID checks; retained error/spawn/exit/close listeners;
bounded64KiB hash scratch, O_NOFOLLOW descriptor opens, exact lengths/hash and
before/after/path identity; close in finally. No download/fallback or product
imports. Protected control reads and filesystem primitives are synchronous;
they cannot be kernel-preempted by a JS timer. Parent path/version/hash binding
is real source policy, but actual real-driver hash operations were not executed.

Before treating the real adapter as exercised, recommend **separate root approval
of a finite harmless-Node cohort**, not slipping it into the43 native run:

1. Bound Node child zero exit, exact stdin/stdout/stderr and actual execPath;
   observe spawn/exit/close/group absence and pipe release.
2. Same with exit7: complete neutral nonzero, not observer failure.
3. Task-owned missing/nonexecutable executable: real error/close order without
   fake launch/close, no surviving group; no unrelated path probes.
4. One finite timer child ignoring TERM: KILL/terminal accounting and exact owned
   group cleanup, no reaping guarantee if the OS refuses service.
5. Parent exit while one bounded same-group helper retains a pipe: real group/
   stream closure distinction. At most two controlled Node processes in this case.
6. Inject receipt publication failure after an actual spawn notification; retain
   its PID/attempt and terminate/drain that same child without retry.
7. Bounded output overflow and early-input-close handling with observed actual
   events; do not require an EPIPE event that did not occur or count it as tested.
8. Actual owned fixture/hash-reader controls: same-size byte drift, missing file,
   symlink, mode drift after an approved mode repair, and post-acquisition failure.

These are a **proposal, not executions/GO**. Preseal exact child programs, binary,
mode policy, unique directories, source closure, finite counts/time/output and
outer owned-child cleanup before that separate review. No Bash/private/native
recipe needed. A controllable missing-close callback remains synthetic; do not
invent an OS way to guarantee a missing close event. If root accepts a narrower
static-only real-adapter qualification, record it explicitly rather than claiming
OS proof from37/37 or26/32.

## Actual43 interface and limits (not authorization)

Original32 unchanged + additive11 are neutral, unrun:5197 script bytes,313 stdin
bytes; combined JSON SHA256
`18f52fe34068d96f12bc35af5d7e51443f3c59e89627accd33f7ce54b8f1534a`.
A01 now contains C3 and really targets the delimiter-first-byte hit as data.
A02–A04 use finite one/two-record origins, not huge loops. A05–A10 isolate
errors; A11 closes only the command's stdin via `<&-`, then reads the restored
parent input. N27/N28 add subshell/pipeline contexts; N29 fixed native callback
remains literal reviewed code, not product callback permission. No external
command, arbitrary source, network or filesystem payload write is authorized.

Current CLI takes exactly FOUR arguments after its filename:

```
BOUND_NODE .../observer-v1/modules/cli.mjs ABS_AUTH AUTH_SHA256 ABS_SEAL SEAL_SHA256
```

Future separately approved authorization fields are `kind: ROOT_NATIVE_GO`, exact
`moduleSealSha256`, `recipeSha256`, ordered explicit `rowIds`, unique `outputRoot`
matching `/private/tmp/mapfile-observer-[A-Za-z0-9-]+`, and exact parent `runtime`
path/version/platform/arch/bytes/sha256. Existing candidate seal is
`d08585b8995ffd1399be27c17dc378357707106b93f12c240e92ffe57dadadc4`;
**a repair needs a new seal and approval**. No usable ROOT_NATIVE_GO file was
created here. The kind token is a trusted coordinator boundary, not authentication
against malicious host JavaScript.

Source fixes must retain explicit `--noprofile --norc -c SCRIPT mapfile-design-v1`,
eight-key replacement PATH/ENV/BASH_ENV/HOME/TMPDIR/LANG/LC_ALL/TZ environment,
C locale/UTC, task-owned fixture/home/tmp and three stdio pipes. Pinned GNU binary
remains SHA2568cecb482...9673c, prior5.3 Darwin metadata only; no new version call.
No GNU/Linux or UTF8-locale/native-byte semantic claim.

At most43 top-level launches, conservative47 contexts;4KiB script/stdin each,
32KiB aggregate each,64KiB combined output/row,1MiB total retained output,
2.5/2.75/3-second row stages and150-second whole admission/reporting boundary.
At most132 receipt files/4MiB receipts and4MiB parent output. Control files each
16MiB/64MiB aggregate, Node256MiB and native16MiB; bounded primitives still are not
preemptible kernel guarantees. Initial protocol110 seconds/32 launches remains
historical; additive design explicitly increases these to150/43. No silent rewrite.

## Product policy overlay and handoff

`LEASE-OVERLAY.md` records root's exclusive/nonreentrant canonical cursor choice
and proposes exact busy diagnostic/status/effect phases. It replaces the author's
open ALS/recursive-versus-sibling queue suggestion, not its historical bytes.
Other numeric/delimiter/NUL/extra/publication policy remains pending observations.
Actual arrays acceptance is a product prerequisite, not a logical requirement for
properly admitted standalone GNU observation. No product source/window requested.

Owned scope only; original78 metadata evidence and43 UNRUN states retained.
No actual observer children/OS fixtures remain to stop or clean. No full gate,
native execution, held XAN action or private repository access occurred.
