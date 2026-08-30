# V7-r2 one-admission result: UNSAFE_STOP

August 28, 2026. **One authorized attempt consumed; admission NOT accepted.**
No retry, recipe edit, extra engine run, policy widening or99-cohort execution.

## Immutable authority and launch

- Root grant commit: `8830c48b242de7f6b29e84e71def3cabee8d22db`.
  GRANT.json951 bytes, SHA256
  `1de161b4493b20cf200e7a8f845399c9757f41192928def1f820f78626309ce3`.
- AUTH/launch-intent commit: `bfdad34b368e139793479929567aaff7ce828ffe`.
  AUTH.json544 bytes/0644, SHA256
  `1afde12dabbd7d6fc8d29d5438eaac2c153e0e0cdc7eb2f0c7235ffe8c9347f2`.
- Independent receipt: be863ac06e915403292b3722d170788099bc221d,
 159 bytes, SHA256
  `e3c3764394a6e19dce23abbbbe218d9b37f27779abb8e1b01862ea7e3880fc12`.
- Unchanged recipe SHA256
  `b19d04354088d31ac387c82606aaa0a7ce64cf26efd0ffbebcfc4f4e5969a03c`;
  interface SHA256
  `33e2c6ca9213f10645f2421e7390a2451d8e320d34cdfe3746366efffb1286b7`.
  All359 inputs/tools authenticated before/after;49 active-closure members are
  retained static-review evidence, not49 newly observed runtime loads.
- Exact sealed Node22.22.2 launch.mjs command ran once with strict unhandled
  rejections and256MiB old-space. Launcher shell exit1; raw launch stdout500 bytes,
  stderr0. No fabricated asynchronous launcher exit/close telemetry.

## Actual progress and blocker

**3/14 workers launched,2 probes qualified,11 workers unlaunched.** Target installed
and physically moved probes each returned natural0, authenticated211 `nextLoad`
events and211 asset reads, evaluated the consumer and performed only direct VFS
probe operations. Both report pending0/descriptors0/violations0/postGuardtrue.
These are not semantic workflow passes.

Comparator probe3 returned exit/close1 with actual **OFFLINE_DENIED:fs.lstatSync**
on `views/baseline-installed/benchmarks/consumer-v5/consumer.mjs`. Its raw stack is
offline.mjs:37 → projection.mjs:9 → bootstrap.mjs:24 → worker.mjs:55.
The exact source installs offline at worker.mjs:51, then calls authenticateBootstrap
at55; that helper calls boundFile, whose live fs.lstatSync has already been denied.
This is a concrete **harness ordering contradiction before comparator import**,
not a comparator/product failure or an outcome of the unavailable-builtin profile.
Comparator nextLoad/consumer-evaluation/bootstrap-window activation are0.

Suggested root-reviewed successor: complete the exact bounded bootstrap metadata
authentication in the trusted pre-import phase before installing the offline
guard, while retaining strict guarded import, hash/mode/parent checks and getter
ordering/revocation. Do not permit generic fs.lstatSync or widen native access.
No such change was made; a successor requires review and a fresh grant.

All12 C01–C12 admission families remain explicitly unrun. **C11 setups0/2 and
semantic calls0**. Body preserves ADMISSION_PROBE_STOP and its exact
fatalPhase label `receipt-persistence`; the child raw record preserves the deeper
OFFLINE_DENIED. Launcher qualificationfalse/unsafetrue; no pass footer.

## Authority, capture, cleanup and projection

There are **8 actual Git authority children**: review/grant for coordinator and
each of3 workers. Ordered observations match immutable references,159/951 byte
hashes,status0,empty stderr and recorded reaping. Not synthetic authority or
cryptographic caller authentication. Together with coordinator+3 workers,
**12 recorded processes are reaped and their exact PID/groups absent** in the
postcapture check. This excludes launcher, tool-host and preparation Git processes.
No supervisor signal/failure, late rejection, cleanup error or publication failure
is recorded. Comparator final report is null: its numeric pending/descriptors
snapshot was **not retained**; do not invent zero counters from process closure.

Coordinator retained all915 stdout/0 stderr/1391 FD3 bytes. Worker FD3 captures
139578/139498/3444 bytes are complete; worker stdout/stderr all0. No truncation
or new raw-byte loss. Logical large receipts are multipart, each physical record
at most262144; RESULT.json80143 bytes. Body raw records2706205 bytes and outer
records6684 bytes are below the unchanged248MiB/8MiB bounds. No full-pressure or
RSS qualification follows.

Staging authenticated the entire858-member6608 target pack plus2 consumer files
per layout, and3843 comparator inputs plus2 consumer files. Postcapture exact
censuses are860/860/3845 files; move-origin absent. Original comparator before/after
census is3843 regular inputs+1 instruction-metadata-only omission. No instruction
plaintext was materialized or read. Exact accepted pack reuse, **not a rebuild or
full-history proof**; no duplicate stage archive created. Stage bytes143592389
remain locally intact and manifest-bound.

## Evidence and preserved history

`REPORT.json`30969 bytes, SHA256
`f1eca1cc6afea3cf2783d195718bcba42962a2f3eb7c75bbd10f848187903f0f`.
It binds all raw references, authority observations, process dispositions,
projection counts, captures and postguards. Four `raw-*.gzpart` files preserve
34 raw files/2720815 bytes in990191 compressed bytes; every byte/hash/mode was
round-trip verified without materialization. Gzip SHA256
`337d1f05a9f678c2ee0cb1a94c1ff082ccc845d997b36b34e8a08ab5659e14b1`.

Old30+1,7/8,31/33,F08 EPERM, consumed grants, V6 oversized artifacts and
**294045 irrecoverable bytes** are unchanged. W07 remains UNQUALIFIED/UNCREDITED;
historical13/54 versus47/54 unchanged.99 semantic cohort still requires separate
fresh root GO after admission qualification. No full-gate/native/SafeJS claim.
