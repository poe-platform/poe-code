# Author current-candidate results — August 27, 2026

**Scoped runtime checks pass; the unchanged maintained global typecheck does not.**
This is author evidence, not Curie's different acceptance, a production release,
full gate, superiority, native parity or deployed-service acceptance.

Candidate: `eba049535d154f4e028f57ffd8efd7622b2239ca`.
Tree: `62d75ef09e89d4d3b6afc032c518d2846dcd03b7`.
All 247 source entries: SHA-256
`d61b88557d04647f487af0d4483124d28159dbc98c26ccc8b868de5777978a95`.

| Author check | Result |
| --- | --- |
| Immutable committed-source build | Pass; one source build, no live fallback |
| Strict moved-package TypeScript consumer | Pass |
| Prepared public runtime cases | 9/9 pass, one attempt each |
| Scoped committed curl+cat mock cases | 4/4 pass; exact selected test bodies |
| Declared package export inventory | 21 keys, 28 expanded public specifiers pass |
| Actual current SafeJS surface | 8/8 pass |
| Actual current SafeJS lifecycle | 11/11 pass |
| Actual current SafeJS zero controls | 6/6 pass |
| Unchanged maintained global typecheck | **Nonpass: 13 diagnostics in foreign tests** |

The 25 SafeJS profiles are unique; repeats of the same imported modules or private
snapshots are not additional cases. Surface 07 is dialect-only; 08 verifies actual
awaited rejection, not a fabricated fulfilled result. L05 uses the unchanged
approved `owned-guest\n)` selected actual rejection. The eight network rows each
have exactly one authorization and one mock transport call, no retry/redirect/
replay, upload before EOF, and the required effect/status/cleanup assertions.

All three actual cohorts took fresh private before/after snapshots. Captured Git
state, index, six metadata files and 264 eligible engine files plus metadata match
exactly. Each child authenticated 63 private source imports and 184 current public
compiled imports. No private code bytes are committed. This is actual copied
source-hook injection, not an installed-private-package claim. No plan contents
were read. Ignored build/cache trees, plan contents and private empty directories
are not certified by the approved eligible-file snapshot.

All 25 children exited naturally; known live children are zero. Lifecycle/control
guards report zero timers, bridge-pending work or failures, with disposal settled.
Surface records one PipeWrap/Socket at result, followed by natural child exit.
These observations do not establish hard preemption of arbitrary opaque handles.

The maintained target ran unchanged against all committed inputs with an isolated
candidate index. Its 22 maintained consumer groups and source consumers passed;
the whole target still failed. The 13 diagnostics are in the regex continuation
test and committed DU consumer/evidence tests, with no `src/` diagnostics.
`FOREIGN-TYPECHECK.txt` retains exact messages and paths; `REPORT.json` records
the stdout hash. No source, test, exclusion, assertion or foreign file was fixed
or waived. No unverified baseline-origin claim is made for those errors.

The mixed public helper's registration-set binding is explicitly disclosed in
`../mixed-public-v1/PROVENANCE.json`; it is not unchanged all-input evidence.
The initial static archive-path preflight failure and its literal POSIX-data
binding correction are preserved in `../execution-v1/PREFLIGHT-ATTEMPTS.md`.
That first static transcript was not captured as a standalone raw stdout file;
no reconstructed file is falsely presented as byte-original raw output.
All actual runtime attempts and the global typecheck raw outputs are retained.
No runtime retry, rescue, source patch, private write, dependency installation,
root `dist` write, native service or broad runtime gate occurred.

`RAW-INVENTORY.json` authenticates 258 raw artifacts in nine lossless bundles.
Each `.json.gz.b64.data` is base64-wrapped gzip of a JSON object containing exact
per-file base64 bytes. Public tarball bytes are included; private engine copies
are not. `HASHES.json` records exact source/test/tool/dist/consumer before/after
inventory hashes, including new entries. Verify without product or private access:

```sh
node tests/integration/owned-output-production-rebase/author-public/results-v1/verify-bundles.mjs
```

**Still unresolved:** the original five custom first-read requirements remain a
separate unexecuted/unmigrated/unwaived custom profile; the 13 global typecheck
diagnostics remain; different final verification remains Curie-owned. Historical
raw cohorts and accepted zero-overlay evidence are not rescored as this candidate.
