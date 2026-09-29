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
| Discovery, prompt/system/messages/options, attachments, complete/stream | `createPythonLlmCapability` reuses the injected `LlmService`; Bash/Python request equivalence and rich request tests pass | Final independently installed artifact verified; qualifying publication still required |
| Defaults, prompt functions, transforms, composition and conversations | Deterministic suite passes; executable `llm-customize.py` added alongside the three existing scripts | All four scripts pass the final installed shared-service artifact; persisted template/conversation parity remains |
| Templates/schema/embeddings and shared-service parity | Actual shared schema/messages/embed routes implemented, embedding metadata owned and retained | Named templates, persisted conversations and remaining reference CLI workflows still require #1443; explicit rejection is not completion |
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

## Resumed shared-service qualification

The native capability now uses the same injected authorized `LlmService` as
`llmCommands({service})`. No provider transport or manual fake-library bridge is
introduced. The focused final deterministic API route passes all 19 Node tests
(`out/python-final-api-contracts-qualified.log`), including a 16 MiB provider
bytes event split into configured 4 KiB messages, byte order, one final metadata
event and early provider cleanup. The adapter defaults binary chunks to 16 KiB;
applications must choose chunks with JSON-envelope headroom under finite native
message budgets. Buffered completion remains a whole result and may be refused.

Subprocess regressions reproduced parent-environment leakage and lost timeout
output. Supplied environments now replace child environments; unspecified env
inherits, leaving parent state unchanged. Buffered deadline failures carry
partial stdout/stderr into ordinary `subprocess.TimeoutExpired`. Streaming
deadlines still fail and await child cleanup. Actual source-mode workerd replay passes both
behaviors, a 2 MiB binary provider event under a finite 1 MiB bridge budget,
embedding metadata, cancellation and all four executable documentation scripts
(`out/source-python-final-current.log`, 2/2 tests).

Maintained normal workspace build and repository-wide lint passed before the
latest compatibility/chunking changes. Focused final ESLint passes. Serialized
full `npm test` has passed 250 root files / 5,228 root tests and continues through
workspace batches; no final full-unit success is claimed yet. Final independently installed candidate now passes the actual runtime gate.
Published package provenance, full-suite completion and compliant hosted consumer
receipts remain pending. The interrupted full-unit run is not a passing receipt.

## Verified delivery checkpoint

The resumed commits are delivered to remote main through
`acda6768b5a829b4421be40fdc7c87858db201c6`; a fresh fetch and ancestry check
verify that delivery. After rebasing, the Python/LLM sources and integration
fixture are unchanged from the qualified candidate. Equivalent packaging-walker,
optional-fixture and lint corrections already delivered upstream were retained.

Current maintained checks pass: normal `npm run build`, repository-wide
`npm run lint`, selected Safe Bash `npm test` (704 runner checks, 19 API tests
and root posttest), and maintained exact root packaging selection (202 tests
plus root posttest). Evidence: `out/python-final-synchronized-build.log`,
`out/python-current-full-lint.log`, `out/python-maintained-focused-unit.log`,
`out/python-maintained-packaging-unit-current.log`. These focused checks do not
prove the interrupted full-suite route completed.

Fresh public safe-fs/safe-js/safe-bash tarballs, version
`0.0.0-python-final-1445`, are installed without workspace symlinks under
`out/python-final-consumer-current`. Actual Pyodide/workerd qualification passes
2/2 tests in `out/python-final-installed-workerd.log`, including all four exact
examples, canonical attachments, typed model options/messages/schema/embed,
embedding metadata, bounded incremental binary events, partial timeout bytes,
explicit environment replacement, cancellation and invocation retirement. The
safe-bash tarball SHA-1 is `e0267cc1e8d236ad7c92e2e36d69a504e4f85bab`; npm pack
receipts retain each artifact's full integrity metadata. This candidate receipt
is distinct from published npm bytes. Published 0.1.753 contains the earlier
bridge/shared service and still predates this final adapter.

Issue 1445 remains open: full shared-service parity, final adapter publication,
consumer adoption and compliant hosted authorization/billing/cleanup acceptance
are not yet complete. No extra Worker deployment or release-barrier bypass is
authorized by this checkpoint.

## Publication repair checkpoint

Remote main `2827abdfd13444f418a80194c9f9161c2d0cc045` contains the
publication build repairs and their regressions; fresh fetch and ancestry verify
delivery. Concurrent upstream date/diff fixes were retained, including the full
shared diff matcher fallback. Async stdin for `wc --files0-from=-` reproduced an
internal error before restoring its missing byte-collector import and passes
afterward. Maintained repair/existing-suite verification passes 704 runner checks,
1,431 selected checks and root posttest
(`out/python-publication-repair-combined-unit.log`); the final rebased eight
regressions and ESLint pass separately. Scoped publication run 36555304294
failed on these exact compile errors before this delivery. Full `npm test` is
restarted with persistent log `out/python-full-unit-after-repairs.log` and an
explicit terminal `.exit` receipt; no full-suite success is claimed yet.
Qualifying publication, full service parity and compliant hosted acceptance
remain incomplete, so issue 1445 stays open.
