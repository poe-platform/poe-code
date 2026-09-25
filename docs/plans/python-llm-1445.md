# Python LLM library — issue 1445

## Objective and implementation sequence

Ship a usable customizable Python library backed by the shared JavaScript LLM
service. Keep JavaScript responsible for providers, authorization, billing and
canonical filesystem access. Implement typed Python workflows and fake-bridge
tests first; integrate the versioned #1443 service through the #1444 invocation
bridge; qualify an independently installed public package in real Pyodide/workerd;
then qualify the established hosted consumer lane. Commit and deliver verified
changes to remote main. Close only when every requirement is evidenced.

Dedicated locked worktree: `/Users/kjopek/Workspace/poe-code-write-a-customi-1445`.
Branch: `poe-code-write-a-customi-1445`. Initial fetched remote main: `9d60411216`.
Owner: `codex:01a0d9b1-6fa3-77e0-a91b-8bf47c8016fa`.
Temporary evidence belongs in this worktree's `out/` and is purged after use.

## Requirement audit

| Requirement | Current evidence | Completion |
| --- | --- | --- |
| 1. Bundled importable module, typed requests/responses/exceptions, distinct name | Python `poe_llm` source bundled with both launchers; registration and typed API covered in `tests/plugins/python-llm.test.ts` | API and source Pyodide import verified; installed-package verification pending |
| 2. Discovery/selection, prompts/messages/options/files, responses/streaming and applicable service parity | Fake-bridge API covers core, conversation, template/schema fields and embeddings | Incomplete: shared-service parity matrix and adapter pending #1443 |
| 3. Defaults, prompt functions, conversations, transforms and composition | Deterministic Python API tests | Implemented against Python bridge protocol |
| 4. Invocation-scoped JavaScript capability, no guest credentials/host objects | Default client refuses absent capability; Python retains identities/options/paths | Incomplete: #1444 bridge absent |
| 5. Async calls/iteration, cleanup, actual launcher scripts, cancellation and limits | Fake-bridge cancellation/early exit/timeout/cleanup tests; ordinary-file examples use existing JSPI run_sync boundary | Incomplete: examples require real capability qualification |
| 6. Canonical filesystem; no copied workspace/subprocess/provider HTTP | Attachment API sends paths; Python uses ordinary canonical file APIs for output | Source design verified; real agent attachment acceptance pending |
| 7. Authenticated distribution/public consumption/provider-neutral config | Source installed by both launchers; no package downloads or provider-specific config | Maintained build passed; packed public consumer qualification pending |
| Pure Python deterministic fake-bridge acceptance | Eleven Python unittest cases executed from Node without creating files | Passing scoped evidence |
| Equivalent Bash/Python requests reach same JS provider | #1443 contract requested in issue comments | Pending |
| Independent installed package + real Pyodide/workerd imports/lists/completes/streams/attachment/cancel | Requires bridge and shared-service integration | Pending |
| Hosted options/auth/billing/no callback or private-file leaks | Named `/Users/kjopek/Workspace/poe2` checkout absent; hosted lane requested from user | Pending; not waived |
| Documentation/examples/matrix/limits | `packages/safe-bash/docs/python-llm.md`, ordinary Python examples | Written; working real-runtime examples not yet verified |
| Package publication | Separate delivery evidence needed | Unverified; user says no full-release wait |
| poe2 adoption | Separate consumer source/CI evidence needed | Unverified |

## Qualification still required

1. Agree on and implement the shared-service adapter and bridge contract. Do not
   substitute CLI strings, buffered attachment copies or duplicate provider clients.
2. Exercise complete and stream operations with the same injected provider through
   Bash and Python, preserving semantic results and typed options.
3. Install packed public artifacts independently; run maintained real
   Pyodide/Miniflare checks for delayed calls, attachments, streaming, cancellation,
   concurrent invocation authority and callback retirement.
4. Qualify the established hosted lane with correct authorization/billing context
   and leak checks. Record publication and consumer adoption separately.
5. Reconcile this matrix with current completion evidence before issue closure.

No partial delivery authorizes closing #1445 or its dependency issues.

## Verified milestone (not full acceptance)

- Maintained selected workspace build closure and final safe-bash package build passed.
- Maintained focused unit route passed 86/86 tests, including eleven pure Python API cases.
- Maintained runner route passed 622/622 tests.
- Source Pyodide/workerd integration passed 10/10 tests: all eight lifecycle scenarios
  retain individual 30-second bounds; candidate publication requires each to pass.
  Native evidence recorded 61 requests, 96 callback modules, zero unhandled Worker
  errors and no finalization failures. This verifies lazy module import and existing
  filesystem/lifecycle behavior, not actual JavaScript LLM calls.
- Runtime qualification reproduced a delayed guest timer callback during teardown;
  Python asyncio handles now cancel before exception reporting and output flushing,
  while immediate task wakeups and cleanup scheduling remain available.

Shared-service equivalence, real LLM operations, independent installed runtime,
working capability-backed examples and hosted authorization/billing/leak checks
remain incomplete. Dependencies #1443 and #1444 remain open; their initial or absent
implementations do not satisfy the typed service/bridge contract. Publication and
poe2 adoption are unverified and separately tracked.
