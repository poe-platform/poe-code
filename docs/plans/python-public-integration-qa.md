# Public Python integration qualification

See the [subsequent user review](python-public-followup-review.md) for the
traceback, script-path and read-only error fixes, expanded coverage and new gate
results. Counts below describe the earlier qualification run.

## Scope

Use the built `poe-code/safe-bash`, `poe-code/safe-fs/core`, and public Python
worker exports. The application scripts and artifacts use the canonical
filesystem bridge. No host Python process is a product fallback. Native Bash
and CPython are independent integration oracles only.

This is a manual QA plan. The maintained automated acceptance tests live in
`packages/safe-bash/tests/integration/pyodide-runtime`; they are explicitly
invoked `.test.mjs` files outside fast `.test.ts` unit discovery. Existing unit
membership, optional profiles and historical evidence must remain intact.

## Preparation outside tests

1. Run `npm run build` from the repository root and wait for the root bundles.
2. Install an independent CPython **3.14.2**. This run used
   `uvx --from uv@latest uv python install 3.14.2` because the installed older
   uv lacked that release in its download manifest. Set `SAFE_BASH_NATIVE_PYTHON` to its absolute
   executable path. The differential suite must fail on a version mismatch;
   a newer patch release is not a matched-version oracle.
3. Set `SAFE_BASH_PYTHON_CACHE` to a new absolute directory outside test inputs.
   Run `npm run provision:python:integration --workspace=virtual-bash`.
   This explicit setup installs the pinned Pyodide 314.0.6 npm runtime and
   provisions the configured document profile through the built public command.
   It is the only maintained route in this cohort that downloads runtime or
   package assets. It writes cache artifacts to the selected directory.
4. `SAFE_BASH_PYODIDE_RUNTIME_URL` optionally selects a preprovisioned trusted
   runtime module URL. The default is the pinned isolated npm installation.
   Supply its matching WASM, standard library and indexed native assets too;
   a loader file alone is not an offline deployment.

## Automated acceptance

Run `npm run test:python:integration --workspace=virtual-bash` with the same
environment. Preserve stdout, stderr and exit status in a unique capture folder.
The exact route includes command parity, documents, and lifecycle/composition
tests. Missing prerequisites, assertion failures, skips and unsupported cases
are not passes. Tests reuse the provisioned cache offline and keep cache changes
and application data in memory; the native differential oracle owns disposable
host scratch space only in the explicit integration run.

Node's test runner can return zero with explicit TODOs. A zero exit from this
route therefore means the maintained run finished without unexpected failures;
it is not full compliance. The named TODO assertions still execute against the
required behavior and retain their actual failure diagnostics. Count them
separately and remove a TODO only after its required workflow is verified.

Record native Python/Bash, Node, Pyodide and package versions; matched case
denominators; delayed-backend operation counts; both-direction file effects;
and every platform difference or unresolved workflow. Record live working-tree
status and hashes of the executed inputs. Do not promote this finite cohort to
full CPython, filesystem-provider or document compatibility.

## Artifact and CLI inspection

Follow [document QA](python-public-documents-qa.md) to export representative
artifacts, reopen them with independent readers and render them. Inspect page
images at a readable scale and preserve screenshots. External rendering proves
that the generated artifact can be rendered by that host tool, not that the
renderer runs inside Pyodide. Formula storage is distinct from formula
calculation; DOCX writing is distinct from Word-to-PDF conversion.

Use `npm run screenshot-poe-code -- bash --help` and the same command with the
explicit runtime, trusted-code acknowledgement and a small Python pipeline.
Inspect visible setup progress, stdout, stderr and an intentional unsupported
interactive-mode diagnostic. Runtime flags are existing behavior; this change
introduces integration routes, not a new product CLI interface.

## Repository gates

Run `npm run build`, `npm test` and `npm run lint` without changing task
membership or synthesizing optional prerequisite revisions. Preserve failures
and stopped stages. A selected passing suite does not repair or establish an
unexecuted whole-workspace gate. Local edits, commits, verified remote-main
delivery and published releases must be reported separately.

## Results

The 2026-09-13 run uses the live working tree on macOS, Node 22.23.2,
Pyodide 314.0.6 and matched native/guest CPython 3.14.2. Native Bash is Apple's
GNU Bash 3.2.57. This is neither a frozen commit qualification nor GNU/Linux
evidence. Runtime/package provisioning completed through the new maintained
route; acceptance uses its offline cache.

