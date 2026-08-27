# Benign complete-command performance evidence

**BENIGN_BENCHMARK_ONLY_NOT_DEFAULT_ACCEPTANCE**

Executed August 27, 2026, 08:55:14–08:55:15 UTC, Node v22.22.2,
Darwin arm64. Exactly **three alternating pairs / six commands**, not six
independent features. All six returned status 0, identical 260-byte stdout
(13 lines), and empty stderr. The original 32-file fixture and command are
unchanged. No threshold or broad performance conclusion is applied.

## Complete-command and startup measurements

All values below are milliseconds. Native worker ready latency is already
included in complete-command elapsed; do not add or treat it as a separate run.

| Pair | Order | Baseline elapsed | Candidate elapsed | Baseline native ready | Candidate native ready |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | baseline, candidate | 32.300042 | 23.862750 | 21.975000 | 12.879542 |
| 2 | candidate, baseline | 15.616750 | 17.783584 | 12.746416 | 12.544875 |
| 3 | baseline, candidate | 15.404584 | 17.088375 | 12.243375 | 12.180500 |

Candidate elapsed was lower in pair 1 and higher in pairs 2 and 3. This is
one instrumented fixture with six fresh shells, no warm-up commands, and
uncontrolled foreign cohost load. It does not establish a general speedup,
regression, superiority, or full-performance acceptance. The larger first
baseline startup remains in the evidence, not discarded or adjusted away.

Imports and VFS fixture setup are excluded exactly as in the prepared/historical
benchmark. Complete-command time includes shell/plugin construction, deferred
plugin setup, worker startup, traversal, output, and awaited shell disposal.

| Pair / variant | Construction/registration upper bound | Public use | Deferred plugin setup | Public exec | Settlement to dispose | Awaited dispose |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 baseline | 0.111459 | 0.015916 | 1.538500 | 32.113000 | 0.052333 | 0.023250 |
| 1 candidate | 0.098792 | 0.021542 | 1.822334 | 23.717792 | 0.007750 | 0.038416 |
| 2 candidate | 0.014626 | 0.002584 | 0.151166 | 17.756375 | 0.008125 | 0.004458 |
| 2 baseline | 0.017917 | 0.002542 | 0.133125 | 15.588000 | 0.008458 | 0.002375 |
| 3 baseline | 0.011959 | 0.002625 | 0.104958 | 15.384209 | 0.005875 | 0.002541 |
| 3 candidate | 0.013875 | 0.002375 | 0.116750 | 17.063125 | 0.005625 | 0.005750 |

The constructor/factory is not independently timed: the upper bound includes
small outer scheduling tails. Deferred plugin setup is inside public exec.
Additive timing taps return original values/promises and add observer overhead
to both variants; these are not independent or additive throughput estimates.
See README for precise interval definitions. No product file was edited.

## Bytes, disposal, and exact children

- Exact stdout SHA256 for every command:
  `508c70ef89ed85ee8704733da421f3af14f1ac7f0b376fe27ab0f6a3403c3086`.
- Each command created one native worker. All six workers exited, had exactly
  one awaited termination, and had zero observed message/messageerror/error/exit
  listeners both at public settlement and after awaited dispose.
- Candidate's actual public promise settlement was separately observed before
  the benchmark's await continuation: all three were already clean. This is
  not inferred from eventual disposal. Baseline was also clean in this fixture;
  its public boundary was recorded, not retroactively given candidate requirements.
- This cohort observes native-worker listeners, not caller/context abort-listener
  counts. No explicit caller signal or new lifecycle controls were introduced.
- The successful exact child was PID 44220: exit 0, no watchdog kill, awaited
  disconnect/stdout/stderr/child close. Parent ready was 119.752625 ms, full
  child lifetime 301.150708 ms, stdout/stderr 0 bytes, cumulative IPC 13,133 bytes.
  Parent ready includes imports and is not native-worker startup.
- The preserved setup-only child PID 42853 exited 1 before ready or any command.
  Both exact children were confirmed absent after close. Active owned children: 0.
  The main verifier's 29 prior children were authenticated and absent before run.

