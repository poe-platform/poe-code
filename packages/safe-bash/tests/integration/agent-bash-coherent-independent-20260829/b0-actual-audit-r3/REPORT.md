# Independent B0-r3 actual evidence audit

## Verdict

**ACCEPT, finite known-role functional evidence only.** This is an audit of the one reported authorized attempt, not a new product run or full coherent acceptance. The fresh, presealed PURE DATA helper exits/closes 0, independently reconciles all **39 expected workflow outcomes**, and rejects **8/8** controlled corruptions. No helper correction, product import, installation, compiler, Worker, guest engine, native oracle, network operation, or old process/group probe was performed.

Evidence commit: `d116d79a5604cae5c5d73ff6ecf861ab095581ae`. Candidate: `8ab0b2875c695c7cf6fbe90080cd083f69ef7146`. PRESEAL: 11952 bytes, SHA256 `78e6c945ceadfb54d51d806fbe57399ab5a552ad4571791cb916c085736e27a7`. Derived source: `3adc676a0ab638c9788ef007e465931d65d2c6fe`, 309 inputs; a derived identity is not assumed to be a Git object.

Full package: 930368 bytes, SHA256 `2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca`, 1014 members. Actual Stage-A dist authority is reused: 1012 emitted files, not a tar extraction relabeled as a source build. This audit independently hashes the retained package and every member in both surviving package locations. The installed package was physically renamed; its old binding paths remain historical, whereas current bytes are checked at the moved location.

## Exact finite outcomes

Each of `source-built`, `installed`, and `physically-moved` contains exactly these 13 identities, in order: **C01 C02 C03 C04 C05 C06 C07 C08 C09 C12 C13 C14 C17**. Each has 13 PASS / 0 FAIL / 0 SKIP, totaling 39. These are workflow assertions, not 39 successful Shell commands; C09 intentionally exercises failure.

The raw consumer stdout contains exactly one complete JSON frame plus LF. It matches the corresponding raw RESULT aggregate. No normalization or extra-frame dropping occurs. Captured consumer stderr is retained byte-for-byte, including Node loader/permission warnings. Individual nested Shell stdout/stderr/effect values are checked by authenticated workflow code but are **not separately serialized as raw per-exec transcripts**; acceptance of those values is source-bound assertion evidence, not a newly recovered transcript.

The 42 cleanup fulfillments are exactly **42 awaited `Shell.dispose()` settlements**, 14 per layout because C01 creates two Shell instances. They do not mean 42 arbitrary provider finalizers. C17 returns the exact nonasync invoke Promise and observes `registered → diagnostic → cleanup-enter → release → cleanup-finished → settled`; its sink reason is `0`, cleanup reason is `false`, and source assertions preserve the intended precedence. A fulfilled Shell disposal does not erase that deliberate cleanup-hook rejection.

## Loads, guards and ownership

Three independently hashed load logs each contain **248 records / 248 unique modules**, checked against the layout's authenticated package/harness binding. `AUTHENTICATED-LOAD-RECORDS.json` preserves all nine load/resource/request files. Loader source verifies bytes before calling the loader continuation; this is trusted immutable-input checking, not an atomic OS execution lock or host authorization boundary.

Both bootstrap and before-exit resource records are present for each consumer. They explicitly report `created:0, live:0`: **zero instrumented application Regex Workers**, not merely absence of a recorded Worker event. There are **three internal-loader admissions**, established by the three child invocations and loader configuration; individual loader-thread exits remain **NOT OBSERVED**. Inherited parent/static Regex closure authority is retained, with no new nested-load proof. Guest engine calls are zero; PUBLIC95 was not loaded.

The four supervised child roles have one spawn, exit and close each, all status 0 and null signal: offline-install PID 70850; source-built 70877; installed 70881; physically-moved 70886. They run sequentially. No TERM/KILL event is present. Actual supervisor retirement is 8590.688375 ms; attempted and stored child capture both total **8653 bytes**. Owner code uses write-all, checked flush/close, explicit primary-presence flags, and shared inclusive clock handling. This is successful-path evidence plus reviewed mechanism, not new native descriptor-fault qualification.

Raw group-absence fields are preserved but not promoted to this review's guarantee. The historical reviewer campaign `eff15eba` remains HOLD for its irretrievable parent-group observation; no old PID was probed. All earlier STOP/HOLD and original cohort results remain unchanged.

## Integrity, clocks and limits

Forty publication-manifest members are independently byte/hash matched. EVIDENCE-MANIFEST SHA256: `c7b3f1dfaadd6856385afcd1cd5fba0286b04fd8c92941b05fad23d13136e0b4`. AUTHORIZATION bytes exactly match the earlier immutable authorization commit `6f8e55272cf2f207a2c71753bd8ccd5a430ccc07`. Final-binding packet SHA256 `0c1fe3ac4c6dde32caab52c0575254bae3ad8071943ce48e5bf404f1af2b5f39` and review receipt SHA256 `377afa30cc705e94e488fc6faf59ddbcd3a5378cb400be8c696b283331f061d0` agree with the execution records.

The external window is issued 11:53:14.522, latest start 12:13:14.522, expiry 12:43:14.522 UTC, August 29, 2026. Preflight begins 12:02:52.037 and is ready 12:02:54.265. Snapshot is 12:06:49.793; evidence publication 12:08:50.419; post-snapshot check 12:08:51.102. These fit even the author's conservative publication deadline of 12:32:52.037. Precise tool-transport activation state is not independently observable from committed artifacts. The ROOT user's one-authorized-attempt/exit-0 statement is authoritative; a hardcoded summary `launcherExit:0` alone would not prove it. External UTC policy is not runtime enforcement; initial trusted host/tool-shell/zsh initialization is outside capture, and login:false does not suppress `.zshenv`.

The independently repeated, invocation-local immutable work census is **2189 entries, 2071 regular files, 12916428 bytes, zero added/missing/changed**, identical before and after the DATA audit. The earlier runtime 12902570-byte value precedes final result/event publication; it is not silently equated to the later inventory. The 192-MiB review work allowance and 48-MiB capture allowance are not an RSS promise. The author's 32-start conservative administrative accounting is retained as such, **not an independently complete census of transitive OS activity**. Its 8653-byte runtime capture excludes administrative publication transcripts; those are preserved separately in authenticated evidence. No universal process-count, arbitrary-provider cleanup, or OS containment result follows.

Reviewer preparation begins 12:10:08.829 with deadline 12:25:08.829. One sealed DATA child runs 12:19:04.169–12:19:04.847, exits/closes 0, and captures 70 stdout / 0 stderr bytes. Metadata and publication roles are recorded separately; no unresolved known review child is accepted. Final publication is within this same grant, not a renewed window.

## Tamper and remaining obligations

Eight DATA controls reject: an extra result frame; duplicated case identity; hidden rejected disposal; reversed C17 ordering; false stored-byte accounting; missing known child close; a zero-worker claim with live=1; and a mismatched loaded-module hash. These check the auditor, not product mutants or native lifecycle fault injection.

**Remaining: 672 retained slots + 15 PUBLIC-engine workflow slots, type/mutant/binding obligations, and all50 Unit2 identities per layout with exact-identity deduplication.** No full 726-slot completion, new Node-module acceptance, native parity, full coherent gate, nested Worker closure, or broad winner claim is made.
