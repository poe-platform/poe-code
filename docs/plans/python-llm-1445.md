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
| 4. Invocation-scoped JavaScript capability, no guest credentials/host objects | Default client refuses absent capability; Python retains identities/options/paths | Invocation-scoped native JSPI dispatcher and shell adapter implemented; real LLM adapter pending |
| 5. Async calls/iteration, cleanup, actual launcher scripts, cancellation and limits | Fake-bridge cancellation/early exit/timeout/cleanup tests; ordinary-file examples use existing JSPI run_sync boundary | Incomplete: examples require real capability qualification |
| 6. Canonical filesystem; no copied workspace/subprocess/provider HTTP | Attachment API sends paths; Python uses ordinary canonical file APIs for output | Source design verified; real agent attachment acceptance pending |
| 7. Authenticated distribution/public consumption/provider-neutral config | Source installed by both launchers; no package downloads or provider-specific config | Maintained build passed; packed public consumer qualification pending |
| Pure Python deterministic fake-bridge acceptance | Fourteen Python unittest cases executed from Node without creating files | Passing scoped evidence |
| Equivalent Bash/Python requests reach same JS provider | #1443 contract requested in issue comments | Pending |
| Independent installed package + real Pyodide/workerd imports/lists/completes/streams/attachment/cancel | Requires bridge and shared-service integration | Pending |
| Hosted options/auth/billing/no callback or private-file leaks | Consumer source fetched from `poe-internal/poe2`; existing object-I/O lane does not qualify LLM calls | Pending; not waived |
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
- Maintained focused unit route passed 86/86 tests, plus the final thirteen-case pure Python API suite.
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

Checkout integration was rebased without conflict onto `85ac23ec97`. The missing
ImageMagick workspace lock entry was reproduced by `npm ci`, then repaired by
regenerating the lockfile against current declarations; no checkout conflict is
being treated as an acceptance blocker. Consumer source is now available locally
from `https://github.com/poe-internal/poe2`: its `shell-python.ts` has no LLM binding,
`execute-shell-llm.ts` rejects options, and `qualify-python-object-io.yml` targets
object I/O. Hosted LLM qualification requires implementing and exercising those
missing bindings, not merely running the existing object-I/O workflow.

Final review additionally reproduced cancellation after worker factory/subscription
under the newly managed shell signals. Python executors and provisioning now use
`combineManagedSignals`; the 86-test focused route and 71 provisioning/environment
tests pass. Two new fake-bridge regressions reproduced completion customization
escaping timeout/cleanup ownership; all fourteen Python cases now pass with the
whole completion operation tracked. The frozen final package build passed.
Guarded repository ESLint exited 0: 18,019 selected files, zero errors, 65 warnings,
complete traversal and receipts. Typechecking and installed-runtime qualification
are recorded only after successful final exits; compiler timeouts are not passes.

Consumer source inspected at
[`09eae133d8a3b81f32dc35d291951810df3c7ad8`](https://github.com/poe-internal/poe2/tree/09eae133d8a3b81f32dc35d291951810df3c7ad8).

## Current continuation evidence

The independently installed public package passed all eleven workerd lifecycle
and shell scenarios after the scoped-filesystem managed-signal fix. Expanded
configured-rg qualification then reproduced native AbortSignal.any rejecting
managed signals in the regex executor; the managed combiner replacement passes
64 focused regex tests. The expanded installed gate must pass against the rebuilt
candidate before claiming this fix qualified. Shared scalar options pass 53
service/provider tests. Fourteen pure Python API cases now pass, including
rejecting integers outside JavaScript's safe integer range before dispatch.

The shell surface includes literal argv, explicit scripts, bounded capture and
pull streaming, ordinary subprocess.run/check_output, separate binary streams,
child cwd/env/input, timeout/check, canonical files, and bounded interpreter
reentry refusal. Its expanded real-runtime tests cover configured rg, pipelines,
nonzero exits, deadlines, output limits, nested Python, binary round trips and
early streaming close. Final rebuilt-runtime qualification remains pending.

No code has been delivered to remote main in this continuation. The actual LLM
adapter, service messages/schema/embedding support, same-provider semantic
comparison and hosted auth/billing/options/leak lane are still required. Issue
1445 and dependency issues remain open. Current build/typecheck/lint/full-test
qualification must follow the final source changes, not reuse earlier passes.

## Verified public adapter milestone

Fresh independently installed public packages passed the expanded eleven-test
workerd/Pyodide gate, including configured rg, deadlines, output limits, direct
and script nested-Python refusal, binary canonical file round trips and stream
cleanup. A second fresh installed candidate also passed eleven tests with actual
poe_llm model discovery, completion, incremental streaming, canonical attachment
reads, typed options and early stream retirement through createLlmService.
The JavaScript fixture counted all three provider iterators retired. This is
host-injected service qualification, not hosted authorization/billing acceptance.

The adapter's same-provider Bash/Python test passes model resolution, canonical
attachment equivalence and typed options. Common service embedding delegation,
message validation and OpenAI conversation/schema serialization pass 56 focused
tests after reproduced failures. These newest shared-contract additions require
fresh build/typecheck/runtime verification before final delivery.

Local atomic commits: e6ae2c5a9a (regex managed cancellation), 47223613b4
(scalar provider options), 6fd9b6b39c (Python safe integer validation).
No remote-main delivery or publication is claimed. Hosted consumer integration,
full supported-feature qualification, per-call host deadlines, final docs and
maintained final lint/test checks remain required before issue closure.
