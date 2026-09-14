---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
name: Pyodide in an existing Cloudflare JavaScript Worker
readiness: draft
setup:
  prompt: |
    Read root and scoped AGENTS.md and docs/plans/pyodide-cloudflare-safe-bash.md.
    Execute tasks in listed order. This pipeline adds an explicit safe-bash Python
    adapter embedded in an existing JavaScript/TypeScript Cloudflare Worker. No
    separate Python Worker, service binding, container or Node-thread fallback.
    Production readiness is the completion bar, not an experimental adapter.
    Follow the existing injected regex-provider architecture: callers supply the
    Pyodide executor; portable command logic owns command policy. Pyodide is the
    fixed Python runtime. Node and Cloudflare are hosts, not interchangeable Python
    runtimes. Do not introduce a generic runtime object or runtime-selection framework.
    The current request creates this plan only; implementation starts separately.

    Record branch, working tree and index, preserve unrelated work, and assign
    owned paths. Follow scoped delegation requirements for substantive package
    implementation, with root coordinating integration and Git. Use failing tests
    before code, maintained package checks and explicit opt-in real-runtime tests.
    Keep logic in packages, root SDK wiring only. Do not change README files.
    Keep plans and manual QA procedures under docs/plans. Never copy credentials.

    Push and release only in the final teardown after production acceptance passes.
    Task-local no-push/no-release instructions defer delivery to that teardown;
    they do not prohibit its authorized release. After verified atomic improvements, commit only
    explicitly owned paths with Conventional Commits and relevant plan updates;
    preserve unrelated staging, never bypass hooks, and do not create empty commits.
    Selected steps omit inherited commit/release steps. This setup and the teardown
    replace automatic blanket Git behavior.
teardown:
  prompt: |
    Report implemented and pending adapter capabilities, exact checks and evidence,
    lifecycle limitations, supported package manifest and actual bundle sizes.
    Distinguish local workerd, deployed validation and production integration.
    Update task states only when their acceptance criteria pass. Preserve existing
    Workers and all unrelated files.

    Finish remaining implementation, review fixes, documentation and required
    validation items within this plan's scope before release. Do not merely commit
    unfinished work and call the pipeline complete. If a required item is blocked,
    record the exact blocker, leave its status open and do not publish the feature.
    Run the maintained checks required for the final change and production
    acceptance matrix; fix failures and rerun affected checks. Validate this plan.
    Verify atomic commits contain owned paths only. Commit all remaining verified
    task-owned changes and relevant plan updates using Conventional Commits and
    explicit paths. Preserve unrelated edits and staging; no blanket staging,
    ignored files, empty commits, co-author trailers or hook bypass.

    After every required production acceptance item passes, deliver on main using
    the repository's maintained release process. Inspect current remote state and
    outgoing commits, resolve conflicts without discarding others' work, and rerun
    affected validation after integration changes. Push main without force or hook
    bypass. Verify the intended commits are present on remote main. Read the current
    release workflow and NPM_PUBLISHING.md; pushing main triggers the GitHub release
    of poe-code@latest. Do not publish locally or invent a parallel release process.
    Watch the matching GitHub release run through successful publication, investigate
    and fix failures within scope, and verify the published version/dist-tag and
    shipped executor exports/assets with a clean consumer smoke test. A successful
    push alone is not a successful release. Report commit hashes, remote-main
    verification, release run, published version and smoke-test results separately.
    If delivery/publication is blocked, report its exact state rather than claiming
    completion. Package release does not authorize changing existing Cloudflare
    application Workers, bindings, routes or the fixed validation account/target.
