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

## Shell stream fragmentation checkpoint

Consumer reproduction tracked in #4185 confirms that a single 256 KiB command
write exceeded the finite bridge envelope while sixteen 16 KiB writes succeeded.
The shell adapter now fragments stdout/stderr before array serialization and
awaits each fragment's admission. `maxStreamChunkBytes` is validated and defaults
to 16 KiB; callers retain cumulative output and serialized-stream limits. Buffered
subprocess results keep their separate whole-result envelope requirement.

The repair is delivered on remote main `4d791e9b88`, verified by fresh fetch and
ancestry. Concurrent upstream CSV publication fixes were preserved; added CSV
regressions remain. Maintained selected verification passes 704 runner checks,
84 selected tests and root posttest (`out/python-shell-csv-maintained.log`);
rebased regressions and lint pass. Coverage includes mixed binary output, exact
chunks and remainder, backpressure, early close during large writes, byte order
and one exit event. Source workerd passes 2/2. Fresh independent public tarballs
`0.0.0-python-shell-1445` installed without workspace symlinks pass actual
Pyodide/workerd 2/2, including a single 256 KiB shell write under finite native
limits (`out/python-shell-installed-workerd.log`); safe-bash SHA-1 is
`18ebb98a2f0df61f1a091fb7c6e4dbaa34979dc7`.

The previous full-suite restart terminated during build because new workspace
links were absent. Current declared dependencies have been installed; that failed
run is not full-suite success. Qualifying publication, full shared-service parity
and compliant consumer/hosted acceptance remain pending.

## Host-owned LLM budgets and text streaming checkpoint

Delivered on remote main `4016ddc5467bce573fde039f23edf64242ff8288`;
fresh fetch verified the exact remote head. Buffered completions now enforce
host-owned serialized response, raw event and terminal metadata ceilings before
retaining output. Empty events count without accumulating text fragments, JSON
escaping and numeric byte-array expansion count, and guest limits cannot raise
host policy. Streaming retains an independent cumulative budget and fragments
text at Unicode scalar boundaries before serialization. The public options are
`maxBufferedResponseBytes`, `maxBufferedEvents`, `maxMetadataBytes` and
`maxStreamChunkBytes`; finite deployment policies remain explicitly configured.

The observed red regressions are retained in
`out/python-llm-budgets-confirmed-red.log`. Maintained focused verification passes
706 runner checks, 12 selected tests and root posttest
(`out/python-llm-budgets-maintained.log`); rebased adapter tests pass 11/11 and
ESLint passes. Integration input registration passes 141 checks. Actual source
Pyodide/workerd passes 4/4 (`out/python-llm-budgets-workerd-source.log`), including
provider disposal after limit errors and early close, one terminal event, exact
2.1 MiB Unicode text written incrementally to the canonical filesystem and the
existing large binary stream under a separate 8 KiB buffered ceiling.

Publication `.754` is independently confirmed from source
`0a4e96adffbe183882ad196cacbbb58192b9b20f`; it contains the previous adapter and
shell fragmentation, not this budget repair. Scoped run `36595943486` tracks the
new delivered commit. Independent repaired-artifact installation is in progress;
packaging required fresh locale generation and upstream root-export mapping.
The maintained normal build is running to supply all public-package prerequisites.
No full release success is claimed.

Requirement checkpoint: importable typed/customizable Python library, explicit
shared-service routing, async cleanup, canonical files, bundled distribution and
shell/subprocess subset have prior implementation/runtime evidence; current
host bounds and text fragmentation pass focused/source gates; full #1443 parity,
repaired public artifact qualification/publication, poe2 adoption and hosted
model-option/auth/billing/private-file/callback acceptance remain open.

The earlier remote full runner remains unobserved on this tool host and was not
restarted; its terminal receipt must be reconciled before another full run.
Issue 1445 remains open, and #4185 ownership/tracking remains separate.

Independent repaired public artifacts now qualify: the normal maintained build
completed successfully, then `scripts/package-safe.mjs` assembled all three
libraries at `0.0.0-python-bounds-1445`. Real npm tarballs installed with scripts
disabled into `out/python-bounds-consumer`, without workspace symlinks. Actual
Pyodide/workerd passes 4/4 (`out/python-bounds-installed-workerd.log`), including
bounded buffered responses/empty events/metadata, Unicode fragmentation and
canonical file streaming, provider cleanup, shell/subprocess examples and
100 MiB authoritative publication/cancellation recovery. Safe Bash SHA-1 is
`1173260b16d0933da2b8e2247fd970c4509f7293`; the complete integrity receipt is
`out/python-bounds-pack-receipt.json`. This is an independently installed local
candidate, not registry publication or hosted acceptance. Repaired publication,
full shared-service parity, poe2 adoption and hosted acceptance remain open.

## Publication and consumer reconciliation

Registry `.758` has Safe Bash SHA-1
`553f2fe9a0d94b2a7ed0edd1d07f8c2c27627899`. Its fetched SLSA provenance identifies
source `9badb683a5b817dc48b20447c01a7cb06a10ad67` and run `36593867946`, which
predate the host-budget repair. Repair run `36595943486` completed successfully
only as a coalesced skip: publication and public verification were skipped, so it
is not qualifying publication evidence. Maintained pinned-main scoped run
`36598809221`, source `26517cdd9de731b7bdfddc22fb4ce5b05eef369c`, is confirmed
pending; that source contains the delivered repair. No duplicate workflow run
was launched after this confirmed dispatch.

Public library budget documentation is updated on remote main `7ade7e8025`.
Consumer PR16569 remains open at `aef9917150660d62386b94859e77149ff62804af`;
its applicable CI checks pass, but this proves neither merge nor repaired-package
adoption. #1443 remains active with incomplete parity/transport delivery.
Hosted lane is poe2 issue474 (not poe-code issue474). Its paired run36589890202
failed production apply-poe at the bundled Convex CLI credential check; Worker
deployments were skipped and later Joiner cleanup lacks verification state.
No credential failure cause is inferred and no alternative deployment is used.

Issue comment16138 supplies terminal observation for the previous remote full
unit runner: exit1, shared batch SIGTERM and none of recorded PIDs present.
First two batches passed500 files/25,672 tests; this is incomplete full validation,
not a passing suite or assertion failure. Original remote log/exit preservation
and cause reconciliation remain outstanding; no replacement full suite was
started from an expired observation. Current focused repair gates remain valid.
