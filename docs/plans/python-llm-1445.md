# Python library acceptance — issue 1445

## Current delivery contract

Deliver the customizable bundled `poe_llm` and `poe_shell` libraries, ordinary
stdlib subprocess compatibility, the shared JavaScript service adapter, current
installed-package runtime acceptance and hosted authorization/billing acceptance.
Deliver required code to remote main before closing 1445. Publication and poe2
adoption are distinct outcomes. Full poe-code release completion is not required.

The resumed implementation uses the named data-only bridge delivered by 1444.
The former request/close adapter is superseded and must not be reapplied. The
original worktree remains preserved; resumed work uses
`poe-code-write-customiza-1445`. Saved out artifacts are absent, so historical
passing notes are not current acceptance evidence.

## Requirement matrix

| Requirement | Current source/evidence | Remaining acceptance |
| --- | --- | --- |
| Bundled typed requests/responses/exceptions | Current `python/llm-module.ts`; deterministic Python API suites pass on resumed main | Current installed public-package import |
| Discovery, prompt/system/messages/options, attachments, complete/stream | Python API and named bridge recovered on main | Real shared-service adapter; Bash/Python semantic equivalence |
| Defaults, prompt functions, transforms, composition and conversations | Current deterministic Python suite | Actual launcher customization examples |
| Templates/schema/embeddings and shared-service parity | Python request surface exists; main service is narrower | Integrate 1443 service contract; retain supported-operation parity matrix |
| Provider/auth/billing ownership | Named data-only capability keeps host objects out of Python | Reuse authorized consumer service; hosted receipt |
| Async iteration, early close, cancellation, exceptions and per-call limits | Current API tests and bridge sources | Same installed-package workerd gate and host cancellation receipt |
| Canonical filesystem, no direct CLI routing | Canonical attachment paths and shell bridge contract | Provider attachment parity and real file round trips |
| Authenticated distribution, public consumption | Bundled static modules in current runtime | Independently packed/installed safe packages and actual Pyodide/workerd |
| Single-call/streaming examples and support docs | Recovered executable scripts and reconciled docs | Run exact scripts through actual launcher |
| Literal argv, explicit scripts, bounded capture and streaming | `poe_shell` suite passes | Installed runtime exact script/argv/binary output checks |
| Ordinary subprocess subset | `run`/`check_output` compatibility suite passes | Real rg, pipelines, errors, timeout, cwd/env and binary round trips |
| Nested Python and cleanup | Current 1444 admission/cleanup implementation | Installed-runtime cancellation and nested-command checks |
| Hosted callbacks/private files, authorization/billing/options | Old consumer checkout/receipts absent | Established DEV lane, exact revisions, owned cleanup receipt |
| Remote main delivery | Recovered bridge/library code is on main; new docs pending | Commit and verify all remaining implementation on remote main |
| Scoped publication | Not reconciled in this resumed session | Record package version and publication provenance separately |
| poe2 adoption | Separate repository; old out clone absent | Current consumer integration and coordinating consumer PR workflow |

## Verification

Use maintained scoped checks while implementing focused changes. Run broad
maintained build/test/lint/type routes if the final change crosses workspaces or
shared infrastructure. Unit tests use deterministic bridges and providers. Actual
runtime acceptance uses independently installed public artifacts, authenticated
Pyodide and workerd/Miniflare. Hosted acceptance must use the established consumer
CI deployment lane and retain a credential-free receipt identifying both exact
revisions and successful owned-resource cleanup.

Temporary commands/results belong in `out/`; this document holds the plan and
requirement matrix. Before closure, verify every row against current authoritative
evidence and record a concise linked completion result.
