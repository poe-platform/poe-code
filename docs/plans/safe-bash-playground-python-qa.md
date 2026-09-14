# Browser Python integration acceptance

Status: blocked at prerequisite availability; implementation and browser
acceptance are pending. This is an agent-run procedure, not an executable QA
script. No Python behavior below has been accepted.

## Availability evidence — September 14, 2026

Inspected main at `3dbc84e65d615f545cdcdef68eb258745efb535d`, root
`AGENTS.md` and `packages/safe-bash/AGENTS.md`. No scoped playground or safe-fs
AGENTS.md exists. Preserve existing modified/untracked plans and evidence.
Ownership for this availability pass is this document only.

Inspected the playground engine, virtual kernel declarations/build plugin,
execution worker, execution supervisor, filesystem RPC, protocol, samples,
session/help, UI, resource limits, maintained worker fixtures/tests and site build.
Also inspected safe-bash plugin composition, package exports and safe-fs source.

- There is no `packages/safe-bash/src/commands/python/`.
- `AgentCommandsOptions` has `regexExecutor`, but no Python injection option.
- The safe-bash manifest has no Python exports. Importing
  `virtual-bash/commands/python` concretely fails with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- Source searches find no Pyodide executor, pinned runtime implementation,
  `PythonFileSystem` or `PythonStatTranslator` service.
- Existing Cloudflare qualification documents independently record these same
  absent prerequisites. Pipeline task status is not implementation evidence.

Executed a source public-API probe using Node with `--import tsx`: construct
`new Shell({ fs: createMemoryFileSystem() }).use(agentCommands())`, execute
`python -c "print(1)"`, `python3 -c "print(1)"`, then
`printf recovered | cat`, and await disposal in finally. Both Python commands
return 127 with command-not-found stderr; the shell pipeline returns 0 and
exact stdout `recovered`. These observations validate missing registration and
ordinary shell recovery only; they are not browser acceptance.

Required input: the implementation checkout/commit containing the public Python
API, injected executor contract, pinned runtime and canonical filesystem bridge,
with its qualified browser-compatible package inventory and maintained checks.
Building a second executor or guessing an API would not satisfy sharing that
implementation. No product files or README files were changed during this pass.

The current page supervisor starts its five-second deadline before worker ready;
the engine also sets five-second wall/CPU budgets. The current execution API
has no caller AbortSignal/Stop entry point; reset is disabled while busy. These
are inspected integration requirements, not evidence of Python cancellation.
The worker fixture uses Node threads and cannot establish browser acceptance.

## Candidate admission and maintained checks

1. Once prerequisites exist, assign exact owned implementation paths. Follow
   scoped delegation for substantive safe-bash changes and independent review.
   Reproduce each change with focused failing tests before implementation.
2. Compose the injected executor in the dedicated execution worker using public
   APIs, following regex composition. Keep the page's canonical filesystem RPC
   authoritative; reject copying the workspace through interpreter MEMFS.
3. Document explicit bounded startup/provisioning and command budgets, their
   transitions and outer termination. Account for each command in a compound
   shell invocation and Python commands in pipelines. A worker-provided loading
   message must not allow arbitrary deadline extension.
4. Run `npm run test:unit --workspace packages/safe-bash-playground` and
   `npm run build:workspaces -- --workspace=safe-bash-playground`. Run the
   affected maintained safe-bash public-API checks and relevant lint route from
   the actual declarations. Record exact commands, outcomes, source revision,
   dirty owned paths, runtime manifest hashes and built asset hashes. Unit
   success alone cannot admit the feature.

## Real-browser procedure against the built site

Serve `packages/safe-bash-playground/dist/site` through a static server at the
same subdirectory layout as hosting. Use browser automation or browser developer
tools to perform these steps interactively. Do not substitute the Node fixture.
Store captures in a new evidence directory under `docs/plans`; never replace
existing evidence. Record browser/OS versions, URLs, timestamps, console errors,
network status, command exit codes, screenshots and artifact hashes.

1. Inspect `.github/workflows/publish-schemas-pages.yml` and deployed
   `https://poe-platform.github.io/poe-code/safe-bash/`. Capture actual document
   response headers, meta/header CSP, runtime asset URLs and redirects, WASM
   response `Content-Type`, and cross-origin policy. Check the built site's
   nested-path asset resolution. Record `crossOriginIsolated`, whether JSPI is
   available, and all chosen transport capabilities. Do not require SAB unless
   the implemented transport needs it. A future build is not yet hosted; verify
   its actual hosting again in release smoke testing.
