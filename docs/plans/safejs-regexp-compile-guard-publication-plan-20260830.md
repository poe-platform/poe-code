# SafeJS regex compilation guard: implementation and validation

Date: 2026-08-30. Revision: R7. Status: author scoped GREEN; fresh independent
broader validation, independent public replay and publication HOLD.
Composition base: `8a0a547d26e89e470cc0c74d965f3b099e8a31e9`, preserving String
source `02eb156d801673a1382ad0851c9fbff9a99c4a71`, the prototype fix and Array
source `321979de0d716af8206232756c3ebb65381682c1`. The explicit fast-forward pull
had no upstream overlap with the 33 R6 owned paths. This is not a claim about a
later remote tip or actual release. Integrate the guard before sticky.

## Implementation and compatibility

- Shared compiler preallocation/depth guards cover literals before VM entry,
  RegExp constructors, implicit clones, reconstruction/replay and native export.
  Hard ceilings are 4096 source UTF-16 units, 8 flag units, group depth 64 and
  16384 structural allocation units. Existing lower caller Budget limits still
  apply; repeated physical compilation consumes existing work/data allowances.
- Preserve supported regex semantics below limits, captures, aliases, cursor
  and snapshot behavior. The existing 2000-step matching limit is unchanged and
  is not a compilation limit. No u/y activation or native matching fallback.
- Use explicit Budget owner/generation and checked allocation/handoff. Known
  ticket removal is idempotent and generation-safe, performs no growth/work/
  deadline check, and preserves primary failures and unrelated live charges.
- Keep published String native-callback/context plumbing. Extracted replacement
  callbacks receive real caller compilation/diagnostic context when available;
  context-free calls retain captured-stack fallback. Undefined, bound and arrow
  receiver behavior remains intact. Reentry checks are not weakened.
- Preserve the generator's mutable resume state across per-node compilation
  contexts through trusted internal forwarding, fixing the observed skipped
  second yield without weakening ownership or diagnostic context.
- After successful executable validation and before entrypoint selection,
  hash the already parsed full Module only when it contains a RegexLiteral.
  Legacy single-node parsing refuses those literals and would hash the same
  Module after fallback. Non-regex sources keep the original hashSource path.
  This removes two actual parsing passes, not charges for work still performed.
  No cache, public AST-input API, hash migration or restore-policy change.

## Unified tests and provenance

The tree retains all original 98 cases and adds twelve hash/checkpoint controls.
R7 passed **110/110 across nine owned roots**, with no selector or skips. Actual
root counts relative to `packages/safe-js/src/`:

- `interp/budget.test.ts`: 29; `interp/budget.compile-guard.test.ts`: 6.
- `interp/regex/compile-ingress.test.ts`: 3; `compile-policy.test.ts`: 34.
- `interp/regex/compile-ownership.test.ts`: 11.
- `interp/regex/compile-callback-stack.test.ts`: 1; `compile-callback-receiver.test.ts`: 1.
- `interp/regex/compile-helper-policy.test.ts`: 15; `compile-helper-ownership.test.ts`: 10.

Existing mock ceilings, isolation, original Budget controls and corrected helper
fixtures remain intact. In particular, the admitted real-regex restore helper
still checks exact fatal 3/2 refusal, unchanged failed-restore usage, and positive
same-snapshot/same-Budget restoration after resetting its existing mock ceiling.
The old sourceHash-limit-2 ingress failure remains a separate negative control.

The twelve additions cover eight legacy hash shapes, template substitutions with
tagged and regex raw spelling, an exported default-parameter entrypoint, nested
computed/default/arrow placements and one genuine old checkpoint pair. The fixture
`packages/safe-js/test/fixtures/regexp-compile-hash-ea469.json` was emitted by actual
EA execution at `ea469259a7d61ab2839457863c445bd9f95155cb`; its sourceHash is
`56c6650b`. Public external replay-mode dump captured pending and completed state
without metadata edits. Consumer checks include own-data records, genuine regex
brand/cursor/aliases, full serialized graphs/journals/outcomes/logical counters
and immutability. Pending wait reissues once, completed wait zero times, resume
provider zero times. Both baseline and pre-optimization candidate admitted it.
This finite author fixture is not the independent SDK replay validation.

## R7 observations and retained failures

All R7 acceptance commands exited 0:

- Four unchanged regressions + twelve new controls + six existing generator
  controls: 21 unique passes, because first-yield overlaps; 242 selector exclusions.
  This ran at 14:28:31–14:28:33 UTC on 2026-08-30.
- Nine roots: 110 passes; legacy hash root: 19 passes; parser regex/import.meta
  refusals: 4 passes with 88 selector exclusions.
- Published String: 85 passes; receiver selector: 39 passes with 102 exclusions.
- Owned declaration-resolved types and ESLint over 32 TS paths; formatter check
  over those paths, fixture and then-current plan; strict diff check: pass.

Last heavy command ended 14:30:21 UTC; CPU release was 14:31:54 UTC. This LIGHT
seal changes only this plan, not tested code/fixture bytes; formatting has not
rerun after this documentation update. No R7 build, install, full-root suite or
built SDK/CLI/image rerun occurred. Earlier R5's 22 workspace builds, installation
and visual checks are historical evidence, not validation of these R7 repairs.

Independent R6 default validation remains recorded as 9164 pass, four failures,
49 skipped and one load failure. The 49 comprise 39 configured skips and ten
setup-blocked O12 cases; O12 later passed separately after builds. The four
original failures are now focused GREEN without changing budgets or assertions,
but the default suite has not rerun here. R6's broader-than-intended 68-task build
is also retained as R6 evidence, not a new R7 build claim.