tasks:
  - id: establish-evidence-and-lifecycle-gate
    title: Establish the compatibility contract and lifecycle feasibility gate
    prompt: |
      Plan and qualify an optional safe-bash Python adapter embedded in the caller's
      existing Cloudflare JavaScript Worker. Read root/scoped AGENTS.md, current
      packages/safe-bash/src/commands/python/{index,worker,node,execution}.ts and
      the PythonFileSystem service in packages/safe-fs. Preserve Node behavior.
      Read /Users/kjopek/Workspace/pyodide-cloudflare-validation/VALIDATION.md and
      its referenced final evidence and source hashes; preserve that fixture.
      Record a sanitized, portable evidence summary and capability matrix under
      docs/plans, including source revisions and artifact hashes. Do not copy .env,
      credentials or the entire generated vendor tree. The prototype invokes
      Pyodide directly: seven passing checks are not integrated safe-bash acceptance.

      Define invocation ownership, runtime lifetime, admission policy, filesystem
      authority, package persistence, stdout/stderr ordering and failure semantics.
      Explicitly separate aborting awaited I/O from interrupting CPU-bound Python:
      an in-process interpreter has no independently terminable Node worker thread.
      Use bounded, externally supervised local workerd experiments for CPU loops,
      abort during I/O, initialization failure and interpreter reuse. Never expose
      an arbitrary-code HTTP endpoint or run unbounded loops in the deployed Worker.
      Determine whether fresh interpreters or validated reuse satisfy isolation and
      memory limits; do not call reset/reuse safe without adversarial state tests.
      Admission must not introduce queue deadlocks in shell pipelines.

      Gate implementation on an explicit achievable contract. If mandatory safe-bash
      cancellation, isolation or resource guarantees cannot hold in the same isolate,
      record the blocker and keep the adapter unavailable under those requirements.
      Do not silently weaken existing guarantees or substitute another service.
      Define the production workload and trusted-code requirements explicitly.
      Production-ready means all mandatory guarantees for that declared workload
      have passing evidence. A feasibility-only or experimental result does not
      satisfy this pipeline. A same-isolate limitation is a blocker to any required
      stronger guarantee, not permission to downgrade the goal.
      No remote mutation, README changes, push or release in this task.
    status:
      implement: open
      test: open

  - id: separate-python-runtime-transport
    title: Separate command orchestration from the Node transport
    prompt: |
      In safe-bash, add the smallest explicit execution-adapter contract needed for
      an in-process Cloudflare Python runtime while preserving existing Node public
      configuration and behavior. Read root/scoped AGENTS.md and the lifecycle gate
      in docs/plans/pyodide-cloudflare-safe-bash.md and its recorded evidence before
      code; unresolved mandatory lifecycle requirements block shipping the adapter.
      Follow the actual regex injection precedent: AgentCommandsOptions.regexExecutor
      in src/plugins/composition.ts, provider selection in src/plugins/index.ts,
      and src/commands/regex-execution/{bounded-provider,portable}.ts within the
      safe-bash package. Define a typed injectable Pyodide executor/factory
      with explicit ownership and disposal. Reuse the architectural separation, not
      regex request shapes or unsupported worker-thread termination guarantees.
      Pyodide is fixed; inject its host execution mechanism, not an arbitrary Python
      runtime. The Cloudflare factory owns the pinned Pyodide build, static WASM
      imports, JSPI bridge and interpreter lifecycle. Node uses the same runtime
      through its thread adapter. Do not add a generic runtime configuration object.
      Keep provider configuration mutually exclusive with legacy createWorker and
      validate ambiguous options. Test caller-owned versus plugin-owned providers,
      sharing across shells, disposal idempotence and sibling cancellation isolation.
      Inspect packages/safe-bash/src/commands/python/index.ts: createWorker,
      SharedArrayBuffer, Atomics replies, request dispatch, capacity accounting,
      descriptor service and cleanup currently share orchestration. Separate the
      transport from invocation parsing, provisioning, PythonFileSystem ownership,
      output forwarding and finalization without pretending an in-process runtime
      is a terminable PythonWorkerEndpoint. Keep worker.ts/node.ts as the Node
      transport implementation. Capability reporting must be truthful and explicit.

      First add focused tests for existing invocation forms, createWorker callers,
      startup/error/exit behavior, admission refusal, abort, pending acquisitions,
      exactly-once descriptor cleanup and capacity retirement after termination.
      Preserve maxTransferBytes/maxOpenFiles and existing exit/error semantics.
      Keep synchronous Atomics.wait exclusive to the Node worker path. Test an
      injected asynchronous adapter with deterministic fakes, using memfs where
      files are needed. Follow package delegation and maintained checks. No remote
      deployment, README changes, push or release; preserve unrelated edits.
    status:
      implement: open
      test: open

  - id: reproducible-cloudflare-runtime-build
    title: Build a pinned runtime using static WASM modules
    prompt: |
      Implement reproducible build tooling for safe-bash's optional Cloudflare
      Pyodide adapter, following root/scoped AGENTS.md. Begin with Pyodide 314.0.6,
      CPython 3.14.2, ABI 2026_0, the versions actually validated in
      /Users/kjopek/Workspace/pyodide-cloudflare-validation/VALIDATION.md. Treat its
      scripts/prepare-runtime.mjs and trampoline generators as experimental evidence,
      not production-ready code. Preserve provenance and required license notices.

      Statically import core WASM, the JSPI feature probe, syncify trampoline,
      conditional syscall trampolines and supported function-signature wrappers.
      Never compile bytes at request time. Pin and verify downloads and lockfile
      hashes; transformations must assert exact source matches and fail closed on
      version drift. Produce a manifest of versions, inputs, transformations,
      signatures, native module paths and output hashes. Regeneration must be
      deterministic. Do not depend on an absolute validation-directory path.

      Keep runtime detection, location/base URL and Fetch-integrity adaptations
      scoped to this runtime. Do not replace host global fetch, process,
      WebAssembly.instantiate or instantiateStreaming. Inspect the existing Node
      loader's temporary WebAssembly mutation and provide a scoped equivalent of
      its protected system/socket import handling, not an unprotected bypass.
      Preserve hash verification when native Fetch integrity is unavailable.
      Prevent Node imports from entering the Cloudflare dependency closure, and
      avoid forcing Cloudflare assets into ordinary Node consumers.
      Test source/hash mismatch, missing signatures, unsupported native module,
      runtime capability failure and host-global preservation. Register real-runtime
      checks through maintained opt-in routes. No remote deployment, README edits,
      push or release. Preserve unrelated files and follow scoped delegation.
    status:
      implement: open
      test: open

  - id: bridge-canonical-filesystem-with-jspi
    title: Connect synchronous Python syscalls to asynchronous safe-fs
    prompt: |
      Implement the Cloudflare Python adapter's JSPI filesystem boundary using the
      existing PythonFileSystem and PythonStatTranslator service in packages/safe-fs
      and the transport-independent safe-bash command lifecycle. Read root and
      scoped AGENTS.md; delegate substantive package work as required. The prototype
      at /Users/kjopek/Workspace/pyodide-cloudflare-validation/src/syscall-bridge.js
      proves only a narrow /canonical mount. Its source and VALIDATION.md are
      evidence, not the full contract. Preserve all existing safe-fs guarantees.

      Enter Python through a suspension-aware entry point and suspend at conditional
      WASM syscall trampolines, awaiting real async descriptor operations. Bootstrap
      and interpreter-internal I/O must remain synchronous where required. Do not
      call syncify from ordinary JavaScript stream callbacks across unsuspendable
      frames. Do not stage user files in MEMFS or copy them back after execution.
      Metadata routing must preserve canonical authority and observe mutations.

      Cover the canonical root, cwd, mounted paths, nested directories, rename,
      unlink, symlinks, stat/timestamps, permission and errno behavior supported by
      safe-fs, retained descriptors, append, seek, pread/pwrite and truncation.
      Unsupported operations must match explicit existing service errors, not
      invented successful behavior. Preserve quotas, transfer limits, descriptor
      accounting, short reads/writes and abort/late-completion cleanup. Validate
      bounds before touching WASM memory and refresh views after memory growth.
      Build parity tests against the Node adapter and an actually delayed safe-fs
      backend, including failure injection and zero leaked handles. Keep real
      runtime tests opt-in with exact maintained membership registration. No remote
      mutation, README changes, push or release; do not claim filesystem parity
      until the capability matrix has passing coverage or explicit blockers.
    status:
      implement: open
      test: open

  - id: wire-execution-stdio-and-finalization
    title: Preserve shell execution and stream semantics in process
    prompt: |
      Implement Cloudflare execution through safe-bash's existing Python command
      parsing and Python launcher, following root/scoped AGENTS.md and the recorded
      lifecycle feasibility gate for docs/plans/pyodide-cloudflare-safe-bash.md.
      Preserve -c, stdin, script and module invocation, argv, cwd, environment,
      exit status and tracebacks. Inspect execution.ts and worker.ts; use
      runPythonAsync or the pinned runtime's verified suspension-aware equivalent
      without requiring users to rewrite synchronous Python open/read calls.

      Route stdin/stdout/stderr through safe-bash handlers with bounded chunks,
      backpressure, ordering, EOF and pipeline/redirection semantics. Connect abort,
      startup/provisioning failure and teardown to actual awaited service operations.
      Release descriptors exactly once, including late acquisitions, and retire
      capacity only when execution can no longer use its resources. Implement the
      gate's explicit admission and interpreter ownership policy; test repeated and
      overlapping calls, Python globals/modules/env/package state leakage and failed
      initialization. Do not advertise hard CPU termination or hostile-code isolation
      without a supported mechanism and evidence. Reject unsupported requested
      guarantees before execution, retaining Node defaults and semantics.

      Write regression tests first, exercise public shell pipelines with delayed
      streams and filesystem failures, and use maintained checks. No remote
      deployment, README edits, push or release. Preserve unrelated changes and
      follow scoped delegation for substantive implementation and verification.
    status:
      implement: open
      test: open

  - id: qualify-package-provisioning
    title: Provision supported packages with integrity and explicit native limits
    prompt: |
      Extend the optional in-process Cloudflare safe-bash adapter's package loading
      through existing provisioning controls, not a parallel installer API. Read
      root/scoped AGENTS.md and packages/safe-bash/src/commands/python provisioning
      and install code. Preserve packages, requirements, install-only behavior,
      progress, network authority and limits. Keep downloads within the authorized
      provisioning phase; runtime code must not gain implicit host/network access.

      Use a versioned static-native manifest and verified hashes. The prototype in
      /Users/kjopek/Workspace/pyodide-cloudflare-validation proved XlsxWriter 3.2.9,
      openpyxl 3.1.5, python-docx 1.2.0, pypdf 6.0.0 and lxml 6.0.2 with seven native
      modules and 184 signature wrappers for its pinned runtime. Requalify those
      through the actual safe-bash command; do not generalize to arbitrary native
      wheels, Pillow or python-pptx. Inspect the existing documents profile and
      either qualify every member or explicitly reject that full profile here;
      do not silently install a smaller profile under the same name.
      Fail clearly before unsupported dynamic native compilation. Test corrupt
      bytes, unsupported ABI/signature, unavailable packages, dependency failures,
      cancellation and repeat invocations. Record package-specific support rather
      than claiming general document rendering or formula calculation support.
      Use opt-in integration routes for actual downloads; ordinary unit tests use
      deterministic fixtures. No remote mutation, README edits, push or release;
      preserve unrelated work and follow scoped delegation.
    status:
      implement: open
      test: open

  - id: expose-cloudflare-adapter
    title: Expose explicit package and SDK integration for existing Workers
    prompt: |
      Wire the optional Cloudflare Python execution adapter into public package
      exports and src/sdk/bash.ts while keeping implementation inside packages.
      Read root/scoped AGENTS.md and existing PythonCommandsOptions/createWorker
      consumers. Preserve Node API compatibility and defaults. Provide explicit
      adapter configuration with truthful capabilities, trusted-code requirements,
      filesystem authority and lifecycle options. Do not auto-select Cloudflare from
      SharedArrayBuffer availability, and do not imply Node worker termination.
      Model the injection boundary on AgentCommandsOptions.regexExecutor and its
      portable executor/provider separation. Accept a caller-supplied Pyodide
      executor in the package and SDK without importing Cloudflare or Node runtime
      machinery into portable command code. Test legacy options, injected providers,
      conflicting configurations and ownership through public APIs. Provider names
      are an implementation choice; the injection and compatibility contract is not.

      Add a minimal existing-Worker embedding fixture that calls public safe-bash
      and SDK APIs, accepts a caller-provided safe-fs backend, and statically bundles
      the runtime. No separate Python Worker, service binding or application-specific
      deployment is required. Do not modify any existing remote Worker. Verify
      strict public types, exports, worker bundling, Node regression imports and host
      globals before/after initialization. Ensure normal Node consumers do not pull
      Cloudflare assets. Document verified setup, integrity, package support and
      limits outside README files; manual QA instructions belong in docs/plans.
      Use maintained build/type/test routes, preserve unrelated work and follow
      scoped delegation. No remote mutation, push or release in this task.
    status:
      implement: open
      test: open

  - id: validate-integrated-adapter-on-disposable-worker
    title: Validate the public safe-bash adapter locally and on the disposable Worker
    prompt: |
      Validate the integrated Cloudflare adapter through public safe-bash and SDK
      calls, following root/scoped AGENTS.md. Write the agent-executed QA procedure
      under docs/plans; test fixtures and deterministic build tools may be code,
      but do not replace the QA procedure with a script. First pass maintained unit,
      public type, build and opt-in local workerd checks. Register real-runtime test
      inputs exactly through scripts/integration-inputs.test.mjs as applicable.

      Remote authorization is limited to the already-created disposable Worker
      pyodide-cf-validation-kjopek-20260914 in account
      fdb283a7279a7b4d1f3577dbb2089ff2. Inspect provenance in
      /Users/kjopek/Workspace/pyodide-cloudflare-validation/VALIDATION.md and guarded
      scripts/cloudflare.mjs. Refuse a different name/account, routes, service
      bindings or any mutation of preexisting application Workers. Never create
      another deployment target or broaden credentials. Use the local protected
      credential only for the Cloudflare API/CLI; never read it into reports, source,
      command output, Git or Worker bindings. Set
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false and WRANGLER_SEND_METRICS=false.
      If credentials have expired or are unavailable, record the exact remote
      blocker and complete local checks; do not fabricate a remote pass.

      Deploy only fixed tests, with no arbitrary Python, path or package HTTP input.
      Verify unchanged ordinary Python file/script invocation, delayed canonical
      filesystem operations, streaming, cancellation within the declared contract,
      repeated/concurrent admission, failures and zero leaked descriptors. Generate
      and reopen XLSX/DOCX/PDF through safe-bash, inspect host-visible artifacts,
      and verify unsupported-native rejection. Return artifacts in the same request
      or persist through an explicitly configured backend; do not assume later
      requests share an isolate. Qualify a caller-supplied persistent backend locally
      where possible and record any remote persistence gap without inventing a new
      cloud resource. Inspect deployed settings and prove no credential bindings.

      Record deployed version, input/output hashes, versions, actual bundle sizes
      versus current account limits, request timings with their measurement scope,
      memory observations and remaining limitations. Compare Node and Cloudflare
      behavior. Seven historical prototype passes do not complete these checks.
      Leave the disposable deployment available, preserve unrelated work, do not
      push/release, and keep production integration explicitly unperformed.
    status:
      implement: open
      test: open

  - id: qualify-persistence-and-production-load
    title: Qualify persistent storage, isolation and resource behavior under load
    prompt: |
      Bring the injected Cloudflare Pyodide executor to production readiness for
      the declared workload, following root/scoped AGENTS.md and the lifecycle
      contract/evidence for docs/plans/pyodide-cloudflare-safe-bash.md. The delayed
      MemoryFileSystem prototype is insufficient for persistence qualification.
      Identify the application's actual safe-fs persistent backend and qualify its
      semantics with fault injection and its maintained local/emulated integration
      route. If that backend cannot be identified or exercised, record the exact
      blocker; do not mark production persistence complete using a substitute.

      Exercise cross-invocation reads, separate interpreter/isolate instances,
      concurrent writers, partial writes, failed close/flush, stale metadata, backend
      timeouts, cancellation during acquisition, rename/unlink with live descriptors,
      path/symlink/mount escape attempts and quota exhaustion. Assert the backend's
      actual consistency contract and document unsupported atomicity explicitly.
      Verify no invocation inherits another's Python globals, modules, environment,
      files, streams, package authority or JavaScript bridge handles. Test different
      shells sharing a provider and failure/disposal without cancelling siblings.

      Write bounded, agent-executed soak and load procedures under docs/plans using
      fixed workloads and declared repetitions/concurrency before execution. Measure
      initialization, package install, steady execution, rejection under saturation,
      cleanup, retained handles, memory growth and application request responsiveness.
      Include small and large supported document workloads, memory growth during I/O,
      runtime traps, corrupt downloads, failed initialization and retry. Compare
      measured usage with actual account limits and the application's available
      bundle/memory/CPU budget; unknown application headroom remains a reported
      integration blocker, not an assumed pass. Define and verify graceful error
      reporting and recovery after each supported failure. Prevent secrets, Python
      file contents and credentials from appearing in telemetry.

      Use maintained checks and opt-in runtime routes. Do not introduce an unbounded
      stress endpoint or arbitrary code execution endpoint. No cloud mutation in
      this task: only the separate fixed-target deployment task has that scope.
      Do not create persistent cloud resources or edit existing Worker bindings.
      Preserve unrelated work, follow scoped delegation, no README edits/push/release.
    status:
      implement: open
      test: open

  - id: expose-pyodide-in-browser-demo
    title: Make Python executable in the browser playground through injected Pyodide
    prompt: |
      Add working Python execution to the existing browser demo in
      packages/safe-bash-playground using the injected Pyodide executor developed
      for safe-bash. Read root and scoped AGENTS.md. Inspect src/engine/index.ts,
      src/engine/kernel.d.ts, the virtual:safe-bash-kernel build integration,
      src/execution-worker.ts, src/execution.ts, src/execution-filesystem.ts,
      src/execution-protocol.ts, src/samples.ts and the maintained browser tests.
      The demo already injects createWorkerRegexProvider into createAgentCommands;
      follow that composition pattern for Pyodide without adding a generic runtime
      framework. Share the pinned runtime, command semantics, filesystem bridge and
      executor contract; keep any browser-specific initialization/transport small
      and explicit. Browser workers and Cloudflare Workers have different capabilities.

      Register Python through public safe-bash APIs in the existing execution worker,
      not directly from page code or through a backend Python service. Keep the UI
      responsive and preserve page-owned canonical filesystem authority through the
      existing async RPC bridge. Ordinary python -c, script/module/stdin invocation,
      pipelines and redirections must work. Python-created or edited files must
      immediately appear in the same explorer, editor and download workflow, with
      the existing workspace quota and descriptor cleanup enforced. Do not copy the
      whole workspace into interpreter MEMFS and copy it back. Do not expose page
      DOM, credentials or unrelated host capabilities to guest Python.

      Load the interpreter lazily with clear loading/provisioning/error feedback.
      Inspect current five-second execution budgets and outer worker supervision:
      account explicitly for cold initialization/provisioning versus command limits,
      keeping startup and execution bounded without silently disabling safeguards.
      Verify Stop, timeout, reset, navigation and worker failure terminate owned
      execution and clean pending filesystem requests/auxiliary workers. Prevent
      late replies from changing a reset or subsequent workspace. Test a CPU loop
      under the browser's externally enforced worker termination and do not transfer
      that guarantee to the in-process Cloudflare adapter. Detect required browser
      capabilities, including JSPI or any chosen transport requirements, and display
      an actionable unsupported-browser result without breaking ordinary shell use.
      Verify actual hosting headers, CSP, WASM MIME and asset URLs; do not assume
      SharedArrayBuffer/cross-origin isolation is available or require it needlessly.

      Update samples.ts welcome text, help/command inventory, relevant UI copy and
      RESOURCE_LIMITS.md to describe actual Python support while keeping other
      uninstalled runtimes accurately described. Do not edit README files. Add
      runnable Python samples for hello.py, canonical file read/write and a supported
      document workflow whose artifact can be downloaded. Only advertise packages
      qualified in this browser build; give deterministic errors for unsupported
      native packages. Avoid adding runtime implementation details to normal UI.

      Add focused regression tests for registration, filesystem visibility, limits,
      worker protocol cleanup and sample accuracy. Run the maintained playground
      unit/build routes and affected safe-bash public-API checks. Write an agent-run
      real-browser QA procedure under docs/plans and execute it against the built
      demo, covering cold/warm load, hello.py, stdin/pipes/redirection, editor-visible
      mutations, document download, cancel/timeout/reset, network or asset failure,
      unsupported capabilities and unaffected shell/regex commands. Record browser
      versions, supported-browser matrix, console errors, screenshots and artifact
      evidence. Missing required browser behavior blocks this task; unit tests alone
      are not browser acceptance. Include browser acceptance in the final production
      review and release smoke test. Preserve unrelated work and follow scoped
      delegation. Do not change existing Cloudflare Workers or deploy a new service.
      Commit verified owned changes; defer push/publication to the final teardown.
    status:
      implement: open
      test: open

  - id: review-compatibility-and-handoff
    title: Review the finished adapter and publish an honest compatibility report
    prompt: |
      Review the Cloudflare safe-bash adapter against
      docs/plans/pyodide-cloudflare-safe-bash.md and its capability matrix using root
      and scoped AGENTS.md. Obtain independent package review as scoped instructions
      require. Inspect transport separation, preserved Node compatibility, canonical
      filesystem authority, pending-operation cleanup, admission, Python state
      isolation, globals, integrity and native-manifest failure behavior. Resolve
      findings with focused regression tests and rerun only affected maintained
      checks. Unresolved required lifecycle or compatibility behavior remains a
      blocker; do not relabel an experimental subset as production-ready.
      Build a requirement-to-evidence checklist covering every production contract:
      provider injection/ownership, Node compatibility, canonical filesystem and
      actual persistence, streams, cancellation, isolation, saturation, memory,
      supported packages, integrity, host-global preservation and deployment budget.
      Include the browser playground's public Python execution, visible shared files,
      downloadable artifacts, capability diagnostics and cancellation/reset evidence.
      Every required row needs passing public-API evidence with source/build hashes.
      Missing, skipped or prototype-only evidence cannot count as a pass. Require
      independent review of the same final artifact and documented reproducible
      build/upgrade checks, dependency/license inventory, runtime pin upgrade and
      rollback procedures, and operational diagnostics without leaking user data.

      Update integration documentation outside README files and the QA/evidence
      report under docs/plans. Explain how callers embed the adapter in their
      existing JavaScript Worker, the exact supported package set, generated/static
      assets, filesystem contract, actual cancellation limits and deployment size.
      Distinguish historical prototype evidence, current public safe-bash validation,
      local workerd and deployed results. Explicitly record unqualified persistent
      storage and document families, and whether deployment checks were blocked.
      Do not claim an existing application Worker was integrated: no such mutation
      is authorized. Mark only verified tasks complete, report local commits and
      remaining work, preserve unrelated changes, and do not push or release.
      Complete this pipeline only when the declared production contract passes;
      otherwise report the precise blocking requirement and leave it unfinished.
    status:
      implement: open
      test: open