2. Clear site data/cache. Run ordinary shell and regex commands first:
   `printf 'pear\napple\n' | sort`, `rg apple data/words.txt`, and
   `[[ apple =~ ^a ]] && echo matched`. Confirm exact expected output and that
   no interpreter assets load. Capture initial page and help screenshots.
3. Run `python examples/hello.py`. Capture visible loading/provisioning feedback,
   network assets, elapsed cold time, Unicode output and successful completion.
   Repeat warm. Confirm which assets and interpreter lifetime are reused; a
   fresh execution worker is not evidence of interpreter reuse.
4. Run `python -c 'print("inline")'`,
   `printf 'pipe input\n' | python -c 'import sys; print(sys.stdin.read(), end="")'`,
   `printf 'print("stdin program")\n' | python -`,
   `python -m json.tool data/people.json > formatted.json`, and
   `python examples/hello.py > hello.txt; cat hello.txt`. Verify pipeline bytes,
   redirections and exit statuses; also run a Python syntax error in a pipeline.
5. Execute the candidate canonical read/write sample. Open its output in the
   explorer/editor immediately, edit it there, then read the changed bytes from
   Python. Test binary bytes, append, rename and a retained descriptor with the
   qualified bridge. Confirm acknowledged effects survive Stop/timeout and
   unrelated files are untouched. Capture editor/explorer evidence.
6. Run the candidate document sample using only its qualified packages. Download
   the artifact through the existing file workflow. Open/inspect it outside the
   demo, verify contents and signature/format, and record filename, byte length
   and SHA-256. Capture artifact and download evidence. Test an unqualified
   native package and confirm the deterministic supported-package diagnostic.
7. Exceed the 16 MiB workspace budget from Python; require a bounded failure
   and unchanged rejected bytes. Exercise descriptor exhaustion and output
   limits, then confirm a subsequent invocation succeeds and no descriptors
   remain owned by the terminated execution. Do not call these heap/RSS limits.
8. In a real browser, run `python -c 'while True: pass'`. Confirm page controls
   remain responsive and the page externally terminates the execution worker
   within the declared command deadline, returning the documented timeout.
   Run the shell/regex baseline again. This proves only browser worker
   termination; it gives no in-process Cloudflare preemption guarantee.
9. Stop during cold loading, provisioning, awaited filesystem I/O and CPU work.
   Reset while execution is active, start another command, then release delayed
   old replies. Navigate away during each phase. Verify execution and auxiliary
   workers terminate, filesystem admission closes, pending requests drain/reject,
   and late state/results/writes cannot mutate the reset or subsequent workspace.
   Capture Stop/reset UI and recovery. Inspect worker/resource lifecycle evidence
   rather than inferring cleanup solely from displayed output.
10. Block an interpreter asset, return an invalid WASM MIME/body, and simulate
    offline cold loading. Force execution worker error/messageerror and auxiliary
    worker failure. Require bounded actionable errors, cleanup, no false success,
    and working subsequent shell commands. Restore networking and retry Python.
11. Test an actual unsupported browser and a controlled missing-capability path.
    Python must give an actionable unsupported-browser result, without loading
    incompatible assets or disabling shell/regex use. Record measured support by
    exact browser version; do not infer Safari/Firefox support from Chromium.

## Acceptance record and release gate

| Browser/version | Capabilities | Python result | Shell/regex result | Evidence |
| --- | --- | --- | --- | --- |
| Chromium — not measured | Pending | Blocked: no executor | Not browser-tested | Pending |
| Firefox — not measured | Pending | Blocked: no executor | Not browser-tested | Pending |
| Safari/WebKit — not measured | Pending | Blocked: no executor | Not browser-tested | Pending |

An independent production review must inspect the final built candidate and
every required acceptance result, including capabilities, filesystem authority,
guest host-capability restrictions, deadlines, cleanup, downloadable document and
hosting behavior. Any missing required browser behavior leaves this task open.

Push/publication is deferred to the pipeline's final teardown. After publication,
repeat cold/warm Python, canonical mutation/download, document artifact,
CPU timeout/Stop/reset, unsupported-capability behavior and shell/regex checks
against the actual hosted release. Verify shipped asset hashes, headers/CSP/MIME
and package qualifications. Report local commits, remote-main delivery and
successful release separately. Do not deploy or alter Cloudflare services.
