# Current Pyodide teardown gate

September 14, 2026. Candidate HEAD:
`bde51059c0d9a924c2c1a96644c42dd3873f8f6c`. Decision: blocked / unfinished.
Root owns this report and the current acceptance update in
[the parent plan](pyodide-cloudflare-safe-bash.md). Existing untracked evidence
and unrelated edits are preserved, not adopted into this commit.

## Executed checks and evidence

Current source inspection and `existsSync` checks confirm the specified
`packages/safe-bash/src/commands/python/{index,node,worker,execution}.ts` baseline
and `src/sdk/bash.ts` are absent. Searches of package/SDK exports find no injected
Pyodide executor. The separate safe-python interpreter is not this adapter.
The external `pyodide-cloudflare-validation/VALIDATION.md` and guarded
`scripts/cloudflare.mjs` are absent. No protected credential or cloud API was read.
`createRequire().resolve()` returns `MODULE_NOT_FOUND` for pyodide, workerd and
wrangler. Independent read-only reviewer `acceptance_review` confirms these gates
against the same HEAD, including the missing PythonFileSystem service.

Fresh `node --import tsx --input-type=module` public-source probe on Node v22.22.2:
import safe-bash `index.ts` and safe-fs `MemoryFileSystem`; construct
`new Shell({fs: new MemoryFileSystem()}).use(agentCommands())`; invoke `.exec()`;
await `.dispose()` twice in finally. No exported name contains Python/Pyodide.

| Command | Exit | Exact stdout | Exact stderr |
| --- | ---: | --- | --- |
| `python -c "print(1)"` | 127 | empty | `shell: line 1: python: command not found\n` |
| `python3 -c "print(1)"` | 127 | empty | `shell: line 1: python3: command not found\n` |
| `printf recovered \| cat` | 0 | `recovered` | empty |

This proves command absence and ordinary shell recovery, not Python execution,
interpreter ownership, isolation, streaming or descriptor cleanup acceptance.

| Inspected source | SHA-256 |
| --- | --- |
| packages/safe-bash/src/index.ts | 66f24e28ac4f72ffc334f5cc76ca08873753f9bc8e4e51350ecc8cb3df9391eb |
| packages/safe-bash/package.json | dd8f09afcac7fb2aa74e82b6a98f1fa3a97eea57e66c8100e64416c84ad2b40e |
| packages/safe-bash-playground/src/session.ts | 2b93d12613ed8c31fcec194a3114f2a87af2dc578b8b6dc09b0106ea440546d9 |

These are source hashes, not generated runtime/bundle hashes.

## Capability and production acceptance matrix

Implemented adapter capabilities: none verified. Every task's implementation
and test acceptance stays open; finalization stays pending.

| Required acceptance | Current evidence / exact blocker |
| --- | --- |
| Lifecycle feasibility and compatibility | Original Node Python baseline, filesystem service and authenticated prototype fixture missing; achievable mandatory contract not proven |
| Transport separation and injection/ownership | No Python transport or injectable Pyodide executor candidate |
| Pinned static WASM build, integrity and host protection | No runtime build, static module/signature manifest or verified assets |
| Canonical JSPI filesystem parity | No bridge/service candidate or delayed-backend real-runtime evidence |
| Invocation, streams, cancellation, finalization | Python unavailable; no real-runtime evidence for supported invocation forms or cleanup |
| Package provisioning | No supported native manifest or qualified package inventory |
| Public package and SDK integration | Executor exports and specified SDK entry point absent |
| Local integrated workerd | Not executed: runtime/tooling/assets absent |
| Fixed-target deployed integrated validation | Not executed: external provenance and guarded tooling absent; credentials/expiry unknown |
| Persistence and production load | Actual application backend, consistency contract, maintained emulator and numeric account/application resource reserve unidentified |
| Browser Python | No injected browser Pyodide candidate; historical screenshots show absence, not successful execution |
| Finished-artifact compatibility review/handoff | Independent absence review confirms blockers; no finished artifact exists to accept |

