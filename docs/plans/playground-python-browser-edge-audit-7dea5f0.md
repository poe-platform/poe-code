# Built playground user edge audit — September 14, 2026

Python browser acceptance is blocked on main at
`7dea5f0cf81689bdeccaddf100aa72a5760c8d4e`: the shared injected executor
required by the task is absent. No product fixes or README edits were made.

Read root and safe-bash instructions; no playground-scoped AGENTS.md exists.
Inspected the engine, kernel declarations, virtual-kernel build integration,
execution worker/supervisor, filesystem bridge, protocol, samples, resource
limits and maintained tests. Current safe-bash source has no Python command
family or Pyodide runtime. Its composition options expose regex injection but
no Python executor option. A freshly built public API probe returned
`ERR_PACKAGE_PATH_NOT_EXPORTED` for `virtual-bash/commands/python`.
Both Python aliases returned 127 through public `agentCommands()`; a subsequent
`printf recovered | cat` returned 0 with exact stdout `recovered`.

## Agent-run browser procedure and results

Executed the available prerequisite portion of
[the full acceptance procedure](safe-bash-playground-python-qa.md) against the
newly built site, served at `http://127.0.0.1:5191/site/`. Browser automation was
invoked interactively with temporary Playwright tooling outside the repository;
no executable QA script was added.

1. Open a fresh Chrome session at the nested site URL and wait for readiness.
2. Submit hello.py, inline Python, python3, piped stdin, stdin source,
   module/redirection, CPU loop and canonical mutation commands.
3. Submit shell sort pipeline, rg, ERE condition, shell write/read, shell sample
   and help to verify recovery and accurate command inventory.
4. Capture browser version, measured capabilities, document response headers,
   console errors, command transcripts/timings and a full-page screenshot.

All Python invocations returned command-not-found, status 127. The attempted
mutation did not create mutation.txt; the following cat returned ENOENT and
final status 1. This compound-command status does not indicate Python execution.
The CPU-loop attempt never executed Python and proves no timeout guarantee.
Python attempt timings were 221–320 ms; these are missing-command timings,
not cold/warm interpreter results. Shell/regex recovery checks passed.

Browser: Google Chrome 152.0.7977.84 on macOS, viewport 1440 × 1000.
JSPI is available; crossOriginIsolated is false. No page exceptions or console
errors were recorded. Visually inspected
[browser.png](playground-python-browser-edge-audit-7dea5f0/browser.png):
Python errors and accurate uninstalled-runtime help are visible.
Raw evidence: [results.json](playground-python-browser-edge-audit-7dea5f0/results.json).

## Maintained verification and limits

- `npm run test:unit --workspace=safe-bash-playground`: 8 files, 223 tests pass.
- `npm run build:workspaces -- --workspace=safe-bash-playground`: declared
  dependency closure and site build pass; Vite circular/large chunk warnings remain.
- Freshly built safe-bash public-API prerequisite probe: missing Python export
  and commands reproduced; ordinary pipeline succeeds.

| Browser | Capability | Python acceptance | Shell/regex |
| --- | --- | --- | --- |
| Chrome 152.0.7977.84 | JSPI yes; isolation no | Blocked: executor absent | Pass |
| Firefox | Unmeasured | Unaccepted | Unmeasured |
| Safari/WebKit | Unmeasured | Unaccepted | Unmeasured |

Document download, interpreter filesystem visibility/quotas, descriptor cleanup,
CPU termination, Stop/reset/navigation, loading/provisioning, runtime asset
failure and unsupported-capability diagnostics remain unaccepted. Local static
headers do not qualify deployed CSP, WASM MIME or runtime URLs. No in-process
Cloudflare preemption guarantee follows from this audit.

Required next input is the checkout/commit containing the shared public Python
executor, pinned runtime, filesystem contract and qualified package inventory.
Resume the full browser procedure against that implementation; missing required
behavior blocks production review. Repeat acceptance against actual hosting in
release smoke. Only this report and its evidence belong to this audit's commit;
push/publication is deferred to final teardown.
