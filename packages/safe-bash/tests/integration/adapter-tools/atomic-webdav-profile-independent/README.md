# Independent configured WebDAV profile verification

This subtree belongs only to the new independent verifier. It does not modify
production, contracts, exports, manifests, the original matrix/fixtures/MockDav,
the author's subtree or prior evidence. It is not a canonical migration.

Read `REPORT.md` for the measured decision and `ATTEMPTS.md` for the preserved
verifier mistake. The passing cohort is `evidence/independent-second/`.

Replay using existing local development tools, with no installs/downloads:

```sh
node tests/integration/adapter-tools/atomic-webdav-profile-independent/verify.mjs new-cohort-name
```

The runner exclusively creates a new cohort and owned `.isolated-*` directory,
freezes runtime/fixtures at `68059389bf95e03caeae6479837187add3d07814`, and checks
their equality with author checkpoint `222e9e127b5e86fa3e9af85d3bad0ee9fa54395c`.
It never runs the author's runner in the author's directory. New verifier inputs
are preserved per attempt; Git commits seal their final source.

The runner builds inside isolation, executes original stock inputs, packs the
build offline, strictly compiles a differently named external consumer, replays
stock/configured matrices and author controls, and executes independent hidden
controls plus bounded emitted-test-helper/config mutations. `observe.mjs` records
actual resolved parent edges and file hashes. Build/pack and type manifests
supplement, but are not misrepresented as, dynamic worker load observations.

Raw failed cohorts and mutants are retained, never overwritten. Temporary build,
native real-adapter scratch, package extraction, npm cache and temporary HOME
are all below the owned isolation and removed in `finally`. Archive contents are
evidence data; `hidden.ts` is a canonical verifier source, not a renamed native
capture or excluded test. No new runtime or development dependencies are added.
