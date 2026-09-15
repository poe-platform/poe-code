# Pyodide teardown acceptance at 17f9b3582

Decision: **BLOCKED / UNFINISHED; do not publish the feature**.
Reviewed September 14, 2026 at source HEAD
`17f9b3582a7a8aea9fb426b9e45071e59f6240a1`, Node v22.22.2.
This report and `pyodide-cloudflare-teardown-17f9b358-evidence.json` are the
only paths owned by this teardown. Existing modified/untracked files and staging
are preserved. No product, README, Worker, binding, route or validation target
was changed.

## Current checks and evidence

The [fresh evidence receipt](pyodide-cloudflare-teardown-17f9b358-evidence.json)
records source/lockfile/release-document SHA-256 values, missing prerequisites,
installed resolution, exact public output bytes, observed task states and remote
state. Receipt SHA-256:
`242326874a36840c854f5892c555182fe09b253ead7e6033c6ed80498bc92b35`.

Executed checks:

- `existsSync`: all four prescribed
  `packages/safe-bash/src/commands/python/{index,node,worker,execution}.ts`
  files, `src/sdk/bash.ts`, external
  `/Users/kjopek/Workspace/pyodide-cloudflare-validation/VALIDATION.md` and
  its guarded `scripts/cloudflare.mjs` are absent.
- Source search across safe-bash, safe-fs and SDK: no Pyodide executor,
  `PythonFileSystem` or `PythonStatTranslator`. Installed package-manifest
  resolution for `pyodide`, `workerd` and `wrangler`: `MODULE_NOT_FOUND`.
- `node --import tsx --input-type=module`, public-source imports of safe-bash
  and safe-fs: no Python/Pyodide exports. A Shell with MemoryFileSystem and
  agentCommands returns the exact results below; assertions exit 0 and disposal
  is awaited twice. This validates absence and ordinary shell recovery only.
- `TURBO_FORCE=true npm run dev -- pipeline validate
docs/plans/pyodide-cloudflare-safe-bash.md`: exit 0. Its native predev build
  reports 72 successful tasks, zero cached, 41.419 seconds; bundle stage succeeds.
  CLI reports `11 tasks (11 done)` and `Plan is valid`. This proves structural
  validity, not truthful acceptance states or Python availability. An earlier
  invocation also exited 0 but used 72 cached build tasks; that invocation is
  not uncached build evidence.
- `parsePlan` independently accepts the current document and reports all eleven
  implement/test maps done, with finalization pending.
- `git diff --check`: exit 0 before and after documentation creation.
- `npm exec --no -- prettier --check` for the two owned paths: initial formatting
  warnings were fixed only in those paths with Prettier; rerun exits 0.
- Receipt verification: all recorded input hashes still match after the uncached
  build; existing parent-plan bytes are unchanged. Parsing the parent from
  `git show HEAD:docs/plans/pyodide-cloudflare-safe-bash.md` confirms eleven open
  implement/test maps and pending finalization. Neither owned path is ignored.

| Public command            | Exit | stdout      | stderr                                        |
| ------------------------- | ---: | ----------- | --------------------------------------------- |
| `python -c "print(1)"`    |  127 | empty       | `shell: line 1: python: command not found\n`  |
| `python3 -c "print(1)"`   |  127 | empty       | `shell: line 1: python3: command not found\n` |
| `printf recovered \| cat` |    0 | `recovered` | empty                                         |

Independent read-only agent `acceptance_review` inspected the same HEAD and
confirmed all seven missing file prerequisites, absent runtime/services/SDK
integration and the status discrepancy. It found regex injection in the
playground, but no Python provider. It concluded that task one's required
achievable lifecycle contract cannot pass and implementation cannot legitimately
advance past it. No finished artifact exists for independent final acceptance.

## Acceptance matrix and lifecycle limits

Implemented adapter capabilities: none verified. Each row below has **open
implementation and test acceptance**, with zero production passes. The receipt
records both these accepted states and the unsupported observed states.

| Plan task                                        | Exact missing acceptance                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| establish-evidence-and-lifecycle-gate            | Original Node Python baseline, canonical Python filesystem service and authenticated prototype inputs; proven mandatory lifecycle contract                                                  |
| separate-python-runtime-transport                | Transport and injected executor candidate; preserved Node behavior, admission, ownership, sibling cancellation and exactly-once cleanup                                                     |
| reproducible-cloudflare-runtime-build            | Pinned, authenticated static WASM/native/signature manifest and assets; deterministic regeneration, scoped host protection and licenses                                                     |
| bridge-canonical-filesystem-with-jspi            | Canonical async service and JSPI bridge; delayed-backend parity, bounds, errno, quotas and zero leaked handles                                                                              |
| wire-execution-stdio-and-finalization            | Actual Python invocation, argv/cwd/env/module/stdin semantics, bounded backpressure/ordering, cancellation and retirement evidence                                                          |
| qualify-package-provisioning                     | Qualified package/native manifest; integrity, dependency failure, unsupported-native rejection and XLSX/DOCX/PDF artifact verification                                                      |
| expose-cloudflare-adapter                        | Public injected executor, SDK parity, ownership/conflict checks and existing-Worker embedding artifact                                                                                      |
| validate-integrated-adapter-on-disposable-worker | Local public workerd candidate and fixed-target provenance/guards; current deployed version/settings/limits, exact bundle inventory and responses                                           |
| qualify-persistence-and-production-load          | Identified actual application backend, consistency/emulator contract, independent-request persistence and numerical account/application resource reserve; isolation, soak and load evidence |
| expose-pyodide-in-browser-demo                   | Browser Python candidate; real browser execution, shared filesystem/artifacts, cancellation/reset, diagnostics, CSP/MIME and screenshots                                                    |
| review-compatibility-and-handoff                 | Finished same-artifact complete acceptance matrix, reproducible upgrade/rollback, diagnostics, licenses and independent final review                                                        |