## Frozen provenance and preserved setup failure

Candidate is the main final verified **actual moved package**, not live source
or root dist. Runtime `1b133a8662a32ee84524794842074c9c98d5f6c3`, registration
`01aa1bffe0568cc6787d5ff8e0331e024a787385`, fixture
`10273352f8d65d929cbf5a23e69119414dacee60` were authenticated. All **216
source/metadata identities** and **704 emitted identities** match the original
and final verified manifests. All 704 package emissions match the frozen build.
Package entry and all three candidate worker URLs physically resolve beneath
the main final verified moved `node_modules/virtual-bash` path recorded in
`setup-recovery-identities.json` and the raw result.

Candidate archive SHA256:
`86c34e382c85563afbd9c760aa2e0f161308e8f43e14fe99dfec9ed96d77539b`.
Final source manifest:
`ef7d7c018ca19cc699a3ddcd009b8d1197de416f154651885738ce7537369b2e`.
Final build manifest:
`9194095150789c25ff250aa746b567aac584d433a6330180f37d4924195a30d9`.

Baseline is the explicitly benchmark-only approved
`329eb2722052e8ace0ec18a751f12c30ed87a25b` closure, using freeze/build archived
at `839f2d4`. All **152 source/metadata identities** and **588 emitted identities**
were checked before and after execution. Historical capture worktree status was
dirty and is retained in full in the identity evidence; the captured identity
list has zero `dirty: true` entries. Neither clean-HEAD provenance nor a different
baseline was substituted. Manifest SHA256s:
`ded2ab6a8e44b860463b8015a405d93e570da6edbd13118099926ca97076beb8`
and `52641ec74771095f07f16c9c8fd30057a89a358461b42e9f74bac055b4ef48ee`.

Preparation manifest matches `d9e277b`. The cloned compiled benchmark body is
`8b1e0d2ac84978e83fd8a060f3046c5b86fdc164afb248e99ac5f0ffd739548e`;
compiled observer body is
`85b997898052fb1c1df27a0422929e1e7667e2ee848c7b4dabf25be839eda2de`.
Both are unchanged. Existing binding, risky guard, preparation, and evidence
were read-only and reauthenticated. Frozen sources/emissions were rechecked
after execution. Concurrent live changes are not execution inputs.

The first setup attempt hit Node package self-reference: the unchanged entry
assertion rejected live root dist **before importing that entry or any command**.
The preload had imported only the two frozen APIs; it executed no command.
The failure was saved and reported to root before the permitted setup recovery.
An owned private package boundary corrected bare resolution without changing
the benchmark/observer. Original `claim.json`, `identities.json`, `result.json`,
and exact `setup-failure-run.mjs.txt` remain intact. Recovery writes fresh
`setup-recovery-*` files. There were no benchmark command retries.

## Validation and limits

Syntax checks passed for the static parent, timing preload, and read-only audit.
The benchmark passed; a subsequent audit of recorded evidence passed without
rerunning commands. It authenticated both attempts, exact bytes, disposal,
compiled body hashes, and absent child PIDs. No lifecycle/original-five/full
suite/build/install or risky probe ran. All six additional exposures remain
**UNUSED**; four risky jobs remain **LOCKED**.

Original preparation **7/8 is preserved and unrebaselined**; separate adjudication
does not turn it into all-original-benign-green. No fabricated all-green approval,
canonical correction, default acceptance, full release, superiority, deployed
provider coverage, or 72-hour completion is claimed.

Durable hashes:
- Preserved failure `result.json`:
  `db3a8c49ea2c44460638a9e45453b0b62de44c9fb6a87046dd70258d8599eded`.
- Successful `setup-recovery-result.json`:
  `56120e9359a390545432175fdb911cf08a6d1f1a3aa8767275c1ba6e3e1776e5`.
- Read-only `audit.json`:
  `13ca372563b2a6a7a9547f0097df658ed58b5caa5b1309a7db8198002de55f50`.

Only new files beneath this benchmark-only directory are committed. Ignored
owned compiled copies/package link are retained for provenance, not active work.