Production application integration is unperformed. No existing Worker, binding,
route or fixed validation account/target was changed. Qualification must not create
a substitute service or weaken the production contract to obtain a pass.

Same-isolate suspension does not provide independently terminable CPU-bound
Python. Aborting awaited I/O is distinct from interrupting execution; interpreter
reuse, fresh-session isolation, memory reclamation, quotas and capacity retirement
remain unqualified. No hard termination or hostile-code isolation is advertised.

Supported adapter package manifest: absent. Qualified package set: empty.
Pyodide 314.0.6, CPython 3.14.2, ABI 2026_0, XlsxWriter 3.2.9, openpyxl 3.1.5,
python-docx 1.2.0, pypdf 6.0.0 and lxml 6.0.2 are historical prototype claims,
not supported current adapter packages. No full documents profile, Pillow,
python-pptx or arbitrary native wheels are qualified. Actual adapter raw/gzip
bundle sizes, archive inventories and deployed resource headroom are unavailable
because those artifacts do not exist. This is not a zero-byte bundle. Historical
5,110.27 KiB gzip is not a current measurement.

## Validation and delivery boundary

The maintained YAML-aware `writeTaskStatus` updates only acceptance states and
preserves plan content. Source `parsePlan` accepts eleven open task status maps
and pending finalization. `node --test
packages/safe-bash/scripts/integration-inputs.test.mjs` exits 0: 107 tests passed,
zero failed/cancelled/skipped/todo; duration 64,678.32725 ms. This validates
maintained input admission, not the absent adapter. `git diff --check` passes.
No product code or visual behavior was changed.

`npm run dev -- pipeline validate docs/plans/pyodide-cloudflare-safe-bash.md`
exits 0 and reports `11 tasks (0 done)` and `Plan is valid`. Its native predev
workspace build and bundle stage also succeeded with zero cached tasks. This is
plan validation with its normal lifecycle, not a substitute for the required
final `npm run build`, unit or production acceptance routes for a future adapter.

Previously captured focused build/public types passed, but the scoped unit route
failed: 31,768 tests, 23 failures, 86 skipped. See
[the existing request validation evidence](cloudflare-adapter-request-validation-20260914.md).
These failures are unresolved, not waived or represented as current passes.
No final production build/unit/acceptance suite can be claimed passing. Required
real-runtime, delayed filesystem, native packages, persistence, isolation, load,
resource and deployed checks remain blocked by the admission gates above.

Read current `.github/workflows/release.yml` and
`docs/development/NPM_PUBLISHING.md`: main push triggers GitHub validation and
semantic-release of poe-code@latest. No local or alternate publication is used.
Fresh `git ls-remote origin refs/heads/main` reports
`775253e664c8c14502178cf9dcb74e6a656aacb0`; the existing local tracking ref agrees.
Before this audit commit, divergence is nine local and two remote commits.
Outgoing commit paths were inspected; they are existing documentation/evidence
commits, not adapter implementation. No integration/rebase is attempted while
release is gated, and no remote work is discarded.

Only the parent plan and this report are owned for this atomic documentation
commit. The initial index was empty. Explicit staging, index-path review, ordinary
hooks and post-commit path review are required. Existing untracked documents are
left untouched and unstaged. A local evidence commit does not finish the feature.

Remote-main delivery: not attempted. Matching release run: none triggered.
Published feature version/dist-tag: none verified. Clean consumer executor/export
and shipped-asset smoke: blocked, not executed. Release remains prohibited until
every required production acceptance item passes.

Resume inputs: the original Python baseline and authenticated external fixture,
then a proven lifecycle contract and verified adapter candidate; an explicitly
identified application persistent backend with consistency/emulator contract;
sanitized fixed-target provenance, current account limits, application reserve and
ordinary request route. These blockers remain open without changing cloud resources.