finalization: pending
---

# Pyodide in an existing Cloudflare JavaScript Worker

This plan turns the September 14, 2026 feasibility fixture into an explicit
safe-bash adapter. Python remains in the application's JavaScript Worker and uses
the caller's asynchronous safe-fs filesystem through JSPI. Existing Node execution
and ordinary Python script syntax remain supported.

The caller injects a Pyodide executor, following the existing
`regexExecutor` provider pattern. Portable safe-bash orchestration retains command
policy; Node and Cloudflare provide execution mechanisms. Production readiness is
required, including persistence, load, cleanup and independent acceptance review.
An experimental adapter is not a completed outcome.
Pyodide is the fixed runtime; there is no generic runtime-selection framework.

The final teardown finishes remaining scoped items, commits remaining verified
changes, pushes main and watches the GitHub release through verified publication
and a consumer smoke test. Release is gated on production acceptance and does not
deploy changes to an existing application Worker.

The prototype's final deployed version was
`3f71fdb5-5c5c-46f4-8a14-afec20c25cc7`: both final requests passed seven checks,
with zero retained file handles. Its bundle measured 5,110.27 KiB gzip. Those
results prove feasibility for a narrow filesystem bridge and selected libraries;
they do not establish the safe-bash lifecycle contract, full filesystem parity,
persistent storage or production readiness.