JSPI suspension for awaited I/O does not establish independently terminable
CPU-bound Python. Fresh-session isolation, interpreter reuse, state leakage,
memory reclamation, bounded admission and resource retirement remain unqualified.
The mandatory guarantees cannot be reduced to make this plan pass. Task one
explicitly gates implementation on an achievable contract; adding an unqualified
runtime now would bypass that gate. The separate safe-python interpreter and
ordinary shell workerd export do not satisfy this plan's fixed Pyodide runtime.

The parent plan already had 22 working-tree edits changing open states to done
when this teardown started. They contradict its acceptance corrections and
current source. They are not certified or included in this commit. The user's
instruction to never revert changes made by others prevents rewriting those
existing edits here; their status discrepancy remains open. No new done state or
completed finalization is written. The committed parent states remain open.

## Package manifest, sizes and validation environments

Supported current adapter package manifest: absent. Qualified package set: empty.
Pyodide 314.0.6, CPython 3.14.2, ABI 2026_0, XlsxWriter 3.2.9, openpyxl 3.1.5,
python-docx 1.2.0, pypdf 6.0.0 and lxml 6.0.2 are historical prototype claims,
not currently supported adapter packages. Full documents profile, Pillow,
python-pptx and arbitrary native wheels remain unqualified.

Actual current adapter raw/compressed bundle sizes and asset inventories are
unavailable because no adapter artifact exists; this is not a zero-byte bundle.
Historical prototype `5,110.27 KiB gzip` and version
`3f71fdb5-5c5c-46f4-8a14-afec20c25cc7` are not current measurements or deployed
safe-bash qualification. Current CPU/memory limits and application reserve are
unidentified; WASM memory cannot substitute for total Worker memory.

- Local integrated workerd: blocked and unperformed; public Python runtime,
  assets and admitted fixture are missing.
- Deployed integrated validation: blocked and unperformed; authenticated external
  provenance and guarded tooling are missing. No Cloudflare API/CLI or credential
  inspection occurred; credential availability/expiry is unknown. No substitute
  account or Worker is selected.
- Production application integration: explicitly unperformed. Package release
  does not authorize changes to existing Workers, bindings, routes or the fixed
  account/target.

The [earlier scoped unit capture](cloudflare-adapter-request-validation-20260914.md)
reported 31,768 tests, 23 failures and 86 skipped. Those are historical failures,
not fresh passing evidence. Remote main now contains an esbuild fixture fix;
it has not been integrated or validated in this checkout. No failure is waived.
No code changed in this teardown. Final `npm run build`, maintained unit/lint
routes and real-runtime production matrix for a future candidate remain required
and open; plan validation's predev build is not a substitute. No visual product
change was made and no fresh screenshot acceptance is claimed.

## Git and release state

Read current `.github/workflows/release.yml` and
`docs/development/NPM_PUBLISHING.md`: main push invokes GitHub validation, restores
the same-run digest-verified build, then semantic-release publishes poe-code at
latest. No local publication or parallel release process is used.

`git ls-remote origin refs/heads/main` and subsequent `git fetch origin main`
agree on `eff793d5dfda1b4e6d1008b04f5da4033237f742`. Before this audit commit,
`git rev-list --left-right --count HEAD...origin/main` reports 13 local and 11
remote commits. Every outgoing commit's path list was inspected: existing local
commits contain documentation/evidence, not adapter implementation. Remote work
is retained; release is gated, so no merge/rebase, push or cloud mutation occurs.

The index was empty on entry. Stage only this report and its receipt with
explicit paths, verify the exact staged path set and receipt/parent hashes,
commit using Conventional Commits without hook bypass, then inspect the commit
path list. Existing untracked reports are not adopted or committed.

Local evidence commit is separate from feature delivery. Remote-main delivery:
not attempted. Matching release run: none triggered. Published feature version
and dist-tag: none verified. Clean consumer executor/export/asset smoke test:
blocked and unperformed. No successful release is claimed.

Resume requires the original Python baseline/service and authenticated external
validation inputs, a passing mandatory lifecycle feasibility gate, a verified
adapter candidate, the actual persistent-backend contract and sanitized current
fixed-target/application budget inputs. All production acceptance stays open
until the complete final artifact passes. The pipeline is unfinished.