The generator and hash-elimination design received Laplace's bounded READY review,
SHA-256 `569e7d147c2298a8decf33aa157ed0b3c23fafb1aba0c0f3e9b3c61b9de9af73`.
Current implementation still needs fresh independent review. Original literal,
A/B, stack/receiver and helper-fixture failures remain preserved locally. R7's
default-dump reentry and non-async spy-wrapper graph mismatch are retained too:
the approved public replay-mode capture and a real async binding with separate
counter fixed the harness, not the expected snapshot graph or production policy.

For the small failures, retained observations were 1001 compiler/zero VM visits;
source analysis explains 452 + 452 + 97 during repeated hash parsing. Workflow
observation was 9392 compiler + 609 other visits. Predicted post-elimination
totals of 898 overall for the small case and 7095 compiler units for the workflow
remain source-derived forecasts, not freshly measured counters or test oracles.
What is now observed is success under unchanged 1000/10000 budgets.

The final union is **34 paths: 23 production, nine test roots, one genuine fixture
and this plan**. Only the fixture is new relative to R6's 33-path union. Local
author receipts and failed full-source capsules are excluded from publication.
The read-only seal supplies current-base preimages, exact postimages, a portable
patch and a minimal historical receipt index; no old capsule must be applied.

## Independent SDK replay remains held

Approved observer-correction handoff:
`/tmp/poe-safejs-compile-independent-r6-20260830/out/safejs-remediation/compile-guard-sdk-observer-correction-20260830/manifest.json`,
SHA-256 `16f55fbb5dbdf9e9f3645e12fc3e5bf6730094261b750bb9094e96f7a6aa1d01`.
It is static preparation, not an executed pass. The original comparison failed
on native ordinary-prototype versus guest null-prototype return records. Approved
assertions separately check prototypes, exact keys, own data descriptors and seven
primitive values, retaining raw graphs. Do not normalize away prototype differences
or generalize this fixture correction. Independent public pending/completed regex
replay, complete journals and zero-reissue checks remain held for reviewer execution.

## README and SDK/CLI handoff

Document the existing-limit interaction and deterministic fatal budget/refusal
contract, including literals compiled before VM execution. Sequential idle Budget
reuse is supported; refusing an exported stale wrapper after its Budget generation
is reused is a **new restriction**, not an old compatibility guarantee. Physical
recompilation consumes work independently of unchanged logical replay counters;
do not promise success under equal tight budgets before and after reconstruction.

SDK and CLI continue to use their existing Budget/configuration surfaces; there
are no new public options or environment variables. The following are exact
historical R5 checks against its locally built SDK entrypoint, not an installed
npm release or an R7 rerun:

```js
import { Budget, SandboxError, run } from "./packages/safe-js/dist/index.js";

await run("return /abc/.source;", { budget: new Budget({ stringLength: 3 }) });
await run("return /abcd/.source;", { budget: new Budget({ stringLength: 3 }) });
```

The first call resolves with `ok: true` and `returnValue: "abc"`. The second
rejects with an actual SandboxError, rather than returning `ok: false`: exact
fields are `code: "budgetExceeded"`, `budget: "stringLength"`, `current: 4`,
`limit: 3`. The verification caught and asserted that rejection; the SDK
verification process exited 0. Consumers must handle the existing fatal channel.

The CLI fixture contains exactly `return /abc/.source;`. Actual built-entrypoint
commands used the existing work-budget option, not a new string-limit flag:

```sh
fixture=/tmp/poe-safejs-compile-unified-r5-20260830/regex-boundary.safejs
node packages/safe-js/dist/cli.js --max-steps 1000 "$fixture"
node packages/safe-js/dist/cli.js --max-steps 1 "$fixture"
```

The first command exits 0, stdout is `{"ok":true,"returnValue":"abc"}`, stderr
is empty. The second exits **3**, stdout is empty, and stderr is:

```text
SandboxError: Sandbox budget exceeded for steps: 2 > 1.

Budget exceeded: steps (2 > 1)
```

The two SDK cases test the caller's literal source-size boundary; the CLI pair
tests existing physical work accounting during compilation. They are different
boundaries and do not imply a CLI stringLength option. Both CLI results were
also captured with the existing screenshot runner against the built entrypoint,
without root predev. The screenshot wrapper exits 0 for each saved image; the
over-limit child still exits 3. Both PNGs were visually inspected: complete,
readable, unclipped success/error output. Image identities in the receipt root:

- `screenshot-under.png`: `978257d139b9b84253a51877b9e1cc7191c6dedac59c992eada1ed1d25394608`.
- `screenshot-over.png`: `a2b588c31ab145cfeeea6d2bc3dea1198dc5ea21d2fcfc6923d9b1097a7f4507`.

Bounded compilation/export is not a universal native-resource or security
guarantee; no native exhaustion exploit, native matching failure or fallback is
asserted. Preserve existing host-export semantics except the explicitly reviewed
malformed-data refusal. These scoped author results do not replace independent
review, publisher gates or validation of an actual release.

Curie owns README integration: the earlier 41f packet may need rebasing onto the
current String/Array README before approval. This author does not edit it. Pair
the approved README with source only after fresh independent validation and the
publisher's normal integration/hooks/gates; preserve newer applicable main.
There is no full-root pass, current built-SDK pass or publication approval here.