The first task is a gate because JSPI can suspend Python for asynchronous I/O but
does not create a separately terminable execution thread. Any mandatory guarantee
that cannot be preserved must remain an explicit blocker or unsupported requested
capability. No separate Worker architecture is a fallback in this plan.

All tasks are unstarted. Creating and validating this document does not execute
the implementation pipeline or authorize changes to existing application Workers.

## Plan creation record

Recorded on September 14, 2026 in `/Users/kjopek/Workspace/poe-code-3`:

- Branch: `main`; no branch created.
- HEAD: `917b203ffa05d85b39138d1e6f1d7265a9a82104`.
- Working tree: clean before this plan update (`git status --short`).
- Index: empty before this plan update (`git diff --cached --name-status`).
- Instructions read: root `AGENTS.md` and `packages/safe-bash/AGENTS.md`.
  No scoped `AGENTS.md` was found in safe-fs or safe-bash-playground.
  Nested safe-bash instructions belong to existing fixture/evidence trees;
  those paths are outside the assignments below and remain preserved.
- Current owned path: `docs/plans/pyodide-cloudflare-safe-bash.md` only.
  No implementation, runtime experiments, deployment, push or release occurs
  during plan creation. Prototype claims above await task-one revalidation.
- Plan validation: the maintained `packages/pipeline/src/plan/parser.ts`
  `parsePlan` accepts this document, with setup, teardown and all eleven ordered
  tasks retaining open implementation/test statuses. `git diff --check` passes.

