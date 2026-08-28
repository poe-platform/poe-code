# One-shot continuation recipe — pre-execution

Source f03c260269dfd8ee10666f7fd2560655f8e14a38; author harness
63aae753af1ce5d8fa26160b596d6203e264e970; evidence
89c735fcdfe6e09bc88bb41535bad421e7e0cbd9. All41 bindings rehashed from pinned Git;
39 unchanged versus e35; only supervise.mjs/DRIVER changed. New recipe does NOT
rerun the15 retained records. Original fb6f048d15P/1F/2U and all old histories stand.

Normalized driver aca88337d644351888659e4364f0610da0219eb3697de45fa808b509bfbc3424;
effective profile fa6731eec6b41915f3f56affa9cdf29e7352a10e939bb0f1fe1b9d675caa7510;
historical519ac40f0239bf363586c5144bbe7f0f3c72c786f42abbc2d1d9ffb004ba2cf6;
f5/c109 unchanged. Separate OS-fence module1955d2225312f57dfd4f7cb4a122e4d940caf997aea9ba4aa4c85f85558bac69
and supervisor3e624d9dd62d30a134540078a0ee3df4b8fdbd16d3f817c75f9583ba60dbcd08.

## Exact invocation and closure

After this commit ONLY:
`python3 tests/integration/full-gate-20260827/unified76-driver-independent/supervisor-repair-v17/continuation-v2/controller.py <recipe-full-commit>`.
Controller reads that committed RECIPE.json and verifies every owned file hash.
It authenticates existing Node/ps/sandbox-exec file identities before use; no new
tool/native semantic/library probe. Recorded metadata OS exceptions remain exact,
not readable-library hashes or full OS attestation. No new permission/route.

Node `/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node` SHA
4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0;
ps `/bin/ps` SHA1e46cdb824858eb32e4c85ca920ba31b4541a814a133980d8b3484f39942276c;
sandbox-exec `/usr/bin/sandbox-exec` SHA
d1ee30dbde955aaa75c7f801fdfea4df05b10129454d7982eb6453f771436d42.
Observer argv exactly `-axo pid=,ppid=,pgid=,lstart=,command=`. Fixed process
environment only PATH=/dev/null, LANG=C, LC_ALL=C, TZ=UTC.

Stage seven regular files only: entire supervise.mjs, os-instruction-fence.mjs,
TOOL-ROUTES.json from pinned source; own review.mjs, compare.mjs, BINDINGS.json,
CHILDREN.json from sealed recipe. No old supervisor stage, AGENTS, dependency,
private/product tree, live fallback or candidate entrypoint. Candidate whole
modules are rehashed immediately before VM linkage; imports and module hashes
persist incrementally. Unknown/dynamic imports reject. Own controller uses
builtin Python modules only; own Node modules use builtins plus sealed compare.

28 pure-data companions (22 comparator+6 collector), then exactly three owned Node
target cases. No additional target/collector child. Counter contexts companion,
sourceSpawn, sourceObserver, ownershipObserver and absenceObserver stay separate.
Expected faults keep their object/primitive identity, statuses/signals/captures.

## Ownership, safety and finite limits

Before coordinator launch the independent Python parent reserves A01–A03 slots.
The spawn adapter obtains real PID/parent/PGID/birth, atomically publishes its
registration, then returns to shipping supervisor BEFORE any injected fault.
Parent consumes those files independently of source fault injection/stdout parser;
before any signal it freshly matches exact PID/birth/PGID. No group signaling,
foreign sentinel or arbitrary PID. The approved ps command enumerates process
metadata; only owned identities are retained. Never signal a merely guessed PID.

Child supervisor timeout3000ms + unchanged cleanup5000ms; intrinsic500/2000/500ms.
Independent parent rescue threshold8000ms per registered child, SIGKILL only exact
owned identity; any rescue is FAIL/HOLD. Coordinator deadline90s, stream drain5s,
outer loop100s plus bounded wait5s; overall qualified ceiling120s. No kernel-hard
deadline/hostile JS/RSS guarantee. Parent observer timeout2s and streams bounded
8MiB each; only its own observer handle is retired on observer failure.

Target stdio ignored stdin/new stdout+stderr pipes only. No foreign writable FD,
IPC, child-spawn permission or user-file write grant in Node targets. Targets run
under actual sandbox-exec with shipping-rendered fresh write-root/exact-output
profile and `--permission --eval <sealed CHILDREN.json code>`. Parent observation
remains outside write sandbox. No unbound execution fallback if sandbox fails.

Separate lexical coordinator stdout/stderr <=1MiB each; source child output65536
bytes; coordinator file-size rlimit16MiB; all deterministic temp data <=32MiB
verified pre/post (not a filesystem quota). Append-only role/load journals and
one file per companion/case preserve partial results. Captures retained losslessly
as gzip/base64 with raw SHA/size, plus actual exit/signal/stream closure. A late
ALL_PASS cannot override coordinator nonzero/fault/overflow/rescue/unclosed state.

One cohort, no runtime fix/retry. Ordinary expected-result mismatches aggregate
only with clean integrity/closure. Unexpected role/admission or child closure
breach stops remaining cases. Only parent-created regular temp roots are removed
after hashes; retained gate roots untouched. All505 prior independent artifacts
are byte-checked; foreign index before/after recorded, never edited or reset.

H06 remains SOURCEQUALIFIED / actual dual-private-error UNEXECUTED, conditional
on terminal persistence. No old40/A10/private/setup/build/chmod/native-oracle/gate.
Successful new scoped proof is not old-case rescoring or fresh root release;
new immutable packet and ROOT authorization still required, with historical
unsupported aggregate qualified NONZERO and no inherited consumed GO.
