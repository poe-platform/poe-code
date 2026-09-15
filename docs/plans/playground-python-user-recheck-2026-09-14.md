# Playground Python user recheck — September 14, 2026

Result: browser Python acceptance remains blocked. This pass tested the built
demo as a user; it did not find an installed Python implementation to fix.
Source revision: `edc6ab3cb` on main. Existing unrelated plans/evidence were
preserved. No product or README changes were made.

## Procedure and evidence

Read root and safe-bash AGENTS.md; no playground-scoped AGENTS.md exists.
Inspected engine registration/declarations/build integration, execution worker,
supervisor, filesystem RPC, protocol, samples, resource limits and maintained
tests. Safe-bash source and exports still contain no injected Python executor,
pinned Pyodide runtime, Python command family or filesystem contract. A source
public-API probe returned `ERR_PACKAGE_PATH_NOT_EXPORTED` for
`virtual-bash/commands/python`. A shell composed with public `agentCommands()`
returned 127 for both Python aliases; a subsequent `printf recovered | cat`
returned 0 and exact stdout `recovered`.

Executed the existing agent-run browser procedure's prerequisite checks against
the newly built static site at `http://127.0.0.1:5187/site/`, using installed
Google Chrome headless through temporary Playwright tooling outside the repo.
No executable QA script was added. Browser: Chrome `152.0.7977.84`, macOS.
Viewport: 1440 × 1000. JSPI measured available; crossOriginIsolated false.
Local document response headers and command transcripts are in
[results.json](playground-python-user-recheck-2026-09-14/results.json).

1. Open the built nested-path site, wait for terminal readiness, capture
   [initial.png](playground-python-user-recheck-2026-09-14/initial.png).
2. Submit Python script, inline, python3 alias, pipeline input, stdin program
   and module-with-redirection commands. Every invocation returns 127 with
   command-not-found. None executes Python. First script attempt completes in
   518 ms; subsequent attempts take 67–128 ms. These are missing-command timings,
   not interpreter cold/warm measurements.
3. Submit sort pipeline, rg, ERE condition, shell file write/read and shell
   hello sample. Expected output is present and ordinary shell use recovers.
4. Run help and capture
   [commands.png](playground-python-user-recheck-2026-09-14/commands.png).
   Visually inspected the screenshot: Python failures are visible and help
   accurately says runtimes are uninstalled. No page exceptions or console
   errors occurred during these checks.

## Maintained verification

- `npm run test:unit --workspace=safe-bash-playground`: 8 files, 223 tests pass.
- `npm run build:workspaces -- --workspace=safe-bash-playground`: dependency
  closure and site build pass. Vite reports circular manual chunks and large
  chunks; no claim of a warning-free build.

## Acceptance limits and next gate

| Browser | Measured capability | Python | Shell/regex |
| --- | --- | --- | --- |
| Chrome 152.0.7977.84 | JSPI yes, isolation no | Missing command | Baseline pass |
| Firefox | Not measured | Not accepted | Not measured |
| Safari/WebKit | Not measured | Not accepted | Not measured |

Python filesystem mutations, document generation/download, quota/descriptor
limits, CPU preemption, Stop/reset/navigation cleanup, startup/provisioning,
asset failures and unsupported-capability feedback cannot be accepted without
the shared runtime. No Python CPU-loop termination or Cloudflare preemption
guarantee is established. Actual deployed runtime headers/CSP/WASM MIME and
asset URLs remain unqualified: this local static test is not hosting evidence.

Continue the full procedure in `safe-bash-playground-python-qa.md` when the
implementation commit is available. Missing browser behavior blocks production
acceptance; passing units do not waive it. Include all browser results in final
production review and repeat them against actual hosting during release smoke.
Push/publication remains deferred to final teardown.