The setup prompt's plan-only restriction applies to this creation request.
A subsequent explicit implementation request starts setup, then the eleven tasks
in their listed order, then teardown. Re-record branch, HEAD, working tree and
index at that time; this clean snapshot does not authorize altering later work.
All implementation and test statuses remain open until their acceptance passes.

## Implementation ownership and delegation

Root coordinates integration, task ordering, acceptance, plan/evidence updates
and all Git operations. At implementation setup, assign named package workers
and an independent reviewer before substantive package edits. Review and stress
verification use a different agent from the implementer, as scoped instructions
require. Assign exact files for each task before editing; the areas below define
ownership boundaries, not permission to stage entire directories.

| Owner role | Assigned area for the later implementation run |
| --- | --- |
| Root integration | This plan and related evidence/manual QA documents under `docs/plans`; root `src/sdk/bash.ts`, affected SDK tests and root public export wiring; integration test membership registration |
| safe-bash implementation worker | Python command/transport/executor code under `packages/safe-bash/src/commands/python`, affected plugin composition, package exports/build tooling, focused package tests and public consumer fixtures |
| safe-fs implementation worker | Required PythonFileSystem/PythonStatTranslator changes and focused tests in `packages/safe-fs`, only after validating a service gap |
| Playground implementation worker | Affected engine, execution worker/RPC, samples, UI, `RESOURCE_LIMITS.md`, build assets and focused browser tests in `packages/safe-bash-playground` |
| Independent reviewer | Read-only review and bounded verification of the final candidate; fixes return to the assigned implementer with failing regression evidence |