The strict comparison initially exposed four leaf failures: both aliases omit
the source line in an uncaught inline-code traceback, and both normalize the
`/./script` spelling of shebang `__file__`. The exact assertions remain active
as named TODOs. See [parity evidence](python-public-parity-evidence.md), including
the original failure capture. Of 42 alias cases, 38 match and four remain
incomplete; the separate invocation-isolation/canonical-edit workflow passes.

The memory and delayed document profiles both pass. See
[document evidence](python-public-documents-qa.md) for the assertions, independent
readers, six inspected screenshots and retained print-layout correction.

Lifecycle checks verify initialization failure, bad wheel and unavailable
package installation, offline reuse and integrity refusal, cancellation during
both execution and package installation, output exhaustion, descriptor cleanup
and successful subsequent invocations. Memory and delayed mount/read-only
compositions preserve both-direction file effects. The required quota-backed
workflow remains TODO: canonical `withFileSystemQuota` rejects descriptor opens
with `ENOTSUP`, including reads. The test does not unwrap the quota or claim
enforcement from an underlying memory filesystem.

Intentional measured platform differences include guest `sys.platform` of
`emscripten`, 32-bit pointers and an empty `sys.executable`, compared with native
`darwin`, 64-bit pointers and a host executable pathname. Native comparison
sets `PYTHONDONTWRITEBYTECODE=1` explicitly; this does not establish native
bytecode-cache or startup/site configuration parity. The traceback and shebang
differences are unresolved compatibility gaps, not byte normalization in tests.

Additional unqualified workflows remain incomplete: interactive terminal/REPL
behavior; general native subprocess/extensions; arbitrary remote canonical
providers; general filesystem syscall parity; formula calculation inside
Pyodide; Word-to-PDF conversion inside Pyodide; browser deployment of this
public-command cohort; and arbitrary document fidelity. Existing experimental
browser captures do not establish these public-export workflows.

The maintained aggregate route finished in 136.7 seconds: **54 test entries,
49 passed, five TODOs, zero unexpected failures, zero skips**. Counts include
parent test groups and must not be described as 54 passing workflows.

The built root `runBash` SDK also reconstructed the profile offline and verified
all eleven actual distribution versions against the configured pins;
`package-versions.json` preserves the observations. Public consumer/source hashes
are in `executed-input-hashes.json`; runtime, cache and font input hashes are in
`runtime-input-hashes.json`, under `output/python-public-integration-20260913/`.

The maintained build and 500/500 safe-bash runner self-tests passed. Repository
`npm run lint` passed, including type and workflow checks. A subsequent final
guarded `npm run lint:eslint` passed against the completed integration files:
zero errors, twelve warnings in cached presentation examples.

Built CLI captures `cli-built-pipeline.png` and
`cli-built-interactive-gap.png` were inspected. The pipeline printed 42 with
status 0 and one initialization message per worker; interactive `-i` was refused
with status 2. The maintained `npm run screenshot -- ... node dist/bin.cjs`
route captured the built CLI while the broad tests continued.

The full `npm test` exited **1**. Its shared Vitest stage reported 30,298 passes
and two skips; the Python spawn workspace passed 29 tests; the safe-bash runner
passed 500/500. The subsequent Bash stage completed all 1,121 discovered files
and reported **38,874 test entries: 38,050 passed, one failed, 823 skipped** in
833.4 seconds. Skips are not passes. Later workspace stages and root posttest
were not established by this stopped run.

The single failure is `S3 HTTP root/subpath exports work from a clean packed
revision without source fallback`. A separate invocation of its maintained
verifier reproduced `Peer binding requires the selected committed package
metadata` with zero verification steps. Default `HEAD` is
`1b7ec7e2df185fbc449033733711ebdaa8d63f2c`; its package metadata differs from the
working tree. Qualification requires an actual matching committed candidate
and peer artifacts. The gate and required membership remain intact; no
synthetic revision was supplied. `s3-export-blocker.json` and `unit.log` retain
the evidence under `output/python-public-integration-20260913/`.

`npm run screenshot-poe-code -- --output
output/python-public-integration-20260913/cli-source-help.png bash --help`
completed successfully. Its screenshot was inspected: runtime, trust, package
profile/cache/offline and limits options are visible and readable. After its
predev rebuild, all 33 captured source/public-export hashes remained unchanged
(`post-cli-input-check.json`). The earlier runtime evidence therefore still
matches the final built public exports.

All local evidence is under `output/python-public-integration-20260913/`.
This verification implementation is complete for its recorded cohort; the
five TODO cases, additional unqualified workflows and full-workspace gate remain
incomplete. None is included in the passing count.
No commit, remote-main delivery or release has been performed for this change.
