# Initial public-runner integration: genuine export blocker

Captured August27,2026 against actual worktree at HEAD 98de827f9f8986f572532d750d3eb9d5ce1c0a86.
The author consumer and builder originate at ac58c9cf3dfcccf8477d97d1029bc6a17d7a72dd.
The new runner copies them unchanged and executes the author build in a fresh /tmp
archive with the real source, package manifest and export map. No private module
fallback or manifest patch is used. Shared dist and author files are untouched.

Command: node tests/fs/s3/http/interop/public-run.mjs --build-only

- Real package compilation: exit0.
- Strict public-consumer compilation: exit1, TS2724 createS3HttpTransport and
  TS2305 S3HttpCredentials missing from virtual-bash/fs/s3.
- Public import and actual-service workflow: NOT RUN. Zero workflows passed.
- No MinIO download, service process, bucket or data was created.
- Current source and isolated snapshots remain unchanged during the run.

Root/Curie owns the actual S3 barrel integration. The runner is ready for
node tests/fs/s3/http/interop/public-run.mjs --download after those exports exist.
It builds first, downloads the official checksum-pinned MinIO only after success,
provisions a fresh bucket using the existing independent reference signer, invokes
the COMPILED runPublicS3Example with a unique owned prefix, then checks six final
objects through independently signed wire GETs. The author function contains nine
named checks within ONE workflow, not nine independent tests. It expects honest
ENOTSUP move refusal with preserved bytes, not a successful guarded move.

Raw build diagnostics, exact manifests/source hashes and build outputs' hashes
are losslessly bundled in raw.json. source-snapshot.json records all source hashes,
exact bytes for inputs different from recorded HEAD, and selected full API/fixture
inputs. This is explicitly a current-worktree snapshot, including concurrent
unowned changes recorded in provenance; it is not a pristine committed-source gate.

Historical native13/17 and direct-module15/18,17/18,18/18 and fallback14/14 remain
unchanged and are not relabeled public acceptance. No product source, dependencies,
manifest, exports, author fixture or existing assertion is changed by this leaf.