Shared files, runtime manifests and generated assets need one named owner before
editing. Root owns shared lockfile integration if a justified dependency change
is necessary. Workers never stage, commit, push or deploy. Root commits verified
atomic improvements with explicit owned files and their relevant plan updates,
preserving unrelated staging and allowing hooks to run. Delivery remains deferred
to final teardown after every mandatory production acceptance item passes.
No README paths, historical sealed fixtures, protected credentials or the external
validation fixture are assigned for modification.

Each task records its failing-test evidence before code, maintained checks,
explicit opt-in runtime results and remaining blockers in `docs/plans`. Evidence
must identify the tested source/build hashes and distinguish deterministic unit
coverage, real Node Pyodide, local workerd, browser and fixed-target deployed
validation. The actual persistent backend and application resource headroom are
unidentified at plan creation; their required qualification stays open. Missing
credentials or unmet same-isolate guarantees likewise remain blockers, never
skipped passes. Independent production acceptance reviews the final artifact
before teardown can authorize its push and verified GitHub publication.

## Teardown acceptance correction — September 14, 2026

All eleven implementation/test states remain open: their acceptance criteria
have not passed. The previous done values conflicted with the recorded blocked
evidence and current source availability. Finalization remains pending.
See [the teardown acceptance report](pyodide-cloudflare-teardown-acceptance.md)
for current checks, independent review, exact blockers and delivery state.
No production feature publication is permitted while these gates remain open.
