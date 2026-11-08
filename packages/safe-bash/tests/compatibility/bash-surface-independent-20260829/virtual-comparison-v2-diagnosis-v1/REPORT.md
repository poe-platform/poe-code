# V2 group EPERM: source/DATA diagnosis

**Conclusion: the immediate observer path is identified; the lower permission cause remains UNKNOWN. No implementation or new probe was performed.**

## Frozen evidence and callsite

V2 source e24cce05ca0b20212155aee25ec21237e0d9baa4, evidence8ec3de0e1a55ec77b7c3ecddf6fc0e8d942c2d67, controlseal51fabb2a01ff9dc9bf2c5ed5f259e916f9d3fba8e90366f394d0c2169c01b923. BINDINGS.json records exact source/record hashes. The retained raw archive was regular/exact-size/hash admitted before inflation of the same authenticated compressed Buffer; no production archive was touched.

- Observer owner is **controls.mjs PID59686**, launched by publication-admin-controls.mjs as pinned Node22.22.2 with only script/work argv. The owner exited1 with exit/close/EOF.
- M08 child is PID59697, term.mjs. mechanism.mjs:26 uses detached:true, shell:false, ignored stdin and captured stdout/stderr pipes. No uid/gid change or shell wrapper is requested.
- mechanism.mjs:8–9 imports node:process and defaults to its bound kill function; it invokes negative pid with numeric signal0. controls.mjs:81 calls runChild; mechanism.mjs:32 probes after wake; :36 sends TERM when present; :37 polls after TERM. M08 supplies no injected kill function.
- Parent launch factory :16–17 replaces environment and specifies no NODE_OPTIONS or permission/preload CLI flags. M08 args are only term.mjs; the guard preload is used for M03–M06, not M08 or the control owner. guard.mjs:8 replaces Worker only, not kill/_kill. M15's synthetic EPERM branch is below the stopped section and **UNRUN**.
- Source inference: entering the TERM branch requires a prior present result. The final unknown result is in post-TERM polling. The raw record does not retain every probe timestamp/argument, so exact probe count/order against exit cannot be reconstructed.

Raw M08 keeps stdout READY\n (6bytes), empty stderr, successful SIGTERM send recorded at 2026-08-29T09:17:51.329Z, exit0/signal-null, close/both EOF, complete flush/size/hash/close. Final error is **Error / EPERM / errno-1 / syscallkill**; row finishes 2026-08-29T09:17:51.389Z. Primary remains CHILD_DEADLINE; group error is separate. No stale PID/PGID59697 check or signal was performed here.

## What pinned Node source does—and does not prove

Primary references are versioned Node v22.22.2 sources, listed in PRIMARY-SOURCES.json. P1 shows the normal JavaScript wrapper calls process._kill and wraps a nonzero result as an errno exception for kill. P2's native Kill calls uv_kill; P3's Unix uv_kill calls kill and translates errno. This makes the retained shape consistent with the normal native errno path. It does **not** authenticate a historical kernel syscall or distinguish ordinary OS permission denial from inherited host policy/interposition. No such trace was retained.

P4 documents flag-enabled Node Permission Model and ERR_ACCESS_DENIED denials. The inspected launch has no enabling flag and the shown stock Kill path has no permission-model branch. Thus there is **no evidence identifying Node Permission Model as cause**. Do not replace this with a universal claim that no unobserved host filter existed. P1 also dynamically accesses process._kill: a bound JavaScript kill function alone is not native-binding attestation. No sealed source replaces either function, but historical runtime binding/permission snapshots are absent.

P5 specifies new group/session leadership for detached:true on non-Windows. Therefore expected PGID59697 is source/API-derived. Only child PID was recorded; an independent getpgid measurement was not. Exit/close/EOF and a source-only no-descendants argument cannot qualify group absence.

## Contrast with accepted functional-native v3

Authenticated 4eea3541 source: group-observer.mjs imports named kill, guards positive owned PIDs and signals; lifecycle.mjs:16 launches detached children and :11 preserves timed group-observation transitions. entry.mjs:32 checks owner execPath/empty execArgv/absent NODE_OPTIONS. Its protocol explicitly separates trusted initial tool-shell startup and owner admission from fresh child environment.

That is a stronger explicit role/evidence boundary, **not permission transferable to this run**. Both designs observe in the parent, not in a restricted child. V2 was launched through the preparation helper; nativev3 had its separately approved exec-replacement route. The OS/tool authority equivalence is not established. Native37 natural retirement observations do not qualify this TERM path or prove a named-import change fixes EPERM. No native grant or runtime was reused.

## Smallest recommended next step

**Qualification and evidence correction, not an asserted permission fix.** Keep observers and signals in an explicitly admitted trusted owner, bind the observer before child acquisition, restrict it to the owner's fresh finite leases, and log exact caller/target/phase plus errors. Preserve child loader/Worker restrictions. V2 already uses the parent; simply moving its call or changing import syntax is not a demonstrated repair. No broad process permission, sudo, OS-filter change or fallback observer is justified.

PROPOSAL.json predeclares five DATA and three fresh harmless Node roles: natural guarded child, TERM-handled child, TERM-ignored/KILL child. Proposed10min/16knownOS/peak2/one loader/zeroRegexWorkers/8MiBcapture/64MiBwork, all requiring fresh ROOT and any exact tool approval. UNKNOWN stops later roles; no stale/reused group and no automatic reroute. The child PID-derived PGID convention remains qualified, not race-proof kernel identity. No tests/probes ran now.

Original12 admission+M01–07, M08STOP, M09–16UNRUN and111 productUNRUN remain unchanged. Unversioned/newer Node search results and unavailable bootstrap-source fetches were not used to assert v22 behavior.
