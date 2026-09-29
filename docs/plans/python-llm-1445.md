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
| Bundled typed requests/responses/exceptions | Current `python/llm-module.ts`; deterministic Python API suites pass on resumed main | Installed tarball import verified; final rich-service artifact still required |
| Discovery, prompt/system/messages/options, attachments, complete/stream | Python API and named bridge recovered on main | Real shared-service adapter; Bash/Python semantic equivalence |
| Defaults, prompt functions, transforms, composition and conversations | Current deterministic Python suite | Exact single-call/streaming/shell scripts pass installed launcher; rich customization parity remains |
| Templates/schema/embeddings and shared-service parity | Python request surface exists; main service is narrower | Integrate 1443 service contract; retain supported-operation parity matrix |
| Provider/auth/billing ownership | Named data-only capability keeps host objects out of Python | Reuse authorized consumer service; hosted receipt |
| Async iteration, early close, cancellation, exceptions and per-call limits | Current API tests and bridge sources | Installed tarball workerd gate passes cancellation/early close/binary events; final rich-service gate still required |
| Canonical filesystem, no direct CLI routing | Canonical attachment paths and shell bridge contract | Provider attachment parity and real file round trips |
| Authenticated distribution, public consumption | Bundled static modules in current runtime | Independently packed/installed 0.0.0-python-1445 candidates pass Pyodide/workerd; final publication remains |
| Single-call/streaming examples and support docs | Recovered executable scripts and reconciled docs | Exact scripts pass the independently installed launcher; final shared-service replay remains |
| Literal argv, explicit scripts, bounded capture and streaming | `poe_shell` suite passes | Installed runtime and exact shell example pass argv/script/binary checks |
| Ordinary subprocess subset | `run`/`check_output` compatibility suite passes | Installed runtime passes rg, pipelines, errors, timeout, cwd/env and binary file round trips |
| Nested Python and cleanup | Current 1444 admission/cleanup implementation | Installed runtime passes invocation retirement, cancellation and nested-command rejection |
| Hosted callbacks/private files, authorization/billing/options | Old consumer checkout/receipts absent | Consumer Convex barrier requires isolated Poe/Joiner receipts for one immutable artifact before Worker deploy; preview tooling tracked by poe2 draft #474 |
| Remote main delivery | Recovered bridge/library, docs 9eac395d3d, embedding iterable f68f21cc07 and native envelope eb0824ff5a verified on remote main | Commit and verify all remaining implementation on remote main |
| Scoped publication | Scoped run 36526051362 built successfully but coalesced into newer main; it did not publish | Record package version and publication provenance separately |
| poe2 adoption | Fresh clean consumer clone at 8979e8bb7145; no consumer implementation delivered | Current consumer integration and coordinating consumer PR workflow |

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

## Current runtime evidence

At `eb0824ff5a`, maintained Safe Bash dependency build closure passes with
`--no-cache`. The public candidates were packed and installed as real tarballs
(no workspace symlinks) under `out/public-consumer`. The real Pyodide 314.0.6 /
workerd 1.20260917.1 gate passes both native-runtime cases, including ordinary
`poe_llm`, `poe_shell`, subprocess, typed scalar options, binary/text events,
canonical files, cancellation, early stream exit and retired-capability rejection.
Requests around 128 KiB round-trip Unicode with a configured 1 MiB capability
budget after removing the separate native decoder ceiling.

The exact `llm-single.py`, `llm-stream.py` and `shell-tools.py` documentation
sources also pass through that installed launcher with the parent's standard
commands and rg enabled. These tests use deterministic host capabilities;
they do not establish the richer shared-service parity or hosted auth/billing
requirements. Logs: `out/installed-python-runtime.log`,
`out/installed-python-examples.log`, `out/native-envelope-green-final.log`.
Publication and final shared-service/consumer qualification remain open.
