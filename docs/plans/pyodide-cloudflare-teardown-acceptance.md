# Pyodide teardown acceptance

September 14, 2026. Inspected HEAD `39dfd65663ce42c8fe2e010de689e1cb64e51b5d`.
Decision: BLOCKED / UNFINISHED. All eleven tasks' implementation and test
acceptance remains open, and finalization remains pending. This report and the
acceptance correction in `pyodide-cloudflare-safe-bash.md` are root-owned paths.
Other modified/untracked documentation and evidence are preserved.

## Current checks and capability evidence

- Filesystem existence checks: Python command `index.ts`, root `src/sdk/bash.ts`,
  external `pyodide-cloudflare-validation/VALIDATION.md` and guarded
  `scripts/cloudflare.mjs` are all absent at their specified locations.
- `rg` inspection of safe-bash, safe-fs, SDK and playground source finds no
  injected Pyodide executor or PythonFileSystem service. The restricted SafeJS
  Python implementation is a separate product and does not satisfy this plan.
- Node v22.22.2: `node --import tsx --input-type=module` imports source public
  safe-bash and safe-fs APIs, constructs an empty-environment memory shell via
  `.use(agentCommands())`, and calls `.exec()`. Python inline returns 127;
  `printf recovered | cat` returns 0 with exact stdout `recovered`.
  No exported name contains Python/Pyodide. Repeated awaited disposal completes.
  An initial probe used nonexistent `.execute()` and failed with TypeError;
  the corrected inspected `.exec()` probe passes. This is availability evidence,
  not Python execution, isolation, descriptor or persistence acceptance.
- Module resolution for `pyodide`, `workerd` and `wrangler` returns
  `ERR_MODULE_NOT_FOUND`. Local integrated workerd validation is blocked.
- Independent read-only reviewer `acceptance_review` inspected the same HEAD
  and confirmed missing implementation/export/service/provenance and unsupported
  done states. Package integration-input membership tooling exists; it does not
  supply an adapter or passing runtime test. This absence review cannot pass
  independent review of a finished production artifact.

Implemented adapter capabilities: none verified. Pending capabilities include
transport separation/Node compatibility, injection/ownership, canonical JSPI
filesystem, streams/finalization, cancellation, isolation/admission, integrity,
package provisioning, public SDK, browser execution and production qualification.
The complete requirement matrix remains in `cloudflare-adapter-final-review.md`;
every production row remains blocked. No missing or skipped check counts as pass.

Supported adapter package manifest: absent; qualified package set: empty.
Prototype Pyodide 314.0.6/CPython 3.14.2/ABI 2026_0 and XlsxWriter 3.2.9,
openpyxl 3.1.5, python-docx 1.2.0, pypdf 6.0.0/lxml 6.0.2 claims remain
unverified historical context. No document profile or arbitrary native wheels
are qualified. Current adapter bundle/assets do not exist, so actual raw/gzip
sizes and build hashes are unavailable. Historical 5,110.27 KiB gzip is not a
current measured bundle or application headroom result.

## Blocking acceptance requirements

The first lifecycle gate cannot pass without the original Python transport/API
and filesystem service, authenticated fixture and runtime artifacts. Same-isolate
JSPI suspension does not establish independently enforceable CPU termination;
aborting awaited I/O does not retire CPU-bound Python. Interpreter reuse,
fresh-session isolation, memory reclamation and supported resource limits remain
unqualified. Implementation is gated on an achievable proven mandatory contract;
inventing a replacement or weakening it is not authorized by the plan.

The actual application's persistent backend, maintained emulator route and
consistency contract are unidentified. Account limits and application bundle,
memory/CPU reserve and responsiveness route are unavailable. Fixed-target
provenance/guards are absent; no credential availability/expiry conclusion is
possible. These inputs are required to resume qualification, without creating
storage resources or modifying application Workers/bindings/routes.

Local workerd: blocked, unperformed. Deployed integrated validation: blocked,
unperformed. Existing application production integration: unperformed and no
application mutation authorized. Browser Python acceptance: blocked; prior
screenshots document command absence rather than successful execution.

## Checks and delivery boundary

Current documentation checks: maintained source `parsePlan` accepts the corrected
plan with eleven open tasks and pending finalization; `git diff --check` passes.
No product code or visual behavior changed. Historical maintained unit/build/type
results remain in `cloudflare-integrated-adapter-qa.md` and its evidence manifest:
selected build/public types passed; unit route failed with 23 failures and 86
skipped out of 31,768 tests. Those failures remain unresolved and are not a final
passing production gate. Adapter checks cannot run without the gated candidate;
no unaffected broad suite is represented as rerun or passed here.

Read `.github/workflows/release.yml` and `docs/development/NPM_PUBLISHING.md`:
main push invokes GitHub validation then semantic-release publication. No local
publish or alternate workflow is used. `git fetch origin main` succeeded;
remote main is `775253e664c8c14502178cf9dcb74e6a656aacb0`.
Before this correction, local/remote divergence is five local and two remote
commits. Existing outgoing commits are `3dbc84e65`, `edc6ab3cb`, `becb83f24`,
`bb2725732`, `39dfd6566`; they are not claimed delivered. Integration is deferred
while mandatory acceptance remains blocked; no conflicting work is discarded.

Only the two root-owned correction/report paths are staged for this atomic
Conventional Commit, with normal hooks and no co-author trailer. Other edits
and staging remain preserved. Local commit hash is reported after creation.
Remote-main delivery: not attempted. Matching release run: none triggered.
Published feature version/dist-tag: none verified. Clean consumer executor/assets
and browser release smoke: blocked, not executed. A documentation commit does
not complete implementation or authorize publication.
